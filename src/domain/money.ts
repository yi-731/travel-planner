import type { Expense, ExpenseCategory, ISODate, Trip } from './types';

/** 換算需要的欄位 */
export type RateTrip = Pick<Trip, 'homeCurrency' | 'localCurrency' | 'rate' | 'rates'>;

const validRate = (r: unknown): r is number => typeof r === 'number' && Number.isFinite(r) && r > 0;

/**
 * 任意值 → 只留有效匯率的 rates（三碼幣別、正的有限數字），壞掉的值直接略過。
 * 讀備份檔或寫入 rates 前用它整理。
 */
export function sanitizeRates(rates: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!rates || typeof rates !== 'object' || Array.isArray(rates)) return out;
  for (const [c, r] of Object.entries(rates)) if (/^[A-Z]{3}$/.test(c) && validRate(r)) out[c] = r;
  return out;
}

/**
 * 1 單位 currency = ? 單位本國貨幣。
 * 本國貨幣 = 1；當地貨幣用 trip.rate；其他幣別查 trip.rates；都沒有回傳 null（尚未換算）。
 */
export function rateFor(trip: RateTrip, currency: string): number | null {
  if (currency === trip.homeCurrency) return 1;
  if (currency === trip.localCurrency) return validRate(trip.rate) ? trip.rate : 1;
  const rs: unknown = trip.rates;
  const r = rs && typeof rs === 'object' && Object.prototype.hasOwnProperty.call(rs, currency) ? (rs as Record<string, unknown>)[currency] : undefined;
  return validRate(r) ? r : null;
}

/** 這個幣別能換算成本國貨幣（本國、當地，或 rates 裡查得到） */
export const hasRate = (trip: RateTrip, currency: string) => rateFor(trip, currency) != null;

/**
 * 金額換算成本國貨幣。
 * 沒有匯率的幣別回傳 null：不要當成 1:1（5,600 JPY 不是 5,600 TWD）。
 */
export function toHome(trip: RateTrip, amount: number, currency: string): number | null {
  if (!Number.isFinite(amount)) return 0;
  const r = rateFor(trip, currency);
  return r == null ? null : amount * r;
}

/** 這筆花費能換算成本國貨幣 */
export const isConverted = (trip: RateTrip, e: Pick<Expense, 'currency'>) => hasRate(trip, e.currency);

/**
 * 一筆花費的本國貨幣金額。尚未換算的花費回傳 0，所以不會算進任何總額、分類或分帳；
 * 畫面上要分辨「0」和「尚未換算」請用 isConverted。
 */
export const expenseHome = (trip: RateTrip, e: Pick<Expense, 'amount' | 'currency'>) => toHome(trip, e.amount, e.currency) ?? 0;

export function totalHome(trip: Trip, filter?: (e: Expense) => boolean): number {
  return trip.expenses.filter(filter ?? (() => true)).reduce((s, e) => s + expenseHome(trip, e), 0);
}

export const dayTotalHome = (trip: Trip, date: ISODate) => totalHome(trip, (e) => e.date === date);

/** 尚未換算（幣別沒有匯率）的花費筆數；這些花費不在總額裡 */
export const unconvertedCount = (trip: RateTrip & Pick<Trip, 'expenses'>) => trip.expenses.filter((e) => !isConverted(trip, e)).length;

