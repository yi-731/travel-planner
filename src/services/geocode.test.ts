import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Item, Trip } from '@/domain/types';
import { cityHint, geocodeMissing, geocodePlace, parseMapsLink, placeQueries, THROTTLE_MS } from './geocode';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('parseMapsLink', () => {
  it.each([
    ['@ 畫面中心', 'https://www.google.com/maps/@35.0116,135.7681,15z', 35.0116, 135.7681],
    ['?q=', 'https://maps.google.com/?q=35.01,135.77', 35.01, 135.77],
    ['q= 編碼過的逗號', 'https://maps.google.com/maps?q=35.01%2C135.77&z=15', 35.01, 135.77],
    ['q=loc:', 'https://maps.google.com/?q=loc:35.01,135.77', 35.01, 135.77],
    ['query=（api=1）', 'https://www.google.com/maps/search/?api=1&query=35.01,135.77', 35.01, 135.77],
    ['ll=（Apple 地圖）', 'https://maps.apple.com/?ll=35.01,135.77&q=Kyoto', 35.01, 135.77],
    ['/maps/search/lat,+lng', 'https://www.google.com/maps/search/35.01,+135.77?entry=tts', 35.01, 135.77],
    ['geo: URI', 'geo:35.01,135.77?z=15', 35.01, 135.77],
    ['純座標', '35.01, 135.77', 35.01, 135.77],
    ['純座標（全形逗號）', '35.01，135.77', 35.01, 135.77],
    ['負數座標', 'https://www.google.com/maps/@-33.8568,151.2153,17z', -33.8568, 151.2153],
  ])('%s', (_name, url, lat, lng) => {
    expect(parseMapsLink(url)).toEqual({ lat, lng });
  });

  it('!3d!4d（地點本身）優先於 @（畫面中心）', () => {
    const url =
      'https://www.google.com/maps/place/Kiyomizu-dera/@34.9903,135.78,17z/data=!3m1!4b1!4m6!3m5!1s0x60010f!8m2!3d34.9948561!4d135.7850463!16s%2Fm';
    expect(parseMapsLink(url)).toEqual({ lat: 34.994856, lng: 135.785046 });
  });

  it('座標超出範圍或不是座標連結 → null', () => {
    expect(parseMapsLink('https://www.google.com/maps/@95.1,135.7,15z')).toBeNull();
    expect(parseMapsLink('35.01, 190.5')).toBeNull();
    expect(parseMapsLink('0, 0')).toBeNull();
    expect(parseMapsLink('https://maps.app.goo.gl/AbCdEf123')).toBeNull();
    expect(parseMapsLink('https://www.google.com/maps/place/清水寺')).toBeNull();
    expect(parseMapsLink('清水寺')).toBeNull();
    expect(parseMapsLink('')).toBeNull();
  });

  it('不完整的 % 編碼不會丟錯', () => {
    expect(parseMapsLink('https://maps.google.com/?q=35.01,135.77&x=%E0%A4%A')).toEqual({ lat: 35.01, lng: 135.77 });
  });
});

describe('placeQueries / cityHint', () => {
  it('地址 → 名稱 → 名稱＋城市', () => {
    expect(placeQueries({ address: '京都市東山区清水1-294', title: '清水寺' }, '京都')).toEqual(['京都市東山区清水1-294', '清水寺', '清水寺 京都']);
    expect(placeQueries({ title: '錦市場' }, '京都')).toEqual(['錦市場', '錦市場 京都']);
  });
  it('名稱已含城市不重複加；路線型標題不拿來查', () => {
    expect(placeQueries({ title: '京都站' }, '京都')).toEqual(['京都站']);
    expect(placeQueries({ address: '関西空港駅', title: '桃園機場 → 關西機場' }, '京都')).toEqual(['関西空港駅']);
    expect(placeQueries({ title: '  ' }, '京都')).toEqual([]);
  });
  it('cityHint 取標籤的城市部分', () => {
    expect(cityHint({ city: 'KYOTO', cityGeo: { lat: 0, lng: 0, label: '京都，日本' } })).toBe('京都');
    expect(cityHint({ city: 'KYOTO' })).toBe('KYOTO');
  });
});

/* ---------------- 以下測試把 fetch 換成假的 ---------------- */

const KYOTO = { lat: 35.0211, lng: 135.7539 };
type Feature = [number, number]; // [lng, lat]

function mockPhoton(answer: (q: string) => Feature[] | 'fail') {
  const calls: { q: string; url: URL; at: number }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const q = url.searchParams.get('q') ?? '';
      calls.push({ q, url, at: Date.now() });
      const a = answer(q);
      if (a === 'fail') throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify({ features: a.map((c) => ({ geometry: { coordinates: c } })) }), { status: 200 });
    }),
  );
  return calls;
}

