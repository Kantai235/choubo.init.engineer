import { type Account, type Operation, type Transaction, type Draft } from '../../src/domain/model'

export const at = '2026-10-02T12:00:00.000Z'
export const account = (id = 'cash', openingBalance = '1000', currencyId = 'TWD'): Account => ({
  id,
  openingBalance,
  currencyId,
  name: id,
  group: '現金',
  note: '',
  includeInTotal: true,
  isCredit: false,
  archived: false,
  color: 'blue',
})
export const op = (id: string, command: Operation['command']): Operation => ({
  format: 'choubo.operation',
  schemaVersion: 1,
  id,
  ownerId: 'alice',
  bookId: 'book',
  createdAt: at,
  command,
})
export const createAccount = (id = 'cash', balance = '1000', currencyId = 'TWD') =>
  op(`create:${id}`, {
    type: 'account.put',
    baseVersionId: null,
    account: account(id, balance, currencyId),
  })
export const transaction = (id = 'purchase'): Transaction => ({
  id,
  kind: 'expense',
  accountId: 'cash',
  targetAccountId: '',
  date: '2026-10-02',
  time: '12:00',
  title: '',
  merchant: '',
  invoiceNumber: 'AB00123456',
  randomCode: '0001',
  note: '',
  fee: '0',
  feeDiscount: '0',
  lines: [
    { id: 'drink', categoryId: 'expense:0:4', name: '飲料', amount: '60', destinationAmount: '' },
    { id: 'home', categoryId: 'expense:6:0', name: '日用品', amount: '140', destinationAmount: '' },
  ],
})
export const post = (tx = transaction()) =>
  op(`transaction:${tx.id}`, {
    type: 'transaction.post',
    transaction: tx,
    dependencies: [
      { accountId: 'cash', versionId: 'create:cash' },
      ...(tx.kind === 'transfer'
        ? [{ accountId: tx.targetAccountId, versionId: `create:${tx.targetAccountId}` }]
        : []),
    ],
  })
export const draft = (revisionId: string, parents: string[] = []): Draft => ({
  format: 'choubo.draft',
  schemaVersion: 1,
  ownerId: 'alice',
  bookId: 'book',
  id: 'purchase',
  revisionId,
  parents,
  updatedAt: at,
  discarded: false,
  value: transaction(),
})
