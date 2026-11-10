/**
 * 天氣頁的純邏輯（不含 React）：溫度條位置、降雨文字、更新時間、多城市行程依城市分組。
 */
import { toISODate } from '@/domain/dates';
import type { DailyWeather, ISODate } from '@/domain/types';
import { findCityAlias } from '@/services/weather';

export interface TempScale {
  lo: number;
  hi: number;
}

/** 整趟旅程的最低～最高溫（溫度條的刻度範圍）；沒有資料回傳 null */
export function tempScale(days: Pick<DailyWeather, 'tMin' | 'tMax'>[]): TempScale | null {
  const ok = days.filter((d) => Number.isFinite(d.tMin) && Number.isFinite(d.tMax));
  if (!ok.length) return null;
  const lo = Math.floor(Math.min(...ok.map((d) => Math.min(d.tMin, d.tMax))));
  let hi = Math.ceil(Math.max(...ok.map((d) => Math.max(d.tMin, d.tMax))));
  if (hi - lo < 1) hi = lo + 1;
  return { lo, hi };
}

/** 一天的溫度區段在刻度上的位置（百分比，從左、從右算） */
export function barInset(day: Pick<DailyWeather, 'tMin' | 'tMax'>, scale: TempScale): { left: number; right: number } {
  const span = scale.hi - scale.lo;
  const a = Math.min(day.tMin, day.tMax), b = Math.max(day.tMin, day.tMax);
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  let left = clamp(((a - scale.lo) / span) * 100);
  let right = clamp(((scale.hi - b) / span) * 100);
  // 溫差很小時至少留一小段，看得出位置
  const MIN = 8;
  if (100 - left - right < MIN) {
    const mid = (left + (100 - right)) / 2;
    left = clamp(mid - MIN / 2);
    right = clamp(100 - (left + MIN));
  }
  return { left: round1(left), right: round1(right) };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** 降雨：預報顯示機率（10% 以上才顯示），歷年平均顯示雨量（0.5 mm 以上） */
export function rainText(day: Pick<DailyWeather, 'rainProb' | 'rainMm'>): string {
  if (day.rainProb != null && Number.isFinite(day.rainProb)) return day.rainProb >= 10 ? `${Math.round(day.rainProb)}%` : '';
  if (day.rainMm != null && Number.isFinite(day.rainMm)) return day.rainMm >= 0.5 ? `${day.rainMm >= 10 ? Math.round(day.rainMm) : round1(day.rainMm)} mm` : '';
  return '';
}

/** 焦點卡的降雨說明（含 0%） */
export function rainLong(day: Pick<DailyWeather, 'rainProb' | 'rainMm'>): { label: string; value: string } | null {
  if (day.rainProb != null && Number.isFinite(day.rainProb)) return { label: '降雨機率', value: `${Math.round(day.rainProb)}%` };
  if (day.rainMm != null && Number.isFinite(day.rainMm)) return { label: '平均雨量', value: `${day.rainMm >= 10 ? Math.round(day.rainMm) : round1(day.rainMm)} mm` };
  return null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 更新時間：今天只顯示 HH:MM，其他日子加上 M/D */
export function fmtUpdated(ms: number, now: Date = new Date()): string {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return '';
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return toISODate(d) === toISODate(now) ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

/** 'M/D（週X）' */
export function fmtDayLabel(md: string, wd: string): string {
  return wd ? `${md}（週${wd}）` : md;
}

/* ---------------- 多城市 ---------------- */

const normName = (s: string) => s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

/** 是不是同一個城市（「拉斯維加斯」＝「Las Vegas」＝「LAS VEGAS」，用城市對照表判斷） */
export function sameCityName(a: string | undefined | null, b: string | undefined | null): boolean {
  const x = a?.trim(), y = b?.trim();
  if (!x || !y) return false;
  if (normName(x) === normName(y)) return true;
  const ax = findCityAlias(x);
  return !!ax && ax === findCityAlias(y);
}

/** 去掉重複（同一個城市的不同寫法算重複），保留第一次出現的寫法與順序 */
export function distinctCities(cities: (string | undefined | null)[]): string[] {
  const out: string[] = [];
  for (const c of cities) {
    const t = c?.trim();
    if (t && !out.some((u) => sameCityName(u, t))) out.push(t);
  }
  return out;
}

export interface CityGroup {
  /** 城市（顯示用）；不知道時是空字串 */
  city: string;
  dates: ISODate[];
}

/** 連續在同一個城市的日子分成一組（天氣列表的小標題）；不知道城市的日子併進前一組 */
export function groupByCity(dates: ISODate[], cityOf: (d: ISODate) => string | undefined | null): CityGroup[] {
  const out: CityGroup[] = [];
  for (const d of dates) {
    const c = cityOf(d)?.trim() ?? '';
    const last = out[out.length - 1];
    if (last && (!c || !last.city || sameCityName(last.city, c))) {
      if (!last.city && c) last.city = c;
      last.dates.push(d);
    } else out.push({ city: c, dates: [d] });
  }
  return out;
}

/** 天氣頁標題上方的城市：「洛杉磯、拉斯維加斯」；三個以上「洛杉磯 等 3 個城市」 */
export function citiesText(cities: string[]): string {
  const uniq = distinctCities(cities);
  if (uniq.length <= 2) return uniq.join('、');
  return `${uniq[0]} 等 ${uniq.length} 個城市`;
}