describe('geocodePlace', () => {
  it('帶 lat/lon 偏好附近結果，不帶 lang', async () => {
    const calls = mockPhoton(() => [[135.7850463, 34.9948561]]);
    expect(await geocodePlace('清水寺', KYOTO)).toEqual({ lat: 34.994856, lng: 135.785046 });
    expect(calls[0].url.host).toBe('photon.komoot.io');
    expect(calls[0].url.searchParams.get('lat')).toBe('35.0211');
    expect(calls[0].url.searchParams.get('lon')).toBe('135.7539');
    expect(calls[0].url.searchParams.has('lang')).toBe(false);
  });
  it('跳過超過 300 公里的結果；全部太遠回傳 null', async () => {
    mockPhoton((q) => (q === '天龍寺' ? [[121.2, 25.08], [135.674, 35.0158]] : [[121.2, 25.08]]));
    expect(await geocodePlace('天龍寺', KYOTO)).toEqual({ lat: 35.0158, lng: 135.674 });
    expect(await geocodePlace('桃園機場', KYOTO)).toBeNull();
    // 沒給 near：不限距離
    expect(await geocodePlace('桃園機場')).toEqual({ lat: 25.08, lng: 121.2 });
  });
  it('空字串不連線；連線失敗丟出中文錯誤', async () => {
    const calls = mockPhoton(() => 'fail');
    expect(await geocodePlace('  ', KYOTO)).toBeNull();
    expect(calls).toHaveLength(0);
    await expect(geocodePlace('清水寺', KYOTO)).rejects.toThrow('無法連線到地點搜尋服務');
  });
});

describe('geocodeMissing', () => {
  const item = (id: string, over: Partial<Item> = {}): Item => ({
    id, date: '2026-11-21', title: id, type: 'sight', done: false, createdAt: 0, updatedAt: 0, ...over,
  });
  const trip = (items: Item[]): Trip => ({
    id: 't', name: '京都', city: 'KYOTO', cityGeo: { ...KYOTO, label: '京都，日本' }, startDate: '2026-11-21', endDate: '2026-11-25',
    localCurrency: 'JPY', homeCurrency: 'TWD', rate: 0.2, members: ['我'], items, expenses: [], cover: { kind: 'orb' },
    ai: { dayChecks: {} }, createdAt: 0, updatedAt: 0,
  });

  it('先用連結、再依序查地址與名稱；已有座標的跳過；請求間隔至少 1.1 秒', async () => {
    vi.useFakeTimers();
    const calls = mockPhoton((q) => (q === '清水寺' ? [[135.785, 34.9949]] : q === '錦市場' ? [[135.765, 35.005]] : []));
    const t = trip([
      item('A', { geo: { lat: 35, lng: 135.7, source: 'manual' } }),
      item('B', { link: 'https://www.google.com/maps/@35.0394,135.7292,17z' }),
      item('C', { title: '清水寺', address: '京都市東山区清水1-294' }),
      item('D', { title: '錦市場' }),
      item('E', { title: '查不到的地方' }),
    ]);
    const got: [string, { lat: number; lng: number }][] = [];
    const p = geocodeMissing(t, (id, g) => got.push([id, g]));
    await vi.runAllTimersAsync();
    expect(await p).toBe(3);
    expect(got).toEqual([
      ['B', { lat: 35.0394, lng: 135.7292 }],
      ['C', { lat: 34.9949, lng: 135.785 }],
      ['D', { lat: 35.005, lng: 135.765 }],
    ]);
    expect(calls.map((c) => c.q)).toEqual(['京都市東山区清水1-294', '清水寺', '錦市場', '查不到的地方', '查不到的地方 京都']);
    for (let k = 1; k < calls.length; k++) expect(calls[k].at - calls[k - 1].at).toBeGreaterThanOrEqual(THROTTLE_MS);
  });

  it('取消時安靜停止並回傳目前筆數', async () => {
    vi.useFakeTimers();
    const ctrl = new AbortController();
    const calls = mockPhoton(() => [[135.76, 35.0]]);
    const t = trip([item('清水寺'), item('錦市場'), item('天龍寺')]);
    const got: string[] = [];
    const p = geocodeMissing(
      t,
      (id) => {
        got.push(id);
        if (got.length === 1) ctrl.abort();
      },
      ctrl.signal,
    );
    await vi.runAllTimersAsync();
    expect(await p).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it('連線失敗時丟出中文錯誤（已找到的已回報）', async () => {
    vi.useFakeTimers();
    mockPhoton((q) => (q === '清水寺' ? [[135.785, 34.9949]] : 'fail'));
    const got: string[] = [];
    const p = geocodeMissing(trip([item('清水寺'), item('錦市場')]), (id) => got.push(id));
    const check = expect(p).rejects.toThrow('無法連線到地點搜尋服務');
    await vi.runAllTimersAsync();
    await check;
    expect(got).toEqual(['清水寺']);
  });
});
