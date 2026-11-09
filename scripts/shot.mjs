// 截圖工具（開發用）：node scripts/shot.mjs --tab home --sheet '{"name":"weather"}' --out /tmp/x --themes light,dark --port 5301
// 會自己啟動 Vite 開發伺服器、用 iPhone 尺寸（390×844）在淺色／深色各截一張，輸出 <out>-light.png / <out>-dark.png。
// --setup '<js>' 可在截圖前執行任意程式（可用 window.__tp.useUI / useData）。--full 截整頁。
import { createRequire } from 'node:module';
import { createServer } from 'vite';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]?.startsWith('--') || arr[i + 1] === undefined ? 'true' : arr[i + 1]]] : acc), []));
const port = Number(args.port ?? 5300 + Math.floor(Math.random() * 600));
const themes = (args.themes ?? 'light,dark').split(',');
const out = args.out ?? '/tmp/shot';
const server = await createServer({ server: { port, strictPort: false, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch();
const errors = [];
try {
  for (const theme of themes) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: Number(args.scale ?? 1), colorScheme: theme, isMobile: true, hasTouch: true, locale: 'zh-TW' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`[${theme}] ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`[${theme}] console: ${m.text()}`));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__tp && window.__tp.useData.getState().hydrated, null, { timeout: 15000 });
    if (args.tab) await page.evaluate((t) => window.__tp.useUI.getState().setTab(t), args.tab);
    if (args.setup) await page.evaluate(args.setup);
    if (args.sheet) await page.evaluate((sh) => window.__tp.useUI.getState().openSheet(JSON.parse(sh)), args.sheet);
    await page.waitForTimeout(Number(args.wait ?? 1400));
    await page.screenshot({ path: `${out}-${theme}.png`, fullPage: args.full === 'true' });
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    if (w > 390) errors.push(`[${theme}] 橫向溢出：scrollWidth=${w}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'OK no page errors');
