# 旅途手帳（travel-planner）— 開發指南

給未來的自己與 AI 助手：這份文件說明專案結構與規則。修改前先讀。

## 這是什麼
iPhone 旅遊 App：行程規劃、導航、天氣、記帳、試算表匯入／Google 試算表同步、AI 助理。
同一份程式碼：
- **PWA**：部署到 GitHub Pages，iPhone Safari →「⋯」→「分享」→「加入主畫面」安裝（免費）。
- **原生 iOS App**：Capacitor 包裝（`ios/` 資料夾），用 GitHub Actions 建置上傳 TestFlight（需 Apple Developer 帳號）。

## 指令
- `npm run dev` 開發伺服器
- `npm run typecheck` 型別檢查（必須通過）
- `npm test` 單元測試（vitest）
- `npm run build` 建置 PWA 到 `dist/`
- `npm run ios:sync` 建置並同步到 iOS 專案

## 技術
React 19 + TypeScript（strict）+ Vite 8、zustand（狀態）、IndexedDB（idb-keyval，資料存在手機）、motion（動畫／手勢）、Leaflet + OpenStreetMap 圖磚（地圖，免金鑰；配色用 CSS 濾鏡，見 features/map/model.ts）、read-excel-file / write-excel-file / papaparse（試算表）、@anthropic-ai/sdk（AI）、Capacitor 8（原生功能）、vite-plugin-pwa（離線＋安裝）。

## 資料夾
```
src/
  app/        App 外框：TopBar、TabBar（浮動膠囊）、SheetHost（底部彈出頁）、Toasts、sheetRegistry
  domain/     純資料與邏輯（無 React）：types.ts（唯一資料模型）、constants、dates、money、schedule
  store/      zustand：data.ts（持久化：行程、設定）、ui.ts（分頁、彈出頁堆疊、toast、busy）、migrations.ts
  services/   對外連線與檔案：weather、fx、geocode、sheets、importer、exporter、ai、links
  platform/   原生／網頁差異（觸覺、分享、選照片、定位、通知、狀態列）。元件不要直接 import @capacitor/*
  ui/         設計系統元件：Button / LinkButton / Sheet / ListGroup / ListRow / Tile / Chip / Picker / 表單欄位 / Orb / Icon
  features/   各功能（一個資料夾一個功能，自帶 *.module.css）
  styles/     tokens.css（所有顏色、字體、間距、圓角、陰影）、global.css
```

## 規則
1. **介面文字**一律繁體中文（台灣用語），自然口語；不用 emoji；按鈕寫清楚會發生什麼（「儲存」「匯入 12 個行程點」）。
2. **外層簡潔、細節收進彈出頁**：分頁畫面只放摘要與主要動作；詳細資訊、表單、設定都開 Sheet（`useUI().openSheet({...})`）。
3. **顏色／字體／間距只用 tokens.css 的 CSS 變數**，不要寫死顏色（社群品牌色點除外）。淺色深色都要能看。
4. **共用元件優先**：先用 `@/ui` 的元件；功能專屬樣式放在該功能資料夾的 `*.module.css`。
5. **資料只透過 store 修改**：`useData` 的 `mutateTrip / upsertItem / upsertExpense ...`；不要直接改物件。
6. **網路呼叫只在 services/**；元件不直接 fetch。失敗要有中文錯誤訊息與可重試的 UI。
7. **原生功能只透過 platform/**，網頁版要有替代或清楚說明。
8. 改資料結構：改 `domain/types.ts` → 在 `store/migrations.ts` 加版本遷移 → `npm run typecheck`。
9. 新增彈出頁：`store/ui.ts` 的 `SheetRoute` 加型別 → `app/sheetRegistry.tsx` 註冊 → 在 features 建元件（default export）。
10. 純邏輯寫測試（`*.test.ts` 放在同資料夾）。
11. iPhone 細節：觸控目標 ≥ 44px；注意瀏海與底部安全區（env(safe-area-inset-*)）；輸入框字級 ≥ 16px（避免 iOS 自動放大）；`100dvh` 而非 `100vh`。

## PWA 與原生 App 設定
- **最低 iOS 16.4**：Vite 預設建置目標是 Safari 16.4，CSS 也用到 color-mix()。`ios/App/App.xcodeproj/project.pbxproj` 的 `IPHONEOS_DEPLOYMENT_TARGET` 同樣是 16.4，兩邊要一致。
- **PWA 更新**：`vite.config.ts` 的 `registerType: 'prompt'`；新版先等待、跳出「有新版本」提示，下次完全關閉再開才生效（`src/app/pwa.ts`）。不要加 `skipWaiting`。
- **主畫面網頁 App 的啟動畫面**：`node scripts/ios-assets.mjs` 產生 `public/apple-splash-*.png` 並寫進 `index.html`。使用者要把主畫面的 App 刪掉再重新加入，才會看到新的啟動畫面（`index.html` 的狀態列設定也一樣）；深淺色可能固定為加入時的外觀。
- **新增原生外掛**（`@capacitor/*`）：看外掛 README 的 Privacy Manifest 段落，把要求的 API 類別加進 `ios/App/App/PrivacyInfo.xcprivacy`；需要的權限說明加進 `Info.plist`（繁體中文、照實寫用途）。
- **開機保險**：`index.html` 有一段不依賴主程式的小腳本，8 秒後畫面還是空的（程式載入失敗、資料庫沒回應）就關掉原生啟動畫面，顯示說明與「重新載入」按鈕；App 畫出來後自動移除。
- `project.pbxproj` 沒有 Xcode 也能手改：新增的資源檔要同時加 PBXFileReference、PBXBuildFile、App 群組的 children、Resources build phase 四處。

## 設計語言
參考圖：大字襯線城市名（Instrument Serif）、霧面玻璃卡片疊在日落橘光球上、黑色膠囊按鈕＋橘色圓形箭頭（`<Button variant="go">`）、浮動黑色分頁列。
數字（時間、金額、溫度）用襯線大字＋ tabular-nums。中文標題用系統字（PingFang TC）粗體。

## AI
`services/ai.ts`，使用者在「更多 → App 設定」填自己的 Anthropic API 金鑰（只存在裝置）。預設模型 `claude-opus-5-5`。
費用依 Anthropic 用量計價，介面需讓使用者知道哪些功能會用到 AI。
