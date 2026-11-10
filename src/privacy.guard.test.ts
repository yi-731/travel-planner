import { describe, expect, it } from 'vitest';

/**
 * 隱私保護：這個 repo 是公開的，GitHub 上任何人都看得到原始碼、測試與文件。
 * 測試資料、註解、文件、介面範例（placeholder）、AI 提示詞裡的行程範例一律要虛構，
 * 不可以照抄使用者真實的行程表（飯店、航班、場館、店名、日期與時間）。
 * 需要「像真的」的資料時，用虛構的城市與行程（例如西雅圖、波特蘭、舊金山、京都、大阪的虛構旅程，
 * 音樂祭、Sunrise Park 主題樂園、Maple Avenue 購物街）。
 *
 * 下面的清單是曾經被當成範例、屬於真實行程的字串。用 base64 存放：這個檔案本身不出現原文，也不替它們打廣告。
 * 測試失敗時：把報出來的那一行改成虛構的例子，不要把字串從清單拿掉。
 * 要加新的字串：把 `node -e "console.log(Buffer.from('字串').toString('base64'))"` 的結果加進 DENYLIST_B64。
 */
const DENYLIST_B64 = [
  'Rm9udGFpbmVibGVhdQ==', 'QWxvZnQ=', 'QmFjY2hhbmFs', 'Q2Flc2Fycw==',
  'TWF4VG91cg==', 'U3BoZXJl', 'QmVsbGFnaW8=', 'R3JpZmZpdGg=',
  'SGVsbCdzIEtpdGNoZW4=', 'UsOpcHVibGlxdWU=', 'VGVzbGEgRGluZXI=', 'Q29tbXVuaXR5IEdvb2Rz',
  'aWwgUGFzdGFpbw==', 'R3JhbmQgQ2VudHJhbCBNYXJrZXQ=', 'TEFDTUE=', 'VXJiYW4gTGlnaHQ=',
  'RmFybWVycyBNYXJrZXQ=', 'VGhlIEdyb3Zl', 'QmF0dGxlZmllbGQgVmVnYXM=', 'SGFycnkgUmVpZA==',
  'Q29uUkFD', 'VW5pdmVyc2Fs', 'VXBwZXIgTG90', 'TG93ZXIgTG90',
  'Q2l0eVdhbGs=', 'Um9kZW8gRHJpdmU=', 'SlgwMDE=', 'SlgwMDI=',
  'UHJhY3RpY2UgMQ==', 'RlAx', 'RlAz', '5a+m6Zqb5pmC6ZaT5Y+v6IO9',
];

/** 要檢查的範圍（相對於 repo 根目錄） */
const TARGETS = ['src', 'scripts', 'docs', 'README.md', 'CLAUDE.md'];
const BINARY = /\.(?:png|jpe?g|gif|webp|avif|ico|icns|woff2?|ttf|otf|eot|mp[34]|mov|pdf|zip|gz)$/i;

interface DirEntry {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}
interface NodeFs {
  readFileSync(path: string, encoding: 'utf8'): string;
  readdirSync(path: string, options: { withFileTypes: true }): DirEntry[];
  existsSync(path: string): boolean;
  statSync(path: string): { isDirectory(): boolean };
}
interface NodePath {
  join(...parts: string[]): string;
  dirname(path: string): string;
  relative(from: string, to: string): string;
}
interface NodeUrl {
  fileURLToPath(url: string): string;
}

/** App 的 tsconfig 沒有載入 Node 型別：模組名稱用變數動態載入，型別用上面的最小介面 */
function load<T>(id: string): Promise<T> {
  return import(/* @vite-ignore */ id) as Promise<T>;
}
const fs = await load<NodeFs>('node:fs');
const path = await load<NodePath>('node:path');
const { fileURLToPath } = await load<NodeUrl>('node:url');

const SELF = fileURLToPath(import.meta.url);
const ROOT = path.join(path.dirname(SELF), '..');

const decode = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))).normalize('NFC');

function walk(dir: string, out: string[]) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && !BINARY.test(e.name)) out.push(full);
  }
}

function sourceFiles(): string[] {
  const out: string[] = [];
  for (const t of TARGETS) {
    const p = path.join(ROOT, t);
    if (!fs.existsSync(p)) continue;
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out.filter((f) => f !== SELF);
}

describe('隱私：公開的 repo 不放真實行程', () => {
  const files = sourceFiles();
  const denylist = DENYLIST_B64.map(decode);

  it('有掃到原始碼與文件（路徑沒寫錯）', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.endsWith(path.join('services', 'places.ts')))).toBe(true);
    expect(files.some((f) => f.endsWith('CLAUDE.md'))).toBe(true);
    expect(files).not.toContain(SELF);
    expect(denylist.every((w) => w.trim().length >= 3)).toBe(true);
  });

  it('原始碼、測試、文件裡沒有清單上的真實行程字串', () => {
    const hits: string[] = [];
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8').normalize('NFC');
      denylist.forEach((w, i) => {
        for (let at = text.indexOf(w); at >= 0; at = text.indexOf(w, at + w.length)) {
          hits.push(`${path.relative(ROOT, f)}:${text.slice(0, at).split('\n').length}（清單第 ${i + 1} 項）`);
        }
      });
    }
    expect(hits, '請把這些地方改成虛構的例子').toEqual([]);
  });
});
