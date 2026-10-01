# Google 分頁授權恢復

日期：2026-10-02。決策來源：使用者明確要求短期 token 暫存 sessionStorage，取代原本只放記憶體的政策。現行對應需求 v0.6 第 15～16 章及 AT36／AT42／AT60。維持純前端與 `drive.file`，沒有新增後台、refresh token 或額外 Google 權限。

## 保存期限與使用體驗

sessionStorage 沒有固定幾小時或幾天的 TTL；在同一分頁的 page session 內可跨重新整理，關閉分頁通常清除，瀏覽器恢復分頁可能恢復資料。因此既不能保證永久保存，也不能依賴關閉分頁作為立即銷毀憑證的保證。由 opener 開啟的分頁可能先複製其 sessionStorage，之後仍獨立；網站外連使用 noopener。[MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage)

Google access token 另有到期時間，以授權回傳的 `expires_in` 換算絕對 `expiresAt`。重整、讀取暫存及同步皆不得重設期限。Google 提前撤銷 token 時，即使本機尚未到期，也會依 401 停止使用。保存一個過期字串無法延長雲端授權。[Google Token 模式](https://developers.google.com/identity/oauth2/web/guides/use-token-model)、[TokenResponse](https://developers.google.com/identity/oauth2/web/reference/js-reference#TokenResponse)

使用者升級到這一版後須先連接一次，才會寫入暫存；之後同一分頁在 token 有效期間可直接重整。到期前五分鐘會出現「續接 Google Drive」；也可在設定頁按「續接目前帳號」。到期或暫存不存在時按「連接 Google Drive」重新授權，不在背景反覆彈出視窗。Google 帳號仍登入時可能不必再輸入密碼，但由 Google 決定，不能承諾無限期免登入。

若日後要求跨日自動續期，需要另行評估帶安全後端的 authorization-code／refresh-token 架構、憑證保存及撤銷機制；refresh token 本身也可能失效。這不屬於本次純前端改動。[Google Code 模式](https://developers.google.com/identity/oauth2/web/guides/use-code-model)

## 實作與隔離

- `src/infrastructure/auth-session.ts`：唯一授權暫存介面；key 為 `choubo:auth-session:v1`，內容僅 version、clientId、ownerId、短期 token、原 expiresAt。嚴格 schema 拒絕不支援欄位；解析錯誤不將原始內容放進訊息。
- `src/infrastructure/auth.ts`：GIS 回傳需有 drive.file scope、非空 token 及正整數 expires_in；不猜測缺失的期限。首次連接與明確切換使用 select_account；續接使用空 prompt 與已驗證 email 的 login_hint，盡量省略重選帳號。GIS 已預載時保持 requestAccessToken 在點擊的同步呼叫堆疊內。
- `src/stores/book.ts`：授權不放入 Pinia 可序列化狀態，與帳務 repository、匯出、Drive 同步分離。所有後續動作受連線 epoch 與 AbortController 保護。
- `src/App.vue`：啟動時嘗試恢復；設定與引導顯示恢復中、錯誤及重新連接狀態。

恢復次序：檢查 sessionStorage 格式／Client ID／期限 → Drive `about.user` → 比對穩定 ownerId → 寫回原期限授權 → 讀該使用者帳務快取 → 核對 Drive 資料夾與帳本 → 同步 → 顯示已連接。向 Google 驗證前不顯示上次帳戶、餘額或草稿。中途不得以本機 email、檔案 ID 或 token 存在代替身分驗證。

| 情況 | 授權處理 | 帳務處理 |
| --- | --- | --- |
| 同分頁有效重整 | 不叫起 OAuth；向 Google 核對身分及原 ownerId | 驗證後才顯示快取、同步帳本；不重複建帳 |
| 格式損壞／Client ID 更換／期限已到 | 移除暫存，不送出該 token | 提示重連；保留原草稿／pending |
| Google 401／恢復帳號不符 | 移除暫存，停止正式提交 | 未驗證前不顯示帳務；已載入草稿仍可本機保存 |
| 身分驗證暫時失敗 | 保留尚未過期暫存；恢復網路／前景檢查重試 | 不先顯示快取；不自動正式入帳 |
| 登出／切換帳號 | 開新授權前先清除此分頁 token；取消選擇也不恢復舊 token | 清畫面、中止舊請求；本機受保護資料留原命名空間 |
| 遲到 Google 回應 | epoch 不符即丟棄，不能重新保存 token | 不回填另一帳號的畫面或帳本 |
| sessionStorage 被瀏覽器封鎖 | 當次連線退回記憶體，提示重整需重連 | 不影響當次 Drive 提交；不改存 localStorage |
| 清除暫存 API 失敗 | 嘗試覆寫失效值；仍失敗即提示關閉分頁及清除網站資料 | 不宣稱清除成功；目前連線仍停止 |

授權計時器與回前景／操作前檢查共同處理背景計時器延遲。正式同步及入帳仍以 Drive 確認為準；重連不會自動重送未知結果的 pending 操作。另有不含 token 的 `choubo:auth-account:v1`，只含 version／clientId／ownerId／email。這項分頁提示可以跨 token 到期保留，協助下一次點擊續接；登出、切換帳號及 OAuth Client ID 變更時清除。舊版沒有提示的有效 token 仍可恢復，驗證後補建提示。

登出為此分頁的應用連線登出，不是 Google 全站登出或全分頁撤權。

## v0.6：一次點擊延續目前帳號

網站不縮短 Google 核發的有效時間，也不偽造 expiresAt。接近到期時只顯示提示；續接必須由使用者明確點擊觸發，不能依賴背景計時器呼叫 popup、隱藏 iframe、prompt none 或瀏覽器關閉後的執行。空 prompt 與 login_hint 是減少重複步驟的提示，Google 仍可要求登入或重新同意。

續接流程：阻止重複 OAuth 與並行正式提交 → 點擊中同步呼叫 GIS（已預載時）→ 新 token 呼叫 about.user → 核對原 ownerId → 替換同一 DriveClient 的 token／到期時間 → 保存新的 sessionStorage 授權與帳號提示 → 同步原 LedgerSession。保留身份 ID、編輯器與欄位，不自動入帳；只採用新回應的期限，不在舊期限加時。

續接取消、被擋或新 token 驗證失敗：未到期原授權不提前刪除；仍依原期限及實際 API 401 判斷能否使用。候選帳號不同時拒絕採用新 token，不讀取其帳本，提示使用明確「切換帳號」入口。登出／切帳號後到達的續接回應不能保存憑證或帳號提示。

設定頁顯示實際到期時間；一般頁面與帳戶／交易編輯器皆提供續接提示。編輯器內更新提示與錯誤可見，不必先關閉表單。手機 360px 與系統亮／暗色沿用既有語意色彩；授權續接期間會暫停提交控制。

## 安全與驗證

sessionStorage 可由同來源 JavaScript 存取，不能抵抗同來源 XSS 或惡意擴充功能；瀏覽器是否把分頁資訊落盤屬其實作細節，不能宣稱這是加密或純記憶體儲存。維持 CSP、Vue 文字插值、最小權限及輸入驗證。短期 token 不得進入 localStorage、Drive、偏好同步、帳務匯出、URL、日誌、Git 或 GitHub；測試只使用明確的假憑證。

單元測試覆蓋 schema、期限、Client ID、儲存不可用與清除失敗。Chrome 模擬 GIS／Drive 端到端測試覆蓋有效重整、驗證前不顯示快取、原期限不延長、到期、401、帳號不符、草稿及 pending 保護、網路恢復、開站後到期、登出遲到回應、取消切換及 storage 降級；另解析 localStorage、模擬 Drive 檔案及實際下載 JSON 檢查不含 token／授權暫存結構。v0.6 另測同步點擊呼叫、模擬 Google 回傳 7200 秒期限無自訂截短、同帳號續接保留兩種編輯器、取消與候選 401 保留未到期原授權、錯帳號拒絕、到期後提示重連、延遲回應及 pending 不自動入帳。既有亮／暗桌面與 360px 流程持續回歸。

這些自動測試不等同真實 Google 到期／撤權、瀏覽器關閉還原或所有裝置驗收。真實 Google 恢復連線仍須於部署後使用者實際授權測試；不能由模擬結果宣稱通過。
