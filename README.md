# 旅途手帳

<img src="public/logo.svg" width="96" height="96" alt="旅途手帳圖示" align="right" />

給 iPhone 用的旅遊 App：把行程、導航、天氣、記帳放在同一個地方。

- **行程**：每天的行程點、時間、地址；自動排序，太趕的段落會標出來
- **導航**：一鍵開 Google 地圖或 Apple 地圖，附近景點、交通路況
- **天氣**：旅行期間每天的預報（超過 16 天顯示歷年同期平均）
- **記帳**：多幣別、匯率自動換算、分帳、拍收據
- **匯入**：Excel／CSV 試算表、Google 試算表同步
- **AI 助理（選用）**：檢查每天行程的交通時間、推薦附近景點、依天氣給穿搭建議、辨識收據
- **出發提醒**（原生 App）：每站出發前通知你
- 資料只存在你的手機裡，不需要註冊帳號

同一份程式碼有兩種安裝方式：

| | PWA（網頁 App） | 原生 iOS App |
|---|---|---|
| 費用 | **免費** | Apple Developer Program **每年 USD 99** |
| 安裝方式 | Safari →「加入主畫面」 | TestFlight（之後可上架 App Store） |
| 更新 | push 程式碼後約 2 分鐘自動上線 | 在 GitHub 按一次按鈕，約 30 分鐘後到 TestFlight |
| 觸覺回饋、出發提醒通知 | 不支援（Safari 限制） | 支援 |
| 需要 Mac 嗎 | 不需要 | 不需要（由 GitHub 雲端的 Mac 建置） |

建議先用免費的 PWA，確定好用再考慮原生 App。

---

## 1. 首次部署（只要做一次）

1. 在 GitHub 建立一個新專案（repository），把這個資料夾的程式碼推上去（branch 名稱用 `main`）。
2. 到 GitHub 專案頁面 → **Settings** → 左側 **Pages** → **Build and deployment** 的 **Source** 選 **GitHub Actions**。
3. 到 **Actions** 分頁，等「部署到 GitHub Pages」變成綠色勾勾（約 2 分鐘）。
   第一次如果在設定 Pages 之前就推了程式碼，進到這個流程按 **Re-run all jobs** 即可。
4. 網址是 `https://<你的 GitHub 帳號>.github.io/<專案名稱>/`（也會顯示在 Settings → Pages 最上方）。

> 公開（public）專案的 GitHub Pages 與 Actions 都免費。私人（private）專案要用 Pages 需要付費方案。

## 2. 安裝到 iPhone（PWA）

1. 用 iPhone 的 **Safari** 打開上面的網址（一定要用 Safari，Chrome 不行）。
2. 點下方的 **分享** 按鈕（方框加向上箭頭）。
3. 往下滑，點 **加入主畫面** → 右上角 **加入**。
4. 從主畫面的「旅途手帳」圖示打開，就會像一般 App 一樣全螢幕使用，離線也能看行程。

> 資料存在 Safari 的這個 App 裡。如果刪掉主畫面圖示，或在「設定 → Safari → 清除瀏覽紀錄和網站資料」，資料會一起清掉。
> 重要行程請定期用 **更多 → 匯出** 備份成試算表。

## 3. 日常更新流程

```
改程式 → git push 到 main → 約 2 分鐘自動上線 → 手機重開 App 即更新
```

1. 在電腦修改程式（或請 AI 助手修改，見下方「如何修改」）。
2. 確認沒有錯誤：`npm run typecheck`、`npm test`。
3. `git add -A && git commit -m "說明這次改了什麼" && git push`
4. GitHub 會自動：檢查（CI）→ 建置 → 發布。到 **Actions** 分頁可以看進度，紅色叉叉代表失敗，點進去看錯誤訊息。
5. iPhone 上：從多工畫面把 App 滑掉，再重新打開。App 會在背景下載新版，有時要再重開一次才會看到。

原生 App 的更新見下一節第 5 步。

## 4. 原生 iOS App／TestFlight

詳細圖文步驟：[docs/ios-testflight.md](docs/ios-testflight.md)。

### 費用

