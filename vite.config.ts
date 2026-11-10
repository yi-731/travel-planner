import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// BASE_PATH：GitHub Pages 部署在 /<repo>/ 底下時設定（例如 /travel-planner/）；
// Capacitor iOS 與本機開發用預設的 '/'。
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    VitePWA({
      // 'prompt'：新版下載好後先等待、不在使用中途換掉（正在填的表單不會不見），
      // 由 src/app/pwa.ts 跳出「有新版本」提示，下次完全關閉再打開 App 就是新版。
      // 不要加 workbox.skipWaiting：開著的頁面會對不上新版的快取，切換畫面時可能載入失敗。
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: '旅途手帳',
        short_name: '旅途手帳',
        description: '行程規劃、導航、天氣、記帳一次完成',
        lang: 'zh-TW',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ECEBE7',
        theme_color: '#ECEBE7',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // iOS 啟動畫面只在加入主畫面時下載一次，不必放進離線快取（幾十張大圖）
        globIgnores: ['**/apple-splash-*.png'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // 地圖圖磚：離線時也能看到看過的地圖。
            // 圖磚用 CORS 載入（TripMap 的 crossOrigin），只存成功的 200 回應：
            // 不透明回應（status 0）在瀏覽器的容量計算裡每張會被算成好幾 MB，而且看不出 403、5xx 等錯誤，會被當成正常圖磚存 30 天。
            // 快取名稱改成 v2：舊的 'map-tiles' 存的是不透明回應，由 src/app/pwa.ts 刪除。
            urlPattern: /^https:\/\/tile\.openstreetmap\.org\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles-v2',
              expiration: { maxEntries: 2000, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: /^https:\/\/(api|archive-api|geocoding-api)\.open-meteo\.com\/.*/,
            handler: 'NetworkFirst',
            options: { cacheName: 'weather', networkTimeoutSeconds: 6, expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 3 } },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
