/**
 * 給元件用的資料 hook（天氣、地點定位、匯率）。會把結果寫回 store 快取。
 *
 * - 同一趟旅程的天氣／定位在模組層級去重：好幾個元件同時用 hook 也只會連線一次。
 * - 自動重抓有冷卻時間（AUTO_RETRY_MS），失敗不會無限重試；refresh() 會立即重抓。
 * - App 回到前景（visibilitychange）或重新連上網路（online）時自動檢查是否需要更新。
 */
import { useCallback, useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { tripDays } from '@/domain/dates';
import type { DailyWeather, ISODate, Item, Trip } from '@/domain/types';
import { useData } from '@/store';
import { fetchRate } from './fx';
import { canGeocode, geocodeMissing, parseMapsLink, searchCenter } from './geocode';
import { fetchTripWeather, geocodeCity, samePlace, weatherStale } from './weather';

/** 自動重抓（非使用者按下重新整理）的最短間隔 */
const AUTO_RETRY_MS = 10 * 60 * 1000;
/** 定位因連線失敗中斷後，多久才自動再試 */
const GEOCODE_RETRY_MS = 60 * 1000;

interface NetStatus {
  weather: Record<string, { loading: boolean; error: string | null }>;
  geocode: Record<string, boolean>;
  /** 重新連上網路時 +1，讓 hook 重新檢查 */
  tick: number;
}
const useNetStatus = create<NetStatus>()(() => ({ weather: {}, geocode: {}, tick: 0 }));

const weatherInflight = new Map<string, Promise<void>>();
const weatherAttempt = new Map<string, { key: string; at: number }>();
const geoRuns = new Map<string, AbortController>();
const geoUsers = new Map<string, number>();
/** 查過但找不到的行程點（地址／名稱／連結沒變就不再查） */
const geoFailed = new Set<string>();
const geoBlocked = new Map<string, { sig: string; at: number }>();

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    weatherAttempt.clear();
    geoBlocked.clear();
    useNetStatus.setState((s) => ({ tick: s.tick + 1 }));
  });
}

const message = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/* ------------------------------------------------------------------ */
/* 天氣                                                                */
/* ------------------------------------------------------------------ */

