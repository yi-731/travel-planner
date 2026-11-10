import { toMinutes } from './dates';
import type { DayCheck, ISODate, Item, LatLng, SegmentEstimate, Trip } from './types';

/** 這個時間以後算晚上 */
const EVENING_MIN = 18 * 60;
/** 試算表裡排在晚上行程後面、這個時間以前的（「23:00 → 0:45」）：當天深夜，不是當天一早 */
const LATE_NIGHT_SHEET_MIN = 5 * 60;
/** App 裡加的行程點：更早的時間才算深夜（04:30 出發看日出不該排到最後） */
const LATE_NIGHT_APP_MIN = 4 * 60;

export interface DayClock {
  /** 排序用的分鐘數（過午夜的 ≥ 1440；跨換日線、比前一列早的維持試算表位置） */
  key: number;
  /** 實際時間（分鐘，當天 0 點起算；過午夜的 ≥ 1440）；沒有時間是 null */
  minutes: number | null;
}

const hasSeq = (it: Pick<Item, 'seq'>) => typeof it.seq === 'number' && Number.isFinite(it.seq);

/**
 * 同一天的行程點排序用的時間（傳入順序＝trip.items 的順序；回傳的陣列和傳入的一一對應）。
 *  - 試算表匯入的（有 seq）：照試算表順序走。時間比前一列早時：前一列是晚上、這列在 05:00 以前 → 過了午夜（+24 小時）；
 *    其他情況（跨換日線的航班：台北 23:55 起飛 → 西雅圖 18:40 抵達）維持在試算表的位置
 *  - App 裡加的（沒有 seq）：照時間；04:00 以前、又排在同一天晚上的行程後面加入的，算過了午夜
 *  - 沒有時間：試算表的維持位置，App 裡加的排最後
 */
export function dayClock(items: readonly Pick<Item, 'time' | 'seq'>[]): DayClock[] {
  const out: DayClock[] = items.map(() => ({ key: Infinity, minutes: null }));
  const sheet = items.map((it, i) => ({ it, i })).filter(({ it }) => hasSeq(it)).sort((a, b) => a.it.seq! - b.it.seq! || a.i - b.i);
  let last = -1;
  for (const { it, i } of sheet) {
    const t = toMinutes(it.time);
    if (t == null) {
      out[i] = { key: last, minutes: null };
      continue;
    }
    let key = t;
    let minutes = t;
    if (t < last) {
      const late = t + 1440;
      if (t < LATE_NIGHT_SHEET_MIN && last >= EVENING_MIN && late >= last) key = minutes = late;
      else key = last;
    }
    out[i] = { key, minutes };
    last = key;
  }
  let evening = false;
  items.forEach((it, i) => {
    const t = toMinutes(it.time);
    if (!hasSeq(it)) {
      const late = t != null && t < LATE_NIGHT_APP_MIN && evening;
      out[i] = t == null ? { key: Infinity, minutes: null } : { key: late ? t + 1440 : t, minutes: late ? t + 1440 : t };
    }
    if (t != null && t >= EVENING_MIN) evening = true;
  });
  return out;
}

/** 同一天的行程點排好順序（見 dayClock） */
export function sortDayItems<T extends Pick<Item, 'time' | 'seq'>>(list: readonly T[]): T[] {
  const clock = dayClock(list);
  return list
    .map((it, idx) => ({ it, idx, k: clock[idx].key, g: hasSeq(it) ? 0 : 1, o: hasSeq(it) ? it.seq! : idx }))
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0) || a.g - b.g || a.o - b.o || a.idx - b.idx)
    .map(({ it }) => it);
}

/** 一天的行程點，依時間排序（試算表匯入的照試算表順序；沒時間的排最後，維持原順序） */
export function itemsOfDay(trip: Pick<Trip, 'items'>, date: ISODate): Item[] {
  return sortDayItems(trip.items.filter((it) => it.date === date));
}

