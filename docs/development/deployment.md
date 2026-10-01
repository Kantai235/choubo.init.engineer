# GitHub Pages 部署

更新：2026-10-02。

## 組成

- 版本庫：`Kantai235/choubo.init.engineer`，依使用者選擇公開。
- 網站：`https://choubo.init.engineer`。
- 靜態主機：GitHub Pages，來源為 GitHub Actions。
- DNS：Cloudflare 的 `init.engineer` zone；`choubo` CNAME 指向 `kantai235.github.io`，初始採 DNS only。
- Google Cloud：獨立 `Choubo` 專案，ID `choubo`；Drive API 與瀏覽器 OAuth。

## 初次部署驗證紀錄

- 初次程式提交 `2b2b07a` 已推送至 `main`。
- [首次 Actions 執行](https://github.com/Kantai235/choubo.init.engineer/actions/runs/36914090148) 的 verify-build 與 deploy 均成功；GitHub Ubuntu／Node 24 環境也通過單元、瀏覽器與建置驗證。
- 調整 CI 後的提交 `486a98a` 也已[完整驗證及部署成功](https://github.com/Kantai235/choubo.init.engineer/actions/runs/36915605615)，runner Chrome 154.0.8037.57 執行 7 項瀏覽器測試通過，測試耗時 23.4 秒。
- Pages 已綁定 `choubo.init.engineer`。Cloudflare 已新增 CNAME、DNS only、TTL 自動；Cloudflare 權威 DNS、1.1.1.1 與 8.8.8.8 均解析至 `kantai235.github.io`。
- 已新增 `_github-pages-challenge-Kantai235.choubo` TXT，並在 GitHub 個人 Pages 設定完成 `choubo.init.engineer` 所有權驗證，畫面顯示 Verified。需保留驗證紀錄，才能持續保護此網域。
- 初次 HTTP 首頁回傳 200，含正確 Choubo HTML、production CSP 與編譯 assets；憑證生效後改為強制 HTTPS。
- 2026-10-02 03:42（Asia/Taipei）HTTPS 憑證已核發，Enforce HTTPS 已開啟，HTTP 301 轉向 HTTPS。首頁與 `/privacy.html` HTTPS 回傳 200；Chrome 已檢查正式站與 `/#/settings` 直接載入。網域所有權狀態為 verified。
- Google Cloud `choubo` 專案、Google Drive API、Google Auth 品牌／同意畫面、`drive.file` 範圍與 1 位測試使用者已設定。Web client 名稱為 `Choubo Web`；公開 Client ID 已設至 Actions repository variable 與忽略追蹤的 `.env.local`。未下載或保存 client secret。
- OAuth 目前為 External／Testing，僅測試使用者可授權。正式公開給一般使用者前，需另完成 Google 應用發布設定；公開 GitHub repository 不代表 Google OAuth 已對所有人開放。

- 注入 Client ID 後的 [Actions 部署](https://github.com/Kantai235/choubo.init.engineer/actions/runs/36917433341) 驗證與部署均成功。正式站已出現可用的 Google Drive 按鈕；真實 Google popup 接受來源、測試帳號與 `drive.file`，進入授權確認頁，尚待使用者同意後驗證 Drive 寫入。

## 自動部署

每次 push 至 `main` 觸發 `.github/workflows/deploy-pages.yml`，依序檢查敏感檔案、套件漏洞、lint、單元測試、瀏覽器測試、型別與 production build。只有成功後才部署；PR 只驗證。手動重跑可用 workflow_dispatch。

CI 固定 `ubuntu-24.04`／Node 24，使用 GitHub runner 預裝 Google Chrome 跑同一套 Playwright 測試，並印出瀏覽器版本；不額外執行 apt 升級。這避免第一次上線時觀察到的 Ubuntu 套件鏡像下載停滯。驗證工作上限 15 分鐘，部署上限 10 分鐘。Chrome 版本隨 GitHub runner image 更新，來源為 [官方 runner 軟體清單](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md)。

GitHub Actions repository variable `VITE_GOOGLE_CLIENT_ID` 保存公開網頁 Client ID。改變變數後需重新跑部署，Vite 不會在執行時读取 GitHub 變數。不設定任何 OAuth client secret；GitHub 的 OIDC／Pages token 由平台提供。

`public/CNAME` 與 `public/.nojekyll` 隨 build 複製。Vue 使用 hash 路由，因此 Pages 不需 404 rewrite。隱私權說明固定 `/privacy.html`。

## 服務設定順序

1. GitHub 啟用 Actions Pages 並綁定 custom domain。
2. 在 Cloudflare 新增僅屬於 `choubo` 的 CNAME，不覆蓋 apex 或其他網站紀錄。
3. DNS 驗證成功後等待 GitHub TLS 憑證，啟用 Enforce HTTPS。
4. Google OAuth 網頁來源加入 `https://choubo.init.engineer`；開發來源另外列出 `http://127.0.0.1:5173`、`http://localhost:5173`、`http://localhost`。本版使用 popup token model，未設定 redirect URI。
5. 在 Google 設定 `drive.file` scope 與測試使用者，建立 Web client，將公開 ID 配置至 Actions variable。
6. 驗證部署成功、TLS、首頁／hash 路由／privacy，最後實測 OAuth。Google Testing 階段只有已列入的測試帳號能使用。

## 官方參考

- [GitHub Pages 自訂 workflow](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [GitHub Pages 自訂網域](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)
- [Cloudflare DNS 紀錄](https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/)
- [Google 瀏覽器 token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
