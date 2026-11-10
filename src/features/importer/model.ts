/**
 * 匯入頁用的純函式（無 React），測試在 model.test.ts。
 */
import { fmtMD } from '@/domain/dates';
import type { Trip } from '@/domain/types';
import { currencyForCountry, currencyLabel } from '@/features/trips/model';
import type { ImportResult } from '@/services/importer';
import { cityNameVariants, findCityAlias } from '@/services/weather';

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
export function guessLocalCurrency(r: { expenses: readonly { currency: string }[] }, home: string, fallback: string): string {
  const count = new Map<string, number>();
  for (const e of r.expenses) if (e.currency && e.currency !== home) count.set(e.currency, (count.get(e.currency) ?? 0) + 1);
  let best = fallback, n = 0;
  for (const [c, k] of count) if (k > n) (best = c), (n = k);
  return best;
}

/** 每筆記帳的幣別：寫明的三碼幣別、沒寫（跟著新行程的當地貨幣）、只寫「¥」（日圓或人民幣，看城市） */
const UNSET = '?';
const YEN = '¥';

/** 建立新行程用的辨識結果：幣別等使用者填好城市、按下建立時才決定 */
export interface NewTripDraft {
  /** 辨識結果；沒寫幣別的記帳幣別暫時是 UNSET、只寫「¥」的是 JPY */
  result: ImportResult;
  /** 每筆記帳的幣別（與 result.expenses 同順序）：三碼幣別、UNSET 或 YEN */
  rows: string[];
  /** 本國貨幣（不算當地貨幣） */
  home: string;
  /** 試算表沒寫明、城市也認不出來時用的貨幣（目前行程的當地貨幣，沒有就是 JPY） */
  fallback: string;
  /** fallback 是不是沿用目前行程的 */
  fromTrip: boolean;
}

/**
 * parse 是「用某個當地貨幣辨識這份試算表」。用兩個不同的當地貨幣各辨識一次，
 * 幣別跟著變的記帳就是沒寫明的：變成記號的是沒寫幣別，日圓／人民幣互換的是只寫「¥」。
 */
export function newTripDraft(parse: (local: string) => ImportResult, home: string, tripCurrency: string | undefined): NewTripDraft {
  const result = parse(UNSET);
  const other = parse('CNY').expenses;
  const rows = result.expenses.map((e, i) => (e.currency === UNSET ? UNSET : e.currency === other[i]?.currency ? e.currency : YEN));
  return { result, rows, home, fallback: tripCurrency || 'JPY', fromTrip: !!tripCurrency };
}

/** 第 i 筆記帳在試算表裡有沒有寫幣別（沒寫的要等決定當地貨幣才知道） */
export const hasWrittenCurrency = (d: NewTripDraft, i: number) => d.rows[i] !== UNSET;

/** 沒寫幣別的記帳筆數 */
export const unwrittenCount = (d: NewTripDraft) => d.rows.filter((c) => c === UNSET).length;

/** 城市名稱 → 當地貨幣（KYOTO、首爾、臺北市…）；認不出來回傳 null */
export function cityCurrency(city: string): string | null {
  for (const v of cityNameVariants(city)) {
    const cur = currencyForCountry(findCityAlias(v)?.cc);
    if (cur) return cur;
  }
  return null;
}

/** 當地貨幣從哪裡來：試算表寫明的、城市、或沿用預設 */
export type CurrencyFrom = 'sheet' | 'city' | 'fallback';

/**
 * 新行程的當地貨幣：試算表寫明的幣別（最常出現、又不是本國貨幣的）→ 城市所在國家的貨幣 → 預設。
 * 「¥」在中國的城市（或預設是人民幣）算人民幣，其他算日圓。
 */
export function pickNewTripCurrency(d: NewTripDraft, city: string): { code: string; from: CurrencyFrom; yen: string } {
  const byCity = cityCurrency(city);
  const yen = (byCity ?? d.fallback) === 'CNY' ? 'CNY' : 'JPY';
  const written = d.rows.filter((c) => c !== UNSET).map((c) => ({ currency: c === YEN ? yen : c }));
  const bySheet = guessLocalCurrency({ expenses: written }, d.home, '');
  if (bySheet) return { code: bySheet, from: 'sheet', yen };
  if (byCity) return { code: byCity, from: 'city', yen };
  return { code: d.fallback, from: 'fallback', yen };
}

/** 依城市決定新行程的當地貨幣，並把沒寫幣別的記帳換成它 */
export function resolveNewTrip(d: NewTripDraft, city: string): { localCurrency: string; result: ImportResult } {
  const { code, yen } = pickNewTripCurrency(d, city);
  const expenses = d.result.expenses.map((e, i) =>
    d.rows[i] === UNSET ? { ...e, currency: code } : d.rows[i] === YEN ? { ...e, currency: yen } : e,
  );
  return { localCurrency: code, result: { ...d.result, expenses } };
}

/** 預覽「建立為新行程」的貨幣說明：新行程會用哪個當地貨幣、沒寫幣別的記帳怎麼算 */
export function currencyHint(d: NewTripDraft, city: string): string {
  const { code, from } = pickNewTripCurrency(d, city);
  const label = currencyLabel(code);
  const head =
    from === 'sheet' ? `當地貨幣：${label}（依試算表）。`
    : from === 'city' ? `當地貨幣：${label}（依城市）。`
    : city.trim() ? `認不出這個城市的貨幣，先用 ${label}；建立後可到行程設定修改。`
    : d.fromTrip ? `當地貨幣先沿用目前行程的 ${label}，填上城市就會改用當地貨幣。`
    : `當地貨幣先用 ${label}，填上城市就會改用當地貨幣。`;
  const unset = unwrittenCount(d);
  return unset ? `${head}沒寫幣別的 ${unset} 筆記帳會以 ${code} 計算。` : head;
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
