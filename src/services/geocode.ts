/**
 * 地點定位（Photon / OpenStreetMap，免金鑰）https://photon.komoot.io/api/?q=...&lat=&lon=&limit=1
 * 用來把行程點畫到地圖上、計算直線距離。
 * TODO（服務代理）：實作
 */
import type { LatLng, Trip } from '@/domain/types';

/** 地址或名稱 → 座標（near：偏好靠近城市中心的結果） */
export async function geocodePlace(_query: string, _near?: LatLng): Promise<LatLng | null> {
  throw new Error('TODO');
}

/** 從 Google 地圖分享連結解析座標（@lat,lng、q=lat,lng、!3d..!4d.. 等格式）；不是座標連結回傳 null */
export function parseMapsLink(_url: string): LatLng | null {
  throw new Error('TODO');
}

/**
 * 幫行程中還沒有座標的行程點補座標（節流：每秒最多 1 筆）。
 * 每找到一筆就呼叫 onResult，由呼叫端寫回 store。回傳成功筆數。
 */
export async function geocodeMissing(
  _trip: Trip,
  _onResult: (itemId: string, geo: LatLng) => void,
  _signal?: AbortSignal,
): Promise<number> {
  throw new Error('TODO');
}
