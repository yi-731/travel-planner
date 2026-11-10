/**
 * 「更多」分頁與行程設定的純邏輯（無 React），有測試（model.test.ts）。
 * - 行程設定表單：初始值、驗證、套用到行程（含日期平移、「第 N 天」換算）
 * - 顯示格式：同步時間、匯率預覽、檔名、平台名稱
 */
import { addDays, diffDays, parseISODate } from '@/domain/dates';
import type { ISODate, Trip } from '@/domain/types';

const pad = (n: number) => String(n).padStart(2, '0');

/* ------------------------------------------------------------------ */
/* 顯示格式                                                             */
/* ------------------------------------------------------------------ */

/** 毫秒時間 → 'HH:MM' */
export function fmtClock(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 毫秒時間 → 'M/D HH:MM' */
export function fmtSyncTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${fmtClock(ms)}`;
}

/** 檔名不能有的字元換成 - ，空白名稱用預設值 */
export function safeFileName(name: string, fallback = '旅途手帳'): string {
  const s = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim();
  return s || fallback;
}

/** 'travel-planner-backup-YYYYMMDD.json' */
export function backupFileName(now: Date = new Date()): string {
  return `travel-planner-backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.json`;
}

/** 目前執行環境的中文名稱 */
export function platformLabel(native: boolean, standalone: boolean): string {
  if (native) return '原生 App';
  if (standalone) return '已安裝的 PWA';
  return '瀏覽器';
}

/** 行程日期摘要：'11/21 – 11/25 · 5 天'；只有出發日：'11/21 出發'；沒日期：'尚未設定日期' */
export function tripDateSummary(t: Pick<Trip, 'startDate' | 'endDate'>): string {
  const s = parseISODate(t.startDate), e = parseISODate(t.endDate);
  const md = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
  if (s && e && t.endDate! >= t.startDate!) return `${md(s)} – ${md(e)} · ${diffDays(t.startDate!, t.endDate!) + 1} 天`;
  if (s) return `${md(s)} 出發`;
  return '尚未設定日期';
}

const CURRENCY_NAMES: Record<string, string> = {
  TWD: '新台幣', JPY: '日圓', KRW: '韓元', USD: '美元', EUR: '歐元', GBP: '英鎊', HKD: '港幣', CNY: '人民幣', THB: '泰銖',
  SGD: '新加坡幣', VND: '越南盾', AUD: '澳幣', CAD: '加幣', CHF: '瑞士法郎', MYR: '馬幣', PHP: '菲律賓披索', IDR: '印尼盾',
  MOP: '澳門幣', NZD: '紐西蘭幣',
};
/** 'JPY 日圓'；不認得的代碼只顯示代碼 */
export const currencyLabel = (code: string) => (CURRENCY_NAMES[code] ? `${code} ${CURRENCY_NAMES[code]}` : code);

/** 下拉選單的幣別清單：常用清單＋目前值（不在清單裡時補上） */
export function currencyChoices(common: readonly string[], ...current: (string | undefined)[]): string[] {
  const out = [...common];
  for (const c of current) if (c && !out.includes(c)) out.unshift(c);
  return out;
}

/** 匯率取 4 位有效數字放進輸入框（0.21043 → '0.2104'、31.523 → '31.52'） */
export function fmtRateInput(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return '';
  return String(Number(rate.toPrecision(4)));
}

/** 匯率預覽：選一個好讀的金額，例如 JPY→TWD 0.21 → { amount: 100, converted: 21 } */
export function ratePreview(rate: number): { amount: number; converted: number } | null {
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const amount = rate >= 1 ? 1 : 10 ** (Math.ceil(Math.log10(1 / rate)) + 1);
  return { amount, converted: amount * rate };
}

/** 使用者輸入的數字（允許全形、千分位逗號）；空白回傳 null，無法辨識回傳 NaN */
export function parseDecimal(input: string): number | null {
  const s = input.normalize('NFKC').replace(/[,\s]/g, '');
  if (!s) return null;
  if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return NaN;
  return Number(s);
}

/* ------------------------------------------------------------------ */
/* 行程設定表單                                                          */
/* ------------------------------------------------------------------ */

export interface TripForm {
  name: string;
  city: string;
  routeCode: string;
  /** '' = 未設定 */
  startDate: ISODate;
  endDate: ISODate;
  localCurrency: string;
  homeCurrency: string;
  rate: string;
  /** 按「更新即時匯率」的時間；手動改匯率時清掉 */
  rateUpdatedAt?: number;
  budget: string;
  members: string[];
  /** 改出發日時，行程點是否跟著平移 */
  shiftItems: boolean;
}

export function initialForm(t: Trip): TripForm {
  return {
    name: t.name,
    city: t.city,
    routeCode: t.routeCode ?? '',
    startDate: t.startDate ?? '',
    endDate: t.endDate ?? '',
    localCurrency: t.localCurrency,
    homeCurrency: t.homeCurrency,
    rate: fmtRateInput(t.rate) || '1',
    rateUpdatedAt: t.rateUpdatedAt,
    budget: t.budget ? String(t.budget) : '',
    members: t.members.length ? [...t.members] : ['我'],
    shiftItems: true,
  };
}

/** 表單是否和初始值不同（決定關閉時要不要確認） */
export function formDirty(a: TripForm, b: TripForm): boolean {
  const pick = (f: TripForm) => [f.name, f.city, f.routeCode, f.startDate, f.endDate, f.localCurrency, f.homeCurrency, f.rate, f.budget, f.members.join('\u0001')];
  return pick(a).some((v, i) => v !== pick(b)[i]);
}

export type FormErrors = Partial<Record<'name' | 'dates' | 'rate' | 'budget' | 'members', string>>;

/** 最長天數（tripDays 最多展開 90 天） */
export const MAX_TRIP_DAYS = 90;

export function validateForm(f: TripForm): FormErrors {
  const e: FormErrors = {};
  if (!f.name.trim()) e.name = '請輸入行程名稱，例如「京都五日」。';
  if (f.endDate && !f.startDate) e.dates = '請先填出發日，再填回程日。';
  else if (f.startDate && f.endDate && f.endDate < f.startDate) e.dates = '回程日不能早於出發日，請改一下其中一天。';
  else if (f.startDate && f.endDate && diffDays(f.startDate, f.endDate) + 1 > MAX_TRIP_DAYS) e.dates = `一趟行程最長 ${MAX_TRIP_DAYS} 天，請縮短日期範圍。`;
  const rate = parseDecimal(f.rate);
  if (f.localCurrency !== f.homeCurrency && (rate == null || !Number.isFinite(rate) || rate <= 0))
    e.rate = '匯率要是大於 0 的數字，或按「更新即時匯率」自動填入。';
  const budget = parseDecimal(f.budget);
  if (budget != null && !Number.isFinite(budget)) e.budget = '預算只能填數字，例如 45000；不需要可以留白。';
  if (!f.members.some((m) => m.trim())) e.members = '至少要有一位旅伴（可以只有你自己）。';
  return e;
}

type ShiftTrip = Pick<Trip, 'startDate' | 'endDate' | 'items' | 'expenses'>;

/** 原本的行程期間（出發日～回程日；沒有回程日時到最後一個行程點） */
function oldRange(trip: ShiftTrip): [ISODate, ISODate] | null {
  if (!trip.startDate) return null;
  const last = lastItemDate(trip.items);
  let end = trip.endDate ?? (last && last > trip.startDate ? last : trip.startDate);
  if (end < trip.startDate) end = trip.startDate;
  return [trip.startDate, end];
}

const lastItemDate = (items: Trip['items']): ISODate | undefined =>
  items
    .map((i) => i.date)
    .filter((x): x is string => !!x)
    .sort()
    .pop();

export interface ShiftPlan {
  /** 平移幾天（0 = 沒有東西要移） */
  days: number;
  /** 有日期的行程點數 */
  items: number;
  /** 在原本行程期間內的記帳筆數（期間外的不動） */
  expenses: number;
}

/** 出發日從 trip.startDate 改到 next 時，要一起平移的行程點與記帳 */
export function shiftPlanFor(trip: ShiftTrip, next: ISODate): ShiftPlan {
  const none = { days: 0, items: 0, expenses: 0 };
  if (!trip.startDate || !next || trip.startDate === next) return none;
  const range = oldRange(trip);
  const items = trip.items.filter((i) => i.date).length;
  const expenses = range ? trip.expenses.filter((e) => e.date >= range[0] && e.date <= range[1]).length : 0;
  if (!items && !expenses) return none;
  return { days: diffDays(trip.startDate, next), items, expenses };
}

/** 出發日從 old 改到 next 時，行程點要平移幾天（沒有可平移的就回傳 0） */
export function shiftDaysFor(trip: ShiftTrip, next: ISODate): number {
  return shiftPlanFor(trip, next).days;
}

/**
 * 改出發日時回程日的建議值：行程點跟著移動時，回程日也移動同樣天數（行程天數不變）。
 * 沒有原本的出發日／回程日、或出發日清空時，維持原本的回程日。
 */
export function shiftedEndDate(initial: Pick<TripForm, 'startDate' | 'endDate'>, nextStart: ISODate, follow: boolean): ISODate {
  if (!follow || !initial.startDate || !initial.endDate || !nextStart) return initial.endDate;
  return addDays(initial.endDate, diffDays(initial.startDate, nextStart));
}

export interface ApplyContext {
  /** 城市有改時新的定位結果；undefined = 找不到或連線失敗（清掉舊座標，之後天氣會再自動定位） */
  cityGeo?: Trip['cityGeo'];
  /**
   * 表單打開時的值。匯率欄位沒動過時，不要用表單裡的舊匯率蓋掉背景剛查到的匯率
   * （新行程先用 1，背景查到即時匯率才寫入）。
   */
  initial?: Pick<TripForm, 'rate' | 'rateUpdatedAt' | 'localCurrency' | 'homeCurrency'>;
}

/**
 * 把表單套用到行程複本（在 mutateTrip 裡呼叫）。
 * - 出發日改了且 shiftItems：有日期的行程點與 AI 排程檢查一起平移
 * - 有「第 N 天」的行程點且已有出發日：換算成日期
 * - 移除範例標記
 */
export function applyForm(d: Trip, f: TripForm, ctx: ApplyContext = {}): void {
  const city = f.city.trim();
  if (city !== d.city.trim()) {
    d.cityGeo = ctx.cityGeo ? { ...ctx.cityGeo } : undefined;
    d.weather = undefined;
  }
  d.city = city;
  d.name = f.name.trim();
  d.routeCode = f.routeCode.trim() || undefined;

  const start = f.startDate || null;
  const shift = f.shiftItems && start ? shiftDaysFor(d, start) : 0;
  if (shift) {
    const range = oldRange(d);
    for (const it of d.items) if (it.date) it.date = addDays(it.date, shift);
    // 原本行程期間內的記帳一起移動（出發前訂房、回國後的花費不動）
    if (range) for (const e of d.expenses) if (e.date >= range[0] && e.date <= range[1]) e.date = addDays(e.date, shift);
    const checks: Trip['ai']['dayChecks'] = {};
    for (const [date, c] of Object.entries(d.ai.dayChecks)) checks[addDays(date, shift)] = c;
    d.ai.dayChecks = checks;
  }
  d.startDate = start;
  d.endDate = f.endDate || null;
  if (shift && start) {
    // 保險：回程日至少要涵蓋移動後的最後一個行程點（只往後延，不動出發日）
    const last = lastItemDate(d.items);
    if (last && last >= start && (!d.endDate || last > d.endDate)) d.endDate = last;
  }

  if (start) {
    for (const it of d.items) {
      if (it.dayOffset == null) continue;
      if (!it.date) it.date = addDays(start, Math.max(1, Math.round(it.dayOffset)) - 1);
      delete it.dayOffset;
    }
    // 沒填回程日：讓日期涵蓋換算後的行程點
    if (!d.endDate) {
      const last = d.items.map((i) => i.date).filter((x): x is string => !!x).sort().pop();
      if (last && last > start) d.endDate = last;
    }
  }

  const currencyChanged = d.localCurrency !== f.localCurrency || d.homeCurrency !== f.homeCurrency;
  d.localCurrency = f.localCurrency;
  d.homeCurrency = f.homeCurrency;
  if (f.localCurrency === f.homeCurrency) {
    if (d.rate !== 1 || currencyChanged) d.rateUpdatedAt = f.rateUpdatedAt;
    d.rate = 1;
  } else {
    const init = ctx.initial;
    // 匯率欄位沒動過（或跟目前存的一樣）：保留行程上的匯率與更新時間，背景剛查到的即時匯率不會被表單的舊值蓋掉
    const untouched =
      !currencyChanged &&
      (f.rate === fmtRateInput(d.rate) ||
        (!!init && init.localCurrency === f.localCurrency && init.homeCurrency === f.homeCurrency && init.rate === f.rate && init.rateUpdatedAt === f.rateUpdatedAt));
    const rate = parseDecimal(f.rate) ?? NaN;
    if (!untouched && Number.isFinite(rate) && rate > 0) {
      if (rate !== d.rate || currencyChanged) d.rateUpdatedAt = f.rateUpdatedAt;
      d.rate = rate;
    }
  }
  const budget = parseDecimal(f.budget);
  d.budget = budget != null && Number.isFinite(budget) && budget > 0 ? budget : undefined;

  const members = [...new Set(f.members.map((m) => m.trim()).filter(Boolean))];
  d.members = members.length ? members : ['我'];
  delete d.isExample;
}

/** 新增旅伴前的檢查；回傳錯誤訊息或 null */
export function memberError(name: string, members: string[]): string | null {
  const n = name.trim();
  if (!n) return '請輸入旅伴的名字。';
  if (n.length > 20) return '名字最多 20 個字。';
  if (members.includes(n)) return `已經有「${n}」了，換個名字或加上暱稱。`;
  return null;
}

/** 這位旅伴有幾筆記帳（付款或分攤） */
export function memberExpenseCount(trip: Pick<Trip, 'expenses'>, name: string): number {
  return trip.expenses.filter((e) => e.payer === name || e.split.includes(name)).length;
}

/**
 * 照片的 IndexedDB key（store/persist.ts 的 blobStore.put 產生，例如 'blob:lx3k9a2b7c'）。
 * 照片和 App 資料存在同一個資料庫：不是這個格式的 key 一律不讀、不刪，
 * 避免備份檔裡的假 key（例如 'travel-planner'）刪掉整份資料。
 */
export const isBlobKey = (k: unknown): k is string => typeof k === 'string' && /^blob:[a-z0-9]+$/.test(k);

/** 刪除行程時可以清掉的照片（其他行程沒有用到的） */
export function orphanBlobKeys(trip: Trip, others: Trip[]): string[] {
  const keys = new Set<string>();
  if (trip.cover.kind === 'image' && isBlobKey(trip.cover.blobKey)) keys.add(trip.cover.blobKey);
  for (const e of trip.expenses) if (isBlobKey(e.receiptBlobKey)) keys.add(e.receiptBlobKey);
  for (const o of others) {
    if (o.id === trip.id) continue;
    if (o.cover.blobKey) keys.delete(o.cover.blobKey);
    for (const e of o.expenses) if (e.receiptBlobKey) keys.delete(e.receiptBlobKey);
  }
  return [...keys];
}
