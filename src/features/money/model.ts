/**
 * 記帳頁的純邏輯（不含 React）：總覽數字、分類比例、分帳表、明細分組、金額解析。
 * 換算一律用 domain/money.ts 的 toHome / expenseHome，這裡只做整理與彙總。
 */
import { COMMON_CURRENCIES, EXPENSE_CATEGORIES, expenseCategory } from '@/domain/constants';
import { fmtMD, toISODate, today, tripDays, tripPhase, weekday } from '@/domain/dates';
import { byCategory, dayTotalHome, expenseHome, totalHome } from '@/domain/money';
import type { Expense, ExpenseCategory, ISODate, Trip } from '@/domain/types';

/* ---------------- 總覽卡 ---------------- */

export interface MoneySummary {
  total: number;
  today: number;
  /** 平均每天花費（旅途中＝已過天數；結束後＝全程天數；出發前＝有花費的天數） */
  dailyAvg: number;
  budget: number | null;
  /** 預算剩餘；超支時為負數 */
  remaining: number | null;
  /** 已用預算比例 0～∞（1 = 100%） */
  used: number | null;
  over: boolean;
}

export function summarize(trip: Trip, now: ISODate = today()): MoneySummary {
  const total = totalHome(trip);
  const ph = tripPhase(trip, now);
  let days: number;
  if (ph.phase === 'during') days = ph.dayIndex + 1;
  else if (ph.phase === 'after') days = ph.days.length;
  else days = new Set(trip.expenses.map((e) => e.date)).size;
  const budget = trip.budget && trip.budget > 0 ? trip.budget : null;
  const remaining = budget != null ? budget - total : null;
  return {
    total,
    today: dayTotalHome(trip, now),
    dailyAvg: total / Math.max(1, days),
    budget,
    remaining,
    used: budget != null ? total / budget : null,
    over: remaining != null && remaining < -0.005,
  };
}

/* ---------------- 分類 ---------------- */

export interface CategorySlice {
  key: ExpenseCategory;
  label: string;
  /** CSS 變數名，例如 --t-food */
  color: string;
  total: number;
  /** 顯示用整數百分比（最大餘數法，總和 = 100） */
  pct: number;
  /** 長條圖用的精確比例 0～1 */
  share: number;
}

export function categorySlices(trip: Trip): CategorySlice[] {
  const rows = byCategory(trip);
  const sum = rows.reduce((s, r) => s + r.total, 0);
  if (sum <= 0) return [];
  const pcts = roundPercents(rows.map((r) => r.total / sum));
  return rows.map((r, i) => {
    const c = expenseCategory(r.key);
    return { key: r.key, label: c.label, color: c.color, total: r.total, pct: pcts[i], share: r.total / sum };
  });
}

/** 比例陣列 → 加總剛好 100 的整數百分比 */
export function roundPercents(shares: number[]): number[] {
  const raw = shares.map((x) => x * 100);
  const floor = raw.map(Math.floor);
  let left = 100 - floor.reduce((s, x) => s + x, 0);
  const order = raw.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (left <= 0) break;
    floor[i]++;
    left--;
  }
  return floor;
}

/* ---------------- 分帳 ---------------- */

export interface MemberRow {
  name: string;
  /** 這個人實際付出的（本國貨幣） */
  paid: number;
  /** 這個人應分攤的 */
  share: number;
  /** paid - share；正數＝別人要還他 */
  net: number;
}

/** 與 domain/money.ts 的 balances() 同一套規則（不在成員名單裡的付款人／分攤者略過） */
export function memberRows(trip: Trip): MemberRow[] {
  const members = trip.members.length ? trip.members : ['我'];
  const rows = new Map(members.map((m) => [m, { name: m, paid: 0, share: 0, net: 0 }]));
  for (const e of trip.expenses) {
    const amt = expenseHome(trip, e);
    const sharers = (e.split.length ? e.split : members).filter((m) => rows.has(m));
    if (!sharers.length) continue;
    const payer = rows.get(e.payer);
    if (payer) payer.paid += amt;
    for (const m of sharers) rows.get(m)!.share += amt / sharers.length;
  }
  return [...rows.values()].map((r) => ({ ...r, net: r.paid - r.share }));
}

/* ---------------- 明細 ---------------- */

export interface DayGroup {
  date: ISODate;
  total: number;
  expenses: Expense[];
}

