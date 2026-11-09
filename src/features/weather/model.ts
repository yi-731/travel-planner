/**
 * 天氣頁的純邏輯（不含 React）：溫度條位置、降雨文字、更新時間。
 */
import { toISODate } from '@/domain/dates';
import type { DailyWeather } from '@/domain/types';

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
