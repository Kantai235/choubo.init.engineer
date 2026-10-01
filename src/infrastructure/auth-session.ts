import { z } from 'zod'

export const AUTH_SESSION_KEY = 'choubo:auth-session:v1'
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
    try {
      this.storage().removeItem(AUTH_SESSION_KEY)
      return true
    } catch {
      // Some storage implementations allow overwriting when removal fails.
      try {
        this.storage().setItem(AUTH_SESSION_KEY, '')
        return true
      } catch {
        return false
      }
    }
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
