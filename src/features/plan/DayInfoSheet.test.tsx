import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Item, Trip } from '@/domain/types';

/*
 * 「這一天」彈出頁：改城市 → 這天變成手動（清掉舊座標重新定位）、重新辨識導航目的地，
 * 手動設定過的導航目的地與座標不受影響；沒改東西按儲存不寫入。
 */
vi.mock('idb-keyval', () => ({ get: async () => undefined, set: async () => {}, del: async () => {} }));
vi.mock('@/platform', async (orig) => ({ ...(await orig<typeof import('@/platform')>()), haptic: async () => {} }));
// 天氣不連網：固定回傳沒有資料
vi.mock('@/services/hooks', () => ({
  useTripWeather: () => ({ days: [], loading: false, error: null, refresh: () => {}, forDate: () => undefined, fetchedAt: null }),
}));

const { useData } = await import('@/store');
const { useUI } = await import('@/store/ui');
const { default: DayInfoSheet } = await import('./DayInfoSheet');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
});

const SEA = { lat: 47.6062, lng: -122.3321, label: '西雅圖，美國', en: 'Seattle', admin1: 'Washington', countryCode: 'US' };
const D1 = '2026-11-09',
  D2 = '2026-11-10';

const it0 = (id: string, extra: Partial<Item>): Item => ({ id, date: D2, title: id, type: 'sight', done: false, createdAt: 0, updatedAt: 0, ...extra });

const trip = (): Trip => ({
  id: 't',
  name: '合成行程',
  city: '舊金山',
  startDate: D1,
  endDate: D2,
  localCurrency: 'USD',
  homeCurrency: 'TWD',
  rate: 32,
  members: ['我'],
  items: [
    it0('manual', { title: 'Pike Place Market', place: { query: 'Pike Place Market, Seattle, WA', source: 'manual', navigable: true }, geo: { lat: 47.6, lng: -122.3, source: 'geocode' } }),
    it0('hotel', { title: 'Thompson check-in', address: '110 Stewart St' }),
  ],
  expenses: [],
  cover: { kind: 'orb' },
  ai: { dayChecks: {} },
  days: {
    [D1]: { label: '台北 → 舊金山', city: '舊金山', source: 'rule' },
    [D2]: { label: '舊金山 → 西雅圖｜住 Thompson Seattle', city: '西雅圖', lodging: 'Thompson Seattle', geo: SEA, source: 'rule' },
  },
  createdAt: 0,
  updatedAt: 0,
});

let root: Root | null = null;
let host: HTMLElement | null = null;
beforeEach(() => {
  useData.setState({ trips: { t: trip() }, activeTripId: 't', hydrated: true });
  useUI.setState({ sheets: [{ name: 'dayInfo', date: D2 }], toasts: [], busy: {} });
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = host = null;
});

function render(date: string) {
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  act(() => root!.render(createElement(DayInfoSheet, { date })));
}
const inputs = () => [...document.querySelectorAll<HTMLInputElement>('input')];
function type(el: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;

describe('DayInfoSheet', () => {
  it('shows the banner and current city', () => {
    render(D2);
    expect(document.body.textContent).toContain('舊金山 → 西雅圖｜住 Thompson Seattle');
    expect(inputs()[0].value).toBe('西雅圖');
    expect(inputs()[1].value).toBe('Thompson Seattle');
    expect(document.body.textContent).toContain('Seattle · Washington');
  });

  it('saving a new city marks the day manual, clears its geo and keeps manual places', () => {
    render(D2);
    type(inputs()[0], '波特蘭');
    act(() => button('儲存').click());
    const t = useData.getState().trips.t;
    expect(t.days?.[D2]).toMatchObject({ city: '波特蘭', lodging: 'Thompson Seattle', source: 'manual', label: '舊金山 → 西雅圖｜住 Thompson Seattle' });
    expect(t.days?.[D2]?.geo).toBeUndefined();
    const manual = t.items.find((i) => i.id === 'manual')!;
    expect(manual.place).toEqual({ query: 'Pike Place Market, Seattle, WA', source: 'manual', navigable: true });
    expect(manual.geo).toEqual({ lat: 47.6, lng: -122.3, source: 'geocode' });
    expect(useUI.getState().sheets).toHaveLength(0);
  });

  it('saving without changes writes nothing', () => {
    const before = useData.getState().trips.t;
    render(D2);
    act(() => button('儲存').click());
    expect(useData.getState().trips.t).toBe(before);
    expect(useUI.getState().sheets).toHaveLength(0);
  });

  it('asks before discarding edits', () => {
    render(D2);
    type(inputs()[1], 'Ace Hotel');
    act(() => (document.querySelector('[aria-label="關閉"]') as HTMLButtonElement).click());
    expect(document.body.textContent).toContain('還沒儲存，要放棄這些變更嗎？');
    expect(useUI.getState().sheets).toHaveLength(1);
    act(() => button('放棄變更').click());
    expect(useUI.getState().sheets).toHaveLength(0);
    expect(useData.getState().trips.t.days?.[D2]?.lodging).toBe('Thompson Seattle');
  });
});
