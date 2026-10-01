import { z } from 'zod'

export const APP_ID = 'choubo.personal-ledger'
export const SCHEMA_VERSION = 1
export const groups = [
  '現金',
  '銀行',
  '信用卡',
  '儲值卡',
  '禮券',
  '紅利點數',
  '保單',
  '證券戶',
  '加密貨幣',
  '其他',
] as const
export const kinds = ['expense', 'income', 'transfer'] as const
export const kindNames = { expense: '支出', income: '收入', transfer: '轉帳' }
const id = z.string().min(1).max(180)
const text = z.string().max(2000)
export const amountSchema = z
  .string()
  .regex(/^-?\d{1,24}(\.\d{1,18})?$/, '請輸入有效金額（最多 24 位整數、18 位小數）')
export const accountSchema = z
  .object({
    id,
    name: z.string().trim().min(1, '請填寫帳戶名稱').max(60),
    group: z.enum(groups),
    currencyId: id,
    openingBalance: amountSchema,
    note: text,
    includeInTotal: z.boolean(),
    isCredit: z.boolean(),
    archived: z.boolean(),
    color: z.enum(['blue', 'green', 'orange', 'purple']),
  })
  .strict()
export type Account = z.infer<typeof accountSchema>
export type AccountView = Account & { versionId: string }
export const lineSchema = z
  .object({
    id,
    categoryId: z.string(),
    name: z.string().max(120),
    amount: z.string().max(60),
    destinationAmount: z.string().max(60),
  })
  .strict()
export const transactionSchema = z
  .object({
    id,
    kind: z.enum(kinds),
    accountId: z.string(),
    targetAccountId: z.string(),
    date: z.string(),
    time: z.string(),
    title: z.string().max(120),
    merchant: z.string().max(120),
    invoiceNumber: z.string().max(40),
    randomCode: z.string().max(40),
    note: text,
    lines: z.array(lineSchema).min(1).max(100),
    fee: z.string().max(60),
    feeDiscount: z.string().max(60),
  })
  .strict()
export type Transaction = z.infer<typeof transactionSchema>
const dependencySchema = z.object({ accountId: id, versionId: id }).strict()
const commandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('account.put'),
      baseVersionId: z.string().nullable(),
      account: accountSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('transaction.post'),
      transaction: transactionSchema,
      dependencies: z.array(dependencySchema).min(1).max(2),
    })
    .strict(),
  z
    .object({
      type: z.literal('transaction.reverse'),
      transactionId: id,
      reason: z.string().trim().min(1).max(500),
    })
    .strict(),
  z
    .object({
      type: z.literal('book.default-account'),
      accountId: id,
      baseVersionId: z.string().nullable(),
    })
    .strict(),
])
export const operationSchema = z
  .object({
    format: z.literal('choubo.operation'),
    schemaVersion: z.literal(SCHEMA_VERSION),
    ownerId: id,
    bookId: id,
    id,
    createdAt: z.string().datetime(),
    command: commandSchema,
  })
  .strict()
export type Operation = z.infer<typeof operationSchema>
export type Command = Operation['command']
export const draftSchema = z
  .object({
    format: z.literal('choubo.draft'),
    schemaVersion: z.literal(SCHEMA_VERSION),
    ownerId: id,
    bookId: id,
    id,
    revisionId: id,
    parents: z.array(id).max(100),
    updatedAt: z.string().datetime(),
    discarded: z.boolean(),
    value: transactionSchema,
  })
  .strict()
export type Draft = z.infer<typeof draftSchema>
export const bookSchema = z
  .object({
    format: z.literal('choubo.book'),
    schemaVersion: z.literal(SCHEMA_VERSION),
    minWritableAppVersion: z.literal('0.1.0'),
    id,
    ownerId: id,
    name: z.string(),
    timeZone: z.literal('Asia/Taipei'),
    createdAt: z.string().datetime(),
  })
  .strict()
export type Book = z.infer<typeof bookSchema>
export type Identity = { id: string; name: string; email: string }
export type Conflict = { id: string; message: string; operationIds: string[] }
export type Ledger = {
  accounts: AccountView[]
  transactions: Transaction[]
  reversed: string[]
  conflicts: Conflict[]
  defaultAccountId: string
  defaultVersionId: string | null
}
export type Currency = {
  id: string
  name: string
  precision: number
  type: 'fiat' | 'crypto' | 'custom'
}
export type Category = {
  id: string
  name: string
  parentId: string | null
  kind: string
  icon: string
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`
  return JSON.stringify(value)
}
export const newId = () => crypto.randomUUID()
