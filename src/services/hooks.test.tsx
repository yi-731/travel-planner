import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { addDays, today } from '@/domain/dates';
import type { Item, Trip } from '@/domain/types';

// 測試環境沒有 IndexedDB：換成記憶體
vi.mock('idb-keyval', () => {
  const m = new Map<string, unknown>();
  return { get: async (k: string) => m.get(k), set: async (k: string, v: unknown) => void m.set(k, v), del: async (k: string) => void m.delete(k) };
});

const { useData } = await import('@/store');
const { useTripWeather, useAutoGeocode, refreshRate } = await import('./hooks');
type TripWeather = ReturnType<typeof useTripWeather>;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let roots: Root[] = [];
afterEach(() => {
  act(() => roots.forEach((r) => r.unmount()));
  roots = [];
  vi.unstubAllGlobals();
});

const START = addDays(today(), 12);
function seedTrip(id: string, over: Partial<Trip> = {}): Trip {
  const t: Trip = {
    id, name: '測試', city: 'KYOTO', cityGeo: { lat: 35.0211, lng: 135.7539, label: '京都，日本' },
    startDate: START, endDate: addDays(START, 4), localCurrency: 'JPY', homeCurrency: 'TWD', rate: 0.2,
    members: ['我'], items: [], expenses: [], cover: { kind: 'orb' }, ai: { dayChecks: {} }, createdAt: 0, updatedAt: 0, ...over,
  };
  useData.setState((s) => ({ trips: { ...s.trips, [id]: t }, hydrated: true }));
  return t;
}
const tripOf = (id: string) => useData.getState().trips[id];

