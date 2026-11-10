/**
 * 匯入頁用的純函式（無 React），測試在 model.test.ts。
 */
import { AI_PLACES_MIN_TWD } from '@/domain/constants';
import { fmtMD } from '@/domain/dates';
import type { Settings, Trip } from '@/domain/types';
import { fmtTwdRange } from '@/features/ai/aiUsage';
import { estimatePlacesTwd } from '@/services/ai';
import { currencyForCountry, currencyLabel } from '@/features/trips/model';
import { applyImport, compareDayKeys, suggestTripCity, type ImportResult } from '@/services/importer';
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
  /** 每個行程點預估花費寫明的幣別（與 result.items 同順序）：三碼幣別、YEN，沒寫是 null */
  itemRows?: (string | null)[];
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
  const cny = parse('CNY');
  const other = cny.expenses;
  const rows = result.expenses.map((e, i) => (e.currency === UNSET ? UNSET : e.currency === other[i]?.currency ? e.currency : YEN));
  // 行程點的預估花費：當地貨幣是 UNSET 時，寫明的幣別都會記在 costCurrency；
  // 只寫「¥」的，用人民幣辨識時就不是 JPY 了（變成當地貨幣、不另外記）
  const itemRows = result.items.map((it, i) =>
    !it.costCurrency ? null : it.costCurrency === 'JPY' && cny.items[i]?.costCurrency !== 'JPY' ? YEN : it.costCurrency,
  );
  return { result, rows, itemRows, home, fallback: tripCurrency || 'JPY', fromTrip: !!tripCurrency };
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
  // 試算表寫明的幣別：記帳的幣別，加上行程點預估花費寫的（「$25」）
  const marks = [...d.rows.filter((c) => c !== UNSET), ...(d.itemRows ?? []).filter((c): c is string => !!c)];
  const written = marks.map((c) => ({ currency: c === YEN ? yen : c }));
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
  const items = d.itemRows?.some((c) => c === YEN)
    ? d.result.items.map((it, i) => (d.itemRows![i] === YEN ? { ...it, costCurrency: yen } : it))
    : d.result.items;
  return { localCurrency: code, result: { ...d.result, items, expenses } };
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

/* ---------- 地點辨識預覽 ---------- */

/** 預覽「每天的城市」的一列 */
export interface DayRow {
  key: string;
  /** 3/8、第 1 天 */
  date: string;
  /** 「台北 → 西雅圖」或「波特蘭」；認不出城市時是空字串 */
  route: string;
  lodging?: string;
  /** 日期列原文（認不出城市時顯示） */
  label: string;
}

/** 試算表的日期列 → 預覽用的每天城市與住宿（依日期排序） */
export function dayRows(r: Pick<ImportResult, 'days'>): DayRow[] {
  const days = r.days ?? {};
  return Object.keys(days)
    .sort(compareDayKeys)
    .map((key) => {
      const d = days[key];
      const rel = /^__D(\d+)$/.exec(key);
      const cities = d.cities?.length ? d.cities : d.city ? [d.city] : [];
      return {
        key,
        date: rel ? `第 ${+rel[1]} 天` : fmtMD(key),
        route: cities.join(' → '),
        ...(d.lodging ? { lodging: d.lodging } : {}),
        label: d.label.replace(/\s*[｜|]\s*/g, ' · '),
      };
    });
}

/** 預覽的一行說明：「3/8 台北 → 西雅圖 · 住 Hotel Zephyr」 */
export function dayRowText(d: DayRow): string {
  const main = d.route || d.label;
  return d.lodging ? `${main} · 住 ${d.lodging}` : main;
}

/** ★ 必做、◇ 可省略各幾個 */
export function flagCounts(r: Pick<ImportResult, 'items'>): { must: number; optional: number } {
  let must = 0, optional = 0;
  for (const it of r.items) {
    if (it.flag === 'must') must++;
    else if (it.flag === 'optional') optional++;
  }
  return { must, optional };
}

