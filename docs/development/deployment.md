# GitHub Pages 部署

更新：2026-10-02。

## 組成

- 版本庫：`Kantai235/choubo.init.engineer`，依使用者選擇公開。
- 網站：`https://choubo.init.engineer`。
- 靜態主機：GitHub Pages，來源為 GitHub Actions。
- DNS：Cloudflare 的 `init.engineer` zone；`choubo` CNAME 指向 `kantai235.github.io`，初始採 DNS only。
- Google Cloud：獨立 `Choubo` 專案，ID `choubo`；Drive API 與瀏覽器 OAuth。

初次部署仍在進行，網域解析、TLS、Google Client ID 與遠端 workflow 的實際完成狀態以本文後續驗證紀錄為準。

## 自動部署

每次 push 至 `main` 觸發 `.github/workflows/deploy-pages.yml`，依序檢查敏感檔案、套件漏洞、lint、單元測試、瀏覽器測試、型別與 production build。只有成功後才部署；PR 只驗證。手動重跑可用 workflow_dispatch。

GitHub Actions repository variable `VITE_GOOGLE_CLIENT_ID` 保存公開網頁 Client ID。改變變數後需重新跑部署，Vite 不會在執行時读取 GitHub 變數。不設定任何 OAuth client secret；GitHub 的 OIDC／Pages token 由平台提供。

`public/CNAME` 與 `public/.nojekyll` 隨 build 複製。Vue 使用 hash 路由，因此 Pages 不需 404 rewrite。隱私權說明固定 `/privacy.html`。

## 服務設定順序

1. GitHub 啟用 Actions Pages 並綁定 custom domain。
2. 在 Cloudflare 新增僅屬於 `choubo` 的 CNAME，不覆蓋 apex 或其他網站紀錄。
3. DNS 驗證成功後等待 GitHub TLS 憑證，啟用 Enforce HTTPS。
4. Google OAuth 網頁來源加入 `https://choubo.init.engineer`；開發來源另外列出 `http://127.0.0.1:5173`、`http://localhost:5173`。
5. 在 Google 設定 `drive.file` scope 與測試使用者，建立 Web client，將公開 ID 配置至 Actions variable。
6. 驗證部署成功、TLS、首頁／hash 路由／privacy，最後實測 OAuth。Google Testing 階段只有已列入的測試帳號能使用。

## 官方參考

- [GitHub Pages 自訂 workflow](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [GitHub Pages 自訂網域](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)
- [Cloudflare DNS 紀錄](https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/)
- [Google 瀏覽器 token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
