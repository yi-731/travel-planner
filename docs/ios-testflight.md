# 原生 iOS App：從零到 TestFlight

照著做一次，之後每次更新只要在 GitHub 按一個按鈕。全程**不需要 Mac**。
預計時間：第一次約 1 小時（不含 Apple 審核開發者帳號的 1～2 天）。

## 費用總覽

| 項目 | 費用 | 說明 |
|---|---|---|
| Apple Developer Program | **USD 99／年** | 必要。到期沒續費，TestFlight 與 App Store 上的 App 都會停用 |
| GitHub Actions | 公開專案免費 | 私人專案有每月免費分鐘數，macOS 消耗較快；每次建置約 20～30 分鐘 |
| TestFlight | 免費 | 每個建置可安裝 90 天，期限前再建置一次即可 |

---

## 第 1 步：加入 Apple Developer Program

1. 準備一個開啟「雙重認證」的 Apple ID（iPhone：設定 → 你的名字 → 登入與安全性）。
2. 在 iPhone 安裝 **Apple Developer** App，登入後點 **立即註冊**（用 App 註冊付款最簡單），或到 <https://developer.apple.com/programs/enroll/>。
3. 身分選 **個人**（Individual）。App Store 上顯示的開發者名稱會是你的本名。
4. 付款 USD 99，等 Apple 寄確認信（通常 1～2 天）。

## 第 2 步：找到 Team ID

1. 打開 <https://developer.apple.com/account>，登入。
2. 往下找 **Membership details**（會員資格詳細資訊）。
3. **Team ID** 是 10 碼英數字，例如 `A1B2C3D4E5`。記下來，這是 `APPLE_TEAM_ID`。

## 第 3 步：註冊 Bundle ID

Bundle ID 是 App 的身分證字號，這個專案用 `io.github.yi731.travelplanner`。

1. 打開 <https://developer.apple.com/account/resources/identifiers/list>（Certificates, Identifiers & Profiles → **Identifiers**）。
2. 按藍色 **＋** → 選 **App IDs** → Continue → 選 **App** → Continue。
3. **Description**：`Travel Planner`（只能英數字）。
4. **Bundle ID** 選 **Explicit**，填 `io.github.yi731.travelplanner`。
5. 下方 Capabilities 不用勾（出發提醒是本機通知，不需要 Push Notifications）。
6. Continue → Register。

> 想用自己的 Bundle ID？先改 `capacitor.config.ts` 的 `appId`，以及 `ios/App/App.xcodeproj/project.pbxproj` 裡的兩處 `PRODUCT_BUNDLE_IDENTIFIER`，再註冊同樣的字串。

## 第 4 步：在 App Store Connect 建立 App

1. 打開 <https://appstoreconnect.apple.com> → **App**。
2. 左上角 **＋** → **新增 App**。
3. 填寫：
   - 平台：**iOS**
   - 名稱：`旅途手帳`（App Store 上不能和別人重複；被用走了就加副標，例如「旅途手帳 行程記帳」）
   - 主要語言：**繁體中文**
   - 套裝識別碼（Bundle ID）：選第 3 步註冊的 `io.github.yi731.travelplanner`
   - SKU：`travelplanner`（自己看的代號，隨意）
   - 使用者存取權限：**完整存取權限**
4. 按 **建立**。

## 第 5 步：建立 App Store Connect API 金鑰

GitHub 用這把金鑰代替你登入 Apple，自動簽署並上傳 App。

1. App Store Connect → 右上角 **使用者和存取權限** → 上方 **整合**（Integrations）分頁 → 左側 **App Store Connect API**。
2. 選 **團隊金鑰**（Team Keys）。第一次使用要先按 **要求存取權限**，同意條款。
3. 按 **產生 API 金鑰**（或 **＋**）：
   - 名稱：`GitHub Actions`
   - 存取權限：**管理**（Admin）
     （自動簽署需要建立發布憑證與描述檔，權限較低的角色會失敗）
4. 按 **產生**。
5. 在列表中：
   - **金鑰 ID**（Key ID，10 碼）→ 這是 `ASC_KEY_ID`
   - 表格上方的 **Issuer ID**（一串含 `-` 的長字串，按「拷貝」）→ 這是 `ASC_ISSUER_ID`
6. 按 **下載 API 金鑰**，得到 `AuthKey_XXXXXXXXXX.p8`。
   **只能下載一次！** 請存到安全的地方（例如密碼管理器）。遺失只能撤銷後重新產生。

## 第 6 步：把 .p8 金鑰轉成 base64 文字

選一種方式，把結果複製起來（這是 `ASC_KEY_P8_BASE64`）：

**Mac（終端機）**
```bash
base64 -i ~/Downloads/AuthKey_XXXXXXXXXX.p8 | pbcopy
```
（已複製到剪貼簿）

