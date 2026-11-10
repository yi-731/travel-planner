/**
 * PWA 圖示產生設定（@vite-pwa/assets-generator）。
 * 來源圖：public/logo.svg（1024×1024，滿版深色底）。
 * 改了 logo.svg 之後執行：npm run icons
 * 會在 public/ 產生：pwa-64x64.png、pwa-192x192.png、pwa-512x512.png、
 * maskable-icon-512x512.png、apple-touch-icon-180x180.png、favicon.ico
 * （iOS 原生 App 的 1024 圖示與啟動畫面，以及主畫面網頁 App 的啟動畫面 public/apple-splash-*.png，
 *   另外用 node scripts/ios-assets.mjs 產生：和原生 App 同一張圖，不是由這裡的 logo.svg 縮放）
 */
import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

/** 圖示本身已是滿版深色底，所以不留白；底色和 logo.svg 的夜色一致 */
const background = '#1A1918';

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    transparent: { ...minimal2023Preset.transparent, padding: 0, resizeOptions: { background, fit: 'contain' } },
    maskable: { ...minimal2023Preset.maskable, padding: 0, resizeOptions: { background, fit: 'contain' } },
    apple: { ...minimal2023Preset.apple, padding: 0, resizeOptions: { background, fit: 'contain' } },
    // 全彩 PNG（預設會壓成 256 色，漸層光暈會出現色階）
    png: { compressionLevel: 9, palette: false },
  },
  images: ['public/logo.svg'],
});
