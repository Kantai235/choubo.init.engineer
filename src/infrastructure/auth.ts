type TokenResult = {
  access_token?: string
  scope?: string
  expires_in?: number
  error?: string
  error_description?: string
}
type GoogleApi = {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string
        scope: string
        callback: (value: TokenResult) => void
        error_callback: (error: { type: string }) => void
      }): { requestAccessToken(options: { prompt: string }): void }
    }
  }
}
declare global {
  interface Window {
    google?: GoogleApi
  }
}
let loadPromise: Promise<void> | undefined
function loadGoogle() {
  if (window.google) return Promise.resolve()
  if (!loadPromise)
    loadPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.onload = () => resolve()
      script.onerror = () => {
        script.remove()
        loadPromise = undefined
        reject(new Error('無法載入 Google 登入，請檢查網路後再試'))
      }
      document.head.appendChild(script)
    })
  return loadPromise
}
export function configuredClientId() {
  return (
    import.meta.env.VITE_GOOGLE_CLIENT_ID ||
    (import.meta.env.DEV ? localStorage.getItem('choubo:google-client-id') : '') ||
    ''
  )
}
export const preloadGoogle = () => loadGoogle().catch(() => undefined)
// Only AuthSessionStorage may persist this short-lived credential, after identity verification.
export async function requestToken(
  clientId: string,
): Promise<{ token: string; expiresAt: number }> {
  if (!clientId.endsWith('.apps.googleusercontent.com'))
    throw new Error('請先設定 Google OAuth 網頁用戶端 ID')
  await loadGoogle()
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/drive.file',
      callback: (value) => {
        if (
          value.error ||
          !value.access_token ||
          !Number.isFinite(value.expires_in) ||
          !Number.isInteger(value.expires_in) ||
          value.expires_in! <= 0 ||
          !value.scope?.split(' ').includes('https://www.googleapis.com/auth/drive.file')
        ) {
          reject(new Error('Google 授權未完成，請重新連接'))
          return
        }
        resolve({
          token: value.access_token,
          expiresAt: Date.now() + value.expires_in! * 1000,
        })
      },
      error_callback: () => reject(new Error('Google 授權視窗已關閉或被瀏覽器阻擋，請重新連接')),
    })
    client.requestAccessToken({ prompt: 'select_account' })
  })
}
