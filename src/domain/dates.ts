import { WEEKDAYS } from './constants';
import type { HHmm, ISODate, Trip } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

export const toISODate = (d: Date): ISODate => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = (): ISODate => toISODate(new Date());

export function parseISODate(s: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s ?? '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

export function addDays(s: ISODate, n: number): ISODate {
  const d = parseISODate(s);
  if (!d) return s;
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/** b - a 的天數 */
export function diffDays(a: ISODate, b: ISODate): number {
  const da = parseISODate(a), db = parseISODate(b);
  if (!da || !db) return 0;
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

/** 11/20 */
export const fmtMD = (s: string | null | undefined) => {
  const d = parseISODate(s);
  return d ? `${d.getMonth() + 1}/${d.getDate()}` : '';
};
/** 週五 → '五' */
export const weekday = (s: string | null | undefined) => {
  const d = parseISODate(s);
  return d ? WEEKDAYS[d.getDay()] : '';
};
/** 11/20（五） */
export const fmtMDW = (s: string | null | undefined) => (s ? `${fmtMD(s)}（${weekday(s)}）` : '');
/** 11 月 20 日 */
export const fmtLongMD = (s: string | null | undefined) => {
  const d = parseISODate(s);
  return d ? `${d.getMonth() + 1} 月 ${d.getDate()} 日` : '';
};
/** 第幾天：3 → '第 3 天'（所有畫面顯示天數都用這個） */
export const fmtDayNo = (n: number) => `第 ${n} 天`;

export function toMinutes(t: HHmm | undefined | null): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(t ?? '');
  return m ? +m[1] * 60 + +m[2] : null;
}
export function fromMinutes(n: number): HHmm {
  const x = ((Math.round(n) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(x / 60))}:${pad(x % 60)}`;
}
export const nowHHmm = (): HHmm => {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** 行程涵蓋的所有日期（出發日～回程日，再加上行程點出現的日期），排序後回傳 */
export function tripDays(trip: Pick<Trip, 'startDate' | 'endDate' | 'items'>): ISODate[] {
  const set = new Set<ISODate>();
  if (trip.startDate && trip.endDate && trip.endDate >= trip.startDate) {
    let d = trip.startDate;
    for (let i = 0; i < 90 && d <= trip.endDate; i++) {
      set.add(d);
      d = addDays(d, 1);
    }
  } else if (trip.startDate) set.add(trip.startDate);
  for (const it of trip.items) if (it.date) set.add(it.date);
  return [...set].sort();
}

export type TripPhase =
  | { phase: 'none'; days: ISODate[]; focusDay: null }
  | { phase: 'before'; days: ISODate[]; focusDay: ISODate; daysUntil: number }
  | { phase: 'during'; days: ISODate[]; focusDay: ISODate; dayIndex: number }
  | { phase: 'after'; days: ISODate[]; focusDay: ISODate };

/** 旅程目前處於出發前／旅途中／結束後，以及首頁要聚焦哪一天 */
export function tripPhase(trip: Pick<Trip, 'startDate' | 'endDate' | 'items'>, now: ISODate = today()): TripPhase {
  const days = tripDays(trip);
  if (!days.length) return { phase: 'none', days, focusDay: null };
  const first = days[0], last = days[days.length - 1];
  if (now < first) return { phase: 'before', days, focusDay: first, daysUntil: diffDays(now, first) };
  if (now > last) return { phase: 'after', days, focusDay: last };
  const focus = days.includes(now) ? now : first;
  return { phase: 'during', days, focusDay: focus, dayIndex: days.indexOf(focus) };
}

/** 「第 N 天」的日期列在還不知道出發日時的 key（存在 Trip.days，設定出發日後用 resolveDayKeys 換成日期） */
export const relDayKey = (n: number) => `__D${n}`;
export const REL_DAY_KEY = /^__D(\d{1,3})$/;

/**
 * 把 days 裡「第 N 天」的 key（__D3）依出發日換成日期；沒有出發日就原樣保留。
 * 換算後和既有的日期重複時，以原本就是日期的為準。
 */
export function resolveDayKeys<T>(days: Record<string, T>, start: ISODate | null): Record<string, T> {
  if (!start) return { ...days };
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(days)) if (!REL_DAY_KEY.test(k)) out[k] = v;
  for (const [k, v] of Object.entries(days)) {
    const m = REL_DAY_KEY.exec(k);
    if (!m || +m[1] < 1) continue;
    const date = addDays(start, +m[1] - 1);
    if (!(date in out)) out[date] = v;
  }
  return out;
}
