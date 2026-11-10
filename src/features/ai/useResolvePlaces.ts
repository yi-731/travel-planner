/**
 * AI 智慧辨識地點：讀整趟行程，判斷每天在哪個城市、每一站真正的導航目的地，寫回行程。
 * - runResolvePlaces(tripId)：給非元件用（匯入完成後在背景跑）；useResolvePlaces(tripId)：給元件用（按鈕＋轉圈＋錯誤）。
 * - 進行中狀態在 useUI().busy['places:<tripId>']，任何元件都看得到；同一趟同時只跑一次。
 * - 分批送出（每批 60 站以內），每批完成就寫入：後面的批次失敗時，前面已付費的結果會留著。
 * - 第一次辨識整趟；之後預設只辨識還沒辨識過的行程點（同步試算表後新增或改過的），{ all: true } 重新辨識全部。
 * - 元件卸載後請求仍會完成並寫入，不會白花費用。
 * 合併規則（手動設定的不動、換城市時清座標…）在 ./placesMerge.ts。
 */
import { useCallback, useState } from 'react';
import type { DayMeta, ISODate } from '@/domain/types';
import { haptic } from '@/platform';
import { AIError, aiErrorMessage, aiReady, resolvePlacesFor, type ResolvedPlaces } from '@/services/ai';
import { isAbort } from '@/services/net';
import { geocodeTravelCity } from '@/services/weather';
import { useData } from '@/store/data';
import { useUI } from '@/store/ui';
import { spentText } from './aiUsage';
import { applyResolvedPlaces, dayGeocodeRequests, dayGeoFrom, pendingPlaceIds } from './placesMerge';

export const placesBusyKey = (tripId: string) => `places:${tripId}`;

export type ResolveRunResult =
  | { status: 'done'; items: number; days: number; costTwd: number }
  | { status: 'error'; message: string; items: number; days: number; costTwd: number }
  | { status: 'skipped'; reason: 'busy' | 'no_key' | 'no_trip' | 'nothing' };

export interface ResolveRunOptions {
  /** true：重新辨識全部；false：只辨識還沒辨識過的；不給：第一次全部、之後只做還沒辨識過的 */
  all?: boolean;
}

function askForKey() {
  const ui = useUI.getState();
  ui.toast('AI 地點辨識要用你的 Anthropic API 金鑰，請先貼上金鑰');
  ui.openSheet({ name: 'appSettings' });
}

const placesSpent = (tripId: string) => {
  const v = useData.getState().trips[tripId]?.ai?.usage?.byFeature?.places;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
};

/** 一批結果寫進行程：別名表沒有的新城市先定位（失敗就留給天氣頁之後再試），再一次寫入 */
async function mergePart(tripId: string, part: ResolvedPlaces): Promise<{ items: number; days: number }> {
  const cur = useData.getState().trips[tripId];
  if (!cur) return { items: 0, days: 0 };
  const geos = new Map<ISODate, NonNullable<DayMeta['geo']>>();
  for (const req of dayGeocodeRequests(cur, part)) {
    try {
      const g = await geocodeTravelCity(req.query);
      const geo = g ? dayGeoFrom(req, g) : null;
      if (geo) geos.set(req.date, geo);
    } catch {
      /* 定位失敗：城市照樣寫入，天氣頁之後會再定位 */
    }
  }
  let stats = { items: 0, days: 0 };
  useData.getState().mutateTrip(tripId, (d) => {
    stats = applyResolvedPlaces(d, part, geos);
  });
  return stats;
}

function markResolved(tripId: string) {
  useData.getState().mutateTrip(tripId, (d) => {
    d.ai = { ...d.ai, dayChecks: d.ai?.dayChecks ?? {}, placesResolvedAt: Date.now() };
  });
}

/** 完成提示：「AI 已辨識 42 個地點，花費約 NT$6」 */
export function resolveDoneText(items: number, days: number, costTwd: number): string {
  const spent = spentText(costTwd);
  if (items > 0) return `AI 已辨識 ${items} 個地點，${spent}`;
  if (days > 0) return `AI 已辨識 ${days} 天的城市，${spent}`;
  return `AI 這次沒有找到要更新的地點，${spent}`;
}

/** 執行地點辨識並寫回行程。不會丟出錯誤：結果（含錯誤訊息）在回傳值裡，也會跳提示。 */
export async function runResolvePlaces(tripId: string, opts: ResolveRunOptions = {}): Promise<ResolveRunResult> {
  const key = placesBusyKey(tripId);
  if (useUI.getState().busy[key]) return { status: 'skipped', reason: 'busy' };
  if (!aiReady()) {
    askForKey();
    return { status: 'skipped', reason: 'no_key' };
  }
  const trip = useData.getState().trips[tripId];
  if (!trip) {
    useUI.getState().toast('找不到這趟旅程，可能已經被刪除。', 'bad');
    return { status: 'skipped', reason: 'no_trip' };
  }
  const all = opts.all ?? !trip.ai?.placesResolvedAt;
  const itemIds = all ? null : pendingPlaceIds(trip);
  if (itemIds && !itemIds.length) {
    useUI.getState().toast('每個地點都已經辨識過了');
    return { status: 'skipped', reason: 'nothing' };
  }

  const before = placesSpent(tripId);
  const spent = () => Math.max(0, placesSpent(tripId) - before);
  let items = 0;
  let days = 0;
  useUI.getState().setBusy(key, true);
  try {
    await resolvePlacesFor(trip, {
      itemIds,
      onChunk: async (part) => {
        const s = await mergePart(tripId, part);
        items += s.items;
        days += s.days;
      },
    });
    markResolved(tripId);
    void haptic('success');
    const cost = spent();
    useUI.getState().toast(resolveDoneText(items, days, cost), 'good', 3600);
    return { status: 'done', items, days, costTwd: cost };
  } catch (e) {
    // 部分批次完成：已寫入的保留，下次只辨識剩下的
    if (items || days) markResolved(tripId);
    if (e instanceof AIError && e.code === 'no_key') {
      askForKey();
      return { status: 'skipped', reason: 'no_key' };
    }
    const message = isAbort(e) ? '已取消。' : aiErrorMessage(e);
    void haptic('error');
    useUI.getState().toast(items ? `AI 已辨識 ${items} 個地點，其餘沒有完成：${message}` : message, 'bad', 4200);
    return { status: 'error', message, items, days, costTwd: spent() };
  } finally {
    useUI.getState().setBusy(key, false);
  }
}

/** 元件用：{ run, busy, error }。error 跟著旅程：換到另一趟就不顯示前一趟的錯誤。 */
export function useResolvePlaces(tripId: string | null | undefined): {
  run: (opts?: ResolveRunOptions) => Promise<void>;
  busy: boolean;
  error: string | null;
} {
  const busy = useUI((s) => (tripId ? !!s.busy[placesBusyKey(tripId)] : false));
  const [failure, setFailure] = useState<{ tripId: string; message: string } | null>(null);
  const run = useCallback(
    async (opts?: ResolveRunOptions) => {
      if (!tripId) return;
      setFailure(null);
      const r = await runResolvePlaces(tripId, opts);
      if (r.status === 'error') setFailure({ tripId, message: r.message });
    },
    [tripId],
  );
  return { run, busy, error: failure && failure.tripId === tripId ? failure.message : null };
}
