import { toMinutes } from './dates';
import type { DayCheck, ISODate, Item, LatLng, SegmentEstimate, Trip } from './types';

/** 一天的行程點，依時間排序（沒時間的排最後，維持原順序） */
export function itemsOfDay(trip: Pick<Trip, 'items'>, date: ISODate): Item[] {
  return trip.items
    .map((it, idx) => ({ it, idx }))
    .filter(({ it }) => it.date === date)
    .sort((a, b) => (a.it.time ?? '99:99').localeCompare(b.it.time ?? '99:99') || a.idx - b.idx)
    .map(({ it }) => it);
}

/** 依日期再依時間排序的全部行程點 */
export function allItemsSorted(trip: Pick<Trip, 'items'>): Item[] {
  return [...trip.items].sort(
    (a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || (a.time ?? '99:99').localeCompare(b.time ?? '99:99'),
  );
}

/**
 * 導航用的查詢字串：優先用地點辨識產生的完整目的地（含城市背景），其次地址，最後名稱。
 */
export const placeQuery = (it: Pick<Item, 'address' | 'title'> & { place?: Item['place'] }) =>
  (it.place?.query ?? '').trim() || (it.address ?? '').trim() || it.title.trim();

/**
 * 能不能導航：地點辨識判斷為「起床」「整理」這類沒有地點的（navigable = false）不行；
 * 有座標（地圖連結、手動、定位）的一律可以。多站路線、導航按鈕用這個過濾。
 */
export const canNavigate = (it: Pick<Item, 'address' | 'title'> & { place?: Item['place']; geo?: Item['geo'] }) =>
  !!it.geo || (it.place?.navigable !== false && !!placeQuery(it));

/** AI 檢查結果若和目前順序一致才採用 */
export function validDayCheck(trip: Trip, date: ISODate): DayCheck | null {
  const c = trip.ai.dayChecks[date];
  if (!c) return null;
  const ids = itemsOfDay(trip, date).map((i) => i.id);
  return ids.length === c.itemIds.length && ids.every((id, k) => id === c.itemIds[k]) ? c : null;
}

/** a → b 這段移動的 AI 估計（若有） */
export function segmentEstimate(trip: Trip, a: Item, b: Item): SegmentEstimate | null {
  if (!a.date || a.date !== b.date) return null;
  const c = validDayCheck(trip, a.date);
  if (!c) return null;
  const k = c.itemIds.indexOf(a.id);
  return k >= 0 && c.itemIds[k + 1] === b.id ? c.segments[k] ?? null : null;
}

/** 兩點直線距離（公里） */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface SegmentInfo {
  from: Item;
  to: Item;
  estimate: SegmentEstimate | null;
  distanceKm: number | null;
  /** 預計抵達時間是否晚於下一站時間 */
  tight: boolean;
  /** 建議最晚出發時間（分鐘），可算時才有 */
  leaveBy: number | null;
}

/** 一天中相鄰兩站之間的資訊 */
export function daySegments(trip: Trip, date: ISODate): SegmentInfo[] {
  const list = itemsOfDay(trip, date);
  const out: SegmentInfo[] = [];
  for (let k = 1; k < list.length; k++) {
    const from = list[k - 1], to = list[k];
    const estimate = segmentEstimate(trip, from, to);
    const distanceKm = from.geo && to.geo ? haversineKm(from.geo, to.geo) : null;
    // 沒有 AI 估計時：直線距離 × 1.3 ÷ 時速 25 公里粗估（只用於判斷是否太趕）
    const travel = estimate?.minutes ?? (distanceKm != null ? Math.round(((distanceKm * 1.3) / 25) * 60) : null);
    const s = toMinutes(from.time), e = toMinutes(to.time);
    const need = (from.durationMin ?? 0) + (travel ?? 0);
    const tight = s != null && e != null && need > 0 && s + need > e;
    const leaveBy = e != null && travel != null ? e - travel - 5 : null;
    out.push({ from, to, estimate, distanceKm, tight, leaveBy });
  }
  return out;
}
