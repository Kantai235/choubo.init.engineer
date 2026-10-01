import { describe, it, expect } from 'vitest'
import { DateTime } from 'luxon'
import { canonical } from '../../src/domain/model'
import { balances, project, validateTransaction, draftHeads } from '../../src/domain/ledger'
import { sum, formatMoney, exactAmount } from '../../src/domain/money'
import { categories, currencies } from '../../src/domain/seeds'

import { at, account, op, createAccount, transaction, post, draft } from './fixtures'

describe('exact money and complete seeds', () => {
  it('adds decimals without floating point loss, including amounts beyond safe Number integers', () => {
    expect(sum(['0.1', '0.2'])).toBe('0.3')
    expect(sum(['9007199254740993.01', '0.09'])).toBe('9007199254740993.1')
    expect(formatMoney('9007199254740993.1')).toBe('9,007,199,254,740,993.10')
  })
  it('rejects accidental precision loss instead of rounding silently', () => {
    expect(() => exactAmount('1.234', 2)).toThrow('2 位')
    expect(() => exactAmount('1e3', 2)).toThrow()
    expect(exactAmount('0.000000000000000001', 18)).toBe('0.000000000000000001')
  })
  it('retains every original category and supported currency type', () => {
    expect(categories.filter((c) => c.kind === 'expense' && c.parentId)).toHaveLength(93)
    expect(categories.filter((c) => c.kind === 'expense' && !c.parentId)).toHaveLength(12)
    expect(categories.filter((c) => c.kind === 'income')).toHaveLength(9)
    expect(new Set(categories.map((c) => c.id)).size).toBe(categories.length)
    expect(currencies.some((c) => c.id === 'ETH' && c.precision === 18)).toBe(true)
  })
})
describe('ledger projection', () => {
  it('AT44: two lines debit once, initial money is not an income transaction', () => {
    const ledger = project([createAccount(), post()])
    expect(balances(ledger).cash).toBe('800')
    expect(ledger.transactions).toHaveLength(1)
    expect(ledger.conflicts).toEqual([])
  })
  it('AT04: conserves a transfer, charging net fees only at the source', () => {
    const tx = {
      ...transaction(),
      kind: 'transfer' as const,
      targetAccountId: 'bank',
      fee: '15',
      feeDiscount: '5',
      lines: [
        {
          id: 'one',
          categoryId: 'transfer:0',
          name: '存入',
          amount: '500',
          destinationAmount: '500',
        },
      ],
    }
    const ledger = project([createAccount('cash', '2000'), createAccount('bank', '100'), post(tx)])
    expect(balances(ledger)).toEqual({ cash: '1490', bank: '600' })
  })
  it('AT05: preserves both currencies and the exact exchange amounts', () => {
    const tx = {
      ...transaction(),
      kind: 'transfer' as const,
      targetAccountId: 'usd',
      fee: '30',
      lines: [
        {
          id: 'one',
          categoryId: 'transfer:4',
          name: '換匯',
          amount: '3200',
          destinationAmount: '100',
        },
      ],
    }
    expect(
      balances(
        project([createAccount('cash', '10000'), createAccount('usd', '0', 'USD'), post(tx)]),
      ),
    ).toEqual({ cash: '6770', usd: '100' })
  })
  it('deduplicates retries but preserves same-ID/different-content conflicts', () => {
    expect(balances(project([createAccount(), post(), post()])).cash).toBe('800')
    const other = post()
    if (other.command.type === 'transaction.post') other.command.transaction.lines[0].amount = '70'
    const ledger = project([createAccount(), post(), other])
    expect(ledger.conflicts).toHaveLength(1)
    expect(balances(ledger).cash).toBe('1000')
  })
  it('blocks different operation IDs that attempt to submit the same draft twice', () => {
    const second = { ...post(), id: 'another-device' }
    const ledger = project([createAccount(), post(), second])
    expect(ledger.transactions).toHaveLength(0)
    expect(ledger.conflicts).toHaveLength(1)
  })
  it('account forks preserve uncontested history and block dependent records', () => {
    const a = op('edit-a', {
      type: 'account.put',
      baseVersionId: 'create:cash',
      account: { ...account(), name: 'A' },
    })
    const b = op('edit-b', {
      type: 'account.put',
      baseVersionId: 'create:cash',
      account: { ...account(), name: 'B' },
    })
    const ledger = project([b, post(), createAccount(), a])
    expect(ledger.accounts[0].name).toBe('cash')
    expect(ledger.transactions).toHaveLength(0)
    expect(ledger.conflicts.length).toBeGreaterThan(0)
  })
  it('archiving later retains earlier transactions and account balances', () => {
    const archive = op('archive', {
      type: 'account.put',
      baseVersionId: 'create:cash',
      account: { ...account(), archived: true },
    })
    expect(balances(project([archive, post(), createAccount()])).cash).toBe('800')
  })
  it('reversal is idempotent and retains the original record', () => {
    const reverse = op('reverse:purchase', {
      type: 'transaction.reverse',
      transactionId: 'purchase',
      reason: '重複',
    })
    const ledger = project([reverse, createAccount(), post(), reverse])
    expect(balances(ledger).cash).toBe('1000')
    expect(ledger.transactions).toHaveLength(1)
  })
  it('does not accept unknown or future dates as posted expenses', () => {
    const accounts = project([createAccount()]).accounts
    expect(() => validateTransaction({ ...transaction(), date: '2026-02-30' }, accounts)).toThrow(
      '有效日期',
    )
    expect(() =>
      validateTransaction({ ...transaction(), date: '2026-10-03' }, accounts, DateTime.fromISO(at)),
    ).toThrow('未來日期')
  })
  it('does not allow silent same-currency differences or fees on hidden fields', () => {
    const accounts = project([createAccount(), createAccount('bank')]).accounts
    expect(() =>
      validateTransaction({ ...transaction(), fee: '10' }, accounts, DateTime.fromISO(at)),
    ).toThrow('只在轉帳')
    const tx = {
      ...transaction(),
      kind: 'transfer' as const,
      targetAccountId: 'bank',
      lines: [
        {
          id: 'line',
          categoryId: 'transfer:0',
          name: '轉帳',
          amount: '100',
          destinationAmount: '90',
        },
      ],
    }
    expect(() => validateTransaction(tx, accounts, DateTime.fromISO(at))).toThrow('本金必須相同')
  })
  it('keeps leading zeroes in invoice random codes', () => {
    expect(project([createAccount(), post()]).transactions[0].randomCode).toBe('0001')
  })
})
describe('draft revision graphs', () => {
  it('keeps parallel revisions instead of last-writer-wins', () => {
    expect(
      draftHeads([draft('a'), draft('b', ['a']), draft('c', ['a'])])
        .map((d) => d.revisionId)
        .sort(),
    ).toEqual(['b', 'c'])
  })
  it('an explicit choice joins both previous heads', () => {
    expect(
      draftHeads([draft('a'), draft('b', ['a']), draft('c', ['a']), draft('d', ['b', 'c'])]).map(
        (d) => d.revisionId,
      ),
    ).toEqual(['d'])
  })
  it('canonical serialization ignores property insertion order', () => {
    expect(canonical({ a: '1', b: ['2'] })).toBe(canonical({ b: ['2'], a: '1' }))
  })
})
