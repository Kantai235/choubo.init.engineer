import { afterEach, describe, expect, it, vi } from 'vitest'
import { DriveClient, DriveRepository } from '../../src/infrastructure/drive'
import { APP_ID, type Book } from '../../src/domain/model'
import { LocalRepository } from '../../src/infrastructure/local'
import { at, createAccount, draft } from './fixtures'

const client = () =>
  new DriveClient('memory-only', Date.now() + 60_000, new AbortController().signal)
const file = {
  id: 'stable-id',
  name: 'record.json',
  mimeType: 'application/json',
  ownedByMe: true,
  parents: ['parent'],
  appProperties: { appId: APP_ID, role: 'operation', bookId: 'book' },
}
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
afterEach(() => vi.unstubAllGlobals())

describe('Drive REST contracts', () => {
  it('continues paginated listings and restricts them to owned app files', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ files: [file], nextPageToken: 'next' }))
      .mockResolvedValueOnce(response({ files: [{ ...file, id: 'second' }] }))
    vi.stubGlobal('fetch', fetcher)
    expect(await client().list('parent', 'operation')).toHaveLength(2)
    const url = new URL(fetcher.mock.calls[1][0])
    expect(url.searchParams.get('pageToken')).toBe('next')
    expect(url.searchParams.get('q')).toContain("'me' in owners")
    expect(url.searchParams.get('q')).toContain(APP_ID)
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer memory-only')
  })
  it('verifies the same generated ID after an upload response is lost', async () => {
    const value = { amount: '60' }
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('response lost'))
      .mockResolvedValueOnce(response(file))
      .mockResolvedValueOnce(response(file))
      .mockResolvedValueOnce(response(value))
    vi.stubGlobal('fetch', fetcher)
    await client().create(file.id, file.name, 'parent', 'operation', 'book', value)
    expect(fetcher.mock.calls.filter((call) => call[1].method === 'POST')).toHaveLength(1)
    expect(fetcher.mock.calls.slice(1).every((call) => call[0].includes('/files/stable-id?'))).toBe(
      true,
    )
  })
  it('refuses an existing ID with different financial content', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({}, 409))
      .mockResolvedValueOnce(response(file))
      .mockResolvedValueOnce(response(file))
      .mockResolvedValueOnce(response({ amount: '600' }))
    vi.stubGlobal('fetch', fetcher)
    await expect(
      client().create(file.id, file.name, 'parent', 'operation', 'book', { amount: '60' }),
    ).rejects.toThrow('內容與本次提交不符')
  })
  it('does not accept an uploaded file belonging to another owner', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(response({ id: file.id }))
        .mockResolvedValueOnce(response({ ...file, ownedByMe: false })),
    )
    await expect(
      client().create(file.id, file.name, 'parent', 'operation', 'book', {}),
    ).rejects.toThrow('歸屬不符')
  })
  it('verifies a root alias using membership while Drive returns the actual parent ID', async () => {
    const folder = {
      ...file,
      mimeType: 'application/vnd.google-apps.folder',
      parents: ['actual-my-drive-id'],
      appProperties: { appId: APP_ID, role: 'root', bookId: '' },
    }
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ id: file.id }))
      .mockResolvedValueOnce(response(folder))
      .mockResolvedValueOnce(response({ files: [folder] }))
    vi.stubGlobal('fetch', fetcher)
    await client().create(file.id, 'Choubo 記帳資料', 'root', 'root', '')
    expect(JSON.parse(fetcher.mock.calls[0][1].body).parents).toEqual(['root'])
    expect(new URL(fetcher.mock.calls[2][0]).searchParams.get('q')).toContain("'root' in parents")
    expect(fetcher.mock.calls.some(([url]) => url.includes('/files/root?'))).toBe(false)
  })
  it('rejects a folder that is not found under the root alias', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(response({ id: file.id }))
        .mockResolvedValueOnce(
          response({
            ...file,
            mimeType: 'application/vnd.google-apps.folder',
            appProperties: { appId: APP_ID, role: 'root', bookId: '' },
          }),
        )
        .mockResolvedValueOnce(response({ files: [] })),
    )
    await expect(client().create(file.id, 'Choubo 記帳資料', 'root', 'root', '')).rejects.toThrow(
      '不在 My Drive 根目錄',
    )
  })
  it('stops expired authorizations before sending a request', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(
      new DriveClient('old', 0, new AbortController().signal).identity(),
    ).rejects.toThrow('授權已到期')
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('verified same-account token replacement', () => {
  it('allows an expired client to use a fresh grant without reconstructing the ledger', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ files: [] }))
    vi.stubGlobal('fetch', fetcher)
    const existing = new DriveClient(
      'expired-test-credential',
      Date.now() - 1,
      new AbortController().signal,
    )
    existing.replaceAuthorization('renewed-test-credential', Date.now() + 3600_000)
    await existing.list('parent')
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer renewed-test-credential')
  })
  it('rejects invalid replacement without discarding an unexpired grant', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ files: [] }))
    vi.stubGlobal('fetch', fetcher)
    const existing = client()
    expect(() => existing.replaceAuthorization('invalid-test-credential', Date.now() - 1)).toThrow(
      '授權已到期',
    )
    await existing.list('parent')
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer memory-only')
  })
})

