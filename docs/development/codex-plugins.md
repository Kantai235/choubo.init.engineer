# Codex 插件與工作流程配置

評估與設定日期：2026-10-02。

## 評估依據

Choubo 是 Vue／TypeScript／Vite 的純前端應用，已有領域、應用、基礎設施與畫面分層，以及 Vitest、Playwright 和需求驗收文件。近期工作先在 Page 整理需求，再保存至專案 Markdown、實作並驗證；使用者也曾明確要求以 Chrome 開啟 Google Cloud。

保留跨專案工具，在 Choubo 內以根目錄 `AGENTS.md` 指定適用條件；個人其他專案資訊不提交至此倉庫。

## 建議與本次處理

| 工具／插件 | 用途與決定 | 已確認狀態 |
| --- | --- | --- |
| Build Web Apps | 網頁實作、前端除錯與瀏覽器驗證；沿用 Vue／PrimeVue | 原已安裝，本次用 CLI 重新安裝並核對 6 個技能檔 |
| Build Web Data Visualization | 帳務報表、排行榜與互動圖表，按需求使用 | 原已安裝，本次重新安裝並核對 18 個技能檔 |
| Cloudflare | 既有 Workers／D1／Hugo 專案的開發與部署 | 原已安裝，本次重新安裝並核對 9 個技能檔；CLI 列出官方 MCP 與 OAuth 狀態，未操作雲端資源 |
| GitHub | 倉庫、PR、Issue、CI 工作 | 本機插件存在，`gh` 已登入；帳號層級 GitHub 插件搜尋結果仍為未安裝，已提供安裝／連線入口，尚未驗證完成 |
| Browser、Chrome | 本機 UI 驗證與需要既有登入狀態的工作 | 本機 CLI 列為已安裝啟用；本次未測試 Chrome 擴充功能連線 |
| Build iOS Apps | SwiftUI、Simulator、效能與除錯 | 本次對話已有技能及 XcodeBuildMCP 工具；保留原配置 |
| Code Review | 程式審查 | 保留 App 內建版；停用重複的 Claude marketplace 版本 |
| Pages、文件、PDF、試算表、簡報 | 既有需求整理、文件與資料輸出工作 | 保留本次對話可用的工具，不重複安裝 |

設定檔中同時存在兩份本機 GitHub 插件。已停用 `github@claude-plugins-official`；保留 `github@openai-curated` 的技能，但因未找到其要求的 `GITHUB_PAT_TOKEN`，停用它的 GitHub MCP server。現階段使用既有 `gh` 登入，不將 keyring token 複製到設定檔。帳號插件完成連線後，以實際載入工具為準。

以上停用操作不刪除插件套件，也不改變服務端權限。其餘插件、既有設計技能、模型、審批及 sandbox 設定均保留。

## 暫不新增

- Google Drive：Choubo 直接使用 Google Identity Services 與 Drive REST API；連接 Codex 的 Drive 插件不能建立網站 Client ID，也不能取代真實帳務驗收。既有本機設定保留，帳號連線等有文件操作需求時再處理。
- Figma、Linear、Notion、Slack：目前查到的工作流程以程式倉庫、Markdown、Pages 為主，沒有足夠證據支持新增這些工作系統。
- OpenAI Developers：目前 Choubo 沒有 OpenAI API 功能；內建 OpenAI Docs 已能處理文件查詢。
- Stripe、Supabase、Vercel、Netlify：不是目前架構的必要條件。記帳不等於實際付款，不能因安裝網頁插件便引入新的後台或金流。
- Superpowers／更多前端設計技能：既有技能已充足，先以任務選擇與專案指引減少重複流程。
- Codex Security：保留原配置；本次未新增帳號安裝、未啟動掃描，也未認證掃描服務可用。

## 安裝來源與版本限制

已檢查 [openai/plugins](https://github.com/openai/plugins) 的 README、marketplace 與相關 manifest。查核時 GitHub main 為 `5fd93af4cd0c623e020d0cc7e9ce178b4ac1f70f`；本機 App 管理的 `openai-curated` 快照為 `d6169bef126ba46677c011ed4beb0754171394f9`。

目前 CLI 為 0.139.0。嘗試依官方文件新增 `openai/plugins` 時，CLI 拒絕重複註冊保留名稱 `openai-curated`；對此來源執行 upgrade 也回報它不是已配置的 Git marketplace。因此三個套件是從既有 App 快照重新安裝，**不是已更新至 GitHub main**。沒有改名繞過保留名稱或修改受管理的目錄內容。

官方文件說明，插件套件、啟用狀態、服務授權與新對話載入是不同步驟。CLI 安裝成功不代表帳號插件已連線，也不代表本次對話熱載入了新工具。完成設定後另開對話載入；若桌面目錄尚未反映本機來源，可重新啟動 App 後檢查。[插件安裝與使用](https://learn.chatgpt.com/docs/plugins) · [插件套件與本機目錄](https://developers.openai.com/plugins/build/plugins)

## 本次設定位置

- `~/.codex/config.toml`：停用兩份重複插件，以及尚未配置認證的本機 GitHub MCP；保留官方 GitHub 技能與 `gh`。
- 專案根目錄 `AGENTS.md`：文件優先順序、Vue 架構、插件選擇、帳務邊界與驗證命令。
- 本文件：選型理由、安裝來源、實際驗證與剩餘步驟。

未新增專案 `.codex/config.toml`：目前 CLI 沒有此目錄的 trust 記錄，專案層設定可能被忽略；不為插件整理自行變更信任或權限設定。插件整理當時尚無 `.git`；後續 GitHub 發布工作另有獨立的資安與部署紀錄。

變更前設定備份僅保留於本機 Codex 備份目錄，不提交個人路徑、設定檔或插件清單至倉庫。還原前須比較新舊設定，避免覆蓋其他工作。

## 後續使用

1. 新對話在本專案工作時讀取 `AGENTS.md`，依任務使用網頁、測試或圖表技能。
2. 如要使用帳號層 GitHub 工具，完成提供的安裝／連線流程；未完成也能使用已登入的 `gh`。
3. 真實 Google OAuth／Drive 驗證仍依 `setup.md` 建立網站公開 Client ID 與 JavaScript origin；這是產品整合工作，與插件安裝無關。
4. Cloudflare 的實際 API 操作與 Chrome 擴充功能操作在需要時驗證；本次未用重新授權或帳號變更來推定其可用性。

## 本次驗證

- 全域設定以 TOML 解析成功；與備份比較，只有 `plugins` 區塊改變。
- CLI 確認三個重新安裝的插件皆為 installed／enabled，兩份重複插件為 installed／disabled。
- MCP 清單確認本機 GitHub server 已停用，Cloudflare 與 XcodeBuildMCP 保持啟用。
- 新增文件及文件索引的本機 Markdown 連結皆存在。
- 本次僅修改開發工具設定與文件，沒有修改應用程式碼，因此未重跑應用測試；既有測試結果仍以 `progress.md` 的原始驗證範圍為準。
