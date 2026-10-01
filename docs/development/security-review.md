# 提交前資安檢查

日期：2026-10-02。範圍：0.1.0 全部待提交原始碼、需求／技術文件、套件鎖定檔、CI 設定與 production 打包內容。本報告記錄已做的檢查，不保證不存在未知漏洞。

## 結果與修正

| 項目 | 結果 |
| --- | --- |
| 憑證扫描 | Gitleaks 8.30.1 掃描初次 staged diff 與 `dist/`，均無發現；執行檔由官方 release 取得並比對 SHA256 |
| 私人內容 | 移除文件中的私人 Page 連結、其他私人專案名稱、本機個人目錄；保留相對文件連結 |
| 檔案排除 | `.env*`（範本除外）、憑證、私鑰、套件設定、帳務匯出、測試 trace、暫存、依賴與打包輸出不提交 |
| 套件稽核 | `pnpm audit`：所有嚴重性共 0 項已知漏洞；此為檢查時的供應商資料庫結果 |
| token | 僅放記憶體；不寫 localStorage、環境檔、日誌或 URL；授權回傳需含 `drive.file` |
| 最小 Drive 權限 | 僅 `drive.file`；核對使用者、帳本、資料夾父項與檔案 metadata；不建立跨使用者分享 |
| 本機資料隔離 | 草稿與 pending 讀出時重驗 ownerId／bookId；異常時停止且保留原資料 |
| HTML 注入 | Vue 純文字插值；惡意 HTML 瀏覽器案例通過；無 `v-html` 或 eval |
| production | CSP 限制 script／連線／frame，禁止 object／base；停用 source maps；開發用 Client ID 編輯與覆寫僅 DEV |
| GitHub Actions | 固定 actions SHA、最小權限、PR 不部署、只上傳 dist、checkout 不保留 Git 憑證 |
| 遠端持續檢查 | 已啟用 GitHub Secret scanning、Push protection、Dependabot alerts；啟用後查詢秘密與依賴漏洞警示均為 0 |
| TLS | GitHub Pages 憑證已核發，Enforce HTTPS 已開啟，HTTP 301 轉 HTTPS；首頁與隱私頁均回應 200 |
| OAuth 部署 | 僅公开 Client ID 存在 Actions variable／前端 bundle；`.env.local` 已忽略，未下載或保存 client secret |
| 網域所有權 | 透過 Cloudflare TXT 完成 GitHub `choubo.init.engineer` Verified domain；限制其他帳號使用此子網域發布 Pages |

`scripts/check-sensitive-files.mjs` 在提交檔案／CI 檢查禁止檔名及常見 token／私鑰格式。執行 `node scripts/check-sensitive-files.mjs --staged` 可檢查即將提交的實際內容。掃描原始報告與備份只存放於已忽略的 `work/security/`。

## 驗證證據

- ESLint、TypeScript、production build 通過。
- 37 項單元／應用／Drive 契約測試通過。
- 7 項 Playwright 流程通過，包括 XSS 文字顯示、切換帳號、離線草稿、失敗重試與撤銷。
- production preview：hash 路由重新整理、隱藏開發設定、隱私頁、inline script 遭 CSP 阻擋，未見 page error。
- 初次 `main` 推送後，GitHub Ubuntu／Node 24 的完整 workflow 驗證與 Pages 部署通過。
- 上述自動測試使用隔離的模擬 GIS／Drive，不等於真實 Google 帳號、撤銷權限或跨裝置完整驗收。

## 已知安全邊界

- localStorage 及 Drive JSON 未做端對端加密；共享電腦需保護作業系統／瀏覽器登入。帳號隔離不是防止本機管理員讀取的加密機制。
- 記憶體 token 仍可能受同來源 XSS／惡意擴充功能影響；CSP 是額外防護，不能代替輸入與供應鏈控制。
- GitHub Pages 不提供專案自訂 HTTP 標頭；meta CSP 不能套用 `frame-ancestors`、HSTS 或 COOP。正式 origin 的真實 GIS popup 已抵達 Google 授權確認頁；實際取得 token 與 Drive 寫入另列於進度文件。
- Drive 沒有本應用所需的跨檔案交易鎖；未完成共同額度上限、進階衝突解決、還原與遷移。不得宣稱金融系統等級一致性或完整 90 項驗收通過。
- 公開 OAuth Client ID、網站網域與 Google Cloud 專案 ID 是公開識別資訊；Client Secret、access／refresh token、Service Account key 不可提交或放入 Vite 環境變數。

## 2026-10-02：需求核對與暗色模式提交

本輪變更不增加 Google scope、第三方腳本或憑證儲存；access token 仍僅記憶體。主題以 CSS 系統偏好決定，不新增 localStorage／sessionStorage key。帳務修改限於報表的對帳差額篩選及查詢／明細展示，不重寫已存在的 Drive 操作。

提交前禁止路徑／憑證格式檢查通過；Gitleaks 對 staged diff 與 production `dist/` 掃描均無發現，`pnpm audit` 無已知漏洞。測試截圖只含模擬資料並保持不提交；報告不含真實 Drive ID、使用者 token 或個人電郵。本輪新增的資料讀寫模擬不等同真實跨裝置資安驗收。