describe('bounded Drive scans', () => {
  function repository() {
    const book: Book = {
      format: 'choubo.book',
      schemaVersion: 1,
      minWritableAppVersion: '0.1.0',
      id: 'book',
      ownerId: 'alice',
      name: 'QA',
      timeZone: 'Asia/Taipei',
      createdAt: at,
    }
    const binding = {
      rootParentId: 'root',
      rootId: 'root-folder',
      booksId: 'books',
      bookFolderId: 'book-folder',
      operationsId: 'operations',
      draftsId: 'drafts',
      manifestId: 'manifest',
      bookId: book.id,
    }
    const drive = client()
    const local = new LocalRepository(
      {
        length: 0,
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
        key: () => null,
      },
      book.ownerId,
      book.id,
    )
    return { drive, repo: new DriveRepository(book, binding, drive, local) }
  }

  it.each(['operations', 'drafts'] as const)(
    'reads %s four at a time and preserves listing order',
    async (kind) => {
      const { drive, repo } = repository()
      const values = Array.from({ length: 9 }, (_, i) =>
        kind === 'operations' ? createAccount(`qa-${i}`) : draft(`qa-${i}`),
      )
      vi.spyOn(drive, 'list').mockResolvedValue(values.map((_, i) => ({ ...file, id: String(i) })))
      const release = new Map<string, () => void>()
      let active = 0,
        maximum = 0
      vi.spyOn(drive, 'content').mockImplementation(async (id) => {
        active++
        maximum = Math.max(maximum, active)
        await new Promise<void>((resolve) => release.set(id, resolve))
        active--
        return values[Number(id)]
      })
      const reading = kind === 'operations' ? repo.readOperations() : repo.readDrafts()
      await vi.waitFor(() => expect(release.size).toBe(4))
      // Finish out of order to ensure array order is not completion order.
      for (const i of [3, 2, 1, 0]) release.get(String(i))!()
      await vi.waitFor(() => expect(release.size).toBe(8))
      for (const i of [7, 6, 5, 4]) release.get(String(i))!()
      await vi.waitFor(() => expect(release.size).toBe(9))
      release.get('8')!()
      expect(await reading).toEqual(values)
      expect(maximum).toBe(4)
    },
  )

  it.each(['operations', 'drafts'] as const)(
    'rejects foreign %s without returning a partial scan',
    async (kind) => {
      const { drive, repo } = repository()
      vi.spyOn(drive, 'list').mockResolvedValue([file, { ...file, id: 'foreign' }])
      vi.spyOn(drive, 'content').mockImplementation(async (id) => ({
        ...(kind === 'operations' ? createAccount() : draft('v1')),
        ownerId: id === 'foreign' ? 'other-owner' : 'alice',
      }))
      await expect(
        kind === 'operations' ? repo.readOperations() : repo.readDrafts(),
      ).rejects.toThrow('資料不屬於目前帳本')
    },
  )

  it('settles in-flight reads and stops scheduling new files after failure', async () => {
    const { drive, repo } = repository()
    vi.spyOn(drive, 'list').mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({ ...file, id: String(i) })),
    )
    const finish = new Map<string, () => void>()
    let rejectFirst!: (reason: Error) => void
    const content = vi.spyOn(drive, 'content').mockImplementation(async (id) => {
      await new Promise<void>((resolve, reject) => {
        finish.set(id, resolve)
        if (id === '0') rejectFirst = reject
      })
      return createAccount(id)
    })
    let finished = false
    const reading = repo.readOperations().catch((error: unknown) => {
      finished = true
      return error
    })
    await vi.waitFor(() => expect(finish.size).toBe(4))
    rejectFirst(new Error('read failed'))
    await Promise.resolve()
    expect(finished).toBe(false)
    for (const id of ['1', '2', '3']) finish.get(id)!()
    expect(await reading).toEqual(new Error('read failed'))
    expect(content).toHaveBeenCalledTimes(4)
  })
})
