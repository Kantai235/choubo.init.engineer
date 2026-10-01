import { describe, it, expect } from 'vitest'
import { LocalRepository, type StoragePort } from '../../src/infrastructure/local'
import { LedgerSession } from '../../src/application/session'
import { type CloudPort } from '../../src/infrastructure/drive'
import { type Book, type Draft, type Operation } from '../../src/domain/model'
import { balances } from '../../src/domain/ledger'
import { at, createAccount, transaction, draft } from './fixtures'

class MemoryStorage implements StoragePort {
  values = new Map<string, string>()
  fail = false
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string) {
    if (this.fail) throw new Error('quota')
    this.values.set(key, value)
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
  key(i: number) {
    return [...this.values.keys()][i] ?? null
  }
  get length() {
    return this.values.size
  }
}
class Cloud implements CloudPort {
  book: Book = {
    format: 'choubo.book',
    schemaVersion: 1,
    minWritableAppVersion: '0.1.0',
    id: 'book',
    ownerId: 'alice',
    name: '我的帳本',
    timeZone: 'Asia/Taipei',
    createdAt: at,
  }
  operations = [createAccount()]
  drafts: Draft[] = []
  failBefore = false
  failAfter = false
  async checkBinding() {}
  async readOperations() {
    return [...this.operations]
  }
  async readDrafts() {
    return [...this.drafts]
  }
  async writeDraft(value: Draft) {
    this.drafts.push(value)
  }
  async writeOperation(value: Operation) {
    if (this.failBefore) throw new Error('network unavailable')
    this.operations.push(value)
    if (this.failAfter) throw new Error('response lost')
  }
}
function fixture() {
  const storage = new MemoryStorage(),
    cloud = new Cloud(),
    local = new LocalRepository(storage, 'alice', 'book'),
    controller = new AbortController()
  const session = new LedgerSession(
    cloud,
    local,
    (fn) => fn(),
    controller.signal,
    () => at,
  )
  return { storage, cloud, local, session, controller }
}
describe('protected local data', () => {
  it('clears only expendable cache, not drafts or pending operations', () => {
    const { local, cloud } = fixture()
    local.saveDraft(draft('one'))
    local.savePending(createAccount())
    local.cache(cloud.book, cloud.operations)
    local.clearCache()
    expect(local.cached()).toBeUndefined()
    expect(local.drafts()).toHaveLength(1)
    expect(local.pending()).toHaveLength(1)
  })
  it('rejects cross-owner data and uses separate namespaces', () => {
    const { local, storage } = fixture()
    local.saveDraft(draft('one'))
    expect(new LocalRepository(storage, 'bob', 'book').drafts()).toHaveLength(0)
    expect(() => local.saveDraft({ ...draft('two'), ownerId: 'bob' })).toThrow('目前使用者')
  })
  it('quota failure retains the previous protected revision and never claims success', () => {
    const { local, storage } = fixture()
    local.saveDraft(draft('one'))
    storage.fail = true
    expect(() => local.saveDraft(draft('two'))).toThrow('尚未安全保存')
    expect(local.drafts()[0].revisionId).toBe('one')
  })
  it('a late draft acknowledgement cannot acknowledge a newer local revision', () => {
    const { local } = fixture()
    const old = draft('one'),
      current = draft('two', ['one'])
    local.saveDraft(old)
    local.saveDraft(current)
    local.acknowledgeDraft(old)
    expect(local.isDraftSynced(current)).toBe(false)
  })
})
describe('cloud-confirmed operation lifecycle', () => {
  it('cloud-synced drafts do not affect posted balance', async () => {
    const { session } = fixture()
    await session.sync()
    session.saveDraft(transaction())
    await session.sync()
    expect(session.drafts).toHaveLength(1)
    expect(session.ledger.transactions).toHaveLength(0)
    expect(balances(session.ledger).cash).toBe('1000')
  })
  it('failed cloud save retains the entire pending operation and original balance', async () => {
    const { session, cloud, local } = fixture()
    await session.sync()
    session.saveDraft(transaction())
    cloud.failBefore = true
    await expect(session.postDraft('purchase')).rejects.toThrow('network')
    expect(balances(session.ledger).cash).toBe('1000')
    expect(local.pending()).toHaveLength(1)
    expect(local.drafts()).toHaveLength(1)
    cloud.failBefore = false
    await session.retry(local.pending()[0].id)
    expect(balances(session.ledger).cash).toBe('800')
    expect(local.pending()).toHaveLength(0)
  })
  it('lost response recovers the same operation without a second payment', async () => {
    const { session, cloud, local } = fixture()
    await session.sync()
    session.saveDraft(transaction())
    cloud.failAfter = true
    await expect(session.postDraft('purchase')).rejects.toThrow('response lost')
    expect(local.pending()).toHaveLength(1)
    cloud.failAfter = false
    await session.sync()
    expect(local.pending()).toHaveLength(0)
    expect(balances(session.ledger).cash).toBe('800')
    await expect(session.postDraft('purchase')).rejects.toThrow('已提交過')
    expect(cloud.operations).toHaveLength(2)
  })
  it('rapid offline edits keep one recoverable head without missing intermediate revisions', async () => {
    const { session } = fixture()
    await session.sync()
    session.saveDraft(transaction())
    await session.sync()
    session.saveDraft({ ...transaction(), title: 'A' })
    session.saveDraft({ ...transaction(), title: 'B' })
    session.saveDraft({ ...transaction(), title: 'C' })
    expect(session.drafts).toHaveLength(1)
    expect(session.drafts[0].value.title).toBe('C')
    await session.sync()
    expect(session.drafts).toHaveLength(1)
  })
  it('an edit during upload remains dirty and descends from the in-flight revision', async () => {
    const { session, cloud, local } = fixture()
    await session.sync()
    const first = session.saveDraft(transaction())
    let release!: () => void
    let started!: () => void
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve
    })
    const wait = new Promise<void>((resolve) => {
      release = resolve
    })
    cloud.writeDraft = async (value) => {
      started()
      await wait
      cloud.drafts.push(value)
    }
    const syncing = session.sync()
    await startedPromise
    const next = session.saveDraft({ ...transaction(), title: 'newer' })
    release()
    await syncing
    expect(next.parents).toContain(first.revisionId)
    expect(session.drafts).toHaveLength(1)
    expect(local.isDraftSynced(next)).toBe(false)
  })
  it('an aborted identity session cannot submit', async () => {
    const { session, controller, cloud } = fixture()
    await session.sync()
    session.saveDraft(transaction())
    controller.abort()
    await expect(session.postDraft('purchase')).rejects.toThrow('工作階段')
    expect(cloud.operations).toHaveLength(1)
  })
})

