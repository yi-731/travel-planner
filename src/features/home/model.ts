/**
 * 首頁（今天）用的純邏輯：標題列文字、下一站、移動資訊、花費摘要。
 * 沒有 React，方便寫測試（model.test.ts）。改首頁顯示規則時先改這裡。
 */
import { fmtMD, toMinutes, weekday, type TripPhase } from '@/domain/dates';
import { totalHome, dayTotalHome } from '@/domain/money';
import type { SegmentInfo } from '@/domain/schedule';
import type { ISODate, Item, Trip } from '@/domain/types';
import type { IconName } from '@/ui/Icon';
import { weatherInfo } from '@/services/weather';

/** 中日韓文字（決定城市名用襯線大字或系統粗體） */
const CJK = /[぀-ヿ㐀-鿿豈-﫿가-힯]/;
export const hasCJK = (s: string) => CJK.test(s);

/** 11/21（週六） */
export const fmtMDWeek = (d: ISODate) => `${fmtMD(d)}（週${weekday(d)}）`;

/** 城市名上方的一行小字 */
export function eyebrowText(p: TripPhase): string {
  switch (p.phase) {
    case 'none':
      return '尚未設定日期';
    case 'before':
      return `${p.daysUntil === 1 ? '明天出發' : `${p.daysUntil} 天後出發`} · ${fmtMDWeek(p.focusDay)}`;
    case 'during':
      return `DAY ${p.dayIndex + 1} / ${p.days.length} · ${fmtMDWeek(p.focusDay)}`;
    case 'after':
      return '旅程已結束';
  }
}

/** 首頁大字：城市名，沒有就用行程名稱 */
export const displayCity = (trip: Pick<Trip, 'city' | 'name'>) => trip.city.trim() || trip.name.trim() || '我的旅程';

/** 依字數算城市名要縮到多小才放得下（單位：最長一個字詞的字數） */
export function cityFitLength(name: string): number {
  if (hasCJK(name)) return Math.max(2, [...name.replace(/\s+/g, '')].length);
  const longestWord = Math.max(...name.split(/\s+/).map((w) => w.length));
  return Math.max(4, longestWord);
}

export type NextStatus = 'first' | 'next' | 'now';
export interface NextStop {
  item: Item;
  /** first = 出發前的第一站；now = 正在進行（開始時間已到、停留時間未結束） */
  status: NextStatus;
}

/**
 * 首頁主卡要顯示的那一站。
 * - 出發前：第一天的第一站
 * - 旅途中：第一個「還沒完成、而且還沒結束」的行程點；都過了就取第一個沒完成的
 * - 其他：沒有
 */
export function pickNextStop(phase: TripPhase['phase'], dayItems: Item[], nowMin: number): NextStop | null {
  if (phase === 'before') return dayItems[0] ? { item: dayItems[0], status: 'first' } : null;
  if (phase !== 'during') return null;
  const open = dayItems.filter((i) => !i.done);
  for (const it of open) {
    const t = toMinutes(it.time);
    if (t == null) continue;
    const end = t + (it.durationMin ?? 0);
    if (end >= nowMin) return { item: it, status: t <= nowMin && it.durationMin ? 'now' : 'next' };
  }
  return open[0] ? { item: open[0], status: 'next' } : null;
}

/** 下一站還有多久開始：三小時內才顯示（「25 分鐘後」「1 小時 5 分後」），其他回傳 null */
export function startsIn(item: Pick<Item, 'time'>, nowMin: number): string | null {
  const t = toMinutes(item.time);
  if (t == null) return null;
  const diff = t - nowMin;
  if (diff <= 0 || diff > 180) return null;
  if (diff < 60) return `${diff} 分鐘後`;
  const h = Math.floor(diff / 60), m = diff % 60;
  return m ? `${h} 小時 ${m} 分後` : `${h} 小時後`;
}

/** 抵達某一站的那段移動 */
export const segmentInto = (segs: SegmentInfo[], itemId: string | undefined) => (itemId ? segs.find((sg) => sg.to.id === itemId) ?? null : null);

