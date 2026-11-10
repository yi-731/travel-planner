/**
 * 補上自動辨識的導航目的地（行程表單儲存、地點頁「改回自動辨識」後用）。
 * 只在有每天城市資料（匯入試算表或設定過「這一天」）的行程做：沒有城市背景時，用地址或名稱導航就好。
 * 辨識結果和原本一樣時，沿用原本用文字查到的座標，不必重新定位。
 */
import type { Item } from '@/domain/types';
import { buildPlace, dayMetaFor } from '@/services/places';
import { useData } from '@/store/data';

export function refreshRulePlace(tripId: string, itemId: string, original: Pick<Item, 'geo' | 'place' | 'address'> | null): void {
  const trip = useData.getState().trips[tripId];
  const cur = trip?.items.find((i) => i.id === itemId);
  if (!trip || !cur || cur.place || !trip.days || !Object.keys(trip.days).length) return;
  let place: Item['place'];
  try {
    place = buildPlace(cur, dayMetaFor(trip, cur.date), trip);
  } catch {
    // 地點辨識出錯：維持用地址或名稱導航
    return;
  }
  if (!place) return;
  useData.getState().mutateTrip(tripId, (d) => {
    const it = d.items.find((i) => i.id === itemId);
    if (!it || it.place) return;
    it.place = place;
    const old = original?.geo;
    if (!it.geo && old?.source === 'geocode' && original?.place?.query === place.query && (original.address ?? '') === (it.address ?? '')) it.geo = old;
  });
}