**Windows（PowerShell）**
```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME\Downloads\AuthKey_XXXXXXXXXX.p8")) | Set-Clipboard
```

**懶人法**：用文字編輯器打開 `.p8`，全選複製（包含 `-----BEGIN PRIVATE KEY-----` 和 `-----END PRIVATE KEY-----` 兩行）。流程兩種格式都接受。

## 第 7 步：在 GitHub 設定 Secrets

1. GitHub 專案 → **Settings** → 左側 **Secrets and variables** → **Actions**。
2. 按 **New repository secret**，名稱一定要完全一樣（大寫、底線），一共 4 個：

| Name | Secret |
|---|---|
| `ASC_KEY_ID` | 第 5 步的金鑰 ID |
| `ASC_ISSUER_ID` | 第 5 步的 Issuer ID |
| `ASC_KEY_P8_BASE64` | 第 6 步複製的文字 |
| `APPLE_TEAM_ID` | 第 2 步的 Team ID |

Secrets 存進去後就看不到內容，只能覆寫；別人 fork 你的專案也拿不到。

## 第 8 步：建置並上傳

1. GitHub 專案 → **Actions** → 左側 **iOS 上傳 TestFlight**。
2. 右側 **Run workflow** → 分支選 `main` → 綠色 **Run workflow**。
3. 等 20～30 分鐘。全部綠色勾勾＝上傳成功，摘要會顯示版本與建置號。
4. Apple 會再處理 5～30 分鐘，完成後寄信通知。

## 第 9 步：用 TestFlight 安裝到 iPhone

1. App Store Connect → 你的 App → **TestFlight** 分頁。
2. 左側 **內部測試** 旁的 **＋** → 建立群組（例如「自己」）→ 加入你自己的 Apple ID。
3. iPhone 從 App Store 安裝 **TestFlight**，用同一個 Apple ID 登入。
4. 收到邀請後在 TestFlight 按 **安裝**。之後每次上傳新建置，TestFlight 會通知你更新。

> 出口合規（加密）問題：專案已在 `Info.plist` 設定 `ITSAppUsesNonExemptEncryption = NO`（只用 HTTPS），不會每次都被問。

## 之後怎麼更新

- **只改了網頁內容**：PWA 版 push 後自動更新；原生 App 要再跑一次第 8 步。
- **建置號**：每次自動加一，不用管。
- **版本號**：送 App Store 審核新版時，把 `package.json` 的 `"version"` 改大（例如 `1.0.0` → `1.0.1`），push 後再跑第 8 步。

## 上架 App Store（選擇性）

TestFlight 給自己和朋友用就夠了（內部測試最多 100 人，外部測試最多 10,000 人，外部測試第一次需要簡短審核）。
要公開上架，還需要在 App Store Connect 填：

- iPhone 截圖（6.9 吋，至少 1 張；可用 `node scripts/shot.mjs` 產生後調整尺寸，或在 iPhone 上截圖）
- App 描述、關鍵字、支援網址（可以用 GitHub 專案網址）
- **隱私權政策網址**與 **App 隱私權** 問卷：本 App 不收集資料（資料只存在裝置）；若使用者自行設定 AI 金鑰，行程與收據內容會傳送給 Anthropic 處理，請在政策中說明
- 送審後約 1～3 天回覆

## 疑難排解

| 錯誤訊息（關鍵字） | 原因與解法 |
|---|---|
| `缺少 Secrets：…` | 第 7 步少設了，或名稱打錯 |
| `ASC_KEY_P8_BASE64 解不出 .p8 金鑰` | base64 文字不完整，重做第 6 步 |
| `Cloud signing permission error`、`not authorized` | API 金鑰權限不是「管理」：撤銷後重新產生 Admin 金鑰，更新 3 個相關 Secrets |
| `No profiles for 'io.github.yi731.travelplanner' were found` | 第 3 步沒註冊 Bundle ID，或第 4 步選錯 Bundle ID |
| `No Accounts`、`401`、`authentication` | `ASC_KEY_ID` 或 `ASC_ISSUER_ID` 填錯（Issuer ID 是表格上方那串，不是金鑰 ID） |
| `The bundle version must be higher` | 同一個建置號重複了，直接再跑一次第 8 步 |
| `SDK version issue`、`must be built with the iOS … SDK` | Apple 要求更新的 Xcode：把 `.github/workflows/ios-testflight.yml` 的 `runs-on: macos-15` 改成較新的 macOS（例如 `macos-26`） |
| `Missing required icon`、`Invalid large app icon` | 圖示有透明或尺寸不對：執行 `node scripts/ios-assets.mjs` 重新產生 |
| `Your Apple Developer Program membership has expired` | 續費 Apple Developer Program |

仍然失敗：點進失敗的步驟，把最後 30 行錯誤訊息複製給 AI 助手，說明「iOS TestFlight 流程失敗」。