/** 缺匯率的幣別（筆數多的在前），給「查詢匯率」用 */
export function missingRateCurrencies(trip: RateTrip & Pick<Trip, 'expenses'>): string[] {
  const m = new Map<string, number>();
  for (const e of trip.expenses) if (!isConverted(trip, e)) m.set(e.currency, (m.get(e.currency) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

/**
 * 行程的當地／本國貨幣改了之後，讓已記的花費維持原本的換算結果（直接改 next）：
 * - 只改當地貨幣：舊的當地貨幣匯率（prev.rate）存進 rates，舊花費照原本的匯率算。
 * - 改了本國貨幣：rates 都是用舊本國貨幣計價，要換算成新的本國貨幣。
 *   「1 舊本國 = ? 新本國」從已知匯率推得出來就一起換算，並把舊本國貨幣也存進 rates；
 *   推不出來就清掉 rates，那些花費會顯示「尚未換算」，之後再查匯率。
 * 幣別沒變時不做任何事。
 */
export function carryRates(prev: RateTrip, next: RateTrip): void {
  if (prev.localCurrency === next.localCurrency && prev.homeCurrency === next.homeCurrency) return;

  // 改之前所有已知匯率（以舊本國貨幣計價）
  const known = sanitizeRates(prev.rates);
  if (prev.localCurrency !== prev.homeCurrency && validRate(prev.rate)) known[prev.localCurrency] = prev.rate;

  // 1 舊本國貨幣 = factor 新本國貨幣
  let factor: number | null = null;
  if (prev.homeCurrency === next.homeCurrency) factor = 1;
  else if (validRate(known[next.homeCurrency])) factor = 1 / known[next.homeCurrency];
  else if (prev.localCurrency === next.localCurrency && next.localCurrency !== next.homeCurrency && validRate(prev.rate) && validRate(next.rate))
    factor = next.rate / prev.rate;

  const out: Record<string, number> = {};
  if (factor != null) {
    for (const [c, r] of Object.entries(known)) out[c] = r * factor;
    if (prev.homeCurrency !== next.homeCurrency) out[prev.homeCurrency] = factor;
  }
  // 本國貨幣固定是 1、當地貨幣用 trip.rate，不必放在 rates
  delete out[next.homeCurrency];
  delete out[next.localCurrency];
  if (Object.keys(out).length) next.rates = out;
  else delete next.rates;
}

export function byCategory(trip: Trip): { key: ExpenseCategory; total: number }[] {
  const m = new Map<ExpenseCategory, number>();
  for (const e of trip.expenses) {
    if (!isConverted(trip, e)) continue;
    m.set(e.category, (m.get(e.category) ?? 0) + expenseHome(trip, e));
  }
  return [...m.entries()].map(([key, total]) => ({ key, total })).filter((x) => x.total > 0).sort((a, b) => b.total - a.total);
}

/**
 * 每人淨額（正數＝別人欠他），各人加總永遠是 0。
 * - 付款人已不在成員名單（被移除或改名）：整筆不算。
 * - 分攤者有人被移除：由還在名單上的分攤者平分；都不在就整筆不算。
 * - 尚未換算的花費不算。
 */
export function balances(trip: Trip): Record<string, number> {
  const members = trip.members.length ? trip.members : ['我'];
  const isMember = new Set(members);
  const bal: Record<string, number> = Object.fromEntries(members.map((m) => [m, 0]));
  for (const e of trip.expenses) {
    if (!isMember.has(e.payer) || !isConverted(trip, e)) continue;
    const sharers = (e.split.length ? e.split : members).filter((m) => isMember.has(m));
    if (!sharers.length) continue;
    const amt = expenseHome(trip, e);
    bal[e.payer] += amt;
    for (const m of sharers) bal[m] -= amt / sharers.length;
  }
  return bal;
}

export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

/** 最少轉帳次數的結算（貪婪法），忽略 0.5 以下零頭 */
export function settle(trip: Trip): Transfer[] {
  const bal = balances(trip);
  const debtors = Object.entries(bal).filter(([, v]) => v < -0.5).map(([k, v]) => ({ k, v: -v })).sort((a, b) => b.v - a.v);
  const creditors = Object.entries(bal).filter(([, v]) => v > 0.5).map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);
  const out: Transfer[] = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amt = Math.min(debtors[i].v, creditors[j].v);
    out.push({ from: debtors[i].k, to: creditors[j].k, amount: amt });
    debtors[i].v -= amt;
    creditors[j].v -= amt;
    if (debtors[i].v < 0.5) i++;
    if (creditors[j].v < 0.5) j++;
  }
  return out;
}

const nf0 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 });
/** 千分位；有小數才顯示小數 */
export const fmtMoney = (n: number | undefined | null) => {
  const v = Number(n) || 0;
  return Math.abs(v % 1) > 0.001 && Math.abs(v) < 1000 ? nf2.format(v) : nf0.format(v);
};
