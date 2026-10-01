import { z } from 'zod'
import {
  APP_ID,
  bookSchema,
  canonical,
  draftSchema,
  operationSchema,
  type Book,
  type Draft,
  type Identity,
  type Operation,
} from '../domain/model'
import { LocalRepository, bindingKey, type StoragePort } from './local'

const ROOT_URL = 'https://www.googleapis.com/drive/v3'
const fileSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  ownedByMe: z.boolean(),
  parents: z.array(z.string()).optional(),
  trashed: z.boolean().optional(),
  appProperties: z.record(z.string(), z.string()).optional(),
})
type DriveFile = z.infer<typeof fileSchema>
type Binding = {
  rootParentId: string
  rootId: string
  booksId: string
  bookFolderId: string
  operationsId: string
  draftsId: string
  manifestId: string
  bookId: string
}
export const bindingSchema = z.object({
  rootParentId: z.string(),
  rootId: z.string(),
  booksId: z.string(),
  bookFolderId: z.string(),
  operationsId: z.string(),
  draftsId: z.string(),
  manifestId: z.string(),
  bookId: z.string(),
})
const fileFields = 'id,name,mimeType,ownedByMe,parents,trashed,appProperties'
const escape = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

// Keep reads bounded, preserve list order, and settle in-flight reads before
// surfacing a failure. A failed scan must never publish a partial ledger.
async function readConcurrently<T, R>(items: T[], read: (item: T) => Promise<R>): Promise<R[]> {
  const result = new Array<R>(items.length)
  let next = 0
  let failed = false
  const workers = Array.from({ length: Math.min(4, items.length) }, async () => {
    while (!failed && next < items.length) {
      const index = next++
      try {
        result[index] = await read(items[index]!)
      } catch (error) {
        failed = true
        throw error
      }
    }
  })
  const settled = await Promise.allSettled(workers)
  const failure = settled.find((item) => item.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
  return result
}
export class DriveError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export class DriveClient {
  constructor(
    private token: string,
    private expiresAt: number,
    readonly signal: AbortSignal,
  ) {}
  // Caller must verify the new token's owner before replacing an active grant.
  replaceAuthorization(token: string, expiresAt: number) {
    if (!token || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now())
      throw new DriveError('Google 授權已到期，請重新連接', 401)
    this.token = token
    this.expiresAt = expiresAt
  }
  async request(path: string, init: RequestInit = {}, upload = false): Promise<unknown> {
    if (Date.now() >= this.expiresAt) throw new DriveError('Google 授權已到期，請重新連接', 401)
    const url = upload ? `https://www.googleapis.com/upload/drive/v3${path}` : `${ROOT_URL}${path}`
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.any([this.signal, AbortSignal.timeout(20_000)]),
      headers: { ...init.headers, Authorization: `Bearer ${this.token}` },
    })
    if (!response.ok) {
      const messages: Record<number, string> = {
        401: 'Google 授權已到期，請重新連接',
        403: 'Drive 權限或儲存空間不足，請檢查 Google Drive',
        404: '無法存取這份 Drive 資料，請確認檔案仍存在且已授權；既有帳本不會自動重建',
        409: '檔案已存在',
        429: 'Drive 暫時限制請求次數，請稍後重試',
      }
      throw new DriveError(
        messages[response.status] ?? 'Drive 暫時無法完成請求，資料已保留，請稍後重試',
        response.status,
      )
    }
    return response.status === 204 ? undefined : response.json()
  }
  async identity(): Promise<Identity> {
    const result = z
      .object({
        user: z.object({
          permissionId: z.string().min(1),
          displayName: z.string().optional(),
          emailAddress: z.string().optional(),
        }),
      })
      .parse(await this.request('/about?fields=user(permissionId,displayName,emailAddress)'))
    return {
      id: result.user.permissionId,
      name: result.user.displayName ?? '我的帳本',
      email: result.user.emailAddress ?? '',
    }
  }
  async list(parent: string, role?: string): Promise<DriveFile[]> {
    const q = `'${escape(parent)}' in parents and trashed = false and 'me' in owners and appProperties has { key='appId' and value='${APP_ID}' }${role ? ` and appProperties has { key='role' and value='${escape(role)}' }` : ''}`
    const files: DriveFile[] = []
    let pageToken: string | undefined
    do {
      const params = new URLSearchParams({
        q,
        spaces: 'drive',
        pageSize: '1000',
        fields: `nextPageToken,files(${fileFields})`,
      })
      if (pageToken) params.set('pageToken', pageToken)
      const result = z
        .object({ files: z.array(fileSchema), nextPageToken: z.string().optional() })
        .parse(await this.request(`/files?${params}`))
      files.push(...result.files)
      pageToken = result.nextPageToken
    } while (pageToken)
    return files
  }
  async meta(id: string) {
    return fileSchema.parse(
      await this.request(`/files/${encodeURIComponent(id)}?fields=${fileFields}`),
    )
  }
  async content(id: string) {
    return this.request(`/files/${encodeURIComponent(id)}?alt=media`)
  }
  async generateId() {
    return z
      .object({ ids: z.array(z.string()).min(1) })
      .parse(await this.request('/files/generateIds?count=1&space=drive&type=files')).ids[0]
  }
  async create(
    id: string,
    name: string,
    parent: string,
    role: string,
    bookId: string,
    value?: unknown,
  ) {
    const metadata = {
      id,
      name,
      parents: [parent],
      mimeType: value === undefined ? 'application/vnd.google-apps.folder' : 'application/json',
      appProperties: { appId: APP_ID, role, bookId },
    }
    try {
      if (value === undefined)
        await this.request('/files?fields=id', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(metadata),
        })
      else {
        const boundary = `choubo_${crypto.randomUUID()}`
        const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(value)}\r\n--${boundary}--`
        await this.request(
          '/files?uploadType=multipart&fields=id',
          {
            method: 'POST',
            headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
            body,
          },
          true,
        )
      }
    } catch (error) {
      // A timeout may mean Drive committed the file. The same pre-generated ID
      // is checked on every attempt; a failed check never becomes a new ID.
      if (
        this.signal.aborted ||
        (error instanceof DriveError && ![409, 500, 502, 503, 504].includes(error.status))
      )
        throw error
      try {
        await this.meta(id)
      } catch {
        throw error
      }
    }
    const confirmed = await this.meta(id)
    if (
      !confirmed.ownedByMe ||
      confirmed.trashed ||
      (parent !== 'root' && !confirmed.parents?.includes(parent)) ||
      confirmed.mimeType !== metadata.mimeType ||
      confirmed.appProperties?.role !== role ||
      confirmed.appProperties?.bookId !== bookId ||
      confirmed.appProperties?.appId !== APP_ID
    )
      throw new Error('雲端檔案歸屬不符，已停止寫入')
    // "root" is an API alias, not the real ID returned in File.parents.
    // Verify membership with a scoped query instead of reading root metadata,
    // which may be inaccessible with drive.file.
    if (parent === 'root' && !(await this.list('root', role)).some((file) => file.id === id))
      throw new Error('雲端資料夾不在 My Drive 根目錄，已停止寫入')
    if (value !== undefined && canonical(await this.content(id)) !== canonical(value))
      throw new Error('雲端檔案內容與本次提交不符，請保留草稿並重新同步')
  }
}

export interface CloudPort {
  readonly book: Book
  readOperations(): Promise<Operation[]>
  readDrafts(): Promise<Draft[]>
  writeOperation(operation: Operation): Promise<void>
  writeDraft(draft: Draft): Promise<void>
  checkBinding(): Promise<void>
}
export class DriveRepository implements CloudPort {
  constructor(
    readonly book: Book,
    readonly binding: Binding,
    private readonly client: DriveClient,
    private readonly local: LocalRepository,
  ) {}
  async checkBinding() {
    const folders = [
      [this.binding.rootId, this.binding.rootParentId, 'root'],
      [this.binding.booksId, this.binding.rootId, 'books'],
      [this.binding.bookFolderId, this.binding.booksId, 'book-folder'],
      [this.binding.operationsId, this.binding.bookFolderId, 'operations'],
      [this.binding.draftsId, this.binding.bookFolderId, 'drafts'],
    ] as const
    await readConcurrently([...folders], async ([id, parent, role]) => {
      const file = await this.client.meta(id)
      if (
        !file.ownedByMe ||
        file.trashed ||
        file.appProperties?.appId !== APP_ID ||
        file.appProperties.role !== role ||
        (parent && !file.parents?.includes(parent))
      )
        throw new Error('Drive 資料夾已移動、刪除或失去權限，已停止提交')
    })
    const manifest = await this.client.meta(this.binding.manifestId)
    if (
      !manifest.ownedByMe ||
      manifest.trashed ||
      !manifest.parents?.includes(this.binding.bookFolderId) ||
      manifest.appProperties?.appId !== APP_ID ||
      manifest.appProperties?.role !== 'manifest' ||
      manifest.appProperties?.bookId !== this.book.id
    )
      throw new Error('帳本識別檔已移動或歸屬不符，已停止提交')
    const book = bookSchema.parse(await this.client.content(this.binding.manifestId))
    if (book.id !== this.book.id || book.ownerId !== this.book.ownerId)
      throw new Error('作用中的帳本已變更，請重新連接')
  }
  async readOperations() {
    const files = await this.client.list(this.binding.operationsId, 'operation')
    return readConcurrently(files, async (file) => {
      const op = operationSchema.parse(await this.client.content(file.id))
      this.assertOwner(op)
      return op
    })
  }
  async readDrafts() {
    const files = await this.client.list(this.binding.draftsId, 'draft')
    return readConcurrently(files, async (file) => {
      const draft = draftSchema.parse(await this.client.content(file.id))
      this.assertOwner(draft)
      return draft
    })
  }
  async writeOperation(op: Operation) {
    this.assertOwner(op)
    // Different contents sharing an operation ID must remain visible as a fork.
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(op)))
    const hash = [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('')
    const id = await this.local.fileId(`operation:${op.id}:${hash}`, () => this.client.generateId())
    await this.client.create(
      id,
      `${op.id}.json`,
      this.binding.operationsId,
      'operation',
      this.book.id,
      op,
    )
  }
  async writeDraft(draft: Draft) {
    this.assertOwner(draft)
    const id = await this.local.fileId(`draft:${draft.revisionId}`, () => this.client.generateId())
    await this.client.create(
      id,
      `${draft.id}_${draft.revisionId}.json`,
      this.binding.draftsId,
      'draft',
      this.book.id,
      draft,
    )
  }
  private assertOwner(value: { ownerId: string; bookId: string }) {
    if (value.ownerId !== this.book.ownerId || value.bookId !== this.book.id)
      throw new Error('資料不屬於目前帳本')
  }
}

export async function openDrive(client: DriveClient, identity: Identity, storage: StoragePort) {
  const bootstrap = new LocalRepository(storage, identity.id, 'bootstrap')
  async function folder(
    parent: string,
    role: string,
    name: string,
    bookId = '',
  ): Promise<DriveFile> {
    let matches = await client.list(parent, role)
    if (matches.length > 1)
      throw new Error('發現多個同用途資料夾，請先在 Drive 核對；網站不會自動合併或覆蓋')
    if (matches.length === 1) return matches[0]
    const id = await bootstrap.fileId(`folder:${parent}:${role}`, () => client.generateId())
    await client.create(id, name, parent, role, bookId)
    matches = await client.list(parent, role)
    if (matches.length !== 1 || matches[0].id !== id)
      throw new Error('資料夾建立結果需要核對，請重新連接')
    return matches[0]
  }
  let binding: Binding
  let book: Book
  const saved = storage.getItem(bindingKey(identity.id))
  if (saved) {
    binding = bindingSchema.parse(JSON.parse(saved))
    book = bookSchema.parse(await client.content(binding.manifestId))
  } else {
    const rootFolder = await folder('root', 'root', 'Choubo 記帳資料')
    const rootId = rootFolder.id
    const rootParentId = rootFolder.parents?.[0]
    if (!rootParentId || rootFolder.parents?.length !== 1)
      throw new Error('無法確認 Choubo 資料夾的位置，請重新連接')
    const booksId = (await folder(rootId, 'books', 'books')).id
    const bookFolderId = (await folder(booksId, 'book-folder', '我的帳本')).id
    let manifests = await client.list(bookFolderId, 'manifest')
    if (manifests.length > 1) throw new Error('發現多份帳本識別，請先核對 Drive 資料')
    let manifestId = manifests[0]?.id
    if (!manifestId) {
      manifestId = await bootstrap.fileId(`manifest:${bookFolderId}`, () => client.generateId())
      // Deterministic metadata allows safe recovery after a lost create response.
      book = bootstrap.task(`book:${bookFolderId}`, bookSchema) ?? {
        format: 'choubo.book',
        schemaVersion: 1,
        minWritableAppVersion: '0.1.0',
        id: bookFolderId,
        ownerId: identity.id,
        name: '我的帳本',
        timeZone: 'Asia/Taipei',
        createdAt: new Date().toISOString(),
      }
      bootstrap.saveTask(`book:${bookFolderId}`, book)
      await client.create(manifestId, 'manifest.json', bookFolderId, 'manifest', book.id, book)
      manifests = await client.list(bookFolderId, 'manifest')
      if (manifests.length !== 1) throw new Error('帳本建立發生並發，請重新連接後核對')
    }
    book = bookSchema.parse(await client.content(manifestId))
    const operationsId = (await folder(bookFolderId, 'operations', 'operations', book.id)).id
    const draftsId = (await folder(bookFolderId, 'drafts', 'drafts', book.id)).id
    await folder(bookFolderId, 'snapshots', 'snapshots', book.id)
    await folder(bookFolderId, 'backups', 'backups', book.id)
    await folder(rootId, 'assets', 'assets')
    await folder(rootId, 'preferences', 'preferences')
    binding = {
      rootParentId,
      rootId,
      booksId,
      bookFolderId,
      operationsId,
      draftsId,
      manifestId,
      bookId: book.id,
    }
    storage.setItem(bindingKey(identity.id), JSON.stringify(binding))
  }
  if (book.ownerId !== identity.id || book.id !== binding.bookId)
    throw new Error('帳本不屬於目前 Google 使用者')
  const local = new LocalRepository(storage, identity.id, book.id)
  const cloud = new DriveRepository(book, binding, client, local)
  await cloud.checkBinding()
  return { cloud, local }
}
