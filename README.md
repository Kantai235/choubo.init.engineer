# Choubo 個人帳簿

純前端網頁記帳程式，以使用者自己的 Google Drive 保存正式資料，localStorage 用於快取、草稿與待確認提交；access token 只放記憶體。

已建立 **0.1.0 基礎記帳開發版**：帳戶管理、多明細收入／支出／轉帳、草稿自動保存、Drive 確認後入帳、失敗重試、查詢及撤銷。這是 M0／M1 的部分實作；信用帳單、回饋、分期、自動儲值、應收應付及完整備份仍依需求文件後續開發。

## 啟動

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

開啟 <http://127.0.0.1:5173/>。在 `.env.local` 設定公開 `VITE_GOOGLE_CLIENT_ID`，或從網站設定頁配置開發用 Client ID。未設定時可查看連線引導。正式站已配置網站 Client ID；Google 應用目前為 Testing，只有列入的測試帳號可授權。一般使用者不必自己建立 Google Cloud 專案。

技術：Vue 3、TypeScript、Vite、Pinia、Vue Router、SCSS、PrimeVue 4、Zod、Decimal.js、Luxon。測試：Vitest、Playwright。

## 開發文件

- [啟動、OAuth 設定及測試命令](docs/development/setup.md)
- [實作進度、驗證與限制](docs/development/progress.md)
- [GitHub Pages、Cloudflare 與部署驗證](docs/development/deployment.md)
- [提交前資安檢查](docs/development/security-review.md)
- [文件索引](docs/README.md)
- [系統分析與需求報告 v0.4](docs/requirements/system-analysis-and-requirements.md)
- [技術選型與實作架構](docs/architecture/technical-stack.md)
- [首版介面方向](docs/architecture/interface-direction.md)

更新日期：2026-10-02。