/** 沒填城市時，新行程會用的城市（日期列最常過夜的城市） */
export const suggestedCity = (r: Pick<ImportResult, 'days'>) => suggestTripCity(r.days);

/**
 * 預覽表的「導航目的地」：實際套用到一個暫時的新行程，取前 n 個行程點的 place.query
 * （和建立後一模一樣的規則，使用者可以先確認 App 有沒有看懂地點）。出錯時回傳空陣列。
 */
export function previewPlaces(r: ImportResult, city: string, n: number): string[] {
  try {
    const scratch: Trip = {
      id: 'preview', name: 'preview', city, startDate: null, endDate: null, localCurrency: 'USD', homeCurrency: 'TWD', rate: 1,
      members: ['我'], items: [], expenses: [], cover: { kind: 'orb', hue: 0 }, ai: { dayChecks: {} }, createdAt: 0, updatedAt: 0,
    };
    const t = applyImport(scratch, { ...r, expenses: [] }, 'new');
    return t.items.slice(0, n).map((it) => it.place?.query?.trim() ?? '');
  } catch {
    return [];
  }
}

/**
 * 匯入後要不要自動用 AI 辨識地點：設定開著、有金鑰、本趟 AI 預算還沒用完，
 * 而且有還沒被 AI 或使用者確認過的行程點（同步後沒變的行程點不會再花一次）。
 */
export function shouldAutoResolve(
  trip: Pick<Trip, 'items'> | undefined,
  settings: Pick<Settings, 'aiAutoResolvePlaces'>,
  ready: boolean,
  budget: { exceeded: boolean; limit?: number; remaining?: number } | null,
): boolean {
  if (!trip || !settings.aiAutoResolvePlaces || !ready || !budget || budget.exceeded) return false;
  // 剩下的預算不夠辨識一次：不自動開始（不然一匯入就跳出「預算不足」）
  if (budget.limit && budget.limit > 0 && budget.remaining != null && budget.remaining < AI_PLACES_MIN_TWD) return false;
  return trip.items.some((it) => it.place?.source !== 'ai' && it.place?.source !== 'manual');
}

/** 自動辨識地點的大約費用（估不出來時顯示這個） */
export const AI_PLACES_COST_HINT = '約 NT$5–10';

/** 自動辨識地點的大約費用，依行程點數與設定的 AI 模型（「約 NT$8–17」）；估不出來用 AI_PLACES_COST_HINT */
export function placesCostHint(trip: Trip | null | undefined, model: string): string {
  if (!trip) return AI_PLACES_COST_HINT;
  try {
    return fmtTwdRange(estimatePlacesTwd(trip, model));
  } catch {
    return AI_PLACES_COST_HINT;
  }
}

/** 預覽時（行程還沒建立）估費用用的行程：只有匯入的行程點與日期列 */
export function previewTrip(result: Pick<ImportResult, 'items' | 'days'>, base?: Pick<Trip, 'homeCurrency' | 'localCurrency' | 'rate' | 'rates'> | null): Trip {
  return {
    id: 'preview',
    name: '',
    city: '',
    startDate: null,
    endDate: null,
    localCurrency: base?.localCurrency ?? 'USD',
    homeCurrency: base?.homeCurrency ?? 'TWD',
    rate: base?.rate ?? 1,
    ...(base?.rates ? { rates: base.rates } : {}),
    members: ['我'],
    items: result.items.map(({ costCurrency: _c, ...it }, i) => ({ ...it, id: `p${i}`, createdAt: 0, updatedAt: 0 })),
    expenses: [],
    cover: { kind: 'orb' },
    ai: { dayChecks: {} },
    days: Object.fromEntries(Object.entries(result.days ?? {}).map(([k, d]) => [k, { label: d.label, ...(d.city ? { city: d.city } : {}), source: 'rule' as const }])),
    createdAt: 0,
    updatedAt: 0,
  };
}
