import { defineStore } from 'pinia'
import { ref, shallowRef, computed } from 'vue'
import { DateTime } from 'luxon'
import { LedgerSession } from '../application/session'
import { DriveClient, DriveError, openDrive, bindingSchema } from '../infrastructure/drive'
import { configuredClientId, requestToken, preloadGoogle } from '../infrastructure/auth'
import { AuthSessionStorage, type AuthSession } from '../infrastructure/auth-session'
import { LocalRepository, bindingKey } from '../infrastructure/local'
import { project, balances } from '../domain/ledger'
import {
  newId,
  type Identity,
  type Ledger,
  type Draft,
  type Transaction,
  type Operation,
  type Account,
} from '../domain/model'

export const useBookStore = defineStore('book', () => {
  const identity = ref<Identity | null>(null)
  const ledger = shallowRef<Ledger>(project([]))
  const drafts = shallowRef<Draft[]>([])
  const pending = shallowRef<Operation[]>([])
  const working = ref(false)
  const connecting = ref(false)
  const restoring = ref(false)
  const renewing = ref(false)
  const renewalDue = ref(false)
  const authorizationExpiresAt = ref(0)
  const ready = ref(false)
  const error = ref('')
  const notice = ref('')
  const lastSyncedAt = ref('')
  const cached = ref(false)
  const online = ref(navigator.onLine)
  const clientId = ref(configuredClientId())
  const folderUrl = ref('')
  const credentials = new AuthSessionStorage()
  let accountHint = credentials.readAccount(clientId.value)
  const hasAccountHint = ref(!!accountHint)
  let driveClient: DriveClient | undefined
  let restoreRetry = false
  let expiryTimer: ReturnType<typeof setTimeout> | undefined
  let active: LedgerSession | undefined
  let abort: AbortController | undefined
  let epoch = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let broadcast: BroadcastChannel | undefined
  const accountBalances = computed(() => balances(ledger.value))
  const visibleDrafts = computed(() =>
    drafts.value.filter(
      (d) => !d.discarded && !ledger.value.transactions.some((t) => t.id === d.id),
    ),
  )
  const status = computed(() =>
    renewing.value
      ? '正在續接 Google Drive'
      : restoring.value
        ? '正在恢復 Google Drive'
        : !identity.value
          ? error.value
            ? '需要重新連接'
            : '尚未連接'
          : !online.value
            ? '離線，可編輯草稿'
            : working.value || connecting.value
              ? '正在同步'
              : cached.value
                ? '快取資料，等待核對'
                : error.value
                  ? '需要處理'
                  : pending.value.length
                    ? '有待確認提交'
                    : ready.value
                      ? '已連接 Google Drive'
                      : '需要重新連接',
  )
  function update(session: LedgerSession) {
    if (active !== session) return
    ledger.value = session.ledger
    drafts.value = session.drafts
    pending.value = session.pending
    lastSyncedAt.value = session.lastSyncedAt
    cached.value = false
  }
  function forgetCredential() {
    const cleared = credentials.clear()
    authorizationExpiresAt.value = 0
    restoreRetry = false
    clearTimeout(expiryTimer)
    renewalDue.value = false
    if (!cleared) notice.value = '瀏覽器無法清除分頁授權暫存，請關閉此分頁並清除網站資料。'
  }
  function expireCredential() {
    forgetCredential()
    ready.value = false
    error.value = 'Google 授權已到期或失效，請續接 Google Drive；草稿及待確認提交已保留'
  }
  function forgetAccount() {
    accountHint = undefined
    hasAccountHint.value = false
    if (!credentials.clearAccount())
      notice.value = '瀏覽器無法清除分頁帳號提示，請關閉此分頁並清除網站資料。'
  }
  function checkAuthorizationTime() {
    if (!authorizationExpiresAt.value) return
    if (Date.now() >= authorizationExpiresAt.value) expireCredential()
    else renewalDue.value = authorizationExpiresAt.value - Date.now() <= 5 * 60_000
  }
  function scheduleExpiry(expiresAt: number) {
    authorizationExpiresAt.value = expiresAt
    clearTimeout(expiryTimer)
    checkAuthorizationTime()
    if (!authorizationExpiresAt.value) return
    // Only show a reminder. GIS renewal must be initiated by an explicit click.
    const delay = expiresAt - Date.now() - (renewalDue.value ? 0 : 5 * 60_000)
    expiryTimer = setTimeout(
      () => scheduleExpiry(expiresAt),
      Math.min(Math.max(0, delay), 2_147_483_647),
    )
  }
  function rememberAuthorization(
    auth: Pick<AuthSession, 'token' | 'expiresAt'>,
    user: Identity,
    oauthClientId: string,
  ) {
    if (!credentials.save({ version: 1, clientId: oauthClientId, ownerId: user.id, ...auth }))
      notice.value = '瀏覽器無法保存分頁授權，這次連線仍可使用，重整後需重新連接。'
    accountHint = { version: 1, clientId: oauthClientId, ownerId: user.id, email: user.email }
    hasAccountHint.value = true
    credentials.saveAccount(accountHint)
    scheduleExpiry(auth.expiresAt)
  }
  async function run(action: (session: LedgerSession) => Promise<unknown>, message = '') {
    const session = active
    if (authorizationExpiresAt.value && Date.now() >= authorizationExpiresAt.value)
      expireCredential()
    if (!session || !ready.value) throw new Error('請先連接 Google Drive')
    if (!online.value) throw new Error('目前離線，請保留草稿後再提交')
    if (working.value || renewing.value) throw new Error('正在處理上一項操作，請稍候')
    working.value = true
    error.value = ''
    notice.value = ''
    try {
      await action(session)
      if (active !== session) return
      update(session)
      notice.value = message
      if (message) broadcast?.postMessage('changed')
    } catch (caught) {
      if (active !== session) return
      update(session)
      error.value = caught instanceof Error ? caught.message : '操作未完成，請再試一次'
      if (caught instanceof DriveError && caught.status === 401) expireCredential()
      throw caught
    } finally {
      if (active === session) working.value = false
    }
  }
  function clearSession() {
    epoch++
    abort?.abort()
    active = undefined
    driveClient = undefined
    renewing.value = false
    renewalDue.value = false
    broadcast?.close()
    clearTimeout(timer)
    clearTimeout(expiryTimer)
    authorizationExpiresAt.value = 0
    restoreRetry = false
    restoring.value = false
    identity.value = null
    ledger.value = project([])
    drafts.value = []
    pending.value = []
    ready.value = false
    working.value = false
    connecting.value = false
    cached.value = false
    lastSyncedAt.value = ''
    folderUrl.value = ''
  }
  async function establish(
    authRequest: () => Promise<Pick<AuthSession, 'token' | 'expiresAt'>>,
    savedOwner?: string,
  ) {
    const current = epoch
    const oauthClientId = clientId.value
    connecting.value = true
    error.value = ''
    const controller = new AbortController()
    abort = controller
    try {
      const auth = await authRequest()
      if (current !== epoch) return
      const client = new DriveClient(auth.token, auth.expiresAt, controller.signal)
      const user = await client.identity()
      if (current !== epoch) return
      // Never trust the stored owner/client binding as proof of authorization.
      if (savedOwner && savedOwner !== user.id)
        throw new DriveError('Google 帳號與分頁暫存不符，請重新連接', 401)
      if (Date.now() >= auth.expiresAt) throw new DriveError('Google 授權已到期，請重新連接', 401)
      rememberAuthorization(auth, user, oauthClientId)
      identity.value = user
      const saved = localStorage.getItem(bindingKey(user.id))
      if (saved) {
        try {
          const binding = bindingSchema.parse(JSON.parse(saved))
          const cache = new LocalRepository(localStorage, user.id, binding.bookId).cached()
          if (cache) {
            ledger.value = project(cache.operations)
            cached.value = true
            lastSyncedAt.value = cache.savedAt
          }
        } catch {
          /* Invalid hints never prove authorization or block cloud recovery. */
        }
      }
      if (!navigator.locks)
        throw new Error(
          '此瀏覽器不支援安全的多分頁寫入，請使用最新版 Chrome、Safari、Firefox 或 Edge',
        )
      const opened = await navigator.locks.request(`choubo:init:${user.id}`, () =>
        openDrive(client, user, localStorage),
      )
      if (current !== epoch) return
      const session = new LedgerSession(
        opened.cloud,
        opened.local,
        async (fn) =>
          await navigator.locks.request(`choubo:${user.id}:${opened.cloud.book.id}`, fn),
        controller.signal,
      )
      active = session
      driveClient = client
      await session.sync()
      if (current !== epoch) return
      if (Date.now() >= auth.expiresAt) throw new DriveError('Google 授權已到期，請重新連接', 401)
      ready.value = true
      update(session)
      folderUrl.value = `https://drive.google.com/drive/folders/${opened.cloud.binding.rootId}`
      if ('BroadcastChannel' in window) {
        broadcast = new BroadcastChannel(`choubo:${user.id}:${opened.cloud.book.id}`)
        broadcast.onmessage = () => {
          if (!working.value && !renewing.value) void sync().catch(() => undefined)
        }
      }
    } catch (caught) {
      if (current !== epoch) return
      error.value = caught instanceof Error ? caught.message : 'Google 連接未完成'
      if (caught instanceof DriveError && caught.status === 401) {
        forgetCredential()
        ready.value = false
      } else if (savedOwner && !identity.value) {
        // A transient network error is not a revoked authorization. Retry only
        // identity verification when online; never reveal cached data yet.
        restoreRetry = true
        error.value = '暫時無法向 Google 驗證連線，將於恢復網路後重試；也可手動重新連接'
      }
    } finally {
      if (current === epoch) {
        connecting.value = false
        restoring.value = false
      }
    }
  }
  async function connect(): Promise<void> {
    if (connecting.value || renewing.value || working.value) return
    if (identity.value && active && driveClient) return renewAuthorization()
    const hint = accountHint
    clearSession()
    notice.value = ''
    forgetCredential()
    await establish(
      () =>
        requestToken(clientId.value, {
          selectAccount: !hint,
          loginHint: hint?.email,
        }),
      hint?.ownerId,
    )
  }
  async function switchAccount() {
    clearSession()
    notice.value = ''
    forgetCredential()
    forgetAccount() // Clear before the picker, even when the user cancels.
    await establish(() => requestToken(clientId.value, { selectAccount: true }))
  }
  async function renewAuthorization(): Promise<void> {
    if (renewing.value || working.value || connecting.value) return
    const session = active,
      client = driveClient,
      user = identity.value,
      controller = abort
    if (!session || !client || !user || !controller) return connect()
    if (!online.value) {
      error.value = '目前離線，請保留草稿，恢復網路後再續接'
      return
    }
    const current = epoch,
      oauthClientId = clientId.value
    let installed = false
    renewing.value = true
    error.value = ''
    notice.value = ''
    try {
      const auth = await requestToken(oauthClientId, { loginHint: user.email })
      if (current !== epoch || active !== session) return
      const candidate = new DriveClient(auth.token, auth.expiresAt, controller.signal)
      const verified = await candidate.identity()
      if (current !== epoch || active !== session) return
      if (verified.id !== user.id)
        throw new Error('Google 回傳不同帳號，續接已取消；請使用「切換帳號」另行連接')
      // Keep the LedgerSession and mounted editors; only replace a verified grant.
      client.replaceAuthorization(auth.token, auth.expiresAt)
      installed = true
      rememberAuthorization(auth, verified, oauthClientId)
      identity.value = verified
      ready.value = true
      await session.sync()
      if (current !== epoch || active !== session) return
      checkAuthorizationTime()
      update(session)
      if (ready.value && !notice.value) notice.value = 'Google Drive 授權已續接，編輯內容已保留'
    } catch (caught) {
      if (current !== epoch || active !== session) return
      checkAuthorizationTime()
      // Candidate errors do not invalidate an old, still usable grant.
      // A 401 after installing the candidate must disable cloud submissions.
      if (caught instanceof DriveError && caught.status === 401 && installed) expireCredential()
      error.value = caught instanceof Error ? caught.message : 'Google 續接未完成，請再試一次'
    } finally {
      if (current === epoch) renewing.value = false
    }
  }
  async function restoreConnection() {
    if (connecting.value || ready.value) return
    const saved = credentials.read(clientId.value)
    if (saved.state !== 'valid') {
      restoreRetry = false
      if (saved.state === 'expired' || saved.state === 'invalid')
        error.value = '分頁授權已到期或失效，請重新連接 Google Drive'
      return
    }
    clearSession()
    restoring.value = true
    // Keep the original expiry; reloading must never extend a Google grant.
    scheduleExpiry(saved.value.expiresAt)
    await establish(
      async () => ({ token: saved.value.token, expiresAt: saved.value.expiresAt }),
      saved.value.ownerId,
    )
  }
  function disconnect() {
    clearSession()
    error.value = ''
    notice.value = '已登出，草稿保留在原使用者的本機空間'
    forgetCredential()
    forgetAccount()
  }
  async function sync() {
    if (active && ready.value) await run((s) => s.sync())
  }
  function saveDraft(value: Transaction, discarded = false, parents?: string[]) {
    if (!active) throw new Error('請先連接 Google Drive')
    const draft = active.saveDraft(value, discarded, parents)
    drafts.value = active.drafts
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (online.value && ready.value && !working.value && !renewing.value)
        void sync().catch(() => undefined)
    }, 1200)
    return draft
  }
  function isDraftSynced(draft: Draft) {
    return (
      active?.local.isDraftSynced(draft) ||
      active?.cloudDrafts.some((d) => d.revisionId === draft.revisionId) ||
      false
    )
  }
  function newTransaction(): Transaction {
    const now = DateTime.now().setZone('Asia/Taipei')
    const accountId = ledger.value.accounts.some(
      (a) => a.id === ledger.value.defaultAccountId && !a.archived,
    )
      ? ledger.value.defaultAccountId
      : ''
    return {
      id: newId(),
      kind: 'expense',
      accountId,
      targetAccountId: '',
      date: now.toISODate()!,
      time: now.toFormat('HH:mm'),
      title: '',
      merchant: '',
      invoiceNumber: '',
      randomCode: '',
      note: '',
      fee: '0',
      feeDiscount: '0',
      lines: [
        { id: newId(), categoryId: 'expense:0:0', name: '', amount: '', destinationAmount: '' },
      ],
    }
  }
  function saveConfig(id: string) {
    localStorage.setItem('choubo:google-client-id', id.trim())
    const configured = configuredClientId()
    if (clientId.value !== configured) disconnect()
    clientId.value = configured
    void preloadGoogle()
  }
  function exportData() {
    if (!active) throw new Error('請先連接帳本')
    return {
      format: 'choubo.basic-export',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      book: active.cloud.book,
      operations: active.operations,
      drafts: active.drafts,
      pending: active.pending,
    }
  }
  function clearCache() {
    active?.local.clearCache()
    notice.value = '已清除可重建快取，草稿及待確認提交保留'
  }
  function initEvents() {
    const foreground = () => {
      checkAuthorizationTime()
      if (restoreRetry && online.value && !connecting.value && !renewing.value)
        void restoreConnection()
      if (
        document.visibilityState === 'visible' &&
        ready.value &&
        online.value &&
        !working.value &&
        !renewing.value
      )
        void sync().catch(() => undefined)
    }
    const onOnline = () => {
      online.value = true
      foreground()
    }
    const onOffline = () => {
      online.value = false
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', foreground)
    const interval = setInterval(foreground, 60_000)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', foreground)
      clearInterval(interval)
      clearTimeout(expiryTimer)
      clearTimeout(timer)
      abort?.abort()
      broadcast?.close()
    }
  }
  return {
    identity,
    ledger,
    drafts,
    visibleDrafts,
    pending,
    working: computed(() => working.value || renewing.value),
    renewing,
    renewalDue,
    authorizationExpiresAt,
    hasAccountHint,
    connecting,
    restoring,
    ready,
    error,
    notice,
    lastSyncedAt,
    cached,
    online,
    clientId,
    status,
    accountBalances,
    folderUrl,
    connect,
    renewAuthorization,
    switchAccount,
    restoreConnection,
    disconnect,
    sync,
    saveDraft,
    isDraftSynced,
    newTransaction,
    saveConfig,
    exportData,
    clearCache,
    initEvents,
    saveAccount: (account: Account, version: string | null) =>
      run((s) => s.saveAccount(account, version), '帳戶已保存至 Google Drive'),
    setDefault: (id: string) => run((s) => s.setDefault(id), '已設定預設記帳帳戶'),
    postDraft: (id: string) => run((s) => s.postDraft(id), 'Drive 已確認保存，紀錄已正式入帳'),
    retry: (id: string) => run((s) => s.retry(id), '已確認雲端保存結果'),
    reverse: (id: string, reason: string) =>
      run((s) => s.reverse(id, reason), '已建立撤銷紀錄，原始內容仍可查閱'),
  }
})
