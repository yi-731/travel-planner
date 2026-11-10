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
      registerType: 'autoUpdate',
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
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // 地圖圖磚：離線時也能看到看過的地圖
            urlPattern: /^https:\/\/tile\.openstreetmap\.org\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              expiration: { maxEntries: 2000, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
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
