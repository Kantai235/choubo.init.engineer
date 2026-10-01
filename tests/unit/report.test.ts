import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { groups } from '../../src/domain/model'
import { categories } from '../../src/domain/seeds'
import { balances, project } from '../../src/domain/ledger'
import { cashFlowSummary } from '../../src/domain/report'
import { createAccount, post, transaction, op, account } from './fixtures'

describe('requirements audit: seeds, accounts and cash-flow reports', () => {
  it('retains every expense and other category name in the requirements appendices', () => {
    const spec = readFileSync('docs/requirements/system-analysis-and-requirements.md', 'utf8')
    const appendix = spec.split('## 附錄 A')[1]!.split('## 附錄 C')[0]!
    for (const row of appendix.split('\n').filter((r) => r.startsWith('| '))) {
      const [, name, children] = row.split('|').map((s) => s.trim())
      if (!children?.includes('、')) continue
      const parent = categories.find((c) => c.kind === 'expense' && c.name === name && !c.parentId)
      const kind = {
        收入: 'income',
        轉帳: 'transfer',
        應收款項: 'receivable',
        應付款項: 'payable',
        系統: 'system',
      }[name!]
      const actual = categories
        .filter((c) => (parent ? c.parentId === parent.id : c.kind === kind))
        .map((c) => c.name)
      expect(actual, name).toEqual(children.split('、'))
    }
  })
  it('AT02: preserves two independent accounts in each of the ten groups through regrouping and archive', () => {
    const accounts = groups.flatMap((group, g) =>
      [0, 1].map((n) =>
        op(`create:${g}:${n}`, {
          type: 'account.put',
          baseVersionId: null,
          account: { ...account(`${g}:${n}`, `${g * 100 + n}`), group },
        }),
      ),
    )
    const before = project(accounts)
    expect(before.accounts).toHaveLength(20)
    for (const group of groups)
      expect(before.accounts.filter((a) => a.group === group)).toHaveLength(2)
    const after = project([
      ...accounts,
      op('edit', {
        type: 'account.put',
        baseVersionId: 'create:0:0',
        account: { ...account('0:0', '0'), group: '銀行', archived: true },
      }),
    ])
    expect(after.accounts.find((a) => a.id === '0:0')).toMatchObject({
      group: '銀行',
      archived: true,
    })
    expect(balances(after)).toEqual(balances(before))
  })
  it('AT03: opening 1000 plus income 500 minus expenses 200 has balance 1300 and reports only cash flows', () => {
    const income = {
      ...transaction('salary'),
      kind: 'income' as const,
      lines: [
        {
          id: 'salary',
          categoryId: 'income:0',
          name: '薪水',
          amount: '500',
          destinationAmount: '',
        },
      ],
    }
    const ledger = project([createAccount(), post(income), post()])
    expect(cashFlowSummary(ledger, 'TWD', '2026-10')).toEqual({
      balance: '1300',
      income: '500',
      expense: '200',
    })
  })
  it('excludes only reconciliation lines by default, including mixed lines, without changing the balance', () => {
    const adjustment = categories.find((c) => c.kind === 'expense' && c.name === '對帳差額')!
    const tx = transaction()
    tx.lines[1]!.categoryId = adjustment.id
    const ledger = project([createAccount(), post(tx)])
    expect(cashFlowSummary(ledger, 'TWD', '2026-10')).toEqual({
      balance: '800',
      income: '0',
      expense: '60',
    })
    expect(cashFlowSummary(ledger, 'TWD', '2026-10', true).expense).toBe('200')
  })
  it('AT07: excluding an account removes its balance, not its spending, and never combines currencies', () => {
    const excluded = op('exclude', {
      type: 'account.put',
      baseVersionId: 'create:cash',
      account: { ...account(), includeInTotal: false },
    })
    const ledger = project([createAccount(), post(), excluded, createAccount('usd', '100', 'USD')])
    expect(cashFlowSummary(ledger, 'TWD', '2026-10')).toEqual({
      balance: '0',
      income: '0',
      expense: '200',
    })
    expect(cashFlowSummary(ledger, 'USD', '2026-10')).toEqual({
      balance: '100',
      income: '0',
      expense: '0',
    })
  })
  it('reversal and month filters affect reports without removing historical balances', () => {
    const ledger = project([createAccount(), post()])
    expect(cashFlowSummary(ledger, 'TWD', '2026-09')).toEqual({
      balance: '800',
      income: '0',
      expense: '0',
    })
    const reversed = project([
      createAccount(),
      post(),
      op('reverse', { type: 'transaction.reverse', transactionId: 'purchase', reason: '重複' }),
    ])
    expect(cashFlowSummary(reversed, 'TWD', '2026-10')).toEqual({
      balance: '1000',
      income: '0',
      expense: '0',
    })
  })
})
