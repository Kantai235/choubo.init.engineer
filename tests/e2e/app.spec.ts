import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { AUTH_SESSION_KEY, AUTH_ACCOUNT_KEY } from '../../src/infrastructure/auth-session'

type File = {
  id: string
  name: string
  mimeType: string
  ownedByMe: boolean
  parents: string[]
  appProperties?: Record<string, string>
  content?: unknown
}
test.afterEach(async ({ page }) => {
  await expect(page.getByText('Invalid PrimeUI License', { exact: true })).not.toBeVisible()
})

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => {
    throw error
  })
})

async function installDrive(page: Page) {
  // drive.file can create/list app files in My Drive without granting access
  // to the root folder's metadata. API responses contain real parent IDs.
  const files = new Map<string, File>()
  let id = 0
  const control = {
    failOperations: false,
    ownerId: 'alice-user',
    rootMetadataReads: 0,
    files,
    oauthCalls: 0,
    oauthRequests: [] as { prompt: string; login_hint?: string }[],
    token: 'test-memory-token',
    oauthWait: undefined as Promise<void> | undefined,
    authorizations: [] as string[],
    cancelOAuth: false,
    expiresIn: 3600,
    identityStatus: 200,
    apiStatus: 200,
    identityWait: undefined as Promise<void> | undefined,
    requests: [] as string[],
  }
  await page.exposeFunction(
    'mockAuthorize',
    async (options: { prompt: string; login_hint?: string }) => {
      control.oauthCalls++
      control.oauthRequests.push(options)
      await control.oauthWait
      return { cancel: control.cancelOAuth, expiresIn: control.expiresIn, token: control.token }
    },
  )
  await page.addInitScript(() => {
    localStorage.setItem('choubo:google-client-id', 'test.apps.googleusercontent.com')
    Object.assign(window, {
      google: {
        accounts: {
          oauth2: {
            initTokenClient: (config: {
              callback: (data: unknown) => void
              error_callback: (data: unknown) => void
            }) => ({
              requestAccessToken: async (options: { prompt: string; login_hint?: string }) => {
                const mock = await (
                  window as unknown as {
                    mockAuthorize: (options: {
                      prompt: string
                      login_hint?: string
                    }) => Promise<{ cancel: boolean; expiresIn: number; token: string }>
                  }
                ).mockAuthorize(options)
                if (mock.cancel) return config.error_callback({ type: 'popup_closed' })
                config.callback({
                  access_token: mock.token,
                  scope: 'https://www.googleapis.com/auth/drive.file',
                  expires_in: mock.expiresIn,
                })
              },
            }),
          },
        },
      },
    })
  })
  await page.route('https://www.googleapis.com/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url())
    const respond = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
        headers: { 'Access-Control-Allow-Origin': '*' },
      })
    control.requests.push(url.pathname)
    control.authorizations.push(request.headers().authorization ?? '')
    if (control.apiStatus !== 200) return respond({ error: 'unauthorized' }, control.apiStatus)
    if (url.pathname.endsWith('/about')) {
      await control.identityWait
      if (control.identityStatus !== 200)
        return respond({ error: 'auth unavailable' }, control.identityStatus)
      return respond({
        user: {
          permissionId: control.ownerId,
          displayName: '小林',
          emailAddress:
            control.ownerId === 'alice-user' ? 'alice@example.test' : 'bob@example.test',
        },
      })
    }
    if (url.pathname.endsWith('/generateIds')) return respond({ ids: [`drive-${++id}`] })
    if (request.method() === 'POST') {
      let metadata: Omit<File, 'ownedByMe'>, content: unknown
      const raw = request.postData()!
      const boundary = request.headers()['content-type']?.split('boundary=')[1]
      if (boundary) {
        const parts = raw
          .split(`--${boundary}`)
          .filter((p) => p.includes('Content-Type:'))
          .map((p) => p.slice(p.indexOf('\r\n\r\n') + 4).trim())
        metadata = JSON.parse(parts[0])
        content = JSON.parse(parts[1])
      } else metadata = JSON.parse(raw)
      if (metadata.appProperties?.role === 'operation' && control.failOperations)
        return respond({ error: 'unavailable' }, 503)
      if (files.has(metadata.id)) return respond({ error: 'exists' }, 409)
      files.set(metadata.id, {
        ...metadata,
        parents: metadata.parents.map((parent) => (parent === 'root' ? 'root-id' : parent)),
        ownedByMe: true,
        content,
      })
      return respond({ id: metadata.id })
    }
    const match = url.pathname.match(/\/files\/([^/]+)$/)
    if (match) {
      if (['root', 'root-id'].includes(match[1])) {
        control.rootMetadataReads++
        return respond({ error: 'not found' }, 404)
      }
      const file = files.get(decodeURIComponent(match[1]))
      if (!file) return respond({ error: 'not found' }, 404)
      return respond(url.searchParams.get('alt') === 'media' ? file.content : file)
    }
    const q = url.searchParams.get('q') ?? '',
      parent = q.match(/^'([^']+)' in parents/)?.[1],
      role = q.match(/key='role' and value='([^']+)'/)?.[1]
    return respond({
      files: [...files.values()].filter(
        (f) =>
          f.parents.includes(parent === 'root' ? 'root-id' : (parent ?? '')) &&
          (!role || f.appProperties?.role === role),
      ),
    })
  })
  return control
}
async function connect(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: '連接 Google Drive', exact: true }).click()
  await expect(page.getByText('已連接 Google Drive', { exact: true })).toBeVisible()
}
async function restore(page: Page) {
  await page.goto('/')
  await expect(page.getByText('已連接 Google Drive', { exact: true })).toBeVisible()
}
async function createAccount(page: Page, name = '日常現金', balance = '1000') {
  await page.getByRole('link', { name: '我的帳戶', exact: true }).click()
  await page.getByRole('button', { name: '新增帳戶', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  // PrimeVue focuses the first input after its enter transition. Filling a
  // second field before that callback can send text to the first field in CI.
  await expect(dialog).not.toHaveClass(/p-dialog-enter-(active|from|to)/)
  await page.getByLabel('帳戶名稱', { exact: true }).fill(name)
  await page.getByLabel('期初餘額', { exact: false }).fill(balance)
  await expect(page.getByLabel('帳戶名稱', { exact: true })).toHaveValue(name)
  await expect(page.getByLabel('期初餘額', { exact: false })).toHaveValue(balance)
  await page.getByRole('button', { name: '保存帳戶', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
}
async function openExpense(page: Page) {
  await page.getByRole('link', { name: /^(收支紀錄|紀錄)$/ }).click()
  await page.getByRole('button', { name: '記一筆', exact: true }).click()
  await page.getByLabel('記帳帳戶', { exact: true }).selectOption({ label: '日常現金 · TWD' })
  await page.getByLabel('第 1 行名稱', { exact: true }).fill('早餐三明治')
  await page.getByLabel('第 1 行金額', { exact: true }).fill('60')
}

test('unauthorized onboarding and developer configuration are useful without exposing a local ledger', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /好好記帳，\s*留點餘裕給生活。/ })).toBeVisible()
  await page.getByRole('link', { name: '設定 Google 連線' }).click()
  await expect(page.getByRole('heading', { name: '開發環境連線設定' })).toBeVisible()
  await page.screenshot({
    path: 'test-results/settings-desktop.png',
    fullPage: true,
    animations: 'disabled',
  })
})
test('first use creates a book without root metadata and rediscovers it after losing the binding', async ({
  page,
}) => {
  const mock = await installDrive(page)
  await connect(page)
  expect(mock.rootMetadataReads).toBe(0)
  const roots = [...mock.files.values()].filter((f) => f.appProperties?.role === 'root')
  expect(roots).toHaveLength(1)
  expect(roots[0].parents).toEqual(['root-id'])
  const originalIds = [...mock.files.keys()]
  await page.evaluate(() => localStorage.removeItem('choubo:binding:alice-user'))
  await restore(page)
  expect([...mock.files.keys()]).toEqual(originalIds)
  expect(mock.rootMetadataReads).toBe(0)
})

