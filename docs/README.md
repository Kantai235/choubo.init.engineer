# 專案文件索引

整理日期：2026 年 10 月 2 日。此目錄收錄前期討論的需求、分析、審查及技術選型，供後續開發與驗收使用。

## 實作與操作

- [開發與 Google Drive 設定](development/setup.md)：啟動、公開 Client ID、測試與靜態部署。
- [實作進度與驗證紀錄](development/progress.md)：0.1.0 範圍、FR 對應、已知限制及後續項目。
- [功能與 UI 核對報告](development/requirements-ui-audit.md)：逐模組與欄位對照、設計差異、現有功能修正及暗色模式。
- [AT01～AT90 驗收矩陣](development/acceptance-matrix.csv)：每項原始情境、預期、現況與證據限制。
- [首版介面方向](architecture/interface-direction.md)：視覺與操作設計。
- [Codex 插件與工作流程配置](development/codex-plugins.md)：插件選型、已完成設定、來源限制及連線狀態。

- [GitHub Pages 部署](development/deployment.md)：工作流程、網域及 OAuth 設定。
- [分頁授權恢復與期限](development/google-session.md)：sessionStorage 邊界、身分驗證、過期／登出處理與驗證範圍。
- [提交前資安檢查](development/security-review.md)：檢查範圍、修正、證據與限制。

## 現行開發依據

| 文件 | 版本／狀態 | 用途 |
| --- | --- | --- |
| [系統分析與需求報告](requirements/system-analysis-and-requirements.md) | v0.5，分頁授權恢復已確認 | 功能、欄位、帳務規則、資料模型、同步、開發階段及 AT01～AT90 驗收案例 |
| [技術選型與實作架構](architecture/technical-stack.md) | v0.2，技術規劃與授權更新 | 建議採用的工具、模組責任、儲存與提交流程、程式目錄、測試及部署 |

先閱讀需求報告第 1～3 章與第 22 章掌握範圍及決策，再閱讀技術文件；開發個別模組時回查需求報告相應章節、FR 編號與驗收案例。技術文件承接產品需求，不改變已確認的帳務規則；套件組合與實際版本仍需在專案初始化及 M0 技術驗證時確認相容性。

## 歷史分析與提案

| 文件 | 基準 | 使用方式 |
| --- | --- | --- |
| [完整需求審查](analysis/requirements-review.md) | 審查 v0.2 | 查閱 R01～R12 問題與 RV01～RV30 補充測試的由來；當時未決事項以 v0.4 的整合結果為準 |
| [Google Drive 優先設計方案](analysis/google-drive-first-proposal.md) | v0.3 歷史方案 | 查閱雲端優先、退款、分期、回饋及復原的設計理由；相關規則已併入 v0.4 |

歷史文件保留原文，僅加上適用範圍提示。舊文中的「建議」「待確認」「本機預設」「離線正式入帳」須按文件日期解讀，不覆蓋現行規格。

## 目前共識

- 網站為無後台的純前端應用，正式使用需要授權本人 Google Drive。
- 資料位於本人 My Drive 根目錄的專用資料夾，不跨使用者共用帳本或資源。
- localStorage 用於加快載入、保存偏好及保護草稿；可攜內容非同步保存至 Drive，短期 token 僅存記憶體與 sessionStorage；重整先向 Google 驗證身分，再載入帳本。
- 雲端已保存草稿不等於正式入帳；正式操作須經 Drive 保存確認與一致性驗證。
- 網站關閉後不提醒或執行；離線只能查看已載入資料及編輯草稿。
- 自動儲值、自動繳款只建立帳務紀錄，不實際移轉金錢。
- 每筆紀錄可包含多筆分類明細，共用帳戶、幣種及日期；轉帳共用帳戶對。

## 來源與維護

本次將既有完整報告保存到專案，技術文件依 2026 年 10 月 2 日的技術選型討論整理。帳務規格維持原 v0.4；v0.5 補充第 19 章系統亮／暗外觀，以及第 15～16 章使用者確認的 sessionStorage 短期授權恢復，取代原 memory-only 規則。

| 原始 Page | 專案文件 |
| --- | --- |
| 系統分析與需求報告（私人原始文件） | `requirements/system-analysis-and-requirements.md` |
| 完整審查報告（私人原始文件） | `analysis/requirements-review.md` |
| Google Drive 優先設計方案（私人原始文件） | `analysis/google-drive-first-proposal.md` |

後續開發在本目錄維護版本與變更日期；若另行更新 Page，須明確同步內容，不能假設兩處會自動保持一致。新增產品決策時更新需求正文及對應驗收；變更工程工具時更新技術文件。保留 FR／AT 識別的可追溯性。

文件定義了需求與驗收條件，不表示應用程式已完成或測試已通過。
