import { test, expect, type Page } from '@playwright/test'

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
  const control = { failOperations: false, ownerId: 'alice-user', rootMetadataReads: 0, files }
  await page.addInitScript(() => {
    localStorage.setItem('choubo:google-client-id', 'test.apps.googleusercontent.com')
    Object.assign(window, {
      google: {
        accounts: {
          oauth2: {
            initTokenClient: (config: { callback: (data: unknown) => void }) => ({
              requestAccessToken: () =>
                config.callback({
                  access_token: 'test-memory-token',
                  scope: 'https://www.googleapis.com/auth/drive.file',
                  expires_in: 3600,
                }),
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
    if (url.pathname.endsWith('/about'))
      return respond({
        user: {
          permissionId: control.ownerId,
          displayName: '小林',
          emailAddress: 'alice@example.test',
        },
      })
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
async function createAccount(page: Page, name = '日常現金', balance = '1000') {
  await page.getByRole('link', { name: '我的帳戶', exact: true }).click()
  await page.getByRole('button', { name: '新增帳戶', exact: true }).click()
  await page.getByLabel('帳戶名稱', { exact: true }).fill(name)
  await page.getByLabel('期初餘額', { exact: false }).fill(balance)
  await page.getByRole('button', { name: '保存帳戶', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
}
async function openExpense(page: Page) {
  await page.getByRole('link', { name: '收支紀錄', exact: true }).click()
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
  await connect(page)
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
  await page.getByRole('button', { name: '連接 Google Drive', exact: true }).click()
  await expect(page.getByText(/無法存取這份 Drive 資料/)).toBeVisible()
  expect([...mock.files.keys()]).toEqual(originalIds)
})

test('moving an established app folder still stops reconnection', async ({ page }) => {
  const mock = await installDrive(page)
  await connect(page)
  const root = [...mock.files.values()].find((f) => f.appProperties?.role === 'root')!
  root.parents = ['another-folder']
  await page.reload()
  await page.getByRole('button', { name: '連接 Google Drive', exact: true }).click()
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
  await connect(page)
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
  await connect(page)
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
  await page.getByRole('button', { name: '重新連接／切換帳號', exact: true }).click()
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
  await expect(page.getByText(payload, { exact: true })).not.toBeVisible()
})