export type TravelInfo =
  | { kind: 'estimate'; seg: SegmentInfo; minutes: number; mode: string }
  | { kind: 'distance'; seg: SegmentInfo; km: number }
  | { kind: 'route'; seg: SegmentInfo }
  | { kind: 'traffic' };

/** 「移動」小卡：AI 估計 → 直線距離 → 只有路線 → 即時路況 */
export function travelInfo(seg: SegmentInfo | null): TravelInfo {
  if (!seg) return { kind: 'traffic' };
  if (seg.estimate && Number.isFinite(seg.estimate.minutes)) return { kind: 'estimate', seg, minutes: Math.round(seg.estimate.minutes), mode: seg.estimate.mode };
  if (seg.distanceKm != null && Number.isFinite(seg.distanceKm)) return { kind: 'distance', seg, km: seg.distanceKm };
  return { kind: 'route', seg };
}

/** 0.85 → { value: '850', unit: 'm' }；3.24 → { value: '3.2', unit: 'km' } */
export function fmtDistance(km: number): { value: string; unit: string } {
  if (km < 1) return { value: String(Math.max(10, Math.round((km * 1000) / 10) * 10)), unit: 'm' };
  return { value: km < 10 ? km.toFixed(1) : String(Math.round(km)), unit: 'km' };
}

/** 建議出發時間（分鐘）是否已經過了或太趕 */
export function leaveTone(seg: SegmentInfo | null, phase: TripPhase['phase'], nowMin: number): 'warn' | 'calm' {
  if (!seg) return 'calm';
  if (seg.tight) return 'warn';
  if (phase === 'during' && seg.leaveBy != null && seg.leaveBy <= nowMin) return 'warn';
  return 'calm';
}

export interface SpendSummary {
  label: string;
  value: number;
  currency: string;
  /** 已花掉預算的百分比（有設預算才有） */
  budgetPct: number | null;
  /** 小卡副標的預算說明：「預算 47%」或超支時「超支 12%」 */
  budgetText: string | null;
}

/** 「花費」小卡：旅途中看今天，其他時候看總額；預算百分比一律以總額計 */
export function spendSummary(trip: Trip, phase: TripPhase): SpendSummary {
  const total = totalHome(trip);
  const isToday = phase.phase === 'during';
  const budgetPct = trip.budget && trip.budget > 0 ? Math.round((total / trip.budget) * 100) : null;
  return {
    label: isToday ? '今日花費' : '花費',
    value: isToday ? dayTotalHome(trip, phase.focusDay) : total,
    currency: trip.homeCurrency,
    budgetPct,
    budgetText: budgetPct == null ? null : budgetPct > 100 ? `超支 ${budgetPct - 100}%` : `預算 ${budgetPct}%`,
  };
}

/** 天氣代碼 → 中文與圖示；服務還沒寫好或出錯時退回空白 */
export function safeWeatherInfo(code: number): { label: string; icon: IconName } {
  try {
    const r = weatherInfo(code);
    return r && r.icon ? r : { label: '', icon: 'sun' };
  } catch {
    return { label: '', icon: 'sun' };
  }
}

/**
 * 天氣小卡副標（小卡很窄，390pt 寬的 iPhone 約放 6 個中文字加分隔點）：「多雲 · 預報」；放不下就只留天氣，
 * 歷年平均一定要講清楚（圖示已經表示天氣）。
 */
export function weatherSub(label: string, kind: 'forecast' | 'climate', maxChars = 6): string {
  const tag = kind === 'forecast' ? '預報' : '歷年平均';
  if (!label) return tag;
  if (label.length + tag.length <= maxChars) return `${label} · ${tag}`;
  return kind === 'climate' ? tag : label;
}

/** 數字越長字越小，避免小卡裡被截斷 */
export function valueSizeClass(text: string): 'md' | 'sm' | 'xs' {
  const n = text.length;
  return n <= 6 ? 'md' : n <= 8 ? 'sm' : 'xs';
}
