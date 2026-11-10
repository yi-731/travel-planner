/**
 * 地點定位（Photon / OpenStreetMap，免金鑰）https://photon.komoot.io/api/?q=...&lat=&lon=&limit=
 * 用來把行程點畫到地圖上、計算直線距離。
 * Photon 不支援中文介面語言參數（lang 只有 en/de/fr），所以不帶 lang；中日文地名照樣查得到。
 */
import { haversineKm } from '@/domain/schedule';
import type { Item, LatLng, Trip } from '@/domain/types';
import { fetchJson, isAbort, sleep } from './net';
import { dayMetaFor } from './places';
import { findCitiesInText, findCityAlias, geocodeTravelCity, type CityAlias } from './weather';

const SERVICE = '地點搜尋服務';
/** 離城市中心超過這個距離的結果視為查錯（例如同名的另一個地方） */
export const MAX_DISTANCE_KM = 300;
/** Photon 公用伺服器的使用規範：每秒最多 1 筆 */
export const THROTTLE_MS = 1100;

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const validLatLng = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

async function searchPlace(query: string, near: LatLng | undefined, signal?: AbortSignal): Promise<LatLng | null> {
  const q = query.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!q) return null;
  const p = new URLSearchParams({ q, limit: '3' });
  if (near) {
    p.set('lat', String(round6(near.lat)));
    p.set('lon', String(round6(near.lng)));
  }
  const data = await fetchJson<{ features?: PhotonFeature[] }>(`https://photon.komoot.io/api/?${p}`, { service: SERVICE, signal });
  for (const f of data.features ?? []) {
    const c = f.geometry?.coordinates;
    if (!c || !validLatLng(c[1], c[0])) continue;
    const pt = { lat: round6(c[1]), lng: round6(c[0]) };
    if (near && haversineKm(near, pt) > MAX_DISTANCE_KM) continue;
    return pt;
  }
  return null;
}

/** 地址或名稱 → 座標（near：偏好靠近城市中心的結果，超過 300 公里視為查無結果）；連線失敗丟出中文錯誤 */
export async function geocodePlace(query: string, near?: LatLng): Promise<LatLng | null> {
  return searchPlace(query, near);
}

const N = '(-?\\d{1,3}(?:\\.\\d+)?)';
/** 依可信度排序：地點本身 > 明確指定的座標參數 > 地圖畫面中心 > 純座標文字 */
const LINK_PATTERNS: RegExp[] = [
  new RegExp(`!3d${N}!4d${N}`),
  new RegExp(`[?&#](?:q|query|ll|sll|daddr|destination|center|coordinate)=(?:loc:)?\\s*${N}\\s*,\\s*${N}`, 'i'),
  new RegExp(`/maps/(?:search|place)/(?:[^/@]*/)?${N}\\s*,\\s*${N}`, 'i'),
  new RegExp(`@${N},${N}`),
  new RegExp(`^geo:${N},${N}`, 'i'),
  new RegExp(`^\\(?\\s*${N}\\s*[,，]\\s*${N}\\s*\\)?$`),
];

/** 從 Google 地圖分享連結解析座標（@lat,lng、q=lat,lng、!3d..!4d.. 等格式）；不是座標連結回傳 null */
export function parseMapsLink(url: string): LatLng | null {
  if (!url) return null;
  let s = url.trim();
  try {
    s = decodeURIComponent(s);
  } catch {
    /* 不完整的 % 編碼：用原字串 */
  }
  s = s.replace(/\+/g, ' ').trim();
  for (const re of LINK_PATTERNS) {
    const m = re.exec(s);
    if (!m) continue;
    const lat = Number(m[1]), lng = Number(m[2]);
    if (validLatLng(lat, lng)) return { lat: round6(lat), lng: round6(lng) };
  }
  return null;
}

/** 城市提示字：cityGeo.label 的城市部分（「京都，日本」→「京都」），沒有就用 trip.city */
export function cityHint(trip: Pick<Trip, 'city' | 'cityGeo'>): string {
  const label = trip.cityGeo?.label?.split(/[，,]/)[0]?.trim();
  return label || trip.city.trim();
}

/** 看起來是路線而不是地點的標題（「桃園機場 → 關西機場」） */
const ROUTE_LIKE = /→|->|⇒|➝|＞|>/;

/** 每個行程點最多查幾次（每次間隔 1.1 秒） */
const MAX_QUERIES = 4;

/**
 * 一個行程點要依序嘗試的查詢字串（純函式）：
 * 地點辨識的導航目的地（含城市背景）→ 目的地名稱 → 地址 → 名稱 → 名稱＋城市。完整的日本地址 Photon 常查不到、名稱反而查得到；
 * 名稱加城市放最後，因為一日遊（例如住京都、去奈良）加上城市反而會查不到。
 */
export function placeQueries(it: Pick<Item, 'address' | 'title'> & { place?: Item['place'] }, city: string): string[] {
  const address = (it.address ?? '').trim();
  const title = it.title.trim();
  const out: string[] = [];
  const pq = (it.place?.query ?? '').trim();
  if (pq) {
    out.push(pq);
    const name = (it.place?.name ?? '').trim();
    // 只有名稱（不含城市、國家）：Photon 對很長的「名稱, 城市, 州, 國家」有時反而查不到
    const core = pq.split(/\s*,\s*/)[0];
    if (name && !ROUTE_LIKE.test(name)) out.push(name);
    if (core && core !== name) out.push(core);
  }
  if (address && !ROUTE_LIKE.test(address)) out.push(address);
  if (title && !ROUTE_LIKE.test(title)) {
    out.push(title);
    if (city && !title.toLowerCase().includes(city.toLowerCase())) out.push(`${title} ${city}`);
  }
  return [...new Set(out)].slice(0, pq ? MAX_QUERIES : undefined);
}