/** 依日期再依時間排序的全部行程點（同一天的順序和 itemsOfDay 一樣；沒有日期的排最後） */
export function allItemsSorted(trip: Pick<Trip, 'items'>): Item[] {
  const byDate = new Map<string, Item[]>();
  const undated: Item[] = [];
  for (const it of trip.items) {
    if (!it.date) undated.push(it);
    else byDate.set(it.date, [...(byDate.get(it.date) ?? []), it]);
  }
  const dated = [...byDate.keys()].sort().flatMap((d) => sortDayItems(byDate.get(d)!));
  const rest = undated.map((it, idx) => ({ it, idx })).sort((a, b) => (a.it.time ?? '99:99').localeCompare(b.it.time ?? '99:99') || a.idx - b.idx);
  return [...dated, ...rest.map(({ it }) => it)];
}

/**
 * 行程點實際的開始時間（當天 0 點起算的分鐘，過了午夜的 ≥ 1440，例如 23:00 之後的「0:45」是 1485）。
 * 提醒、日曆用這個；沒有時間回傳 null。
 */
export function itemMinutes(trip: Pick<Trip, 'items'>, it: Pick<Item, 'id' | 'date' | 'time'>): number | null {
  const own = toMinutes(it.time);
  if (own == null || !it.date) return own;
  const list = trip.items.filter((x) => x.date === it.date);
  const k = list.findIndex((x) => x.id === it.id);
  return k < 0 ? own : (dayClock(list)[k].minutes ?? own);
}

const URL_TEXT = /^(?:https?:\/\/|www\.)/i;

/**
 * 導航用的查詢字串：優先用地點辨識產生的完整目的地（含城市背景），其次地址，最後名稱。
 * 貼上的網址（Google 地圖連結）不能當查詢字：有座標用座標，否則用名稱。
 */
export const placeQuery = (it: Pick<Item, 'address' | 'title'> & { place?: Item['place']; geo?: Item['geo'] }) => {
  const q = (it.place?.query ?? '').trim();
  const a = (it.address ?? '').trim();
  if (q && !URL_TEXT.test(q)) return q;
  if (a && !URL_TEXT.test(a)) return a;
  if ((q || a) && it.geo) return `${it.geo.lat},${it.geo.lng}`;
  return it.title.trim();
};

/**
 * 能不能導航：地點辨識判斷為「起床」「整理」這類沒有地點的（navigable = false）不行；
 * 有可信座標（地圖連結、手動）的一律可以。自動定位（geocode）的座標是用文字查到的，不能推翻 navigable = false。
 * 多站路線、導航按鈕用這個過濾。
 */
export const canNavigate = (it: Pick<Item, 'address' | 'title'> & { place?: Item['place']; geo?: Item['geo'] }) =>
  (!!it.geo && it.geo.source !== 'geocode') || (it.place?.navigable !== false && !!placeQuery(it));

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
  // 過了午夜的時間（23:00 → 0:45）照 dayClock 算成 24:45，才不會被當成「太趕」
  const clock = dayClock(list);
  const out: SegmentInfo[] = [];
  for (let k = 1; k < list.length; k++) {
    const from = list[k - 1], to = list[k];
    const estimate = segmentEstimate(trip, from, to);
    const distanceKm = from.geo && to.geo ? haversineKm(from.geo, to.geo) : null;
    // 沒有 AI 估計時：直線距離 × 1.3 ÷ 時速 25 公里粗估（只用於判斷是否太趕）
    const travel = estimate?.minutes ?? (distanceKm != null ? Math.round(((distanceKm * 1.3) / 25) * 60) : null);
    const s = clock[k - 1].minutes, e = clock[k].minutes;
    // 下一站的時間比這站早（跨換日線的航班：兩站是不同時區）：不判斷是否太趕
    const comparable = s != null && e != null && e >= s;
    const need = (from.durationMin ?? 0) + (travel ?? 0);
    const tight = comparable && need > 0 && s + need > e;
    const leaveBy = e != null && travel != null && (s == null || comparable) ? e - travel - 5 : null;
    out.push({ from, to, estimate, distanceKm, tight, leaveBy });
  }
  return out;
}
