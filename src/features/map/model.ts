/**
 * 地圖分頁用的純邏輯：選哪一天、當天站點編號、地圖範圍、圖磚、外部連結、匯出檔名。
 * 沒有 React／Leaflet，方便寫測試（model.test.ts）。改地圖頁顯示規則時先改這裡。
 */
import { itemType } from '@/domain/constants';
import { haversineKm, itemsOfDay, placeQuery } from '@/domain/schedule';
import type { ISODate, Item, LatLng, Trip } from '@/domain/types';
import { gmapsSearch, gmapsTraffic } from '@/services/links';
import type { IconName } from '@/ui/Icon';

/* ---------------- 日期 ---------------- */

/** 要顯示哪一天（與行程分頁相同規則）：已選的（還在行程內）→ 今天（在行程內）→ 第一天 */
export function resolveDate(days: ISODate[], selected: ISODate | null, now: ISODate): ISODate | null {
  if (selected && days.includes(selected)) return selected;
  if (days.includes(now)) return now;
  return days[0] ?? null;
}

/* ---------------- 站點 ---------------- */

export interface Stop {
  item: Item;
  /** 當天第幾站（從 1 開始，依時間排序；地圖標記與清單共用） */
  n: number;
  /** 類型色的 CSS 變數名，例如 --t-sight */
  color: string;
  geo: LatLng | null;
}

/** 一天的站點（依時間排序並編號） */
export function dayStops(trip: Pick<Trip, 'items'>, date: ISODate | null): Stop[] {
  if (!date) return [];
  return itemsOfDay(trip, date).map((item, k) => ({
    item,
    n: k + 1,
    color: itemType(item.type).color,
    geo: item.geo ? { lat: item.geo.lat, lng: item.geo.lng } : null,
  }));
}

/** 有座標的站點（照順序） */
export const locatedStops = (stops: Stop[]) => stops.filter((s): s is Stop & { geo: LatLng } => !!s.geo);

/** 座標變了才需要重新框選範圍：用這個字串當比較依據 */
export const pointsKey = (stops: Stop[]) =>
  locatedStops(stops)
    .map((s) => `${s.item.id}:${s.geo.lat.toFixed(5)},${s.geo.lng.toFixed(5)}`)
    .join('|');

/** 依序連起來的直線距離總和（公里）；少於兩個有座標的站點時為 null */
export function straightKm(stops: Stop[]): number | null {
  const pts = locatedStops(stops).map((s) => s.geo);
  if (pts.length < 2) return null;
  let km = 0;
  for (let k = 1; k < pts.length; k++) km += haversineKm(pts[k - 1], pts[k]);
  return km;
}

/** 12.4 km／850 m */
export function fmtKm(km: number): string {
  if (km < 1) return `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

/* ---------------- 地圖範圍 ---------------- */

/** 沒有任何座標可用時的預設畫面（台灣附近，看得到東亞） */
export const WORLD_VIEW = { center: { lat: 25, lng: 121.5 } as LatLng, zoom: 4 };
/** 只有一個點或只有城市座標時的縮放層級 */
export const SINGLE_ZOOM = 15;
export const CITY_ZOOM = 12;

export type Framing =
  | { kind: 'bounds'; points: LatLng[] }
  | { kind: 'point'; center: LatLng; zoom: number };

/** 地圖該怎麼框：兩點以上框住全部；一點置中放大；都沒有就用城市座標，再沒有就看東亞 */
export function framing(stops: Stop[], city?: LatLng | null): Framing {
  const pts = locatedStops(stops).map((s) => s.geo);
  if (pts.length >= 2) return { kind: 'bounds', points: pts };
  if (pts.length === 1) return { kind: 'point', center: pts[0], zoom: SINGLE_ZOOM };
  if (city) return { kind: 'point', center: { lat: city.lat, lng: city.lng }, zoom: CITY_ZOOM };
  return { kind: 'point', center: WORLD_VIEW.center, zoom: WORLD_VIEW.zoom };
}

/* ---------------- 圖磚 ---------------- */

export const TILE_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> © <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>';

/** CARTO 圖磚：淺色用 Voyager、深色用 Dark Matter（{r} 在高解析螢幕換成 @2x） */
export const tileUrl = (dark: boolean) =>
  dark
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';

/* ---------------- 外部連結 ---------------- */

export interface QuickLink {
  key: string;
  label: string;
  icon: IconName;
  href: string;
}

/** 地圖下方的四個快捷（Google 地圖會以目前位置為中心搜尋） */
export const QUICK_LINKS: QuickLink[] = [
  { key: 'traffic', label: '即時路況', icon: 'traffic', href: gmapsTraffic },
  { key: 'food', label: '附近美食', icon: 'food', href: gmapsSearch('餐廳') },
  { key: 'store', label: '便利商店', icon: 'store', href: gmapsSearch('便利商店') },
  { key: 'station', label: '車站', icon: 'train', href: gmapsSearch('車站') },
];

/** 要顯示的地址：和名稱一樣（例如「錦市場」）就不重複顯示 */
export function stopAddress(it: Pick<Item, 'address' | 'title'>): string {
  const a = (it.address ?? '').trim();
  return a && a !== it.title.trim() ? a : '';
}

/** 第二行：時間 · 地址（沒有的就不寫） */
export const stopSubtitle = (it: Pick<Item, 'time' | 'address' | 'title'>) => [it.time, stopAddress(it)].filter(Boolean).join(' · ');

/** 當天時間範圍「07:30–16:00」；沒有時間就回傳空字串 */
export function timeSpan(stops: Stop[]): string {
  const times = stops.map((s) => s.item.time).filter((t): t is string => !!t);
  if (!times.length) return '';
  const first = times[0], last = times[times.length - 1];
  return first === last ? first : `${first}–${last}`;
}

/** 導航目的地（地址優先，否則名稱） */
export const navQuery = (it: Pick<Item, 'address' | 'title'>) => placeQuery(it);

/* ---------------- 定位進度 ---------------- */

/** '定位中 3/8…'；total = 這一輪開始時要定位的數量 */
export function geocodeLabel(total: number, pending: number): string {
  const all = Math.max(total, pending);
  if (all <= 0) return '定位中…';
  return `定位中 ${Math.min(all, Math.max(0, all - pending))}/${all}…`;
}

/** 找不到位置的提示標題：「清水寺、錦市場 找不到位置」，太多時只列前兩個 */
export function missingTitle(items: Pick<Item, 'title'>[]): string {
  if (!items.length) return '';
  if (items.length === 1) return `「${items[0].title}」找不到位置`;
  if (items.length === 2) return `「${items[0].title}」和「${items[1].title}」找不到位置`;
  return `「${items[0].title}」等 ${items.length} 個行程點找不到位置`;
}

/* ---------------- 匯出 ---------------- */

/** Google 我的地圖 CSV 檔名：去掉檔名不能用的字元 */
export function myMapsFileName(tripName: string): string {
  const base = tripName.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim() || '行程';
  return `${base.slice(0, 60)}－我的地圖.csv`;
}
