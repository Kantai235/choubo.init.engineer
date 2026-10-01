import { DateTime } from 'luxon'
import {
  canonical,
  accountSchema,
  transactionSchema,
  type Account,
  type AccountView,
  type Operation,
  type Ledger,
  type Transaction,
  type Draft,
} from './model'
import { currency, categories } from './seeds'
import { exactAmount, money, Money, sum } from './money'

export function validateAccount(input: Account): Account {
  const value = accountSchema.parse(input)
  value.openingBalance = exactAmount(value.openingBalance, currency(value.currencyId).precision)
  return value
}

export function validateTransaction(
  input: Transaction,
  accounts: AccountView[],
  now = DateTime.now().setZone('Asia/Taipei'),
): Transaction {
  const tx = transactionSchema.parse(input)
  const account = accounts.find((a) => a.id === tx.accountId)
  if (!account || account.archived) throw new Error('請選擇可使用的帳戶')
  const precision = currency(account.currencyId).precision
  const date = DateTime.fromISO(`${tx.date}T${tx.time}`, { zone: 'Asia/Taipei' })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tx.date) || !/^\d{2}:\d{2}$/.test(tx.time) || !date.isValid)
    throw new Error('請填寫有效日期與時間')
  if (date.toMillis() > now.endOf('minute').toMillis())
    throw new Error('未來日期請先保留草稿；目前只提供立即入帳')
  if (new Set(tx.lines.map((l) => l.id)).size !== tx.lines.length)
    throw new Error('明細識別重複，請重新新增明細')
  let destination: AccountView | undefined
  if (tx.kind === 'transfer') {
    destination = accounts.find((a) => a.id === tx.targetAccountId)
    if (!destination || destination.archived || destination.id === account.id)
      throw new Error('請選擇不同且可使用的轉入帳戶')
  } else if (tx.targetAccountId) throw new Error('收入與支出不能包含轉入帳戶')
  tx.lines = tx.lines.map((line) => {
    const category = categories.find((c) => c.id === line.categoryId && c.kind === tx.kind)
    if (!category || categories.some((c) => c.parentId === category.id))
      throw new Error('請為每行明細選擇分類子項目')
    if (tx.kind === 'transfer' && category.name === '退款')
      throw new Error('退款須使用關聯退款流程，目前請先保留草稿')
    if (!line.name.trim()) throw new Error('請填寫每行明細的名稱')
    const amount = exactAmount(line.amount, precision, true)
    let destinationAmount = ''
    if (destination) {
      destinationAmount = exactAmount(
        line.destinationAmount,
        currency(destination.currencyId).precision,
        true,
      )
      if (destination.currencyId === account.currencyId && !money(amount).equals(destinationAmount))
        throw new Error('同幣轉帳的轉入與轉出本金必須相同，手續費另填')
    }
    return { ...line, name: line.name.trim(), amount, destinationAmount }
  })
  tx.fee = exactAmount(tx.fee || '0', precision)
  tx.feeDiscount = exactAmount(tx.feeDiscount || '0', precision)
  if (
    money(tx.fee).isNegative() ||
    money(tx.feeDiscount).isNegative() ||
    money(tx.feeDiscount).gt(tx.fee)
  )
    throw new Error('手續費折扣須介於 0 與手續費之間')
  if (tx.kind !== 'transfer' && (!money(tx.fee).isZero() || !money(tx.feeDiscount).isZero()))
    throw new Error('此表單只在轉帳時收取手續費')
  return tx
}

export function total(tx: Transaction) {
  return sum(tx.lines.map((l) => l.amount || '0'))
}
export function netFee(tx: Transaction) {
  return money(tx.fee || '0')
    .minus(tx.feeDiscount || '0')
    .toFixed()
}

