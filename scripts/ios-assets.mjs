// iOS 原生 App 的圖示與啟動畫面產生器。
// 用法：node scripts/ios-assets.mjs
// 來源：public/logo.svg（1024×1024）。改了 logo 之後執行一次，再 npm run ios:sync。
// 產生：
//   ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png   1024×1024，無透明（App Store 規定）
//   ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732*.png    淺色＋深色啟動畫面
//   public/apple-splash-portrait-*.png                                   主畫面網頁 App（PWA）的啟動畫面，
//                                                                        連結寫進 index.html
// 需要 sharp（@vite-pwa/assets-generator 已附帶安裝）。
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(root, 'ios/App/App/Assets.xcassets');
if (!existsSync(assets)) {
  console.error('找不到 ios/ 專案。請先執行：npx cap add ios');
  process.exit(1);
}

// 顏色和 src/styles/tokens.css 一致
const LIGHT = { bg: '#ECEBE7', ink: '#1A1918', glow: 0.22 };
const DARK = { bg: '#0F0F11', ink: '#F6F3EE', glow: 0.38 };
const NIGHT = '#1A1918';

// ---- App 圖示 ----
const logo = readFileSync(join(root, 'public/logo.svg'));
await sharp(logo, { density: 144 })
  .resize(1024, 1024)
  .flatten({ background: NIGHT })
  .removeAlpha()
  .toColourspace('srgb')
  .png({ compressionLevel: 9 })
  .toFile(join(assets, 'AppIcon.appiconset/AppIcon-512@2x.png'));
console.log('✓ AppIcon 1024×1024');