/** 依日期分組：新的日期在上；同一天內後記的在上 */
export function groupByDate(trip: Trip): DayGroup[] {
  const m = new Map<ISODate, Expense[]>();
  for (const e of trip.expenses) {
    const list = m.get(e.date);
    if (list) list.push(e);
    else m.set(e.date, [e]);
  }
  return [...m.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([date, list]) => ({
      date,
      total: list.reduce((s, e) => s + expenseHome(trip, e), 0),
      expenses: [...list].sort((a, b) => b.createdAt - a.createdAt),
    }));
}

/** 11/21（週六） */
export const fmtDayHead = (d: ISODate) => (fmtMD(d) ? `${fmtMD(d)}（週${weekday(d)}）` : d);

/** 第 N 天（不在旅程日期內回傳 null） */
export function dayNumber(trip: Pick<Trip, 'startDate' | 'endDate' | 'items'>, d: ISODate): number | null {
  const i = tripDays(trip).indexOf(d);
  return i >= 0 ? i + 1 : null;
}

/* ---------------- 匯率與幣別 ---------------- */

const rateNf = new Intl.NumberFormat('zh-TW', { maximumSignificantDigits: 4 });
export const fmtRate = (r: number) => rateNf.format(Number.isFinite(r) && r > 0 ? r : 1);

/** 頁首小字：1 JPY = 0.21 TWD · 更新於 11/9 */
export function rateLine(trip: Pick<Trip, 'localCurrency' | 'homeCurrency' | 'rate' | 'rateUpdatedAt'>): string {
  if (trip.localCurrency === trip.homeCurrency) return `以 ${trip.homeCurrency} 記帳`;
  const base = `1 ${trip.localCurrency} = ${fmtRate(trip.rate)} ${trip.homeCurrency}`;
  return trip.rateUpdatedAt ? `${base} · 更新於 ${fmtMD(toISODate(new Date(trip.rateUpdatedAt)))}` : base;
}

/** 這個幣別有匯率可換算（當地或本國貨幣） */
export const hasRate = (trip: Pick<Trip, 'localCurrency' | 'homeCurrency'>, currency: string) =>
  currency === trip.localCurrency || currency === trip.homeCurrency;

/** 幣別選單：當地、本國、常用幣別，再加上目前值（例如 AI 讀到的少見幣別），不重複 */
export function currencyOptions(trip: Pick<Trip, 'localCurrency' | 'homeCurrency'>, current?: string): string[] {
  const list = [trip.localCurrency, trip.homeCurrency, ...(current ? [current] : []), ...COMMON_CURRENCIES];
  return [...new Set(list.filter((c) => /^[A-Z]{3}$/.test(c)))];
}

/* ---------------- 表單 ---------------- */

/**
 * 解析使用者輸入的金額：接受千分位逗號、全形數字與小數點；
 * 空字串、非數字、0 或負數回傳 null。
 */
export function parseAmount(input: string): number | null {
  const half = input
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, '.')
    .replace(/[,，\s]/g, '');
  if (!/^\d*\.?\d+$|^\d+\.$/.test(half)) return null;
  const n = Number(half);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

/** 輸入框只保留數字、一個小數點（貼上「¥1,280」也能用） */
export function sanitizeAmountInput(input: string): string {
  const half = input
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, '.')
    .replace(/[^\d.]/g, '');
  const dot = half.indexOf('.');
  return dot < 0 ? half : half.slice(0, dot + 1) + half.slice(dot + 1).replace(/\./g, '').slice(0, 2);
}

/** 新的一筆預設日期：今天在旅程內就用今天，否則用目前選的日期，再不然第一天 */
export function defaultExpenseDate(trip: Pick<Trip, 'startDate' | 'endDate' | 'items'>, selected: ISODate | null, now: ISODate = today()): ISODate {
  const days = tripDays(trip);
  if (days.includes(now)) return now;
  if (selected && days.includes(selected)) return selected;
  return days[0] ?? now;
}

/** 分攤者正規化：全員或沒選人都存成空陣列（＝全員） */
export function normalizeSplit(members: string[], split: string[]): string[] {
  const valid = split.filter((m) => members.includes(m));
  if (!valid.length || members.every((m) => valid.includes(m))) return [];
  return members.filter((m) => valid.includes(m));
}

export const categoryOptions = EXPENSE_CATEGORIES.map((c) => ({ key: c.key, label: c.label, color: c.color }));