// Materialize immutable operations. Forks remain conflicts; clocks never choose
// a financial winner. Uncontested ancestors remain visible and reconstructible.
export function project(operations: Operation[]): Ledger {
  const ledger: Ledger = {
    accounts: [],
    transactions: [],
    reversed: [],
    conflicts: [],
    defaultAccountId: '',
    defaultVersionId: null,
  }
  const unique = new Map<string, Operation[]>()
  for (const op of operations) {
    const bucket = unique.get(op.id) ?? []
    if (!bucket.some((old) => canonical(old) === canonical(op))) bucket.push(op)
    unique.set(op.id, bucket)
  }
  const usable: Operation[] = []
  for (const [id, versions] of unique) {
    if (versions.length > 1)
      ledger.conflicts.push({
        id,
        message: '相同操作有不同版本，相關項目暫停入帳',
        operationIds: [id],
      })
    else usable.push(versions[0])
  }
  const accountOps = usable.filter((op) => op.command.type === 'account.put')
  const versions = new Map<string, AccountView>()
  const blocked = new Set<string>()
  for (const accountId of new Set(
    accountOps.map((op) => (op.command.type === 'account.put' ? op.command.account.id : '')),
  )) {
    const chain = accountOps.filter(
      (op) => op.command.type === 'account.put' && op.command.account.id === accountId,
    )
    let base: string | null = null
    let current: AccountView | undefined
    const seen = new Set<string>()
    while (true) {
      const next = chain.filter(
        (op) =>
          op.command.type === 'account.put' &&
          op.command.baseVersionId === base &&
          !seen.has(op.id),
      )
      if (next.length > 1) {
        blocked.add(accountId)
        ledger.conflicts.push({
          id: accountId,
          message: '帳戶有並發修改，保留最後無爭議版本',
          operationIds: next.map((op) => op.id),
        })
        break
      }
      const op = next[0]
      if (!op || op.command.type !== 'account.put') break
      const account = validateAccount(op.command.account)
      if (
        current &&
        (account.currencyId !== current.currencyId ||
          account.openingBalance !== current.openingBalance ||
          account.isCredit !== current.isCredit)
      )
        throw new Error('目前版本不支援更改既有帳戶的幣種、性質或期初金額')
      current = { ...account, versionId: op.id }
      base = op.id
      seen.add(op.id)
      versions.set(op.id, current)
    }
    if (chain.some((op) => !seen.has(op.id)) && !blocked.has(accountId)) {
      blocked.add(accountId)
      ledger.conflicts.push({
        id: accountId,
        message: '帳戶缺少相依版本，請重新同步',
        operationIds: chain.filter((op) => !seen.has(op.id)).map((op) => op.id),
      })
    }
    if (current) ledger.accounts.push(current)
  }
  const txSeen = new Set<string>()
  const txOps = usable.filter((op) => op.command.type === 'transaction.post')
  for (const op of txOps) {
    if (op.command.type !== 'transaction.post') continue
    const { transaction, dependencies } = op.command
    if (txSeen.has(transaction.id)) continue
    txSeen.add(transaction.id)
    const sameTransaction = txOps.filter(
      (o) => o.command.type === 'transaction.post' && o.command.transaction.id === transaction.id,
    )
    const relevant = [
      transaction.accountId,
      ...(transaction.kind === 'transfer' ? [transaction.targetAccountId] : []),
    ]
    const dependencyAccounts = dependencies.map((d) => versions.get(d.versionId))
    if (
      sameTransaction.length !== 1 ||
      dependencies.length !== relevant.length ||
      new Set(dependencies.map((d) => d.accountId)).size !== relevant.length ||
      dependencies.some(
        (d, i) =>
          !relevant.includes(d.accountId) ||
          dependencyAccounts[i]?.id !== d.accountId ||
          blocked.has(d.accountId),
      )
    ) {
      ledger.conflicts.push({
        id: transaction.id,
        message: '紀錄版本或相依帳戶需要核對，尚未納入餘額',
        operationIds: sameTransaction.map((o) => o.id),
      })
      continue
    }
    try {
      // Validation at the operation's historical account revision is intentional:
      // archiving an account later must not erase already-posted transactions.
      ledger.transactions.push(
        validateTransaction(
          transaction,
          dependencyAccounts as AccountView[],
          DateTime.fromISO(op.createdAt).setZone('Asia/Taipei'),
        ),
      )
    } catch (error) {
      ledger.conflicts.push({
        id: transaction.id,
        message: error instanceof Error ? error.message : '無法驗證紀錄',
        operationIds: [op.id],
      })
    }
  }
  for (const op of usable) {
    if (op.command.type !== 'transaction.reverse') continue
    const id = op.command.transactionId
    if (ledger.transactions.some((t) => t.id === id)) ledger.reversed.push(id)
    else
      ledger.conflicts.push({
        id: op.id,
        message: '撤銷缺少原始紀錄，請同步後處理',
        operationIds: [op.id],
      })
  }
  let base: string | null = null
  while (true) {
    const next = usable.filter(
      (op) => op.command.type === 'book.default-account' && op.command.baseVersionId === base,
    )
    if (next.length > 1) {
      ledger.conflicts.push({
        id: 'default-account',
        message: '預設帳戶有不同設定，請核對',
        operationIds: next.map((o) => o.id),
      })
      break
    }
    const op = next[0]
    if (!op || op.command.type !== 'book.default-account') break
    ledger.defaultAccountId = op.command.accountId
    ledger.defaultVersionId = op.id
    base = op.id
  }
  return ledger
}

export function balances(ledger: Ledger): Record<string, string> {
  const values = Object.fromEntries(ledger.accounts.map((a) => [a.id, new Money(a.openingBalance)]))
  for (const tx of ledger.transactions) {
    if (ledger.reversed.includes(tx.id)) continue
    const amount = money(total(tx))
    values[tx.accountId] = values[tx.accountId].plus(
      tx.kind === 'income' ? amount : amount.negated(),
    )
    if (tx.kind === 'transfer') {
      values[tx.accountId] = values[tx.accountId].minus(netFee(tx))
      values[tx.targetAccountId] = values[tx.targetAccountId].plus(
        sum(tx.lines.map((l) => l.destinationAmount)),
      )
    }
  }
  return Object.fromEntries(Object.entries(values).map(([id, value]) => [id, value.toFixed()]))
}

export function draftHeads(drafts: Draft[]): Draft[] {
  const unique = new Map<string, Draft>()
  for (const draft of drafts) {
    const old = unique.get(draft.revisionId)
    if (old && canonical(old) !== canonical(draft))
      throw new Error('草稿版本識別重複但內容不同，已停止同步')
    unique.set(draft.revisionId, draft)
  }
  const revisions = [...unique.values()]
  const parents = new Set(revisions.flatMap((d) => d.parents))
  return revisions.filter((d) => !parents.has(d.revisionId))
}
