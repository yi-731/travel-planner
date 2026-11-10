import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays } from '@/domain/dates';
import type { DailyWeather, Trip, WeatherCache } from '@/domain/types';
import {
  averageClimate,
  cityLabel,
  cityNameVariants,
  climateYearsBack,
  fetchTripWeather,
  dayWeatherLocation,
  findCitiesInText,
  findCityAlias,
  geocodeCity,
  geocodeTravelCity,
  modeWeatherCode,
  parseForecast,
  shiftYears,
  validWeatherDays,
  weatherInfo,
  weatherLocations,
  weatherLocKey,
  weatherStale,
  type ArchiveDaily,
} from './weather';

const TODAY = '2026-11-09';
const KYOTO = { lat: 35.0211, lng: 135.7539, label: '京都，日本', timezone: 'Asia/Tokyo', countryCode: 'JP' };

function trip(over: Partial<Trip> = {}): Trip {
  return {
    id: 't1',
    name: '京都',
    city: 'KYOTO',
    cityGeo: KYOTO,
    startDate: addDays(TODAY, 12),
    endDate: addDays(TODAY, 16),
    localCurrency: 'JPY',
    homeCurrency: 'TWD',
    rate: 0.2,
    members: ['我'],
    items: [],
    expenses: [],
    cover: { kind: 'orb' },
    ai: { dayChecks: {} },
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

const day = (date: string, kind: DailyWeather['kind'] = 'forecast'): DailyWeather => ({ date, code: 1, tMax: 15, tMin: 5, kind });
const HOUR = 3600_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 9, 12, 0, 0));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('weatherInfo', () => {
  it('對照常見 WMO 代碼', () => {
    expect(weatherInfo(0)).toEqual({ label: '晴', icon: 'sun' });
    expect(weatherInfo(1)).toEqual({ label: '大致晴朗', icon: 'sun' });
    expect(weatherInfo(2)).toEqual({ label: '多雲', icon: 'cloud' });
    expect(weatherInfo(3)).toEqual({ label: '陰天', icon: 'cloud' });
    expect(weatherInfo(45).icon).toBe('fog');
    expect(weatherInfo(53).label).toBe('毛毛雨');
    expect(weatherInfo(61).label).toBe('小雨');
    expect(weatherInfo(63)).toEqual({ label: '雨', icon: 'rain' });
    expect(weatherInfo(65).label).toBe('大雨');
    expect(weatherInfo(67).label).toBe('凍雨');
    expect(weatherInfo(71)).toEqual({ label: '小雪', icon: 'snow' });
    expect(weatherInfo(75).label).toBe('大雪');
    expect(weatherInfo(80).label).toBe('陣雨');
    expect(weatherInfo(95)).toEqual({ label: '雷雨', icon: 'storm' });
    expect(weatherInfo(99).icon).toBe('storm');
  });
  it('表外代碼依區段歸類，不會丟錯', () => {
    expect(weatherInfo(62).icon).toBe('rain');
    expect(weatherInfo(74).icon).toBe('snow');
    expect(weatherInfo(97).icon).toBe('storm');
    expect(weatherInfo(-1).label).toBe('天氣不明');
    expect(weatherInfo(Number.NaN).label).toBe('天氣不明');
  });
});

describe('日期小工具', () => {
  it('shiftYears 處理閏年 2/29', () => {
    expect(shiftYears('2026-11-21', -1)).toBe('2025-11-21');
    expect(shiftYears('2028-02-29', -1)).toBe('2027-02-28');
    expect(shiftYears('2028-02-29', -4)).toBe('2024-02-29');
  });
  it('climateYearsBack 只用一週以前的資料', () => {
    expect(climateYearsBack('2026-11-25', TODAY)).toEqual([1, 2, 3]);
    // 明年底的行程：往前 1 年（今年底）還沒發生，要從往前 2 年開始
    expect(climateYearsBack('2027-12-30', TODAY)).toEqual([2, 3, 4]);
    // 剛過去的日子：去年同期可用
    expect(climateYearsBack('2026-11-05', TODAY)).toEqual([1, 2, 3]);
  });
});