describe('pending intent safety', () => {
  it('freezes an uncertain submission while allowing a separate copied draft', async () => {
    const { session, cloud } = fixture()
    await session.sync()
    session.saveDraft(transaction())
    cloud.failBefore = true
    await expect(session.postDraft('purchase')).rejects.toThrow()
    expect(() => session.saveDraft({ ...transaction(), title: 'changed' })).toThrow('待確認提交')
    expect(() => session.saveDraft(transaction(), true)).toThrow('待確認提交')
    expect(() => session.saveDraft(transaction())).not.toThrow()
    expect(() => session.saveDraft({ ...transaction(), id: 'copy' })).not.toThrow()
  })
  it('retries the exact reversal intent even when the user enters a new reason', async () => {
    const { session, cloud, local } = fixture()
    await session.sync()
    session.saveDraft(transaction())
    await session.postDraft('purchase')
    cloud.failBefore = true
    await expect(session.reverse('purchase', 'first reason')).rejects.toThrow()
    const pending = local.pending()[0]
    cloud.failBefore = false
    await session.reverse('purchase', 'new reason')
    expect(cloud.operations.at(-1)).toEqual(pending)
    expect(balances(session.ledger).cash).toBe('1000')
  })
  it('refuses to retry a queued transaction against changed account settings', async () => {
    const { session, cloud, local } = fixture()
    await session.sync()
    session.saveDraft(transaction())
    cloud.failBefore = true
    await expect(session.postDraft('purchase')).rejects.toThrow()
    const original = createAccount()
    if (original.command.type !== 'account.put') throw new Error('fixture')
    cloud.operations.push({
      ...original,
      id: 'edit',
      command: {
        ...original.command,
        baseVersionId: original.id,
        account: { ...original.command.account, name: 'updated' },
      },
    })
    cloud.failBefore = false
    await expect(session.retry(local.pending()[0].id)).rejects.toThrow('設定已變更')
    expect(cloud.operations).toHaveLength(2)
    expect(local.pending()).toHaveLength(1)
  })
})

describe('untrusted local storage isolation', () => {
  it('rejects a foreign owner planted into the current namespace without deleting it', () => {
    const { local, storage } = fixture()
    local.saveDraft(draft('owned'))
    const key = [...storage.values.keys()].find((key) => key.includes(':draft:'))!
    storage.values.set(key, JSON.stringify({ ...draft('foreign'), ownerId: 'bob' }))
    expect(() => local.drafts()).toThrow('目前使用者')
    expect(storage.values.has(key)).toBe(true)
  })
  it('rejects a foreign pending operation planted into the current namespace', () => {
    const { local, storage } = fixture()
    local.savePending(createAccount())
    const key = [...storage.values.keys()].find((key) => key.includes(':pending:'))!
    storage.values.set(key, JSON.stringify({ ...createAccount(), ownerId: 'bob' }))
    expect(() => local.pending()).toThrow('目前使用者')
  })
})