| 項目 | 費用 |
|---|---|
| Apple Developer Program | **USD 99／年**（台灣約新台幣 3,200 元，依匯率與 Apple 定價為準）。沒續費 App 會從 App Store 下架、TestFlight 也無法使用 |
| GitHub Actions（雲端 Mac 建置） | 公開專案免費。私人專案有每月免費分鐘數，macOS 機器消耗較快，每次建置約 20～30 分鐘；超過會收費，可在 GitHub Settings → Billing 查看用量 |
| TestFlight | 免費（每個建置可測試 90 天） |
| Mac 電腦 | 不需要 |

### 準備清單

- [ ] 加入 [Apple Developer Program](https://developer.apple.com/programs/)（個人身分即可，審核約 1～2 天）
- [ ] 在 Apple 開發者網站註冊 Bundle ID：`io.github.yi731.travelplanner`
- [ ] 在 [App Store Connect](https://appstoreconnect.apple.com) 建立 App（名稱「旅途手帳」、主要語言繁體中文）
- [ ] 建立 App Store Connect API 金鑰（權限選「管理」Admin），下載 `.p8` 檔
- [ ] 在 GitHub 專案 → Settings → Secrets and variables → Actions 新增 4 個 Secrets：

| Secret 名稱 | 內容 |
|---|---|
| `ASC_KEY_ID` | API 金鑰 ID（10 碼英數字） |
| `ASC_ISSUER_ID` | Issuer ID（像 `57246542-96fe-1a63-e053-0824d011072a` 的長字串） |
| `ASC_KEY_P8_BASE64` | `.p8` 檔轉成 base64 的文字（直接貼 `.p8` 全文也可以） |
| `APPLE_TEAM_ID` | 開發者團隊 ID（10 碼英數字） |

### 建置並上傳

GitHub 專案 → **Actions** → 左側 **iOS 上傳 TestFlight** → **Run workflow**。
約 20～30 分鐘完成，Apple 再處理 5～30 分鐘後，iPhone 上的 **TestFlight** App 就能安裝或更新。

- 版本號取自 `package.json` 的 `version`（例如 `1.0.0`）；建置號每次自動加一。
- 要送 App Store 審核新版本時，先把 `package.json` 的 `version` 改大（例如 `1.0.1`）。

### 不想等雲端？在 Mac 上自己建置

```bash
npm run ios:sync   # 建置網頁並同步到 ios/
npm run ios:open   # 用 Xcode 打開，選你的 iPhone 按 ▶ 執行
```

## 5. AI 金鑰與費用

AI 功能是**選用**的，不設定金鑰也能使用其他所有功能。

**會用到 AI 的功能**（每次都是你按下按鈕才會執行，不會在背景偷偷呼叫）：
行程「AI 檢查」交通時間、「推薦景點」、天氣頁的「穿搭建議」、記帳的「拍收據自動填寫」。

**設定方式**

1. 到 [Anthropic Console](https://console.anthropic.com) 註冊，在 **Billing** 儲值（預付制，最低金額以網站為準），建議同時設定每月花費上限。
2. 在 **API Keys** 建立金鑰（`sk-ant-` 開頭）。
3. App 內：**更多 → App 設定 → AI 助理** 貼上金鑰，按「測試連線」。

金鑰只存在你的手機，不會上傳到 GitHub 或任何其他伺服器；AI 功能使用時，行程或收據內容會傳給 Anthropic 處理。
這和 Claude.ai 的訂閱（Pro／Max）是分開計費的。

**費用**（依 Anthropic 用量計價，以下是 2026 年 10 月的官方價格，每 100 萬個 token）：

| 模型 | 輸入 | 輸出 | 適合 |
|---|---|---|---|
| Claude Opus 5.5（預設） | USD 4 | USD 20 | 最聰明，行程檢查最準 |
| Claude Sonnet 5.5 | USD 2 | USD 10 | 較快、約一半價格 |
| Claude Haiku 5.5 | USD 0.10 | USD 0.50 | 最便宜，簡單任務夠用 |

粗估：用預設的 Opus 5.5，**每次 AI 功能約 USD 0.01～0.10**（行程越長、收據照片越大越貴）。
一趟五天的旅行正常使用，大約 USD 0.5～2。實際以 Anthropic Console 的帳單為準，最新價格見 [anthropic.com/pricing](https://www.anthropic.com/pricing)。
想更省：在 App 設定把模型換成 Sonnet 或 Haiku。

## 6. 專案結構與如何修改

**修改前請先讀 [CLAUDE.md](CLAUDE.md)**：裡面有資料夾結構、設計規則、資料模型的改法。
用 AI 助手（例如 Claude Code）修改時，它會自動讀這份檔案，所以直接用中文描述你想改什麼就可以。

```
src/
  app/         App 外框（分頁列、彈出頁、出發提醒）
  domain/      資料模型與純邏輯（types.ts 是唯一的資料定義）
  store/       資料存取（行程、設定，存在手機）
  services/    天氣、匯率、地理編碼、試算表、AI
  platform/    原生／網頁差異（震動、分享、照片、定位、通知）
  ui/          共用元件（按鈕、彈出頁、清單…）
  features/    各功能畫面，一個資料夾一個功能
  styles/      tokens.css：所有顏色、字體、間距
public/        圖示（logo.svg 是原始檔）
ios/           原生 iOS 專案（Capacitor 產生，通常不用手動改）
docs/          說明文件
scripts/       開發用小工具
.github/workflows/  自動檢查、自動部署、TestFlight 上傳
```

**常見修改**

| 想改的 | 改哪裡 |
|---|---|
| 顏色、字體、圓角 | `src/styles/tokens.css`（淺色、深色都要改） |
| 某個畫面 | `src/features/<功能>/` |
| 資料欄位 | `src/domain/types.ts` → `src/store/migrations.ts` 加遷移（見 CLAUDE.md 規則 8） |
| App 圖示 | 改 `public/logo.svg`，然後 `npm run icons` 與 `node scripts/ios-assets.mjs` |
| App 名稱 | `capacitor.config.ts` 的 `appName`、`vite.config.ts` 的 `name`、`index.html`、`ios/App/App/Info.plist` 的 `CFBundleDisplayName` |
| 原生權限說明文字 | `ios/App/App/Info.plist`（`NS…UsageDescription`） |

**常用指令**（先安裝 [Node.js 22](https://nodejs.org)，第一次執行 `npm install`）

| 指令 | 做什麼 |
|---|---|
| `npm run dev` | 開發模式，瀏覽器打開顯示的網址；手機和電腦同一個 Wi‑Fi 可用 `npm run dev -- --host` 在手機上看 |
| `npm run typecheck` | 型別檢查（push 前一定要通過） |
| `npm test` | 單元測試 |
| `npm run build` | 建置正式版到 `dist/` |
| `npm run icons` | 由 `public/logo.svg` 產生 PWA 圖示 |
| `node scripts/ios-assets.mjs` | 由 `public/logo.svg` 產生 iOS 圖示與啟動畫面 |
| `npm run ios:sync` | 建置並同步到 iOS 專案 |

## 7. 常見問題

**Q：手機上沒看到更新？**
從多工畫面把 App 滑掉再打開，必要時再重開一次。也可以先到 GitHub 的 Actions 確認部署是綠色勾勾。

**Q：Actions 出現紅色叉叉？**
點進失敗的流程，展開紅色的步驟看錯誤訊息。最常見的是型別錯誤：在電腦執行 `npm run typecheck` 修正後再 push。

**Q：網址打開是 404 或空白？**
確認 Settings → Pages 的 Source 是 **GitHub Actions**，且網址結尾有 `/<專案名稱>/`。

**Q：PWA 可以收到出發提醒嗎？**
不行。iPhone 的 Safari 網頁 App 不支援排程通知，需要原生 App（TestFlight）。

**Q：換手機或刪掉 App，資料會不見嗎？**
會。資料只存在手機上。請用 **更多 → 匯出** 存成試算表，新手機再用 **匯入** 載入；或把行程放在 Google 試算表並用同步功能。

**Q：AI 功能顯示「API 金鑰無效」或「使用量達到上限」？**
到 Anthropic Console 確認金鑰沒有被刪除、帳戶有餘額；新帳戶的每分鐘用量上限較低，等一分鐘再試。

**Q：可以用在 Android 嗎？**
PWA 在 Android 的 Chrome 也能「加入主畫面」使用。原生 Android App 目前沒有設定。

**Q：可以改 Bundle ID 嗎？**
可以，在建立 App Store Connect 的 App 之前改：`capacitor.config.ts` 的 `appId`，以及 `ios/App/App.xcodeproj/project.pbxproj` 裡兩處 `PRODUCT_BUNDLE_IDENTIFIER`。
