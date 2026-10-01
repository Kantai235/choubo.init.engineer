# 開發與 Google Drive 設定

更新：2026-10-02。適用程式版本：0.1.0 基礎記帳開發版。

## 本機啟動

使用 Node.js 22.12 以上與 pnpm。此輪實際驗證環境為 macOS、Node.js 26.10.0、pnpm 12.8.1；其他 Node 版本尚未跑相同測試。

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

開啟 <http://127.0.0.1:5173/>。未設定 Client ID 也能查看連線引導與設定頁；正式帳務功能需要授權本人 Drive。沒有內建示範帳本，也不會在正式程式中切換到假雲端。

`.env.local` 可設定公開的網頁 OAuth Client ID：

```dotenv
VITE_GOOGLE_CLIENT_ID=你的用戶端ID.apps.googleusercontent.com
```

更改環境變數後重新啟動 Vite。開發時也可以在「設定 → 開發環境連線設定」貼上公開 Client ID，保存在此網站的 localStorage；環境變數設定優先。**Client Secret、access token、refresh token 均不可填入環境檔。**

## Google Cloud 設定

1. 使用網站開發者的 Google Cloud 專案，啟用 Google Drive API。
2. 設定 Google Auth Platform／OAuth 同意畫面的應用名稱與測試使用者；正式公開前完成 Google 要求的發布設定。
3. 建立類型為「網頁應用程式」的 OAuth 用戶端。
4. 將 `http://127.0.0.1:5173` 加入「已授權的 JavaScript 來源」。若也使用 localhost，另加 `http://localhost:5173`；兩者是不同來源。部署後另加實際 HTTPS 網站來源，不加路徑。
5. 將公開 Client ID 放進 `.env.local`，或開發環境設定頁。
6. 以測試使用者開站點「連接 Google Drive」，同意檔案存取後建立第一個帳戶。

本程式採 Google Identity Services 的瀏覽器 token model，直接以 REST 呼叫 Drive，沒有 OAuth code exchange 後台。短期 token 僅存記憶體及 sessionStorage。同分頁重新載入會自動向 Google 驗證相同帳號後恢復，再同步 Drive；到期前五分鐘提供「續接 Google Drive」，點擊後沿用同帳號取得新的 Google 期限並保留表單；設定頁可隨時續接或明確切換帳號。到期、失效或暫存不存在時仍需使用者點擊；Google 可能要求重新登入。原本已開啟的舊版頁面沒有 token 暫存，升級後需先連接一次。不承諾無限期靜默登入，詳見 [授權恢復與期限](google-session.md)。[Google token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)

目前只申請 `https://www.googleapis.com/auth/drive.file`，存取由應用建立或使用者授權的檔案。這不是讀取使用者整個 Drive 的權限；本版也不要求 Picker 選取既有私人檔案。[Drive scope 說明](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)

初次授權會在本人 My Drive 根目錄建立可見的 `Choubo 記帳資料` 資料夾。網站本身沒有共用帳本機制。辨識採檔案 ID、父目錄、appProperties、所有權與帳本內容；不以同名資料夾作為資料歸屬的唯一證明。

## 操作驗證

依序建立期初 1,000 TWD 現金帳戶 → 新增支出兩行 60 與 140 → 按確認入帳 → Drive 確認後總餘額為 800。重新載入並授權同帳號應仍為 800；在紀錄明細撤銷後回到 1,000，原紀錄仍可查詢。

可另外測試：保留草稿後關閉再開、離線禁止正式入帳、清除可重建快取不刪草稿、切換 Google 帳號後不顯示先前人的帳務、到 Drive 移動資料夾後提交應停止。正式站 Client ID 與 OAuth origin 已配置並進入真實 Google 授權確認頁；Drive 寫入實測狀態見進度文件。自動測試使用隔離的模擬回應，不會寫入任何人的 Drive。

## 工程命令

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
pnpm preview
```

- `pnpm test`：十進位計算、領域規則、草稿與提交生命週期、Drive REST 契約。
- `pnpm test:e2e`：真實瀏覽器執行 Vue 網站，攔截 GIS／Drive 網路回應；測試資料只存在測試程序。測試自啟獨立 `127.0.0.1:4175` 伺服器並以空 Client ID 環境變數覆寫 `.env.local`，不沿用開發伺服器。
- Playwright 瀏覽器安裝若因網路失敗，可指定已安裝的 Chromium／Chrome 執行檔，使用獨立測試設定檔。例如此輪 macOS 驗證方式：

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' pnpm test:e2e
```

- 帳戶表單測試在 PrimeVue 開啟動畫完成後才填值，並在提交前確認名稱／金額、保存後確認帳戶出現；避免 `onAfterEnter` 的自動聚焦與快速填表競爭。測試不使用自動重試掩蓋錯誤。
- 螢幕截圖及失敗 trace 位於 `test-results/`，已排除版本控制；不把測試中的範例金額當成真實帳務。
- 首次安裝、CI 使用 lockfile。`@parcel/watcher` 的非必要安裝腳本停用；SCSS 由 `sass-embedded` 處理。
- PrimeVue 固定在 MIT 授權的 4.5.5，主題固定 2.0.3。更新重大版本前檢查授權及整合，不能直接改成 latest。

## 靜態部署

`pnpm build` 輸出 `dist/`，由 GitHub Pages 提供。Vue Router 使用 hash 模式，例如 `/#/accounts`、`/#/transactions`、`/#/drafts`、`/#/settings`，直接開啟與重新整理均不需要伺服器路由回退。

正式站 OAuth JavaScript origin 為 `https://choubo.init.engineer`。公開 Client ID 放在版本庫 Actions variable `VITE_GOOGLE_CLIENT_ID`，由建置時注入；正式版本不接受 localStorage 覆寫。Google token 不是可公開的環境變數。

每次 push 到 `main` 由 `.github/workflows/deploy-pages.yml` 執行敏感檔案檢查、依賴稽核、lint、單元與瀏覽器測試、型別檢查及打包，再部署 `dist/`。PR 只驗證，不部署。Actions 固定 commit SHA，部署工作僅使用 Pages 與 OIDC 必要權限。詳見 [部署設定](deployment.md)。

production build 會加入 CSP 與 referrer meta，並停用 source maps；已驗證阻擋未授權的 inline script。GitHub Pages 無法由專案直接設定任意 HTTP 安全標頭，meta CSP 不能提供 `frame-ancestors` 防護。真實 GIS 彈窗、Safari／Firefox、完整容量與跨裝置驗收另見進度文件。

本版同步尚為全量掃描，沒有增量游標與壓縮快照；大帳本效能尚未達成需求報告的 10,000 筆驗收目標。詳見 [實作進度與限制](progress.md)。
