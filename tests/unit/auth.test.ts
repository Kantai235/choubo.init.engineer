import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestToken } from '../../src/infrastructure/auth'

function googleFixture(response: Record<string, unknown> = {}) {
  const requests: unknown[] = []
  vi.stubGlobal('window', {
    google: {
      accounts: {
        oauth2: {
          initTokenClient: (config: { callback: (value: unknown) => void }) => ({
            requestAccessToken: (options: unknown) => {
              requests.push(options)
              config.callback({
                access_token: 'unit-test-credential',
                expires_in: 7200,
                scope: 'https://www.googleapis.com/auth/drive.file',
                ...response,
              })
            },
          }),
        },
      },
    },
  })
  return requests
}
afterEach(() => vi.unstubAllGlobals())

describe('user-initiated Google authorization', () => {
  it('requests a new token synchronously within the click and uses the full Google-issued lifetime', async () => {
    const requests = googleFixture()
    const start = Date.now()
    const result = requestToken('test.apps.googleusercontent.com', {
      loginHint: 'alice@example.test',
    })
    expect(requests).toEqual([{ prompt: '', login_hint: 'alice@example.test' }])
    const grant = await result
    expect(grant.expiresAt).toBeGreaterThanOrEqual(start + 7200_000)
    expect(grant.expiresAt).toBeLessThanOrEqual(Date.now() + 7200_000)
  })
  it('switching accounts requests a chooser without a previous account hint', async () => {
    const requests = googleFixture()
    await requestToken('test.apps.googleusercontent.com', {
      selectAccount: true,
      loginHint: 'alice@example.test',
    })
    expect(requests).toEqual([{ prompt: 'select_account' }])
  })
  it.each([undefined, 0, -1, 1.5, Infinity, NaN])(
    'rejects an unusable lifetime rather than extending it locally',
    async (expires_in) => {
      googleFixture({ expires_in })
      await expect(requestToken('test.apps.googleusercontent.com')).rejects.toThrow(
        'Google 授權未完成',
      )
    },
  )
  it('rejects missing Drive scope and does not surface provider diagnostic content', async () => {
    googleFixture({ scope: 'email', error_description: 'private diagnostic' })
    await expect(requestToken('test.apps.googleusercontent.com')).rejects.toThrow(
      'Google 授權未完成，請重新連接',
    )
  })
})
