/**
 * 匯入頁用的純函式（無 React），測試在 model.test.ts。
 */
import { fmtMD } from '@/domain/dates';
import type { Trip } from '@/domain/types';
import type { ImportResult } from '@/services/importer';

const pad = (n: number) => String(n).padStart(2, '0');

/** 毫秒 → 「11/9 14:32」 */
export function fmtSynced(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 「18 個行程點 · 3 筆記帳」（沒有的那一項省略；都沒有時回傳「沒有資料」） */
export function countsText(r: Pick<ImportResult, 'items' | 'expenses'>, sep = ' · '): string {
  const parts: string[] = [];
  if (r.items.length) parts.push(`${r.items.length} 個行程點`);
  if (r.expenses.length) parts.push(`${r.expenses.length} 筆記帳`);
  return parts.join(sep) || '沒有資料';
}

/** 預覽表的日期欄：11/20、第 1 天、— */
export function previewDate(it: { date: string | null; dayOffset?: number }): string {
  if (it.date) return fmtMD(it.date);
  if (it.dayOffset) return `第 ${it.dayOffset} 天`;
  return '—';
}

/**
 * 按鈕裡的行程名稱太長時縮短：先去掉結尾括號（「京阪奈五日（範例）」→「京阪奈五日」），
 * 還是太長再截斷成最多 max 個字（含「…」）。
 */
export function shortName(name: string, max = 10): string {
  let chars = [...name.trim()];
  if (chars.length <= max) return chars.join('');
  const stripped = chars.join('').replace(/\s*[（(][^（()）]*[)）]$/, '').trim();
  if (stripped) chars = [...stripped];
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('');
}

/**
 * 新行程的當地貨幣：記帳裡最常出現、又不是本國貨幣的幣別；沒有就用 fallback。
 */
export function guessLocalCurrency(r: Pick<ImportResult, 'expenses'>, home: string, fallback: string): string {
  const count = new Map<string, number>();
  for (const e of r.expenses) if (e.currency && e.currency !== home) count.set(e.currency, (count.get(e.currency) ?? 0) + 1);
  let best = fallback, n = 0;
  for (const [c, k] of count) if (k > n) (best = c), (n = k);
  return best;
}

/** 「以試算表為準」更新後，原本的行程點有幾個會被移除 */
export function removedCount(before: Pick<Trip, 'items'>, after: Pick<Trip, 'items'>): number {
  const keep = new Set(after.items.map((i) => i.id));
  return before.items.filter((i) => !keep.has(i.id)).length;
}

/** 錯誤物件 → 可以顯示的中文訊息 */
export function errorText(e: unknown, fallback: string): string {
  const m = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  if (!m || /^todo\b/i.test(m.trim())) return fallback;
  return m;
}