describe('averageClimate', () => {
  const sample = (k: number, rows: [string, number | null, number | null, number | null, number | null][]): { yearsBack: number; daily: ArchiveDaily } => ({
    yearsBack: k,
    daily: {
      time: rows.map((r) => r[0]),
      weather_code: rows.map((r) => r[1]),
      temperature_2m_max: rows.map((r) => r[2]),
      temperature_2m_min: rows.map((r) => r[3]),
      precipitation_sum: rows.map((r) => r[4]),
    },
  });

  it('取最常見的代碼、平均氣溫（整數）與雨量（一位小數）', () => {
    const out = averageClimate(
      ['2026-11-21', '2026-11-22'],
      [
        sample(1, [['2025-11-21', 3, 14.2, 5.1, 0], ['2025-11-22', 61, 12, 6, 4.2]]),
        sample(2, [['2024-11-21', 3, 15.9, 4.4, 1.1], ['2024-11-22', 1, 13, 7, 0]]),
        sample(3, [['2023-11-21', 61, 13.1, 6.0, 7.3], ['2023-11-22', 80, 11, 5, 2.5]]),
      ],
    );
    expect(out).toEqual([
      { date: '2026-11-21', code: 3, tMax: 14, tMin: 5, rainMm: 2.8, kind: 'climate' },
      // 三年都不同：取代碼中位數（61）
      { date: '2026-11-22', code: 61, tMax: 12, tMin: 6, rainMm: 2.2, kind: 'climate' },
    ]);
  });

  it('略過缺值；完全沒資料的日期不輸出', () => {
    const out = averageClimate(
      ['2026-11-21', '2026-11-30'],
      [sample(1, [['2025-11-21', 2, 10, null, null]]), sample(2, [['2024-11-21', null, 12, 4, 1]])],
    );
    expect(out).toEqual([{ date: '2026-11-21', code: 2, tMax: 11, tMin: 4, rainMm: 1, kind: 'climate' }]);
  });

  it('modeWeatherCode：多數決，平手取中位數', () => {
    expect(modeWeatherCode([3, 3, 61])).toBe(3);
    expect(modeWeatherCode([1, 3, 61])).toBe(3);
    expect(modeWeatherCode([0, 61])).toBe(0);
    expect(modeWeatherCode([95])).toBe(95);
  });
});

describe('parseForecast', () => {
  it('轉成 DailyWeather，日出日落存 HH:mm，缺值的日子略過', () => {
    const out = parseForecast({
      time: ['2026-11-21', '2026-11-22'],
      weather_code: [80, null],
      temperature_2m_max: [11.1, 15.9],
      temperature_2m_min: [6.8, 5.3],
      precipitation_probability_max: [23, 21],
      sunrise: ['2026-11-21T06:36', '2026-11-22T06:37'],
      sunset: ['2026-11-21T16:48', '2026-11-22T16:48'],
    });
    expect(out).toEqual([
      { date: '2026-11-21', code: 80, tMax: 11, tMin: 7, rainProb: 23, sunrise: '06:36', sunset: '16:48', kind: 'forecast' },
    ]);
  });
});

