import Decimal from 'decimal.js'
import { amountSchema } from './model'

// 24 integer + 18 fractional digits are accepted at boundaries. Keep headroom
// for multiplication and summation; monetary values never cross a Number boundary.
export const Money = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_UP })
export function money(value: string): Decimal {
  return new Money(amountSchema.parse(value))
}
export function exactAmount(value: string, precision: number, positive = false): string {
  const n = money(value)
  if (positive && !n.greaterThan(0)) throw new Error('金額必須大於 0')
  if (n.decimalPlaces() > precision) throw new Error(`此幣種最多 ${precision} 位小數`)
  return n.toFixed()
}
export const sum = (values: string[]) =>
  values.reduce((n, value) => n.plus(money(value)), new Money(0)).toFixed()
export function formatMoney(value: string, precision = 2): string {
  const [integer = '0', fraction] = new Money(value).toFixed(precision).split('.')
  return (
    integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') +
    (fraction && /[1-9]/.test(fraction) ? `.${fraction}` : '')
  )
}
