/**
 * 地圖鏡頭移動的排程規則（TripMap 的 useWhenIdle 用；有測試 whenIdle.test.ts）。
 *
 * - Leaflet 在縮放動畫進行中會直接忽略新的 setView／fitBounds（Map._tryAnimatedZoom 檢查 _animatingZoom），
 *   例如剛換天又馬上補到新座標時，第二次框選就會不見。所以動畫中改成等 zoomend 再做，而且只做最後一次要求。
 * - 地圖已移除（切到別的分頁）時什麼都不做：map.remove() 後再 flyTo 會丟 TypeError（_leaflet_pos）。
 *   Leaflet 移除時會清空圖層容器，用公開的 getPane('mapPane') 判斷（_loaded 移除後不會重設，不能用）。
 */
import type { Map as LeafletMap } from 'leaflet';

export type IdleTask = (m: LeafletMap) => void;

/** 地圖還能操作嗎（還沒被 remove） */
export const mapAlive = (map: LeafletMap) => !!map.getPane('mapPane');

/**
 * 現在能動就馬上做；縮放動畫中就排到 zoomend（同時只排一個，後來的要求取代先前的）。
 * pending 由呼叫端保存（React 用 useRef），讓同一張地圖的多次呼叫共用。
 */
export function runWhenIdle(map: LeafletMap | null, pending: { current: IdleTask | null }, fn: IdleTask): void {
  if (!map || !mapAlive(map)) return;
  const zooming = (map as unknown as { _animatingZoom?: boolean })._animatingZoom === true;
  if (!zooming) {
    pending.current = null;
    fn(map);
    return;
  }
  const waiting = pending.current !== null;
  pending.current = fn;
  if (!waiting)
    map.once('zoomend', () => {
      const next = pending.current;
      pending.current = null;
      // 動畫結束的計時器可能在地圖移除後才觸發
      if (next && mapAlive(map)) next(map);
    });
}