test('a missing existing manifest stops reconnection without creating an empty replacement', async ({
  page,
}) => {
  const mock = await installDrive(page)
  await connect(page)
  const manifest = [...mock.files.values()].find((f) => f.appProperties?.role === 'manifest')!
  mock.files.delete(manifest.id)
  const originalIds = [...mock.files.keys()]
  await page.reload()
  await expect(page.getByText(/無法存取這份 Drive 資料/)).toBeVisible()
  expect([...mock.files.keys()]).toEqual(originalIds)
})

test('moving an established app folder still stops reconnection', async ({ page }) => {
  const mock = await installDrive(page)
  await connect(page)
  const root = [...mock.files.values()].find((f) => f.appProperties?.role === 'root')!
  root.parents = ['another-folder']
  await page.reload()
  await expect(page.getByText('Drive 資料夾已移動、刪除或失去權限，已停止提交')).toBeVisible()
})

test('cloud account, two-line posting, persisted reload, and reversal', async ({ page }) => {
  const mock = await installDrive(page)
  await connect(page)
  await createAccount(page)
  await openExpense(page)
  await page.getByRole('button', { name: '新增一行明細' }).click()
  await page.getByLabel('第 2 行分類', { exact: true }).selectOption({ label: '家居／日常用品' })
  await page.getByLabel('第 2 行名稱', { exact: true }).fill('日用品')
  await page.getByLabel('第 2 行金額', { exact: true }).fill('140')
  await page.getByRole('button', { name: '確認入帳', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByRole('button', { name: /早餐三明治.*200/ })).toBeVisible()
  await page.getByRole('link', { name: '總覽', exact: true }).click()
  await expect(page.locator('.balance-number')).toHaveText('800')
  await page.screenshot({
    path: 'test-results/dashboard-desktop.png',
    fullPage: true,
    animations: 'disabled',
  })
  const stored = await page.evaluate(() => JSON.stringify(localStorage))
  expect(stored).not.toContain('test-memory-token')
  expect(
    [...mock.files.values()].filter((f) => f.appProperties?.role === 'operation'),
  ).toHaveLength(2)
  await restore(page)
  await expect(page.locator('.balance-number')).toHaveText('800')
  await page.getByRole('button', { name: /早餐三明治.*200/ }).click()
  await page.getByRole('button', { name: '撤銷這筆紀錄' }).click()
  await page.getByLabel('撤銷原因').fill('重複記帳')
  await page.getByRole('button', { name: '確認撤銷', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.locator('.balance-number')).toHaveText('1,000')
})
test('failed cloud submission retains the draft and a single retry posts once', async ({
  page,
}) => {
  const mock = await installDrive(page)
  await connect(page)
  await createAccount(page)
  await openExpense(page)
  mock.failOperations = true
  await page.getByRole('button', { name: '確認入帳', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible()
  mock.failOperations = false
  await page.getByRole('button', { name: '保留草稿', exact: true }).click()
  await page.getByRole('link', { name: /^草稿/ }).first().click()
  await page.getByRole('button', { name: '查回／重試' }).click()
  await expect(page.getByRole('heading', { name: '等待確認的提交' })).not.toBeVisible()
  await page.getByRole('link', { name: '總覽', exact: true }).click()
  await expect(page.locator('.balance-number')).toHaveText('940')
  expect(
    [...mock.files.values()].filter((f) => f.appProperties?.role === 'operation'),
  ).toHaveLength(2)
})
test('offline drafts survive reload, remain non-posting, and render at 360px', async ({
  page,
  context,
}) => {
  await installDrive(page)
  await connect(page)
  await createAccount(page)
  await openExpense(page)
  await context.setOffline(true)
  await expect(page.getByRole('button', { name: '確認入帳', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '保留草稿', exact: true }).click()
  await context.setOffline(false)
  await restore(page)
  await expect(page.locator('.balance-number')).toHaveText('1,000')
  await page.getByRole('link', { name: /^草稿/ }).first().click()
  await expect(page.getByRole('heading', { name: '早餐三明治' })).toBeVisible()
  await page.setViewportSize({ width: 360, height: 800 })
  await page.getByRole('button', { name: '繼續編輯' }).click()
  await expect(page.getByLabel('第 1 行金額', { exact: true })).toHaveValue('60')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.screenshot({
    path: 'test-results/editor-mobile.png',
    fullPage: true,
    animations: 'disabled',
  })
  await page.getByRole('button', { name: '確認入帳', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.getByRole('link', { name: '總覽', exact: true }).click()
  await expect(page.locator('.balance-number')).toHaveText('940')
})

test('switching Google accounts hides all previous balances, drafts, and dialogs', async ({
  page,
}) => {
  const mock = await installDrive(page)
  await connect(page)
  await createAccount(page)
  await openExpense(page)
  await page.getByRole('button', { name: '保留草稿', exact: true }).click()
  await page.getByRole('link', { name: '設定', exact: true }).click()
  mock.ownerId = 'bob-user'
  // The provider returns a separate Drive space for the newly selected owner.
  mock.files.clear()
  await page.getByRole('button', { name: '切換帳號', exact: true }).click()
  await expect(page.getByText('已連接 Google Drive', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: '總覽', exact: true }).click()
  await expect(page.locator('.balance-number')).toHaveText('0')
  await expect(page.getByText('日常現金', { exact: true })).not.toBeVisible()
  await page.getByRole('link', { name: /^草稿/ }).first().click()
  await expect(page.getByRole('heading', { name: '目前沒有未完成的草稿' })).toBeVisible()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).some(
        (key) => key.includes('alice-user') && key.includes(':draft:'),
      ),
    ),
  ).toBe(true)
})

test('income and same-currency transfer keep principal out of spending totals', async ({
  page,
}) => {
  await installDrive(page)
  await connect(page)
  await createAccount(page)
  await createAccount(page, '日常銀行', '500')
  await openExpense(page)
  await page.getByRole('button', { name: '收入', exact: true }).click()
  await page.getByLabel('第 1 行名稱', { exact: true }).fill('薪水')
  await page.getByLabel('第 1 行金額', { exact: true }).fill('2000')
  await page.getByRole('button', { name: '確認入帳', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await openExpense(page)
  await page.getByRole('button', { name: '轉帳', exact: true }).click()
  await page.getByLabel('轉入帳戶', { exact: true }).selectOption({ label: '日常銀行 · TWD' })
  await page.getByLabel('第 1 行金額', { exact: true }).fill('100')
  await page.getByLabel('手續費', { exact: true }).fill('15')
  await page.getByLabel('手續費折扣', { exact: true }).fill('5')
  await page.getByRole('button', { name: '確認入帳', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.getByRole('link', { name: '總覽', exact: true }).click()
  await expect(page.locator('.balance-number')).toHaveText('3,490')
  await expect(page.locator('.month-stat').filter({ hasText: '本月收入' })).toContainText('2,000')
  await expect(page.locator('.month-stat').filter({ hasText: '本月支出' })).toContainText('10')
})

test('financial text is rendered as text and never executes markup', async ({ page }) => {
  await installDrive(page)
  await connect(page)
  await createAccount(page)
  await openExpense(page)
  const payload = '<img src=x onerror="window.__ledgerXss=true">'
  await page.getByLabel('第 1 行名稱', { exact: true }).fill(payload)
  await page.getByRole('button', { name: '確認入帳', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByText(payload, { exact: true })).toBeVisible()
  expect(await page.evaluate(() => Object.hasOwn(window, '__ledgerXss'))).toBe(false)
  await expect(page.locator('img[src="x"]')).toHaveCount(0)
  await page.reload()
  await expect(page.getByText('已連接 Google Drive', { exact: true })).toBeVisible()
  await expect(page.getByText(payload, { exact: true })).toBeVisible()
  expect(await page.evaluate(() => Object.hasOwn(window, '__ledgerXss'))).toBe(false)
  await expect(page.locator('img[src="x"]')).toHaveCount(0)
})

async function assertReadableSurface(page: Page) {
  const dialog = page.getByRole('dialog')
  if (await dialog.isVisible())
    await expect(dialog).not.toHaveClass(/p-dialog-enter-(active|from|to)/)
  const issues = await page.evaluate(() => {
    const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number)
    const luminance = (c: number[]) =>
      c
        .slice(0, 3)
        .map((x) => {
          const n = x / 255
          return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4
        })
        .reduce((v, n, i) => v + n * [0.2126, 0.7152, 0.0722][i]!, 0)
    const issues: string[] = []
    for (const el of document.querySelectorAll<HTMLElement>(
      'main *, .p-dialog *, .sidebar a, .mobile-nav a',
    )) {
      if (
        !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) ||
        el.closest('[aria-hidden="true"], :disabled') ||
        ![...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())
      )
        continue
      const fg = rgb(getComputedStyle(el).color)
      let ancestor: HTMLElement | null = el
      let bg: number[] = []
      while (ancestor) {
        bg = rgb(getComputedStyle(ancestor).backgroundColor)
        if (bg.length === 3 || bg[3] === 1) break
        ancestor = ancestor.parentElement
      }
      if (!ancestor || fg.length < 3 || bg.length < 3) continue
      const a = luminance(fg),
        b = luminance(bg)
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
      const style = getComputedStyle(el)
      const large =
        parseFloat(style.fontSize) >= 24 ||
        (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700)
      if (ratio < (large ? 3 : 4.5))
        issues.push(
          `${el.tagName}.${el.className}: ${el.textContent?.trim().slice(0, 24)} (${ratio.toFixed(2)})`,
        )
    }
    return issues
  })
  expect(issues).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}

for (const scheme of ['light', 'dark'] as const) {
  test(`UI audit: ${scheme} desktop and mobile surfaces, dialogs and error states`, async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await page.emulateMedia({ colorScheme: scheme })
    const mock = await installDrive(page)
    await page.goto('/')
    await assertReadableSurface(page)
    await page.screenshot({ path: `test-results/audit-${scheme}-onboarding.png`, fullPage: true })
    await page.getByRole('button', { name: '連接 Google Drive', exact: true }).click()
    await expect(page.getByText('已連接 Google Drive', { exact: true })).toBeVisible()
    await createAccount(page)
    await openExpense(page)
    await page.getByRole('button', { name: '確認入帳', exact: true }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
    for (const width of [1440, 360]) {
      await page.setViewportSize({ width, height: width === 360 ? 800 : 1000 })
      for (const [path, name] of [
        ['/', 'dashboard'],
        ['/accounts', 'accounts'],
        ['/transactions', 'transactions'],
        ['/drafts', 'drafts'],
        ['/settings', 'settings'],
      ]) {
        await page.goto(`/#${path}`)
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        await assertReadableSurface(page)
        await page.screenshot({
          path: `test-results/audit-${scheme}-${width}-${name}.png`,
          fullPage: true,
        })
      }
      await page.goto('/#/accounts')
      await page.getByRole('button', { name: '編輯日常現金', exact: true }).click()
      await expect(page.getByRole('dialog')).not.toHaveClass(/p-dialog-enter-(active|from|to)/)
      await assertReadableSurface(page)
      await page.screenshot({
        path: `test-results/audit-${scheme}-${width}-account-editor.png`,
        fullPage: true,
      })
      await page.getByRole('button', { name: '取消', exact: true }).click()
      await page.goto('/#/transactions')
      await page
        .getByRole('button', { name: /早餐三明治.*60/ })
        .first()
        .click()
      await assertReadableSurface(page)
      await page.screenshot({
        path: `test-results/audit-${scheme}-${width}-record-detail.png`,
        fullPage: true,
      })
      await page.keyboard.press('Escape')
      await openExpense(page)
      mock.failOperations = true
      await page.getByRole('button', { name: '確認入帳', exact: true }).click()
      await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible()
      await assertReadableSurface(page)
      await page.screenshot({
        path: `test-results/audit-${scheme}-${width}-editor-error.png`,
        fullPage: true,
      })
      mock.failOperations = false
      await page.getByRole('button', { name: '保留草稿', exact: true }).click()
      await page.goto('/#/drafts')
      await assertReadableSurface(page)
      await page.screenshot({
        path: `test-results/audit-${scheme}-${width}-pending.png`,
        fullPage: true,
      })
      await page.getByRole('button', { name: '查回／重試' }).click()
      await expect(page.getByRole('heading', { name: '等待確認的提交' })).not.toBeVisible()
    }
    await page.goto('/privacy.html')
    await assertReadableSurface(page)
    await page.screenshot({ path: `test-results/audit-${scheme}-privacy.png`, fullPage: true })
  })
}

test('appearance follows live system changes, including an open dialog, without reconnecting', async ({
  page,
}) => {
  await installDrive(page)
  await page.emulateMedia({ colorScheme: 'light' })
  await connect(page)
  await createAccount(page)
  await openExpense(page)
  await expect(page.getByRole('dialog')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.getByRole('dialog')).toHaveCSS('background-color', 'rgb(27, 37, 50)')
  await expect(page.getByText('已連接 Google Drive', { exact: true })).toBeVisible()
  await expect(page.getByLabel('第 1 行名稱', { exact: true })).toHaveValue('早餐三明治')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.getByRole('dialog')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
})

test('category search and reconciliation report controls agree with posted balance', async ({
  page,
}) => {
  await installDrive(page)
  await connect(page)
  await createAccount(page)
  await openExpense(page)
  await page.getByLabel('第 1 行分類', { exact: true }).selectOption({ label: '其他／對帳差額' })
  await page.getByRole('button', { name: '確認入帳', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.getByRole('textbox', { name: '搜尋紀錄' }).fill('對帳差額')
  await expect(page.getByRole('button', { name: /早餐三明治.*60/ })).toBeVisible()
  await page.goto('/#/')
  await expect(page.locator('.balance-number')).toHaveText('940')
  const spending = page.locator('.month-stat').filter({ hasText: '本月支出' }).locator('strong')
  await expect(spending).toHaveText('0')
  await page.getByLabel('包含對帳差額').check()
  await expect(spending).toHaveText('60')
  await expect(page.locator('.balance-number')).toHaveText('940')
})

test('account default, edit, exclusion, archive and restore preserve historical transactions', async ({
  page,
}) => {
  await installDrive(page)
  await connect(page)
  await createAccount(page)
  await openExpense(page)
  await page.getByRole('button', { name: '確認入帳', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.getByRole('link', { name: '我的帳戶', exact: true }).click()
  await page.getByRole('button', { name: '設為預設記帳帳戶' }).click()
  await expect(page.getByText('預設帳戶', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '編輯日常現金' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).not.toHaveClass(/p-dialog-enter-(active|from|to)/)
  await page.getByLabel('帳戶名稱', { exact: true }).fill('生活現金')
  await page.getByLabel('帳戶分組', { exact: true }).selectOption('儲值卡')
  await page.getByLabel('納入總餘額', { exact: true }).uncheck()
  await page.getByRole('button', { name: '保存帳戶' }).click()
  await expect(dialog).not.toBeVisible()
  await page.getByRole('link', { name: '總覽', exact: true }).click()
  await expect(page.locator('.balance-number')).toHaveText('0')
  await expect(
    page.locator('.month-stat').filter({ hasText: '本月支出' }).locator('strong'),
  ).toHaveText('60')
  await page.getByRole('button', { name: '記一筆', exact: true }).click()
  await expect(page.getByLabel('記帳帳戶', { exact: true }).locator('option:checked')).toHaveText(
    '生活現金 · TWD',
  )
  await page.keyboard.press('Escape')
  await page.getByRole('link', { name: '我的帳戶', exact: true }).click()
  await page.getByRole('button', { name: '編輯生活現金' }).click()
  await page.getByLabel('封存帳戶（保留歷史紀錄）', { exact: true }).check()
  await page.getByRole('button', { name: '保存帳戶' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole('heading', { name: '生活現金' })).not.toBeVisible()
  await page.getByLabel('顯示已封存').check()
  await expect(page.locator('.account-card-balance')).toContainText('940')
  await page.getByRole('button', { name: '編輯生活現金' }).click()
  await page.getByLabel('封存帳戶（保留歷史紀錄）', { exact: true }).uncheck()
  await page.getByLabel('納入總餘額', { exact: true }).check()
  await page.getByRole('button', { name: '保存帳戶' }).click()
  await expect(dialog).not.toBeVisible()
  await page.getByRole('link', { name: '總覽', exact: true }).click()
  await expect(page.locator('.balance-number')).toHaveText('940')
})

test('cross-currency transfer detail shows both legs and net fees', async ({ page }) => {
  await installDrive(page)
  await connect(page)
  await createAccount(page, '日常現金', '10000')
  await page.getByRole('button', { name: '新增帳戶', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).not.toHaveClass(/p-dialog-enter-(active|from|to)/)
  await page.getByLabel('帳戶名稱', { exact: true }).fill('美元帳戶')
  await page.getByLabel('主幣種', { exact: true }).selectOption('USD')
  await page.getByRole('button', { name: '保存帳戶', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await openExpense(page)
  await page.getByRole('button', { name: '轉帳', exact: true }).click()
  await page.getByLabel('轉入帳戶', { exact: true }).selectOption({ label: '美元帳戶 · USD' })
  await page.getByLabel('第 1 行金額', { exact: true }).fill('3200')
  await page.getByLabel('第 1 行轉入金額', { exact: true }).fill('100')
  await page.getByLabel('手續費', { exact: true }).fill('30')
  await page.getByRole('button', { name: '確認入帳', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await page.getByRole('button', { name: /早餐三明治.*3,200/ }).click()
  await expect(dialog).toContainText('轉入合計 USD 100')
  await expect(dialog).toContainText('來源實扣 TWD 3,230')
  await page.keyboard.press('Escape')
  await page.getByRole('link', { name: '總覽', exact: true }).click()
  await expect(page.locator('.balance-number')).toHaveText('6,770')
  await page.getByLabel('總覽幣種').selectOption('USD')
  await expect(page.locator('.balance-number')).toHaveText('100')
})

test('session restore verifies Google before showing cache, preserves expiry and never requests OAuth again', async ({
  page,
}) => {
  const mock = await installDrive(page)
  await connect(page)
  await createAccount(page)
  const before = await page.evaluate(
    (key) => JSON.parse(sessionStorage.getItem(key)!),
    AUTH_SESSION_KEY,
  )
  let release!: () => void
  mock.identityWait = new Promise<void>((resolve) => {
    release = resolve
  })
  mock.requests.length = 0
  await page.goto('/')
  await expect(page.getByText('正在恢復 Google Drive', { exact: true })).toBeVisible()
  await expect(page.locator('.balance-number')).not.toBeVisible()
  await expect(page.getByText('日常現金', { exact: true })).not.toBeVisible()
  await expect.poll(() => mock.requests).toEqual(['/drive/v3/about'])
  release()
  await expect(page.getByText('已連接 Google Drive', { exact: true })).toBeVisible()
  await expect(page.locator('.balance-number')).toHaveText('1,000')
  expect(mock.oauthCalls).toBe(1)
  expect(
    await page.evaluate(
      (key) => JSON.parse(sessionStorage.getItem(key)!).expiresAt,
      AUTH_SESSION_KEY,
    ),
  ).toBe(before.expiresAt)
  expect([...mock.files.values()].filter((f) => f.appProperties?.role === 'root')).toHaveLength(1)
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('test-memory-token')
  expect(JSON.stringify([...mock.files.values()])).not.toContain('test-memory-token')
  await page.getByRole('link', { name: '設定', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '下載 JSON', exact: true }).click()
  const download = await downloadPromise
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8'))
  expect(exported.operations).toHaveLength(1)
  expect(JSON.stringify(exported)).not.toContain('test-memory-token')
  expect(JSON.stringify(exported)).not.toContain('auth-session')
  expect(JSON.stringify(exported)).not.toContain('auth-account')
})

for (const reason of ['expired', 'revoked', 'owner-mismatch'] as const) {
  test(`session restore rejects ${reason} before loading data and preserves drafts and pending`, async ({
    page,
  }) => {
    const mock = await installDrive(page)
    await connect(page)
    await createAccount(page)
    await openExpense(page)
    mock.failOperations = true
    await page.getByRole('button', { name: '確認入帳', exact: true }).click()
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible()
    await page.getByRole('button', { name: '保留草稿', exact: true }).click()
    const protectedData = await page.evaluate(() =>
      Object.entries(localStorage)
        .filter(([key]) => key.includes(':draft:') || key.includes(':pending:'))
        .sort(),
    )
    expect(protectedData.length).toBeGreaterThan(0)
    if (reason === 'expired')
      await page.evaluate((key) => {
        const saved = JSON.parse(sessionStorage.getItem(key)!)
        saved.expiresAt = Date.now() - 1
        sessionStorage.setItem(key, JSON.stringify(saved))
      }, AUTH_SESSION_KEY)
    if (reason === 'revoked') mock.identityStatus = 401
    if (reason === 'owner-mismatch') mock.ownerId = 'bob-user'
    mock.requests.length = 0
    await page.goto('/')
    await expect(page.getByRole('alert')).toContainText(
      reason === 'owner-mismatch' ? '帳號與分頁暫存不符' : '授權已到期',
    )
    await expect(page.locator('.balance-number')).not.toBeVisible()
    expect(mock.requests).toEqual(reason === 'expired' ? [] : ['/drive/v3/about'])
    expect(mock.oauthCalls).toBe(1)
    expect(await page.evaluate((key) => sessionStorage.getItem(key), AUTH_SESSION_KEY)).toBeNull()
    expect(
      await page.evaluate(() =>
        Object.entries(localStorage)
          .filter(([key]) => key.includes(':draft:') || key.includes(':pending:'))
          .sort(),
      ),
    ).toEqual(protectedData)
  })
}

test('temporary identity failure preserves the unexpired grant and retries when online', async ({
  page,
}) => {
  const mock = await installDrive(page)
  await connect(page)
  await createAccount(page)
  mock.identityStatus = 503
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('暫時無法向 Google 驗證連線')
  await expect(page.locator('.balance-number')).not.toBeVisible()
  expect(await page.evaluate((key) => sessionStorage.getItem(key) !== null, AUTH_SESSION_KEY)).toBe(
    true,
  )
  mock.identityStatus = 200
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.getByText('已連接 Google Drive', { exact: true })).toBeVisible()
  await expect(page.locator('.balance-number')).toHaveText('1,000')
  expect(mock.oauthCalls).toBe(1)
})

test('expiry while open stops posting, keeps the draft, and supports explicit reconnect', async ({
  page,
}) => {
  const mock = await installDrive(page)
  await connect(page)
  await createAccount(page)
  await openExpense(page)
  await page.clock.setFixedTime(Date.now() + 3_700_000)
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(page.locator('main > [role="alert"]')).toContainText('授權已到期或失效')
  await expect(page.getByRole('button', { name: '確認入帳', exact: true })).toBeDisabled()
  expect(await page.evaluate((key) => sessionStorage.getItem(key), AUTH_SESSION_KEY)).toBeNull()
  await page.getByRole('button', { name: '保留草稿', exact: true }).click()
  await page.getByRole('link', { name: '設定', exact: true }).click()
  await page.getByRole('button', { name: '續接目前帳號', exact: true }).click()
  await expect(page.getByText('已連接 Google Drive', { exact: true })).toBeVisible()
  expect(mock.oauthCalls).toBe(2)
  await page.getByRole('link', { name: /^草稿/ }).first().click()
  await expect(page.getByRole('heading', { name: '早餐三明治' })).toBeVisible()
})

test('logout clears the grant and a late identity response cannot restore it', async ({ page }) => {
  const mock = await installDrive(page)
  await connect(page)
  await createAccount(page)
  let release!: () => void
  mock.identityWait = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.goto('/#/settings')
  await page.reload()
  await expect(page.getByText('正在恢復 Google Drive', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '登出', exact: true }).click()
  release()
  await expect(page.getByText('尚未連接', { exact: true })).toBeVisible()
  expect(await page.evaluate((key) => sessionStorage.getItem(key), AUTH_SESSION_KEY)).toBeNull()
  mock.requests.length = 0
  await page.goto('/')
  await expect(page.getByRole('button', { name: '連接 Google Drive', exact: true })).toBeEnabled()
  await expect(page.locator('.balance-number')).not.toBeVisible()
  expect(mock.requests).toEqual([])
  expect(mock.oauthCalls).toBe(1)
})

test('cancelled account switch removes the previous credential before opening OAuth', async ({
  page,
}) => {
  const mock = await installDrive(page)
  await connect(page)
  await page.getByRole('link', { name: '設定', exact: true }).click()
  mock.cancelOAuth = true
  await page.getByRole('button', { name: '切換帳號', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Google 授權視窗已關閉')
  expect(await page.evaluate((key) => sessionStorage.getItem(key), AUTH_SESSION_KEY)).toBeNull()
  mock.requests.length = 0
  await page.goto('/')
  await expect(page.getByText('尚未連接', { exact: true })).toBeVisible()
  expect(mock.requests).toEqual([])
  expect(mock.oauthCalls).toBe(2)
})

test('blocked session storage falls back to memory with an explicit reload notice', async ({
  page,
}) => {
  await installDrive(page)
  await page.addInitScript(() => {
    Object.defineProperty(window, 'sessionStorage', {
      get: () => {
        throw new DOMException('Blocked', 'SecurityError')
      },
    })
  })
  await connect(page)
  await expect(page.getByRole('status')).toContainText('瀏覽器無法保存分頁授權')
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('test-memory-token')
  await page.reload()
  await expect(page.getByText('尚未連接', { exact: true })).toBeVisible()
})

test('a revoked live session clears its stored token and prevents further cloud writes', async ({
  page,
}) => {
  const mock = await installDrive(page)
  await connect(page)
  await createAccount(page)
  await openExpense(page)
  await page.getByRole('button', { name: '保留草稿', exact: true }).click()
  mock.apiStatus = 401
  await page.getByRole('button', { name: '重新同步', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('授權已到期或失效')
  expect(await page.evaluate((key) => sessionStorage.getItem(key), AUTH_SESSION_KEY)).toBeNull()
  await expect(page.getByRole('button', { name: '重新同步', exact: true })).toBeDisabled()
  await page.getByRole('link', { name: /^草稿/ }).first().click()
  await page.getByRole('button', { name: '繼續編輯', exact: true }).click()
  await expect(page.getByLabel('第 1 行金額', { exact: true })).toHaveValue('60')
  await expect(page.getByRole('button', { name: '確認入帳', exact: true })).toBeDisabled()
})

test('an OAuth response without a usable lifetime is rejected instead of inventing an expiry', async ({
  page,
}) => {
  const mock = await installDrive(page)
  mock.expiresIn = 0
  await page.goto('/')
  await page.getByRole('button', { name: '連接 Google Drive', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Google 授權未完成')
  expect(await page.evaluate((key) => sessionStorage.getItem(key), AUTH_SESSION_KEY)).toBeNull()
  expect(mock.requests).toEqual([])
})

async function makeRenewalDue(page: Page) {
  const expiresAt = await page.evaluate(
    (key) => JSON.parse(sessionStorage.getItem(key)!).expiresAt,
    AUTH_SESSION_KEY,
  )
  await page.clock.setFixedTime(expiresAt - 4 * 60_000)
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  return expiresAt as number
}

test('one-click renewal extends only the Google-issued expiry and keeps a mobile transaction editor intact', async ({
  page,
}) => {
  const mock = await installDrive(page)
  await page.emulateMedia({ colorScheme: 'dark' })
  await connect(page)
  await createAccount(page)
  await page.setViewportSize({ width: 360, height: 800 })
  await openExpense(page)
  const oldExpiry = await makeRenewalDue(page)
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Google 授權即將到期', { exact: true })).toBeVisible()
  expect(mock.oauthCalls).toBe(1) // Foreground and timer events never open OAuth.
  await assertReadableSurface(page)
  await page.screenshot({ path: 'test-results/renew-dark-mobile-editor.png', fullPage: true })
  await expect(dialog.getByRole('button', { name: '續接 Google Drive', exact: true })).toBeEnabled()
  mock.token = 'renewed-test-token'
  mock.requests.length = 0
  mock.authorizations.length = 0
  await dialog.getByRole('button', { name: '續接 Google Drive', exact: true }).click()
  await expect(page.getByText('已連接 Google Drive', { exact: true })).toBeVisible()
  await expect(dialog).toBeVisible()
  await expect(page.getByLabel('第 1 行名稱', { exact: true })).toHaveValue('早餐三明治')
  await expect(page.getByLabel('第 1 行金額', { exact: true })).toHaveValue('60')
  expect(mock.oauthRequests).toEqual([
    { prompt: 'select_account' },
    { prompt: '', login_hint: 'alice@example.test' },
  ])
  const renewed = await page.evaluate(
    (key) => JSON.parse(sessionStorage.getItem(key)!),
    AUTH_SESSION_KEY,
  )
  expect(renewed.expiresAt).toBe(oldExpiry - 4 * 60_000 + 3600_000)
  expect(renewed.token).toBe('renewed-test-token')
  expect(mock.requests[0]).toBe('/drive/v3/about')
  expect(mock.authorizations.every((h) => h === 'Bearer renewed-test-token')).toBe(true)
  await page.getByRole('button', { name: '確認入帳', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(
    [...mock.files.values()].filter((f) => f.appProperties?.role === 'operation'),
  ).toHaveLength(2)
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    'renewed-test-token',
  )
  expect(JSON.stringify([...mock.files.values()])).not.toContain('renewed-test-token')
})

test('same-account renewal keeps unsaved account settings and cancellation keeps an unexpired grant', async ({
  page,
}) => {
  const mock = await installDrive(page)
  await connect(page)
  await createAccount(page)
  await page.getByRole('button', { name: '編輯日常現金', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).not.toHaveClass(/p-dialog-enter-(active|from|to)/)
  await page.getByLabel('帳戶名稱', { exact: true }).fill('尚未保存的名稱')
  const oldExpiry = await makeRenewalDue(page)
  mock.cancelOAuth = true
  await dialog.getByRole('button', { name: '續接 Google Drive', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Google 授權視窗已關閉')
  await expect(page.getByLabel('帳戶名稱', { exact: true })).toHaveValue('尚未保存的名稱')
  expect(
    await page.evaluate(
      (key) => JSON.parse(sessionStorage.getItem(key)!).expiresAt,
      AUTH_SESSION_KEY,
    ),
  ).toBe(oldExpiry)
  await expect(page.getByRole('button', { name: '保存帳戶', exact: true })).toBeEnabled()
  mock.cancelOAuth = false
  mock.identityStatus = 401
  await dialog.getByRole('button', { name: '續接 Google Drive', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Google 授權已到期')
  expect(
    await page.evaluate(
      (key) => JSON.parse(sessionStorage.getItem(key)!).expiresAt,
      AUTH_SESSION_KEY,
    ),
  ).toBe(oldExpiry)
  await expect(page.getByRole('button', { name: '保存帳戶', exact: true })).toBeEnabled()
  mock.identityStatus = 200
  await dialog.getByRole('button', { name: '續接 Google Drive', exact: true }).click()
  await expect(dialog.locator('.authorization-notice')).not.toBeVisible()
  await expect(page.getByLabel('帳戶名稱', { exact: true })).toHaveValue('尚未保存的名稱')
  await page.getByRole('button', { name: '保存帳戶', exact: true }).click()
  await expect(page.getByRole('heading', { name: '尚未保存的名稱', exact: true })).toBeVisible()
})

test('renewal rejects a different Google owner before replacing the active token or reading their book', async ({
  page,
}) => {
  const mock = await installDrive(page)
  await connect(page)
  await createAccount(page)
  await openExpense(page)
  const oldExpiry = await makeRenewalDue(page)
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: '續接 Google Drive', exact: true })).toBeEnabled()
  mock.ownerId = 'bob-user'
  mock.token = 'wrong-owner-test-token'
  mock.requests.length = 0
  await dialog.getByRole('button', { name: '續接 Google Drive', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Google 回傳不同帳號')
  expect(mock.requests).toEqual(['/drive/v3/about'])
  const saved = await page.evaluate(
    (key) => JSON.parse(sessionStorage.getItem(key)!),
    AUTH_SESSION_KEY,
  )
  expect(saved.expiresAt).toBe(oldExpiry)
  expect(saved.token).toBe('test-memory-token')
  expect(saved.ownerId).toBe('alice-user')
  await expect(page.getByLabel('第 1 行名稱', { exact: true })).toHaveValue('早餐三明治')
  expect(JSON.stringify([...mock.files.values()])).not.toContain('bob-user')
})

test('expired reload retains only a same-account hint, then a click reconnects and switching removes that hint', async ({
  page,
}) => {
  const mock = await installDrive(page)
  await connect(page)
  await createAccount(page)
  await page.evaluate((key) => {
    const value = JSON.parse(sessionStorage.getItem(key)!)
    value.expiresAt = Date.now() - 1
    sessionStorage.setItem(key, JSON.stringify(value))
  }, AUTH_SESSION_KEY)
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('授權已到期')
  expect(await page.evaluate((key) => sessionStorage.getItem(key), AUTH_SESSION_KEY)).toBeNull()
  const hint = await page.evaluate(
    (key) => JSON.parse(sessionStorage.getItem(key)!),
    AUTH_ACCOUNT_KEY,
  )
  expect(hint).toEqual({
    version: 1,
    clientId: 'test.apps.googleusercontent.com',
    ownerId: 'alice-user',
    email: 'alice@example.test',
  })
  await expect(page.locator('.balance-number')).not.toBeVisible()
  expect(mock.oauthCalls).toBe(1)
  await page.getByRole('link', { name: '設定', exact: true }).click()
  await expect(page.getByRole('button', { name: '登出', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '連接 Google Drive', exact: true }).click()
  await expect(page.getByText('已連接 Google Drive', { exact: true })).toBeVisible()
  expect(mock.oauthRequests.at(-1)).toEqual({ prompt: '', login_hint: 'alice@example.test' })
  await page.getByRole('link', { name: '設定', exact: true }).click()
  mock.cancelOAuth = true
  await page.getByRole('button', { name: '切換帳號', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('授權視窗已關閉')
  expect(mock.oauthRequests.at(-1)).toEqual({ prompt: 'select_account' })
  expect(await page.evaluate((key) => sessionStorage.getItem(key), AUTH_ACCOUNT_KEY)).toBeNull()
  expect(await page.evaluate((key) => sessionStorage.getItem(key), AUTH_SESSION_KEY)).toBeNull()
})

test('a late renewal after logout cannot save a new credential or hint', async ({ page }) => {
  const mock = await installDrive(page)
  await connect(page)
  await page.getByRole('link', { name: '設定', exact: true }).click()
  let release!: () => void
  mock.oauthWait = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.getByRole('button', { name: '續接目前帳號', exact: true }).click()
  await expect(page.getByText('正在續接 Google Drive', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '登出', exact: true }).click()
  release()
  await expect(page.getByText('尚未連接', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('尚未連接', { exact: true })).toBeVisible()
  expect(await page.evaluate((key) => sessionStorage.getItem(key), AUTH_ACCOUNT_KEY)).toBeNull()
  expect(await page.evaluate((key) => sessionStorage.getItem(key), AUTH_SESSION_KEY)).toBeNull()
})

test('renewal does not automatically post an unresolved pending operation', async ({ page }) => {
  const mock = await installDrive(page)
  await connect(page)
  await createAccount(page)
  await openExpense(page)
  mock.failOperations = true
  await page.getByRole('button', { name: '確認入帳', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible()
  await page.getByRole('button', { name: '保留草稿', exact: true }).click()
  const pendingBefore = await page.evaluate(() =>
    Object.entries(localStorage)
      .filter(([key]) => key.includes(':pending:'))
      .sort(),
  )
  expect(pendingBefore.length).toBeGreaterThan(0)
  mock.failOperations = false
  await page.getByRole('link', { name: '設定', exact: true }).click()
  await page.getByRole('button', { name: '續接目前帳號', exact: true }).click()
  await expect(
    page.getByText('Google Drive 授權已續接，編輯內容已保留', { exact: true }),
  ).toBeVisible()
  expect(
    await page.evaluate(() =>
      Object.entries(localStorage)
        .filter(([key]) => key.includes(':pending:'))
        .sort(),
    ),
  ).toEqual(pendingBefore)
  expect(
    [...mock.files.values()].filter((f) => f.appProperties?.role === 'operation'),
  ).toHaveLength(1)
  await page.getByRole('link', { name: /^草稿/ }).first().click()
  await expect(page.getByRole('heading', { name: '等待確認的提交' })).toBeVisible()
})