export interface TripWeather {
  days: DailyWeather[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  forDate: (d: ISODate) => DailyWeather | undefined;
  /** 最後更新時間（ms） */
  fetchedAt: number | null;
}

/** 影響天氣結果的欄位；變了就重新檢查 */
const weatherKey = (t: Trip) =>
  [t.id, t.city.trim(), t.cityGeo ? `${t.cityGeo.lat},${t.cityGeo.lng}` : '', tripDays(t).join(',')].join('|');

function loadWeather(tripId: string, force: boolean): Promise<void> {
  const running = weatherInflight.get(tripId);
  if (running) return running;
  const trip = useData.getState().trips[tripId];
  if (!trip) return Promise.resolve();
  const needsGeo = !trip.cityGeo;
  if (needsGeo && !trip.city.trim()) return Promise.resolve();
  if (!force && !needsGeo && (!tripDays(trip).length || !weatherStale(trip.weather, trip))) return Promise.resolve();

  let key = weatherKey(trip);
  const last = weatherAttempt.get(tripId);
  if (!force && last && last.key === key && Date.now() - last.at < AUTO_RETRY_MS) return Promise.resolve();
  weatherAttempt.set(tripId, { key, at: Date.now() });

  const setStatus = (loading: boolean, error: string | null) =>
    useNetStatus.setState((s) => ({ weather: { ...s.weather, [tripId]: { loading, error } } }));
  setStatus(true, null);

  const p = (async () => {
    let error: string | null = null;
    try {
      let t: Trip | undefined = trip;
      if (!t.cityGeo) {
        const city = t.city;
        const geo = await geocodeCity(city);
        if (!geo) {
          throw new Error(`找不到「${city.trim()}」這個城市。請到「行程設定」改成完整的城市名稱，或改用英文（例如 Osaka）。`);
        }
        useData.getState().mutateTrip(tripId, (d) => {
          if (!d.cityGeo && d.city === city) d.cityGeo = { ...geo };
        });
        t = useData.getState().trips[tripId];
        // 剛寫入城市座標：之後用這個狀態比對有沒有被改過（自己寫入的座標不算變更）
        if (t) {
          key = weatherKey(t);
          weatherAttempt.set(tripId, { key, at: Date.now() });
        }
      }
      if (!t?.cityGeo || !tripDays(t).length) return;
      if (!force && !weatherStale(t.weather, t)) return;
      const cache = await fetchTripWeather(t);
      useData.getState().mutateTrip(tripId, (d) => {
        if (d.cityGeo && samePlace(d.cityGeo, cache)) d.weather = cache;
      });
    } catch (e) {
      error = message(e, '天氣資料暫時無法取得，請稍後再試一次。');
    } finally {
      weatherInflight.delete(tripId);
      // 抓取期間日期或城市改了：這次抓的是舊的範圍，馬上照新的再抓一次
      // （新的 key 會記在 weatherAttempt，冷卻時間照算，不會一直重抓）
      const cur = useData.getState().trips[tripId];
      if (cur && weatherKey(cur) !== key) {
        void loadWeather(tripId, false);
        // 不需要再抓（例如快取已經涵蓋）時，loadWeather 不會更新狀態：這裡結束載入中
        if (!weatherInflight.has(tripId)) setStatus(false, error);
      } else {
        setStatus(false, error);
      }
    }
  })();
  weatherInflight.set(tripId, p);
  return p;
}

/** 行程天氣：快取過期才重抓；沒有城市座標時先定位城市 */
export function useTripWeather(trip: Trip | null): TripWeather {
  const id = trip?.id ?? null;
  const status = useNetStatus((s) => (id ? s.weather[id] : undefined));
  const tick = useNetStatus((s) => s.tick);
  const key = trip ? weatherKey(trip) : '';

  useEffect(() => {
    if (!id) return;
    void loadWeather(id, false);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadWeather(id, false);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [id, key, tick]);

  const cache = trip?.weather;
  const geo = trip?.cityGeo;
  const valid = !!(cache && geo && samePlace(cache, geo));
  const dayList = trip ? tripDays(trip).join(',') : '';

  const days = useMemo(() => {
    if (!valid || !cache) return [];
    const want = new Set(dayList.split(','));
    return cache.days.filter((d) => want.has(d.date));
  }, [valid, cache, dayList]);

  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const forDate = useCallback((d: ISODate) => byDate.get(d), [byDate]);
  const refresh = useCallback(() => {
    if (id) void loadWeather(id, true);
  }, [id]);

  // 第一次 render（effect 還沒跑）時，若接下來一定會連線，就先顯示載入中，避免閃一下「沒有資料」
  const willLoad = !!trip && (!geo ? !!trip.city.trim() : !valid && !!dayList);
  return {
    days,
    loading: status ? status.loading : willLoad,
    error: status?.error ?? null,
    refresh,
    forDate,
    fetchedAt: valid && cache ? cache.fetchedAt : null,
  };
}

/* ------------------------------------------------------------------ */
/* 行程點定位                                                          */
/* ------------------------------------------------------------------ */

const itemSig = (tripId: string, it: Pick<Item, 'id' | 'address' | 'title' | 'link'>) =>
  [tripId, it.id, it.address ?? '', it.title, it.link ?? ''].join('\u0001');

/** 還沒有座標、而且還沒查過失敗的行程點 */
const todoItems = (trip: Trip) => trip.items.filter((it) => canGeocode(it) && !geoFailed.has(itemSig(trip.id, it)));

function startGeocode(tripId: string) {
  if (geoRuns.has(tripId)) return;
  const trip = useData.getState().trips[tripId];
  if (!trip) return;
  const todo = todoItems(trip);
  if (!todo.length) return;
  const sig = todo.map((it) => itemSig(tripId, it)).join('\n');
  const blocked = geoBlocked.get(tripId);
  if (blocked && blocked.sig === sig && Date.now() - blocked.at < GEOCODE_RETRY_MS) return;

  const ctrl = new AbortController();
  geoRuns.set(tripId, ctrl);
  useNetStatus.setState((s) => ({ geocode: { ...s.geocode, [tripId]: true } }));
  const found = new Set<string>();
  const snapshot = new Map(todo.map((it) => [it.id, it]));

  // 只查待定位的行程點，但搜尋中心要用整趟行程算（已定位的行程點也算在內）
  geocodeMissing(
    { ...trip, items: todo },
    (itemId, geo) => {
      const before = snapshot.get(itemId);
      if (!before) return;
      found.add(itemId);
      const source = before.link && parseMapsLink(before.link) ? 'link' : 'geocode';
      useData.getState().mutateTrip(tripId, (d) => {
        const it = d.items.find((x) => x.id === itemId);
        // 查詢期間使用者改了地址或名稱：這筆結果不適用
        if (it && !it.geo && itemSig(tripId, it) === itemSig(tripId, before)) it.geo = { lat: geo.lat, lng: geo.lng, source };
      });
    },
    ctrl.signal,
    { near: searchCenter(trip) },
  )
    .then(() => {
      if (ctrl.signal.aborted) return;
      for (const it of todo) if (!found.has(it.id)) geoFailed.add(itemSig(tripId, it));
      geoBlocked.delete(tripId);
    })
    .catch(() => {
      // 連線失敗：已找到的已寫入；其餘的等網路恢復或稍後再試
      geoBlocked.set(tripId, { sig, at: Date.now() });
    })
    .finally(() => {
      geoRuns.delete(tripId);
      useNetStatus.setState((s) => ({ geocode: { ...s.geocode, [tripId]: false } }));
    });
}

/** 背景幫沒座標的行程點補座標（地圖頁使用）。pending = 還在等待定位的行程點數 */
export function useAutoGeocode(trip: Trip | null): { pending: number; running: boolean } {
  const id = trip?.id ?? null;
  const running = useNetStatus((s) => (id ? !!s.geocode[id] : false));
  const tick = useNetStatus((s) => s.tick);
  const todo = trip ? todoItems(trip) : [];
  const sig = id ? todo.map((it) => itemSig(id, it)).join('\n') : '';

  // 有幾個元件在用；全部卸載時中止背景定位
  useEffect(() => {
    if (!id) return;
    geoUsers.set(id, (geoUsers.get(id) ?? 0) + 1);
    return () => {
      const n = (geoUsers.get(id) ?? 1) - 1;
      if (n > 0) geoUsers.set(id, n);
      else {
        geoUsers.delete(id);
        geoRuns.get(id)?.abort();
      }
    };
  }, [id]);

  useEffect(() => {
    if (!id || !sig || running) return;
    startGeocode(id);
    // 連線失敗後的冷卻時間到了再試一次
    const t = setTimeout(() => startGeocode(id), GEOCODE_RETRY_MS + 500);
    return () => clearTimeout(t);
  }, [id, sig, running, tick]);

  return { pending: todo.length, running };
}

/* ------------------------------------------------------------------ */
/* 匯率                                                                */
/* ------------------------------------------------------------------ */

/** 更新行程匯率（當地→本國），回傳新匯率；失敗丟出中文錯誤 */
export async function refreshRate(tripId: string): Promise<number> {
  const t = useData.getState().trips[tripId];
  if (!t) throw new Error('找不到這趟旅程，可能已經被刪除。');
  const from = t.localCurrency, to = t.homeCurrency;
  const rate = await fetchRate(from, to);
  useData.getState().mutateTrip(tripId, (d) => {
    // 查詢期間幣別被改掉：不要寫入錯的匯率
    if (d.localCurrency === from && d.homeCurrency === to) {
      d.rate = rate;
      d.rateUpdatedAt = Date.now();
    }
  });
  return rate;
}