describe('weatherStale', () => {
  const days5 = (kindOf: (d: string) => DailyWeather['kind']) =>
    [12, 13, 14, 15, 16].map((n) => day(addDays(TODAY, n), kindOf(addDays(TODAY, n))));
  const cache = (days: DailyWeather[], ageMs: number, geo = KYOTO): WeatherCache => ({ fetchedAt: Date.now() - ageMs, lat: geo.lat, lng: geo.lng, days });
  const fresh = days5((d) => (d <= addDays(TODAY, 15) ? 'forecast' : 'climate'));

  it('沒有快取或沒有城市座標 → 過期', () => {
    expect(weatherStale(undefined, trip())).toBe(true);
    expect(weatherStale(cache(fresh, 0), trip({ cityGeo: undefined }))).toBe(true);
  });
  it('城市座標換了 → 過期', () => {
    expect(weatherStale(cache(fresh, 0), trip({ cityGeo: { lat: 34.69, lng: 135.5 } }))).toBe(true);
    // 小於約 1 公里的差異視為同一地點
    expect(weatherStale(cache(fresh, 0), trip({ cityGeo: { lat: 35.0215, lng: 135.754 } }))).toBe(false);
  });
  it('行程日期沒有全部涵蓋 → 過期', () => {
    expect(weatherStale(cache(fresh.slice(0, 4), 0), trip())).toBe(true);
    expect(weatherStale(cache(fresh, 0), trip({ endDate: addDays(TODAY, 17) }))).toBe(true);
  });
  it('預報範圍內還是歷年平均 → 過期；第 16 天容許還沒有預報', () => {
    const climateAll = days5(() => 'climate');
    expect(weatherStale(cache(climateAll, HOUR), trip())).toBe(true);
    const lastDayClimate = trip({ startDate: addDays(TODAY, 11), endDate: addDays(TODAY, 15) });
    const c = cache([11, 12, 13, 14, 15].map((n) => day(addDays(TODAY, n), n === 15 ? 'climate' : 'forecast')), HOUR);
    expect(weatherStale(c, lastDayClimate)).toBe(false);
  });
  it('預報 3 小時過期', () => {
    expect(weatherStale(cache(fresh, 2 * HOUR), trip())).toBe(false);
    expect(weatherStale(cache(fresh, 3 * HOUR + 1), trip())).toBe(true);
  });
  it('只有歷年平均（行程還很遠）7 天過期', () => {
    const far = trip({ startDate: addDays(TODAY, 40), endDate: addDays(TODAY, 42) });
    const c = (age: number) => cache([40, 41, 42].map((n) => day(addDays(TODAY, n), 'climate')), age);
    expect(weatherStale(c(6 * 24 * HOUR), far)).toBe(false);
    expect(weatherStale(c(7 * 24 * HOUR + 1), far)).toBe(true);
  });
  it('旅程已結束且資料齊全 → 不再更新', () => {
    const past = trip({ startDate: addDays(TODAY, -10), endDate: addDays(TODAY, -8) });
    const c = cache([-10, -9, -8].map((n) => day(addDays(TODAY, n), 'forecast')), 60 * 24 * HOUR);
    expect(weatherStale(c, past)).toBe(false);
  });
});

/* ---------------- 以下測試把 fetch 換成假的 ---------------- */

