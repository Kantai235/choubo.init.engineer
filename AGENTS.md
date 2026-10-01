# Choubo 開發指引

## 專案依據

- 使用繁體中文溝通；先讀 `docs/README.md`，再依任務查閱需求、架構與實作進度。
- 產品規則以 `docs/requirements/system-analysis-and-requirements.md` 的現行版本為準。保留 FR／AT 編號；需求定義、已實作功能與驗收通過狀態須分開記錄。
- 工程修改沿用 Vue 3、TypeScript、Vite、Pinia、Vue Router、SCSS、PrimeVue 4、pnpm 與現有 lockfile。PrimeVue／主題版本須遵守 `docs/development/setup.md` 的授權與相容性限制。

## 插件與工具選擇

- 網頁實作與除錯可用 Build Web Apps；只有與本任務相關的技能才載入。其 React、shadcn、Stripe 或 Supabase 範例不構成本專案遷移框架、加入後台或接入金流的理由。
- 本機介面驗證使用 Browser 或現有 Playwright 測試。使用者指定 Chrome，或任務需要既有 Chrome 登入狀態時，依 Chrome 技能及可用連線操作。
- 圖表、收支報表與視覺化任務才使用 Build Web Data Visualization；沿用 Vue 元件與目前資料模型。
- GitHub 任務先確認本目錄的 Git／remote 狀態。使用已連線的 GitHub 插件；未連線時可使用已登入的 `gh`。不要因插件設定而自行建立遠端倉庫或推送。
- 只有任務涉及 Cloudflare 部署或資源時才載入 Cloudflare／Wrangler 技能。iOS、Android、Sites 等工具依實際任務使用，不因全域安裝便改變本專案的技術架構或部署平台。
- Codex 的 Google Drive 插件用於使用者要求的文件操作；網站本身的 GIS／Drive API 授權是獨立設定，不可用插件連線取代網站 OAuth 驗收。
- 優先使用既有、適用的設計技能，不同時疊加多套互相衝突的視覺設計流程。

## 程式結構與帳務邊界

- `src/domain/`：schema、金額、種子資料、帳務規則；`src/application/`：提交與草稿生命週期，不依賴 Vue。
- `src/infrastructure/`：GIS、Drive、localStorage；`src/stores/`：Pinia；`src/features/` 與 `src/components/`：畫面與元件。
- 金額使用十進位字串與 Decimal.js。Drive 確認保存及一致性驗證後才顯示正式入帳成功。
- 依 2026-10-02 使用者確認，短期 access token 僅存記憶體與 sessionStorage；恢復先向 Google 驗證相同帳號，保留原到期時間，登出／切帳號／到期／401 清除。續接只能由明確點擊觸發；沿用已驗證帳號 email 作 login_hint，取得新 token 後核對 ownerId 才更新。保留編輯器及草稿；切換帳號另開明確入口。sessionStorage 可保留不含憑證的帳號提示，登出／切帳號一併清除。禁止寫入 localStorage、Drive、匯出、日誌或 Git。localStorage 用於快取、偏好、草稿與待確認提交。不得將草稿或 pending 當作可重建快取刪除。
- 保留操作識別、帳號隔離與衝突檢查。模擬 API 測試通過不等於真實 OAuth／Drive 或跨裝置驗收通過。

## 驗證與交付

- 按變更範圍執行 `pnpm lint`、`pnpm typecheck`、`pnpm test`；影響瀏覽器流程時執行 `pnpm test:e2e`，影響打包時執行 `pnpm build`。
- 需要 Chrome 作為 Playwright 執行檔時，依 `docs/development/setup.md` 設定 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`；使用獨立測試環境及模擬 Drive 回應。
- 介面變更檢查桌面與 360 px 手機寬度。依變更更新 `docs/development/progress.md`，清楚列出未驗證項目。
- 文件與工具設定修改以內容、連結及設定解析驗證為主，不必為此重跑全部應用程式測試。