/** 已有座標的行程點的中位數位置（沒有城市座標時當作搜尋中心） */
export function itemsCenter(trip: Pick<Trip, 'items'>): LatLng | undefined {
  const pts = trip.items.flatMap((i) => (i.geo ? [i.geo] : []));
  if (!pts.length) return undefined;
  const mid = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  return { lat: mid(pts.map((p) => p.lat)), lng: mid(pts.map((p) => p.lng)) };
}

/** 搜尋中心：城市座標，沒有就用已定位行程點的中位數（要傳完整的行程，不是只有待定位的那些） */
export const searchCenter = (trip: Pick<Trip, 'cityGeo' | 'items'>): LatLng | undefined => trip.cityGeo ?? itemsCenter(trip);

/** 這個行程點有沒有東西可以拿來定位（地點辨識判斷為「起床」「整理」這類沒有地點的，不定位） */
export const canGeocode = (it: Pick<Item, 'geo' | 'address' | 'title' | 'link'> & { place?: Item['place'] }) =>
  !it.geo && it.place?.navigable !== false && !!((it.address ?? '').trim() || it.title.trim() || (it.link ?? '').trim());

/** 導航目的地提到的城市（「Todai-ji, Nara, Japan」→ 奈良）；同時提到當天城市時以當天為準 */
function queryCity(query: string, dayCity: string | undefined): CityAlias | undefined {
  const ms = findCitiesInText(query).map((m) => m.alias);
  if (!ms.length) return undefined;
  const day = dayCity ? findCityAlias(dayCity) : undefined;
  if (day && ms.includes(day)) return undefined;
  return ms[ms.length - 1];
}

/**
 * 幫行程中還沒有座標的行程點補座標（節流：每秒最多 1 筆）。
 * 每找到一筆就呼叫 onResult，由呼叫端寫回 store。回傳成功筆數。
 * 先試 Google 地圖連結（不用連網），再依序查導航目的地（地點辨識結果）、地址、名稱、名稱＋城市。
 * 搜尋中心：那天的城市（多城市行程每天不同；目的地在別的城市時用那個城市，例如一日遊）；
 * 沒有才用 opts.near（只傳待定位的行程點時，用 searchCenter(完整行程) 算好傳進來）。離中心超過 300 公里的結果不採用。
 * signal 取消時安靜停止並回傳目前的筆數；連線失敗時丟出中文錯誤（已找到的仍已透過 onResult 回報）。
 */
export async function geocodeMissing(
  trip: Trip,
  onResult: (itemId: string, geo: LatLng) => void,
  signal?: AbortSignal,
  opts?: { near?: LatLng },
): Promise<number> {
  const near = opts?.near ?? searchCenter(trip);
  const tripCity = cityHint(trip);
  /** 一趟執行中查過的城市座標（同一個城市只查一次；查不到或連線失敗記 null） */
  const cityGeo = new Map<string, LatLng | null>();
  const cityCenter = async (city: string): Promise<LatLng | undefined> => {
    const key = (findCityAlias(city)?.en ?? city).trim().toLowerCase();
    if (!cityGeo.has(key)) {
      const g = await geocodeTravelCity(city, signal).catch((e: unknown) => {
        if (isAbort(e)) throw e;
        return null;
      });
      cityGeo.set(key, g ? { lat: g.lat, lng: g.lng } : null);
    }
    return cityGeo.get(key) ?? undefined;
  };
  const multiCity = Object.values(trip.days ?? {}).some((m) => !!m?.city?.trim());
  let ok = 0;
  let lastAt = 0;
  try {
    for (const it of trip.items) {
      if (signal?.aborted) break;
      if (!canGeocode(it)) continue;
      const fromLink = it.link ? parseMapsLink(it.link) : null;
      if (fromLink) {
        onResult(it.id, fromLink);
        ok++;
        continue;
      }
      const day = dayMetaFor(trip, it.date);
      let center: LatLng | undefined = day?.geo ? { lat: day.geo.lat, lng: day.geo.lng } : undefined;
      // 那天的城市還沒定位（天氣頁還沒開過）：先定位城市，不然會用行程城市當中心、把別的城市的結果都當成太遠
      if (!center && multiCity && day?.city?.trim()) center = await cityCenter(day.city);
      center ??= near;
      const other = it.place?.query ? queryCity(it.place.query, day?.city) : undefined;
      if (other) center = (await cityCenter(other.display)) ?? center;
      // 「名稱＋城市」：多城市行程用那天的城市；單一城市行程照舊用行程城市（cityHint）
      const city = (multiCity && day?.city?.trim()) || tripCity;
      for (const q of placeQueries(it, city)) {
        const wait = lastAt + THROTTLE_MS - Date.now();
        if (wait > 0) await sleep(wait, signal);
        lastAt = Date.now();
        const geo = await searchPlace(q, center, signal);
        if (geo) {
          onResult(it.id, geo);
          ok++;
          break;
        }
      }
    }
  } catch (e) {
    if (isAbort(e)) return ok;
    throw e;
  }
  return ok;
}
