import type { Expense, ExpenseCategory, ISODate, Trip } from './types';

/** 金額換算成本國貨幣 */
export function toHome(trip: Pick<Trip, 'homeCurrency' | 'localCurrency' | 'rate'>, amount: number, currency: string): number {
  if (!Number.isFinite(amount)) return 0;
  if (currency === trip.homeCurrency) return amount;
  if (currency === trip.localCurrency) return amount * (trip.rate || 1);
  // 其他幣別：沒有匯率資料時以 1:1 計（UI 會提示）
  return amount;
}

export const expenseHome = (trip: Trip, e: Expense) => toHome(trip, e.amount, e.currency);

export function totalHome(trip: Trip, filter?: (e: Expense) => boolean): number {
  return trip.expenses.filter(filter ?? (() => true)).reduce((s, e) => s + expenseHome(trip, e), 0);
}

export const dayTotalHome = (trip: Trip, date: ISODate) => totalHome(trip, (e) => e.date === date);

export function byCategory(trip: Trip): { key: ExpenseCategory; total: number }[] {
  const m = new Map<ExpenseCategory, number>();
  for (const e of trip.expenses) m.set(e.category, (m.get(e.category) ?? 0) + expenseHome(trip, e));
  return [...m.entries()].map(([key, total]) => ({ key, total })).filter((x) => x.total > 0).sort((a, b) => b.total - a.total);
}

/** 每人淨額（正數＝別人欠他） */
export function balances(trip: Trip): Record<string, number> {
  const members = trip.members.length ? trip.members : ['我'];
  const bal: Record<string, number> = Object.fromEntries(members.map((m) => [m, 0]));
  for (const e of trip.expenses) {
    const amt = expenseHome(trip, e);
    const sharers = (e.split.length ? e.split : members).filter((m) => m in bal);
    if (!sharers.length) continue;
    if (e.payer in bal) bal[e.payer] += amt;
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