function rangeDays(a: string, b: string) {
  const out: string[] = [];
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
  return out;
}
type Route = (u: URL) => unknown | undefined;
function mockFetch(route: Route) {
  const calls: URL[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const u = new URL(String(input));
      calls.push(u);
      const body = route(u);
      if (body === undefined) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  return calls;
}
const weatherRoute: Route = (u) => {
  if (u.host !== 'api.open-meteo.com' && u.host !== 'archive-api.open-meteo.com') return undefined;
  const time = rangeDays(u.searchParams.get('start_date')!, u.searchParams.get('end_date')!);
  const n = time.map(() => 10);
  return { daily: { time, weather_code: time.map(() => 1), temperature_2m_max: n, temperature_2m_min: n, precipitation_probability_max: n, precipitation_sum: n } };
};

async function waitFor(cond: () => boolean, ms = 4000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('waitFor 逾時');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
}

/** 渲染一個用 hook 的元件，回傳最新結果 */
function renderWeather(id: string) {
  const out: { current: TripWeather | null } = { current: null };
  function Probe() {
    const trip = useData((s) => s.trips[id] ?? null);
    out.current = useTripWeather(trip);
    return null;
  }
  const el = document.createElement('div');
  const root = createRoot(el);
  roots.push(root);
  act(() => root.render(createElement(Probe)));
  return out;
}

describe('useTripWeather', () => {
  it('多個元件同時使用只連線一次，結果寫回 trip.weather', async () => {
    const calls = mockFetch(weatherRoute);
    seedTrip('w1');
    const a = renderWeather('w1');
    const b = renderWeather('w1');
    expect(a.current?.loading).toBe(true);
    await waitFor(() => !!tripOf('w1').weather && a.current?.loading === false);
    expect(calls.filter((u) => u.host === 'api.open-meteo.com')).toHaveLength(1);
    expect(a.current?.days).toHaveLength(5);
    expect(b.current?.days).toHaveLength(5);
    expect(a.current?.forDate(START)?.kind).toBe('forecast');
    expect(a.current?.forDate(addDays(START, 4))?.kind).toBe('climate');
    expect(a.current?.fetchedAt).toBe(tripOf('w1').weather?.fetchedAt);
    expect(a.current?.error).toBeNull();

    // 快取還新：重新掛載不再連線
    const n = calls.length;
    renderWeather('w1');
    await act(async () => {});
    expect(calls.length).toBe(n);
  });

  it('沒有城市座標時先定位城市再抓天氣', async () => {
    const calls = mockFetch((u) =>
      u.host === 'geocoding-api.open-meteo.com'
        ? { results: [{ name: '大阪市', latitude: 34.69379, longitude: 135.50107, feature_code: 'PPLA', country_code: 'JP', timezone: 'Asia/Tokyo', population: 2753862 }] }
        : weatherRoute(u),
    );
    seedTrip('w2', { city: '大阪', cityGeo: undefined });
    const r = renderWeather('w2');
    await waitFor(() => !!tripOf('w2').weather);
    expect(tripOf('w2').cityGeo).toEqual({ lat: 34.6938, lng: 135.5011, label: '大阪，日本', timezone: 'Asia/Tokyo', countryCode: 'JP' });
    expect(calls[0].searchParams.get('name')).toBe('Osaka');
    expect(tripOf('w2').weather?.lat).toBe(34.6938);
    await waitFor(() => r.current?.days.length === 5);
  });

  it('找不到城市：顯示可修正的中文錯誤，不會一直重試', async () => {
    const calls = mockFetch(() => ({}));
    seedTrip('w3', { city: '火星基地', cityGeo: undefined });
    const r = renderWeather('w3');
    await waitFor(() => !!r.current?.error);
    expect(r.current?.error).toContain('找不到「火星基地」');
    expect(r.current?.loading).toBe(false);
    const n = calls.length;
    renderWeather('w3');
    await act(async () => {});
    expect(calls.length).toBe(n);
  });

  it('連線失敗保留錯誤；refresh() 立即重試', async () => {
    let online = false;
    const calls = mockFetch((u) => (online ? weatherRoute(u) : undefined));
    seedTrip('w4');
    const r = renderWeather('w4');
    await waitFor(() => !!r.current?.error);
    expect(r.current?.error).toContain('無法連線到天氣服務');
    expect(r.current?.days).toEqual([]);
    online = true;
    act(() => r.current?.refresh());
    expect(r.current?.loading).toBe(true);
    await waitFor(() => r.current?.days.length === 5);
    expect(r.current?.error).toBeNull();
    expect(calls.length).toBeGreaterThan(1);
  });

  it('抓取期間改了日期：結束後照新的日期再抓一次', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const calls: URL[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const u = new URL(String(input));
        calls.push(u);
        if (calls.length === 1) await gate; // 第一次請求卡住，模擬還在抓
        const body = weatherRoute(u);
        if (body === undefined) throw new TypeError('Failed to fetch');
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    seedTrip('w6');
    const r = renderWeather('w6');
    await waitFor(() => calls.length === 1);
    const NEW = addDays(START, 2);
    act(() => useData.getState().mutateTrip('w6', (d) => {
      d.startDate = NEW;
      d.endDate = addDays(NEW, 4);
    }));
    await act(async () => release());
    await waitFor(() => r.current?.loading === false && r.current.days.length === 5);
    expect(calls.filter((u) => u.host === 'api.open-meteo.com').length).toBeGreaterThanOrEqual(2);
    expect(r.current?.days.map((d) => d.date)).toEqual(rangeDays(NEW, addDays(NEW, 4)));
  });

  it('多城市行程：先定位每天的城市（寫回 days），再依當天城市抓天氣', async () => {
    const geoResults: Record<string, unknown> = {
      Seattle: { name: 'Seattle', admin1: 'Washington', latitude: 47.6062, longitude: -122.3321, feature_code: 'PPLA2', population: 737015, country_code: 'US', timezone: 'America/Los_Angeles' },
      Portland: { name: 'Portland', admin1: 'Oregon', latitude: 45.5152, longitude: -122.6784, feature_code: 'PPLA2', population: 652503, country_code: 'US', timezone: 'America/Los_Angeles' },
    };
    const calls = mockFetch((u) => {
      if (u.host === 'geocoding-api.open-meteo.com') {
        const r = geoResults[u.searchParams.get('name') ?? ''];
        return { results: r ? [r] : [] };
      }
      const lats = (u.searchParams.get('latitude') ?? '').split(',');
      const one = weatherRoute(u);
      return lats.length > 1 ? lats.map(() => one) : one;
    });
    seedTrip('w7', {
      city: '西雅圖',
      cityGeo: undefined,
      startDate: START,
      endDate: addDays(START, 2),
      days: { [START]: { city: '西雅圖' }, [addDays(START, 1)]: { city: '波特蘭' }, [addDays(START, 2)]: { label: '一日遊' } },
    });
    const r = renderWeather('w7');
    await waitFor(() => !!tripOf('w7').weather && r.current?.days.length === 3);
    const t = tripOf('w7');
    expect(t.days?.[START]?.geo).toMatchObject({ lat: 47.6062, en: 'Seattle', admin1: 'Washington' });
    expect(t.days?.[addDays(START, 1)]?.geo).toMatchObject({ lat: 45.5152, en: 'Portland' });
    // 行程城市直接沿用同城市那天的座標，不再查一次
    expect(t.cityGeo).toMatchObject({ lat: 47.6062, lng: -122.3321 });
    const geoCalls = calls.filter((u) => u.host === 'geocoding-api.open-meteo.com').map((u) => u.searchParams.get('name'));
    expect(geoCalls).toEqual(['Seattle', 'Portland']);
    const fc = calls.filter((u) => u.host === 'api.open-meteo.com');
    expect(fc.at(-1)?.searchParams.get('latitude')).toBe('47.6062,45.5152');
    expect(r.current?.days.map((d) => d.place)).toEqual(['西雅圖', '波特蘭', '波特蘭']);
  });

  it('某天的城市因連線失敗沒定位到：不當成「找不到」，重新整理（或稍後）會再查', async () => {
    let portlandTries = 0;
    const calls = mockFetch((u) => {
      if (u.host === 'geocoding-api.open-meteo.com') {
        const name = u.searchParams.get('name');
        if (name === 'Portland' && portlandTries++ < 1) return undefined; // 第一次連不上
        if (name === 'Portland') return { results: [{ name: 'Portland', admin1: 'Oregon', latitude: 45.5152, longitude: -122.6784, feature_code: 'PPLA2', population: 652503, country_code: 'US' }] };
        if (name === 'Seattle') return { results: [{ name: 'Seattle', admin1: 'Washington', latitude: 47.6062, longitude: -122.3321, feature_code: 'PPLA2', population: 737015, country_code: 'US' }] };
        return { results: [] };
      }
      const lats = (u.searchParams.get('latitude') ?? '').split(',');
      const one = weatherRoute(u);
      return lats.length > 1 ? lats.map(() => one) : one;
    });
    // 同一次查詢裡另一天（西雅圖）有查到：以前會把連不上的波特蘭也記成「找不到」，這次開 App 都不再查
    seedTrip('w8', { startDate: START, endDate: addDays(START, 1), days: { [START]: { city: '西雅圖' }, [addDays(START, 1)]: { city: '波特蘭', label: '波特蘭' } } });
    const r = renderWeather('w8');
    await waitFor(() => r.current?.loading === false && portlandTries >= 1 && !!tripOf('w8').days?.[START]?.geo);
    expect(tripOf('w8').days?.[addDays(START, 1)]?.geo).toBeUndefined();
    act(() => r.current!.refresh());
    await waitFor(() => !!tripOf('w8').days?.[addDays(START, 1)]?.geo);
    expect(tripOf('w8').days?.[addDays(START, 1)]?.geo).toMatchObject({ lat: 45.5152, en: 'Portland' });
    expect(calls.filter((u) => u.searchParams.get('name') === 'Portland').length).toBe(2);
  });

  it('城市換了：舊座標的天氣不顯示', async () => {
    mockFetch(weatherRoute);
    seedTrip('w5');
    const r = renderWeather('w5');
    await waitFor(() => r.current?.days.length === 5);
    act(() => useData.getState().mutateTrip('w5', (d) => void (d.cityGeo = { lat: 34.69, lng: 135.5 })));
    expect(r.current?.days.length === 0 || r.current?.loading).toBe(true);
    await waitFor(() => tripOf('w5').weather?.lat === 34.69 && r.current?.days.length === 5);
  });
});

describe('useAutoGeocode', () => {
  const item = (id: string, over: Partial<Item> = {}): Item => ({
    id, date: START, title: id, type: 'sight', done: false, createdAt: 0, updatedAt: 0, ...over,
  });
  function renderGeo(id: string) {
    const out: { current: { pending: number; running: boolean } | null } = { current: null };
    function Probe() {
      const trip = useData((s) => s.trips[id] ?? null);
      out.current = useAutoGeocode(trip);
      return null;
    }
    const root = createRoot(document.createElement('div'));
    roots.push(root);
    act(() => root.render(createElement(Probe)));
    return { out, root };
  }

  it('補上座標（連結 → link、查詢 → geocode），查不到的不重查', async () => {
    const calls = mockFetch((u) => ({ features: u.searchParams.get('q') === '錦市場' ? [{ geometry: { coordinates: [135.7656, 35.005] } }] : [] }));
    seedTrip('g1', {
      items: [item('A', { link: 'https://www.google.com/maps/@35.0394,135.7292,17z' }), item('錦市場'), item('沒有這個地方', { address: '' })],
    });
    const { out } = renderGeo('g1');
    // 連結不用連網，掛載當下就解析完成
    expect(out.current?.pending).toBe(2);
    expect(out.current?.running).toBe(true);
    await waitFor(() => out.current?.running === false && out.current.pending === 0, 8000);
    const items = tripOf('g1').items;
    expect(items[0].geo).toEqual({ lat: 35.0394, lng: 135.7292, source: 'link' });
    expect(items[1].geo).toEqual({ lat: 35.005, lng: 135.7656, source: 'geocode' });
    expect(items[2].geo).toBeUndefined();
    const n = calls.length;
    renderGeo('g1');
    await act(async () => {});
    expect(calls.length).toBe(n);
  }, 10_000);

  it('沒有城市座標時，用已定位的行程點當搜尋中心，太遠的結果（其他大陸的同名地點）不採用', async () => {
    // 「中央公園」查到美國亞特蘭大：離東京的行程點約 11,000 公里
    const calls = mockFetch(() => ({ features: [{ geometry: { coordinates: [-84.39, 33.75] } }] }));
    seedTrip('g3', {
      city: '', cityGeo: undefined,
      items: [
        item('a', { geo: { lat: 35.68, lng: 139.76, source: 'link' } }),
        item('b', { geo: { lat: 35.66, lng: 139.7, source: 'link' } }),
        item('中央公園'),
      ],
    });
    const { out } = renderGeo('g3');
    await waitFor(() => out.current?.running === false && calls.length > 0, 8000);
    expect(calls[0].searchParams.get('lat')).toBe('35.68');
    expect(calls[0].searchParams.get('lon')).toBe('139.76');
    expect(tripOf('g3').items[2].geo).toBeUndefined();
  }, 10_000);

  it('卸載時中止背景定位', async () => {
    const calls = mockFetch(() => ({ features: [{ geometry: { coordinates: [135.76, 35.0] } }] }));
    seedTrip('g2', { items: [item('一'), item('二'), item('三')] });
    const { out, root } = renderGeo('g2');
    await waitFor(() => tripOf('g2').items[0].geo !== undefined);
    act(() => root.unmount());
    roots = roots.filter((r) => r !== root);
    await new Promise((r) => setTimeout(r, 1500));
    expect(calls.length).toBe(1);
    expect(tripOf('g2').items.filter((i) => i.geo)).toHaveLength(1);
    expect(out.current?.running).toBe(true); // 最後一次 render 時還在跑
  });
});

describe('refreshRate', () => {
  it('寫入匯率與更新時間', async () => {
    mockFetch(() => ({ result: 'success', rates: { TWD: 0.2071 } }));
    seedTrip('r1');
    expect(await refreshRate('r1')).toBe(0.2071);
    expect(tripOf('r1').rate).toBe(0.2071);
    expect(tripOf('r1').rateUpdatedAt).toBeGreaterThan(0);
    await expect(refreshRate('不存在')).rejects.toThrow('找不到這趟旅程');
  });
});