type Route = (u: URL) => { status?: number; body: unknown } | undefined;
function mockFetch(route: Route) {
  const calls: URL[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const u = new URL(String(input));
    calls.push(u);
    const r = route(u);
    if (!r) throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

/** 依查詢範圍產生每天的假資料 */
function rangeDays(start: string, end: string) {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}
function forecastBody(u: URL) {
  const time = rangeDays(u.searchParams.get('start_date')!, u.searchParams.get('end_date')!);
  return {
    daily: {
      time,
      weather_code: time.map(() => 3),
      temperature_2m_max: time.map(() => 14.4),
      temperature_2m_min: time.map(() => 4.6),
      precipitation_probability_max: time.map(() => 20),
      sunrise: time.map((t) => `${t}T06:35`),
      sunset: time.map((t) => `${t}T16:48`),
    },
  };
}
function archiveBody(u: URL) {
  const time = rangeDays(u.searchParams.get('start_date')!, u.searchParams.get('end_date')!);
  const y = +time[0].slice(0, 4);
  return {
    daily: {
      time,
      weather_code: time.map(() => (y === 2025 ? 61 : 1)),
      temperature_2m_max: time.map(() => 12 + (2025 - y)),
      temperature_2m_min: time.map(() => 4),
      precipitation_sum: time.map(() => (y === 2025 ? 6 : 0)),
    },
  };
}

describe('fetchTripWeather', () => {
  it('16 天內用預報、之後用近 3 年同期平均', async () => {
    const calls = mockFetch((u) =>
      u.host === 'api.open-meteo.com' ? { body: forecastBody(u) } : u.host === 'archive-api.open-meteo.com' ? { body: archiveBody(u) } : undefined,
    );
    const c = await fetchTripWeather(trip());
    expect(c.lat).toBe(KYOTO.lat);
    expect(c.days.map((d) => [d.date, d.kind])).toEqual([
      ['2026-11-21', 'forecast'],
      ['2026-11-22', 'forecast'],
      ['2026-11-23', 'forecast'],
      ['2026-11-24', 'forecast'],
      ['2026-11-25', 'climate'],
    ]);
    expect(c.days[0]).toMatchObject({ code: 3, tMax: 14, tMin: 5, rainProb: 20, sunrise: '06:35' });
    // 2025:61 / 2024:1 / 2023:1 → 1；氣溫 12、13、14 → 13；雨量 6、0、0 → 2
    expect(c.days[4]).toEqual({ date: '2026-11-25', code: 1, tMax: 13, tMin: 4, rainMm: 2, kind: 'climate', place: '京都' });

    const fc = calls.find((u) => u.host === 'api.open-meteo.com')!;
    expect(fc.searchParams.get('start_date')).toBe('2026-11-21');
    expect(fc.searchParams.get('end_date')).toBe('2026-11-24');
    expect(fc.searchParams.get('timezone')).toBe('auto');
    const years = calls.filter((u) => u.host === 'archive-api.open-meteo.com').map((u) => u.searchParams.get('start_date')).sort();
    expect(years).toEqual(['2023-11-25', '2024-11-25', '2025-11-25']);
  });

  it('伺服器日期範圍較短時縮小重試', async () => {
    const calls = mockFetch((u) => {
      if (u.host === 'archive-api.open-meteo.com') return { body: archiveBody(u) };
      if (u.searchParams.get('end_date') === '2026-11-24') {
        return { status: 400, body: { error: true, reason: "Parameter 'end_date' is out of allowed range from 2026-08-08 to 2026-11-23" } };
      }
      return { body: forecastBody(u) };
    });
    const c = await fetchTripWeather(trip());
    expect(c.days.find((d) => d.date === '2026-11-24')?.kind).toBe('climate');
    expect(c.days.filter((d) => d.kind === 'forecast')).toHaveLength(3);
    expect(calls.filter((u) => u.host === 'api.open-meteo.com')).toHaveLength(2);
  });

  it('沿用快取中的歷年平均，不重複查詢', async () => {
    const calls = mockFetch((u) => (u.host === 'api.open-meteo.com' ? { body: forecastBody(u) } : undefined));
    const prev: WeatherCache = { fetchedAt: Date.now() - 5 * HOUR, lat: KYOTO.lat, lng: KYOTO.lng, days: [day('2026-11-25', 'climate')] };
    const c = await fetchTripWeather(trip({ weather: prev }));
    expect(c.days).toHaveLength(5);
    expect(c.days[4]).toEqual({ ...day('2026-11-25', 'climate'), place: '京都' });
    expect(calls.some((u) => u.host === 'archive-api.open-meteo.com')).toBe(false);
  });

  it('歷年平均查詢額度用完：仍回傳預報的日子', async () => {
    mockFetch((u) =>
      u.host === 'api.open-meteo.com' ? { body: forecastBody(u) } : { status: 429, body: { error: true, reason: 'Daily API request limit exceeded.' } },
    );
    const c = await fetchTripWeather(trip());
    expect(c.days.map((d) => d.date)).toEqual(['2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24']);
  });

  it('全部失敗時丟出中文錯誤', async () => {
    mockFetch(() => undefined);
    await expect(fetchTripWeather(trip())).rejects.toThrow('無法連線到天氣服務');
    mockFetch(() => ({ status: 429, body: { error: true, reason: 'limit' } }));
    await expect(fetchTripWeather(trip({ startDate: addDays(TODAY, 40), endDate: addDays(TODAY, 41) }))).rejects.toThrow('免費查詢次數');
  });

  it('沒有城市座標時提示先設定城市', async () => {
    await expect(fetchTripWeather(trip({ cityGeo: undefined }))).rejects.toThrow('行程設定');
  });

  it('沒有日期時回傳空資料、不連線', async () => {
    const calls = mockFetch(() => undefined);
    const c = await fetchTripWeather(trip({ startDate: null, endDate: null }));
    expect(c.days).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe('城市定位', () => {
  it('別名表：中英文、異體字、加了「市」都能對到', () => {
    expect(findCityAlias('首爾')?.en).toBe('Seoul');
    expect(findCityAlias('臺北市')?.en).toBe('Taipei');
    expect(findCityAlias('KYOTO')?.display).toBe('京都');
    expect(findCityAlias('  osaka ')?.display).toBe('大阪');
    expect(findCityAlias('火星')).toBeUndefined();
  });
  it('cityNameVariants', () => {
    expect(cityNameVariants('臺北')).toEqual(['臺北', '台北', '臺北市', '台北市']);
    expect(cityNameVariants('胡志明市')).toEqual(['胡志明市', '胡志明']);
    // 去掉字尾只剩一個字就不試（京都 → 京）
    expect(cityNameVariants('京都')).toEqual(['京都', '京都市']);
    expect(cityNameVariants('Kyoto')).toEqual(['Kyoto']);
    expect(cityNameVariants('  ')).toEqual([]);
  });
  it('cityLabel 用台灣用語國名，城市即國家時不重複', () => {
    expect(cityLabel('京都', 'JP')).toBe('京都，日本');
    expect(cityLabel('首爾', 'KR')).toBe('首爾，南韓');
    expect(cityLabel('香港', 'HK')).toBe('香港');
    expect(cityLabel('新加坡', 'SG')).toBe('新加坡');
    expect(cityLabel('某地', undefined, '某國')).toBe('某地，某國');
  });

  const om = (name: string, extra: Record<string, unknown> = {}) => ({
    name, latitude: 37.566, longitude: 126.9784, feature_code: 'PPLC', country_code: 'KR', country: '韩国', timezone: 'Asia/Seoul', population: 10349312, ...extra,
  });

  it('別名城市用英文名＋國家代碼查詢，標籤用使用者的寫法', async () => {
    const calls = mockFetch((u) => (u.searchParams.get('name') === 'Seoul' ? { body: { results: [om('首尔特别市')] } } : { body: {} }));
    const g = await geocodeCity('首爾');
    expect(g).toEqual({ lat: 37.566, lng: 126.9784, label: '首爾，南韓', timezone: 'Asia/Seoul', countryCode: 'KR' });
    expect(calls[0].searchParams.get('countryCode')).toBe('KR');
    expect(calls[0].searchParams.get('language')).toBe('zh');
  });

  it('多筆結果時選人口多的城市，而不是同名小村莊', async () => {
    mockFetch(() => ({
      body: {
        results: [
          om('羅馬', { country_code: 'US', feature_code: 'PPL', population: 32573, latitude: 43.2, longitude: -75.4 }),
          om('羅馬', { country_code: 'IT', feature_code: 'PPLC', population: 2318895, latitude: 41.89, longitude: 12.51 }),
        ],
      },
    }));
    const g = await geocodeCity('Roma');
    expect(g?.countryCode).toBe('IT');
    expect(g?.label).toBe('羅馬，義大利');
  });

  it('第一個結果不可信時試其他寫法，再退回 OpenStreetMap', async () => {
    const village = om('某某', { country_code: 'CN', feature_code: 'PPL', population: undefined, latitude: 30, longitude: 110 });
    const calls = mockFetch((u) => {
      if (u.host === 'photon.komoot.io') {
        return { body: { features: [{ geometry: { coordinates: [121.1, 24.1] }, properties: { name: '某某市', osm_value: 'city', countrycode: 'TW' } }] } };
      }
      return { body: u.searchParams.get('name') === '某某' ? { results: [village] } : {} };
    });
    const g = await geocodeCity('某某');
    expect(calls.map((u) => u.searchParams.get('name') ?? u.searchParams.get('q'))).toEqual(['某某', '某某市', '某某']);
    expect(g).toEqual({ lat: 24.1, lng: 121.1, label: '某某，台灣', countryCode: 'TW' });
  });

  it('都找不到回傳 null；OpenStreetMap 也沒有時才用不可信的結果', async () => {
    mockFetch(() => ({ body: { features: [] } }));
    expect(await geocodeCity('完全不存在的地方')).toBeNull();
    expect(await geocodeCity('')).toBeNull();

    const hamlet = om('小村', { country_code: 'JP', feature_code: 'PPL', population: 800, latitude: 36.1, longitude: 137.2, timezone: 'Asia/Tokyo' });
    mockFetch((u) => (u.host === 'photon.komoot.io' ? { body: { features: [] } } : { body: u.searchParams.get('name') === '小村' ? { results: [hamlet] } : {} }));
    expect(await geocodeCity('小村')).toEqual({ lat: 36.1, lng: 137.2, label: '小村，日本', timezone: 'Asia/Tokyo', countryCode: 'JP' });
  });

  it('連線失敗丟出中文錯誤（不要誤報成找不到）', async () => {
    mockFetch(() => undefined);
    await expect(geocodeCity('京都')).rejects.toThrow('無法連線到城市定位服務');
  });
});

/* ---------------- 多城市行程 ---------------- */

const PDX = { lat: 45.5152, lng: -122.6784, en: 'Portland', admin1: 'Oregon', countryCode: 'US', label: '波特蘭，美國' };
const SEA = { lat: 47.6062, lng: -122.3321, label: '西雅圖，美國', countryCode: 'US' };

/** 西雅圖出發 → 波特蘭兩晚 → 回西雅圖（日期在預報範圍內） */
function multiTrip(over: Partial<Trip> = {}): Trip {
  const d = (n: number) => addDays(TODAY, n);
  return trip({
    city: '西雅圖',
    cityGeo: SEA,
    startDate: d(2),
    endDate: d(5),
    days: {
      [d(2)]: { city: '西雅圖', label: '台北 → 西雅圖' },
      [d(3)]: { city: '波特蘭', geo: PDX, lodging: 'Maple Lodge' },
      // 沒寫城市：沿用前一天
      [d(4)]: { label: '酒莊一日遊' },
      [d(5)]: { city: '西雅圖' },
    },
    ...over,
  });
}

describe('每天的天氣地點', () => {
  it('依當天城市；沒寫城市沿用前一天；同城市沒有座標時用行程城市的座標', () => {
    const t = multiTrip();
    expect(dayWeatherLocation(t, addDays(TODAY, 2))).toEqual({ lat: 47.6062, lng: -122.3321, place: '西雅圖' });
    expect(dayWeatherLocation(t, addDays(TODAY, 3))).toEqual({ lat: 45.5152, lng: -122.6784, place: '波特蘭' });
    expect(dayWeatherLocation(t, addDays(TODAY, 4))).toEqual({ lat: 45.5152, lng: -122.6784, place: '波特蘭' });
    expect(weatherLocKey(weatherLocations(t))).toBe(
      `${addDays(TODAY, 2)}:47.61,-122.33|${addDays(TODAY, 3)}:45.52,-122.68|${addDays(TODAY, 4)}:45.52,-122.68|${addDays(TODAY, 5)}:47.61,-122.33`,
    );
  });
  it('單一城市行程（沒有 days）：全部用行程城市，地點名稱是別名表的中文名', () => {
    expect(dayWeatherLocation(trip(), addDays(TODAY, 12))).toEqual({ lat: KYOTO.lat, lng: KYOTO.lng, place: '京都' });
  });
});

describe('fetchTripWeather（多城市）', () => {
  it('一次請求帶多個座標，每天用自己城市的天氣，並記下 place 與 locKey', async () => {
    const calls = mockFetch((u) => {
      if (u.host !== 'api.open-meteo.com') return undefined;
      const lats = u.searchParams.get('latitude')!.split(',');
      // 多個座標時回傳陣列；波特蘭比較冷
      return { body: lats.map((lat) => {
        const b = forecastBody(u);
        if (lat.startsWith('45')) b.daily.temperature_2m_max = b.daily.temperature_2m_max.map(() => 8);
        return b;
      }) };
    });
    const t = multiTrip();
    const c = await fetchTripWeather(t);
    const fc = calls.filter((u) => u.host === 'api.open-meteo.com');
    expect(fc).toHaveLength(1);
    expect(fc[0].searchParams.get('latitude')).toBe('47.6062,45.5152');
    expect(fc[0].searchParams.get('longitude')).toBe('-122.3321,-122.6784');
    expect(c.days.map((d) => [d.place, d.tMax])).toEqual([['西雅圖', 14], ['波特蘭', 8], ['波特蘭', 8], ['西雅圖', 14]]);
    expect(c.locKey).toBe(weatherLocKey(weatherLocations(t)));
    expect(c.lat).toBe(SEA.lat);
    expect(weatherStale(c, t)).toBe(false);
  });

  it('某天換了城市：locKey 不同 → 過期；只有那天的舊天氣不顯示', async () => {
    mockFetch((u) => (u.host === 'api.open-meteo.com' ? { body: u.searchParams.get('latitude')!.includes(',') ? [forecastBody(u), forecastBody(u)] : forecastBody(u) } : undefined));
    const t = multiTrip();
    const c = await fetchTripWeather(t);
    const moved = multiTrip();
    moved.days![addDays(TODAY, 5)] = { city: '波特蘭', geo: PDX };
    expect(weatherStale(c, moved)).toBe(true);
    expect(validWeatherDays(c, moved).map((d) => d.date)).toEqual([2, 3, 4].map((n) => addDays(TODAY, n)));
    expect(validWeatherDays(c, t)).toHaveLength(4);
  });

  it('舊版快取（沒有 locKey）：單一城市行程照常有效', () => {
    const legacy: WeatherCache = { fetchedAt: Date.now(), lat: KYOTO.lat, lng: KYOTO.lng, days: [12, 13, 14, 15, 16].map((n) => day(addDays(TODAY, n), n <= 15 ? 'forecast' : 'climate')) };
    expect(weatherStale(legacy, trip())).toBe(false);
    expect(validWeatherDays(legacy, trip())).toHaveLength(5);
    // 多城市行程用舊快取：城市不同的日子視為過期
    const pdxDay = trip({ days: { [addDays(TODAY, 14)]: { city: '波特蘭', geo: PDX } } });
    expect(weatherStale(legacy, pdxDay)).toBe(true);
  });

  it('沒有行程城市、但有日期城市：用第一個有座標的日子當主要座標', async () => {
    mockFetch((u) => (u.host === 'api.open-meteo.com' ? { body: forecastBody(u) } : undefined));
    const t = trip({ city: '', cityGeo: undefined, startDate: addDays(TODAY, 3), endDate: addDays(TODAY, 4), days: { [addDays(TODAY, 3)]: { city: '波特蘭', geo: PDX } } });
    const c = await fetchTripWeather(t);
    expect(c.lat).toBe(PDX.lat);
    expect(c.days.every((d) => d.place === '波特蘭')).toBe(true);
  });
});

describe('城市別名與文字中的城市', () => {
  it('別名表：英文簡稱、州', () => {
    expect(findCityAlias('SF')?.display).toBe('舊金山');
    expect(findCityAlias('firenze')?.display).toBe('佛羅倫斯');
    expect(findCityAlias('NYC')?.en).toBe('New York');
    expect(findCityAlias('波特蘭')).toEqual({ display: '波特蘭', en: 'Portland', cc: 'US', admin1: 'Oregon' });
    expect(findCityAlias('San Jose')?.display).toBe('聖荷西');
    // 舊格式（沒有州）照常
    expect(findCityAlias('京都')).toEqual({ display: '京都', en: 'Kyoto', cc: 'JP', admin1: undefined });
  });
  it('findCitiesInText：飯店名稱裡的城市、較長的寫法優先', () => {
    const names = (s: string) => findCitiesInText(s).map((m) => m.alias.display);
    expect(names('住 Harbor Inn Portland')).toEqual(['波特蘭']);
    expect(names('New York Bagels Seattle')).toEqual(['紐約', '西雅圖']);
    expect(names('Venice Beach 散步')).toEqual(['威尼斯']);
    expect(names('東京都庁')).toEqual(['東京']);
    expect(names('Kobe｜當地時間')).toEqual(['神戶']);
    expect(names('New Taipei 夜市')).toEqual(['新北']);
  });
  it('findCitiesInText：路名、菜名、短英文的大小寫不算', () => {
    const names = (s: string) => findCitiesInText(s).map((m) => m.alias.display);
    expect(names('1234 Portland Ave')).toEqual([]);
    expect(names('北京烤鴨')).toEqual([]);
    expect(names('晚餐 大阪燒')).toEqual([]);
    expect(names('LAOX 免稅店')).toEqual([]);
    expect(names('La Boqueria 市場')).toEqual([]);
    expect(names('kobe beef 3')).toEqual([]);
    expect(names('日光浴')).toEqual([]);
  });
});

describe('geocodeTravelCity', () => {
  it('同名城市選別名表指定的州（Portland, ME 人口「比較多」（假資料）也選 OR），回傳英文名與州', async () => {
    const calls = mockFetch((u) =>
      u.searchParams.get('name') === 'Portland'
        ? {
            body: {
              results: [
                { name: 'Portland', admin1: 'Maine', latitude: 43.6591, longitude: -70.2568, feature_code: 'PPLA2', population: 900000, country_code: 'US' },
                { name: 'Portland', admin1: 'Oregon', latitude: 45.5152, longitude: -122.6784, feature_code: 'PPLA2', population: 652503, country_code: 'US', timezone: 'America/Los_Angeles' },
              ],
            },
          }
        : { body: {} },
    );
    const g = await geocodeTravelCity('波特蘭');
    expect(g).toEqual({ lat: 45.5152, lng: -122.6784, label: '波特蘭，美國', en: 'Portland', admin1: 'Oregon', timezone: 'America/Los_Angeles', countryCode: 'US' });
    expect(calls[0].searchParams.get('language')).toBe('en');
    expect(calls[0].searchParams.get('countryCode')).toBe('US');
  });
  it('不在別名表的城市：照原文查，英文結果名當 en', async () => {
    mockFetch(() => ({ body: { results: [{ name: 'Hood River', admin1: 'Oregon', latitude: 45.7054, longitude: -121.5215, feature_code: 'PPLA2', population: 8300, country_code: 'US' }] } }));
    expect(await geocodeTravelCity('Hood River')).toMatchObject({ en: 'Hood River', admin1: 'Oregon', label: 'Hood River，美國' });
  });
});
