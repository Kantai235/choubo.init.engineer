import { describe, expect, it } from 'vitest'
import { AuthSessionStorage, AUTH_SESSION_KEY } from '../../src/infrastructure/auth-session'

const clientId = 'test.apps.googleusercontent.com'
const valid = () => ({
  version: 1 as const,
  clientId,
  ownerId: 'alice',
  token: 'fake-test-credential',
  expiresAt: Date.now() + 60_000,
})
function fixture() {
  const values = new Map<string, string>()
  const port = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
  return { values, port, storage: new AuthSessionStorage(() => port) }
}

describe('tab authorization storage', () => {
  it('restores the original expiry and clears only authorization', () => {
    const { values, storage } = fixture()
    values.set('unrelated-draft', 'keep')
    const auth = valid()
    expect(storage.save(auth)).toBe(true)
    expect(storage.read(clientId)).toEqual({ state: 'valid', value: auth })
    expect(storage.read(clientId, auth.expiresAt)).toEqual({ state: 'expired' })
    expect(values.has(AUTH_SESSION_KEY)).toBe(false)
    expect(values.get('unrelated-draft')).toBe('keep')
  })
  it.each([
    '{broken',
    'null',
    '[]',
    JSON.stringify({ ...valid(), token: '' }),
    JSON.stringify({ ...valid(), version: 2 }),
    JSON.stringify({ ...valid(), expiresAt: 'tomorrow' }),
    JSON.stringify({ ...valid(), refreshToken: 'not-allowed' }),
  ])('rejects malformed credentials without exposing their contents', (raw) => {
    const { values, storage } = fixture()
    values.set(AUTH_SESSION_KEY, raw)
    expect(storage.read(clientId)).toEqual({ state: 'invalid' })
    expect(values.has(AUTH_SESSION_KEY)).toBe(false)
  })
  it('rejects a credential saved for another OAuth client', () => {
    const { storage, values } = fixture()
    storage.save(valid())
    expect(storage.read('other.apps.googleusercontent.com')).toEqual({ state: 'invalid' })
    expect(values.has(AUTH_SESSION_KEY)).toBe(false)
  })
  it('fails safely when the sessionStorage getter is blocked', () => {
    const storage = new AuthSessionStorage(() => {
      throw new Error('blocked')
    })
    expect(storage.read(clientId)).toEqual({ state: 'unavailable' })
    expect(storage.save(valid())).toBe(false)
    expect(storage.clear()).toBe(false)
  })
  it('removes an old credential if a new write fails', () => {
    const { values, port } = fixture()
    values.set(AUTH_SESSION_KEY, JSON.stringify(valid()))
    const storage = new AuthSessionStorage(() => ({
      ...port,
      setItem: () => {
        throw new Error('quota')
      },
    }))
    expect(storage.save(valid())).toBe(false)
    expect(values.has(AUTH_SESSION_KEY)).toBe(false)
  })
  it('invalidates by overwriting if removal fails', () => {
    const { values, port } = fixture()
    values.set(AUTH_SESSION_KEY, JSON.stringify(valid()))
    const storage = new AuthSessionStorage(() => ({
      ...port,
      removeItem: () => {
        throw new Error('blocked removal')
      },
    }))
    expect(storage.clear()).toBe(true)
    expect(storage.read(clientId)).toEqual({ state: 'empty' })
  })
  it('never saves an already expired grant', () => {
    const { values, storage } = fixture()
    expect(storage.save({ ...valid(), expiresAt: Date.now() })).toBe(false)
    expect(values.has(AUTH_SESSION_KEY)).toBe(false)
  })
})

const hint = { version: 1 as const, clientId, ownerId: 'alice', email: 'alice@example.test' }
describe('same-account reconnection hints', () => {
  it('retains only non-credential account data after token expiry and clears it on logout', () => {
    const { storage } = fixture()
    const auth = valid()
    expect(storage.save(auth)).toBe(true)
    expect(storage.saveAccount(hint)).toBe(true)
    expect(storage.read(clientId, auth.expiresAt)).toEqual({ state: 'expired' })
    expect(storage.readAccount(clientId)).toEqual(hint)
    storage.clearAccount()
    expect(storage.readAccount(clientId)).toBeUndefined()
  })
  it('does not accept a token hidden in the hint or a hint from another OAuth client', () => {
    const { storage } = fixture()
    expect(storage.saveAccount({ ...hint, token: 'unit-test-credential' } as typeof hint)).toBe(
      false,
    )
    expect(storage.readAccount(clientId)).toBeUndefined()
    storage.saveAccount(hint)
    expect(storage.readAccount('different.apps.googleusercontent.com')).toBeUndefined()
    expect(storage.readAccount(clientId)).toBeUndefined()
  })
  it('allows old grants without hints and handles blocked hint storage without leaking errors', () => {
    const { storage } = fixture()
    expect(storage.save(valid())).toBe(true)
    expect(storage.readAccount(clientId)).toBeUndefined()
    const blocked = new AuthSessionStorage(() => {
      throw new Error('blocked')
    })
    expect(blocked.saveAccount(hint)).toBe(false)
    expect(blocked.readAccount(clientId)).toBeUndefined()
  })
})
