import { z } from 'zod'

export const AUTH_SESSION_KEY = 'choubo:auth-session:v1'
export const AUTH_ACCOUNT_KEY = 'choubo:auth-account:v1'
const accountSchema = z
  .object({
    version: z.literal(1),
    clientId: z.string().min(1),
    ownerId: z.string().min(1),
    email: z.string().max(320),
  })
  .strict()
export type AuthAccountHint = z.infer<typeof accountSchema>
const schema = z
  .object({
    version: z.literal(1),
    clientId: z.string().min(1),
    ownerId: z.string().min(1),
    token: z.string().min(1).max(16_384),
    expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict()
export type AuthSession = z.infer<typeof schema>
type StorageAccess = () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type ReadResult =
  | { state: 'valid'; value: AuthSession }
  | { state: 'empty' | 'expired' | 'invalid' | 'unavailable' }

// Separate from ledger repositories, Pinia state, exports and cloud synchronization.
// A saved owner is only a hint: Google must verify it before exposing local data.
export class AuthSessionStorage {
  constructor(private readonly storage: StorageAccess = () => window.sessionStorage) {}

  clear(): boolean {
    return this.remove(AUTH_SESSION_KEY)
  }

  clearAccount(): boolean {
    return this.remove(AUTH_ACCOUNT_KEY)
  }

  private remove(key: string): boolean {
    try {
      this.storage().removeItem(key)
      return true
    } catch {
      // Some storage implementations allow overwriting when removal fails.
      try {
        this.storage().setItem(key, '')
        return true
      } catch {
        return false
      }
    }
  }

  // This non-credential hint survives token expiry only within this tab.
  // Never use it as proof of identity or include it in portable preferences.
  readAccount(clientId: string): AuthAccountHint | undefined {
    try {
      const raw = this.storage().getItem(AUTH_ACCOUNT_KEY)
      if (!raw) return undefined
      const parsed = accountSchema.safeParse(JSON.parse(raw))
      if (parsed.success && parsed.data.clientId === clientId) return parsed.data
    } catch {
      /* Blocked or malformed storage is not an identity. */
    }
    this.clearAccount()
    return undefined
  }

  saveAccount(value: AuthAccountHint): boolean {
    const parsed = accountSchema.safeParse(value)
    if (parsed.success) {
      try {
        this.storage().setItem(AUTH_ACCOUNT_KEY, JSON.stringify(parsed.data))
        return true
      } catch {
        /* Token storage can still succeed independently. */
      }
    }
    this.clearAccount()
    return false
  }

  read(clientId: string, now = Date.now()): ReadResult {
    let raw: string | null
    try {
      raw = this.storage().getItem(AUTH_SESSION_KEY)
    } catch {
      return { state: 'unavailable' }
    }
    if (!raw) return { state: 'empty' }
    try {
      const parsed = schema.safeParse(JSON.parse(raw))
      if (!parsed.success || parsed.data.clientId !== clientId) {
        this.clear()
        return { state: 'invalid' }
      }
      if (parsed.data.expiresAt <= now) {
        this.clear()
        return { state: 'expired' }
      }
      return { state: 'valid', value: parsed.data }
    } catch {
      // Never surface JSON/Zod diagnostics that could contain credentials.
      this.clear()
      return { state: 'invalid' }
    }
  }

  save(value: AuthSession): boolean {
    const parsed = schema.safeParse(value)
    if (!parsed.success || parsed.data.expiresAt <= Date.now()) {
      this.clear()
      return false
    }
    try {
      this.storage().setItem(AUTH_SESSION_KEY, JSON.stringify(parsed.data))
      return true
    } catch {
      this.clear()
      return false
    }
  }
}
