/**
 * Capacitor 設定：把 dist/（PWA 建置結果）包成原生 iOS App。
 * 改完這個檔案要執行 npm run ios:sync，設定才會寫進 ios/ 專案。
 */
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.yi731.travelplanner',
  appName: '旅途手帳',
  webDir: 'dist',
  ios: {
    // 安全區（瀏海、底部橫條）由網頁自己用 env(safe-area-inset-*) 處理
    contentInset: 'never',
    // Xcode 的建置 scheme 名稱（cap run / cap build 與 GitHub Actions 都用它）。
    // 這不是顯示名稱：App 在主畫面的名字由 appName 與 Info.plist 的 CFBundleDisplayName 決定。
    scheme: 'App',
    // 網頁還沒畫出來前的底色，和啟動畫面、淺色主題背景一致，避免閃白
    backgroundColor: '#ECEBE7',
  },
  plugins: {
    SplashScreen: {
      // 資料從 IndexedDB 讀完後由 App 呼叫 hideSplash() 關閉（src/platform）
      launchAutoHide: false,
      backgroundColor: '#ECEBE7',
      showSpinner: false,
    },
    LocalNotifications: {},
  },
};

export default config;
