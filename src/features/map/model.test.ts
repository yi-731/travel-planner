import { describe, expect, it } from 'vitest';
import type { Item } from '@/domain/types';
import {
  CITY_ZOOM,
  dayStops,
  fmtKm,
  framing,
  geocodeLabel,
  locatedStops,
  missingTitle,
  myMapsFileName,
  pointsKey,
  QUICK_LINKS,
  resolveDate,
  SINGLE_ZOOM,
  stopAddress,
  stopSubtitle,
  straightKm,
  tileUrl,
  timeSpan,
  WORLD_VIEW,
} from './model';

let seq = 0;
const item = (p: Partial<Item> & Pick<Item, 'title'>): Item => ({
  id: `i${++seq}`,
  date: '2026-11-21',
  type: 'sight',
  done: false,
  createdAt: 0,
  updatedAt: 0,
  ...p,
});

describe('resolveDate', () => {
  const days = ['2026-11-21', '2026-11-22', '2026-11-23'];
  it('keeps a valid selection', () => expect(resolveDate(days, '2026-11-22', '2026-11-23')).toBe('2026-11-22'));
  it('falls back to today when inside the trip', () => expect(resolveDate(days, '2025-01-01', '2026-11-23')).toBe('2026-11-23'));
  it('falls back to the first day', () => expect(resolveDate(days, null, '2026-11-09')).toBe('2026-11-21'));
  it('returns null without days', () => expect(resolveDate([], null, '2026-11-09')).toBeNull());
});

describe('dayStops', () => {
  const trip = {
    items: [
      item({ title: '晚餐', time: '19:00', type: 'food', geo: { lat: 35.0, lng: 135.77, source: 'geocode' } }),
      item({ title: '早上', time: '08:00' }),
      item({ title: '別天', date: '2026-11-22', time: '09:00' }),
      item({ title: '中午', time: '12:00', type: 'transport', geo: { lat: 35.01, lng: 135.76, source: 'link' } }),
    ],
  };

  it('numbers the day in time order with type colors', () => {
    const st = dayStops(trip, '2026-11-21');
    expect(st.map((x) => [x.n, x.item.title, x.color])).toEqual([
      [1, '早上', '--t-sight'],
      [2, '中午', '--t-transport'],
      [3, '晚餐', '--t-food'],
    ]);
    expect(st[0].geo).toBeNull();
    expect(st[1].geo).toEqual({ lat: 35.01, lng: 135.76 });
  });

  it('is empty without a date', () => expect(dayStops(trip, null)).toEqual([]));

  it('keeps only located stops, in order, for the route', () => {
    const st = dayStops(trip, '2026-11-21');
    expect(locatedStops(st).map((x) => x.n)).toEqual([2, 3]);
    expect(pointsKey(st)).toMatch(/^i\d+:35\.01000,135\.76000\|i\d+:35\.00000,135\.77000$/);
  });

  it('sums straight-line distance only with 2+ points', () => {
    const st = dayStops(trip, '2026-11-21');
    const km = straightKm(st)!;
    expect(km).toBeGreaterThan(1.2);
    expect(km).toBeLessThan(1.6);
    expect(straightKm(st.slice(0, 2))).toBeNull();
  });
});

describe('framing', () => {
  const at = (lat: number, lng: number) => item({ title: 'x', geo: { lat, lng, source: 'manual' } });

  it('fits bounds with 2+ points', () => {
    const f = framing(dayStops({ items: [at(35, 135.7), at(35.1, 135.8)] }, '2026-11-21'));
    expect(f.kind).toBe('bounds');
  });
  it('centers a single point', () => {
    expect(framing(dayStops({ items: [at(35, 135.7)] }, '2026-11-21'))).toEqual({ kind: 'point', center: { lat: 35, lng: 135.7 }, zoom: SINGLE_ZOOM });
  });
  it('falls back to the city, then a regional view', () => {
    expect(framing([], { lat: 35.02, lng: 135.75 })).toEqual({ kind: 'point', center: { lat: 35.02, lng: 135.75 }, zoom: CITY_ZOOM });
    expect(framing([], null)).toEqual({ kind: 'point', center: WORLD_VIEW.center, zoom: WORLD_VIEW.zoom });
  });
});

describe('text helpers', () => {
  it('formats distances', () => {
    expect(fmtKm(0.234)).toBe('230 m');
    expect(fmtKm(0.001)).toBe('10 m');
    expect(fmtKm(3.456)).toBe('3.5 km');
    expect(fmtKm(23.6)).toBe('24 km');
  });

  it('builds the subtitle from time and address', () => {
    expect(stopSubtitle({ title: '飯店', time: '09:00', address: ' 京都駅 ' })).toBe('09:00 · 京都駅');
    expect(stopSubtitle({ title: '飯店', address: '  ' })).toBe('');
  });

  it('hides an address that only repeats the title', () => {
    expect(stopAddress({ title: '錦市場', address: '錦市場' })).toBe('');
    expect(stopAddress({ title: '清水寺', address: '京都市東山区清水1-294' })).toBe('京都市東山区清水1-294');
    expect(stopSubtitle({ title: '錦市場', time: '11:00', address: '錦市場' })).toBe('11:00');
  });

  it('shows the time span of the day', () => {
    const st = dayStops(
      { items: [item({ title: 'a', time: '16:00' }), item({ title: 'b', time: '07:30' }), item({ title: 'c' })] },
      '2026-11-21',
    );
    expect(timeSpan(st)).toBe('07:30–16:00');
    expect(timeSpan(st.slice(0, 1))).toBe('07:30');
    expect(timeSpan(dayStops({ items: [item({ title: 'c' })] }, '2026-11-21'))).toBe('');
  });

  it('shows geocoding progress', () => {
    expect(geocodeLabel(8, 5)).toBe('定位中 3/8…');
    expect(geocodeLabel(0, 4)).toBe('定位中 0/4…');
    expect(geocodeLabel(0, 0)).toBe('定位中…');
  });

  it('names the items without location', () => {
    expect(missingTitle([])).toBe('');
    expect(missingTitle([{ title: '清水寺' }])).toBe('「清水寺」找不到位置');
    expect(missingTitle([{ title: 'A' }, { title: 'B' }])).toBe('「A」和「B」找不到位置');
    expect(missingTitle([{ title: 'A' }, { title: 'B' }, { title: 'C' }])).toBe('「A」等 3 個行程點找不到位置');
  });

  it('makes a safe export file name', () => {
    expect(myMapsFileName('京阪奈/五日: 範例?')).toBe('京阪奈 五日 範例－我的地圖.csv');
    expect(myMapsFileName('  ')).toBe('行程－我的地圖.csv');
  });
});

describe('tiles and links', () => {
  it('picks CARTO tiles by theme', () => {
    expect(tileUrl(false)).toContain('/rastertiles/voyager/');
    expect(tileUrl(true)).toContain('/dark_all/');
    expect(tileUrl(true)).toContain('{r}');
  });
  it('has four quick links to Google Maps', () => {
    expect(QUICK_LINKS.map((q) => q.label)).toEqual(['即時路況', '附近美食', '便利商店', '車站']);
    for (const q of QUICK_LINKS) expect(q.href).toMatch(/^https:\/\/www\.google\.com\/maps\//);
  });
});
