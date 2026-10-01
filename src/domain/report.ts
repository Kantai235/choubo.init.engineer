import type { Ledger } from './model'
import { balances, total, netFee } from './ledger'
import { category } from './seeds'
import { Money, sum } from './money'

// Cash-flow reporting uses transaction dates. Reconciliation adjustments stay
// in balances but are excluded from everyday income/spending by default.
export function cashFlowSummary(
  ledger: Ledger,
  currencyId: string,
  month: string,
  includeAdjustments = false,
) {
  const values = balances(ledger)
  const balance = sum(
    ledger.accounts
      .filter((a) => a.currencyId === currencyId && a.includeInTotal)
      .map((a) => values[a.id] ?? '0'),
  )
  let income = new Money(0)
  let expense = new Money(0)
  for (const tx of ledger.transactions) {
    if (
      ledger.reversed.includes(tx.id) ||
      !tx.date.startsWith(`${month}-`) ||
      ledger.accounts.find((a) => a.id === tx.accountId)?.currencyId !== currencyId
    )
      continue
    const amount = includeAdjustments
      ? total(tx)
      : sum(
          tx.lines.filter((l) => category(l.categoryId)?.name !== '對帳差額').map((l) => l.amount),
        )
    if (tx.kind === 'income') income = income.plus(amount)
    if (tx.kind === 'expense') expense = expense.plus(amount)
    if (tx.kind === 'transfer') expense = expense.plus(netFee(tx))
  }
  return { balance, income: income.toFixed(), expense: expense.toFixed() }
}