// ---- 啟動畫面 ----
// 2732×2732 正方形，iOS 以「填滿」方式顯示：iPhone 上約 1 像素 = 0.31 pt，
// 中央標誌約 100 pt 寬。標誌和 App 圖示同一組幾何（光球沉入地平線＋路線圓點）。
function splashSvg({ bg, ink, glow }) {
  const S = 2732;
  const k = 0.52; // 從 1024 圖示座標縮放
  // 圖示中標誌的範圍：x 196–827、y 242–720 → 中心 (511.5, 481)
  const tx = S / 2 - 511.5 * k;
  const ty = S / 2 - 481 * k;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs>
    <radialGradient id="sun" cx="0.34" cy="0.30" r="0.962" fx="0.34" fy="0.30">
      <stop offset="0" stop-color="#FFE7CD"/>
      <stop offset="0.30" stop-color="#FFA75F"/>
      <stop offset="0.64" stop-color="#FF6A1A"/>
      <stop offset="1" stop-color="#E64700"/>
    </radialGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#FF7A2E" stop-opacity="${glow}"/>
      <stop offset="0.5" stop-color="#FF6A1A" stop-opacity="${(glow * 0.32).toFixed(3)}"/>
      <stop offset="1" stop-color="#FF6A1A" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="above"><rect width="1024" height="650"/></clipPath>
  </defs>
  <rect width="${S}" height="${S}" fill="${bg}"/>
  <g transform="translate(${tx.toFixed(1)} ${ty.toFixed(1)}) scale(${k})">
    <circle cx="512" cy="494" r="430" fill="url(#glow)"/>
    <circle cx="512" cy="494" r="252" fill="url(#sun)" clip-path="url(#above)"/>
    <rect x="196" y="682" width="508" height="22" rx="11" fill="${ink}"/>
    <circle cx="800" cy="693" r="27" fill="${ink}"/>
  </g>
</svg>`);
}

const splashDir = join(assets, 'Splash.imageset');
for (const [name, theme] of [['', LIGHT], ['-dark', DARK]]) {
  const png = await sharp(splashSvg(theme)).removeAlpha().png({ compressionLevel: 9 }).toBuffer();
  // Capacitor 範本用三個同樣的檔案對應 1x/2x/3x
  for (const suffix of ['', '-1', '-2']) writeFileSync(join(splashDir, `splash-2732x2732${name}${suffix}.png`), png);
}
const scales = [['-2', '1x'], ['-1', '2x'], ['', '3x']];
const contents = {
  images: [
    ...scales.map(([s, scale]) => ({ idiom: 'universal', filename: `splash-2732x2732${s}.png`, scale })),
    ...scales.map(([s, scale]) => ({
      appearances: [{ appearance: 'luminosity', value: 'dark' }],
      idiom: 'universal',
      filename: `splash-2732x2732-dark${s}.png`,
      scale,
    })),
  ],
  info: { version: 1, author: 'xcode' },
};
writeFileSync(join(splashDir, 'Contents.json'), JSON.stringify(contents, null, 2) + '\n');
console.log('✓ 啟動畫面（淺色＋深色）');

// ---- 主畫面網頁 App（PWA）的啟動畫面 ----
// iOS 的主畫面網頁 App 不會用 manifest 產生啟動畫面，要用 <link rel="apple-touch-startup-image">
// 為每種螢幕尺寸各給一張，否則開啟時會先閃一下空白（深色模式特別明顯）。
// 用和原生 App 一樣的圖，像 iOS「填滿」那樣裁成各機型的直式尺寸（App 只支援直式）。
// 圖放在 public/apple-splash-*.png（不放進離線快取，見 vite.config.ts 的 globIgnores），
// 連結自動寫進 index.html 的 apple-splash 標記之間。
// 使用者要把主畫面的 App 刪掉再重新加入才會看到新圖；深淺色可能固定為加入時的外觀。
const PWA_SPLASH = [
  // [寬, 高（像素）, 倍率]：同尺寸的機型只列一次
  [1320, 2868, 3], // iPhone 17 Pro Max、16 Pro Max
  [1206, 2622, 3], // iPhone 17、17 Pro、16 Pro
  [1260, 2736, 3], // iPhone Air
  [1290, 2796, 3], // iPhone 16 Plus、15 Pro Max、15 Plus、14 Pro Max
  [1179, 2556, 3], // iPhone 16、15、15 Pro、14 Pro
  [1170, 2532, 3], // iPhone 16e、14、13、13 Pro、12、12 Pro
  [1284, 2778, 3], // iPhone 14 Plus、13 Pro Max、12 Pro Max
  [1125, 2436, 3], // iPhone 13 mini、12 mini、11 Pro、XS、X
  [1242, 2688, 3], // iPhone 11 Pro Max、XS Max
  [828, 1792, 2], // iPhone 11、XR
  [1242, 2208, 3], // iPhone 8 Plus
  [750, 1334, 2], // iPhone SE（第 2、3 代）、8
];
const publicDir = join(root, 'public');
const links = [];
for (const [name, theme] of [['light', LIGHT], ['dark', DARK]]) {
  const square = await sharp(splashSvg(theme)).removeAlpha().png().toBuffer();
  for (const [w, h, dpr] of PWA_SPLASH) {
    const file = `apple-splash-portrait-${name}-${w}x${h}.png`;
    await sharp(square)
      .resize(w, h, { fit: 'cover', position: 'centre' })
      .png({ compressionLevel: 9 })
      .toFile(join(publicDir, file));
    const scheme = name === 'dark' ? ' and (prefers-color-scheme: dark)' : '';
    links.push(
      `    <link rel="apple-touch-startup-image" media="screen and (device-width: ${w / dpr}px) and (device-height: ${h / dpr}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)${scheme}" href="/${file}" />`,
    );
  }
}
const htmlPath = join(root, 'index.html');
const html = readFileSync(htmlPath, 'utf8');
const START = '<!-- apple-splash:start（由 scripts/ios-assets.mjs 產生，不要手改） -->';
const END = '<!-- apple-splash:end -->';
const from = html.indexOf(START);
const to = html.indexOf(END);
if (from < 0 || to < from) {
  console.error(`index.html 裡找不到啟動畫面標記，請在 <head> 裡加上：\n    ${START}\n    ${END}`);
  process.exit(1);
}
writeFileSync(htmlPath, html.slice(0, from + START.length) + '\n' + links.join('\n') + '\n    ' + html.slice(to));
console.log(`✓ 主畫面網頁 App 啟動畫面（${PWA_SPLASH.length} 種尺寸 × 淺色＋深色，已寫入 index.html）`);
