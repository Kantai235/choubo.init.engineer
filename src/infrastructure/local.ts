import { z } from 'zod'
import {
  bookSchema,
  draftSchema,
  operationSchema,
  type Draft,
  type Operation,
  type Book,
} from '../domain/model'

export interface StoragePort {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  key(index: number): string | null
  readonly length: number
}
const cacheSchema = z.object({
  book: bookSchema,
  operations: z.array(operationSchema),
  savedAt: z.string(),
})
export class LocalRepository {
  constructor(
    private readonly storage: StoragePort,
    readonly ownerId: string,
    readonly bookId: string,
  ) {}
  private get prefix() {
    return `choubo:v1:${encodeURIComponent(this.ownerId)}:${encodeURIComponent(this.bookId)}:`
  }
  private read<T>(key: string, schema: z.ZodType<T>): T | undefined {
    const value = this.storage.getItem(this.prefix + key)
    return value === null ? undefined : schema.parse(JSON.parse(value))
  }
  private write(key: string, value: unknown) {
    const encoded = JSON.stringify(value)
    try {
      this.storage.setItem(this.prefix + key, encoded)
    } catch {
      this.clearCache()
      try {
        this.storage.setItem(this.prefix + key, encoded)
      } catch {
        throw new Error('本機暫存空間不可用，內容尚未安全保存。請下載草稿後再繼續。')
      }
    }
  }
  private keys(prefix: string) {
    return Array.from({ length: this.storage.length }, (_, i) => this.storage.key(i))
      .filter((key): key is string => !!key?.startsWith(this.prefix + prefix))
      .map((key) => key.slice(this.prefix.length))
  }
  saveDraft(draft: Draft) {
    this.assertOwner(draft)
    this.write(`draft:${draft.id}`, draft)
  }
  drafts() {
    const values = this.keys('draft:')
      .map((key) => this.read(key, draftSchema)!)
      .filter(Boolean)
    values.forEach((value) => this.assertOwner(value))
    return values
  }
  acknowledgeDraft(draft: Draft) {
    this.assertOwner(draft)
    this.write(`ack:${draft.id}`, draft.revisionId)
  }
  isDraftSynced(draft: Draft) {
    return this.read(`ack:${draft.id}`, z.string()) === draft.revisionId
  }
  removeDraft(id: string) {
    this.storage.removeItem(this.prefix + `draft:${id}`)
    this.storage.removeItem(this.prefix + `ack:${id}`)
  }
  savePending(operation: Operation) {
    this.assertOwner(operation)
    this.write(`pending:${operation.id}`, operation)
  }
  pending() {
    const values = this.keys('pending:')
      .map((key) => this.read(key, operationSchema)!)
      .filter(Boolean)
    values.forEach((value) => this.assertOwner(value))
    return values
  }
  removePending(id: string) {
    this.storage.removeItem(this.prefix + `pending:${id}`)
  }
  task<T>(key: string, schema: z.ZodType<T>) {
    return this.read(`task:${key}`, schema)
  }
  saveTask(key: string, value: unknown) {
    this.write(`task:${key}`, value)
  }
  cache(book: Book, operations: Operation[]) {
    const value = { book, operations, savedAt: new Date().toISOString() }
    // Large histories stay in memory/Drive. Protected drafts are never evicted.
    if (JSON.stringify(value).length * 2 > 1_048_576) {
      this.clearCache()
      return
    }
    try {
      this.write('cache', value)
    } catch {
      /* Cache failure does not invalidate confirmed cloud writes. */
    }
  }
  cached() {
    try {
      const value = this.read('cache', cacheSchema)
      if (value) {
        this.assertOwner({ ownerId: value.book.ownerId, bookId: value.book.id })
        value.operations.forEach((op) => this.assertOwner(op))
      }
      return value
    } catch {
      this.clearCache()
      return undefined
    }
  }
  clearCache() {
    this.storage.removeItem(this.prefix + 'cache')
  }
  async fileId(task: string, generate: () => Promise<string>): Promise<string> {
    const existing = this.read(`file:${task}`, z.string())
    if (existing) return existing
    const id = await generate()
    this.write(`file:${task}`, id)
    return id
  }
  private assertOwner(value: { ownerId: string; bookId: string }) {
    if (value.ownerId !== this.ownerId || value.bookId !== this.bookId)
      throw new Error('資料不屬於目前使用者或帳本')
  }
}

export const bindingKey = (ownerId: string) => `choubo:binding:${encodeURIComponent(ownerId)}`
export function downloadJson(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
