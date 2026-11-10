import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Trip } from '@/domain/types';
import type { ResolvedPlaces, ResolvePlacesOptions } from '@/services/ai';

/*
 * runResolvePlaces：分批結果逐批寫進行程、別名表沒有的新城市先定位、完成提示、部分失敗保留已付費的結果。
 * 不連真正的 API：resolvePlacesFor 換成假的（照劇本逐批回報），定位也換成假的。
 */
vi.mock('idb-keyval', () => ({ get: async () => undefined, set: async () => {}, del: async () => {} }));
const script = vi.hoisted(() => ({
  parts: [] as ResolvedPlaces[],
  failAfter: -1,
  error: null as Error | null,
  lastOpts: null as ResolvePlacesOptions | null,
  costPerChunk: 2.5,
}));
vi.mock('@/services/ai', async (orig) => {
  const real = await orig<typeof import('@/services/ai')>();
  return {
    ...real,
    aiReady: () => true,
    resolvePlacesFor: vi.fn(async (trip: Trip, opts: ResolvePlacesOptions = {}) => {
      script.lastOpts = opts;
      const { useData } = await import('@/store/data');
      for (let i = 0; i < script.parts.length; i++) {
        if (i === script.failAfter) throw script.error;
        // 假裝這批已經記帳
        useData.getState().mutateTrip(trip.id, (d) => {
          d.ai = { ...d.ai, usage: real.addUsage(d.ai.usage, 'places', script.costPerChunk, 100, 100) };
        });
        await opts.onChunk?.(script.parts[i], i + 1, script.parts.length);
      }
      return { days: {}, items: {} };
    }),
  };
});
const geocode = vi.hoisted(() => vi.fn(async (q: string) => (q.startsWith('Cannon Beach') ? { lat: 45.89, lng: -123.96, label: 'x', countryCode: 'US', timezone: 'America/Los_Angeles' } : null)));
vi.mock('@/services/weather', async (orig) => ({ ...(await orig<typeof import('@/services/weather')>()), geocodeTravelCity: geocode }));
vi.mock('@/platform', async (orig) => ({ ...(await orig<typeof import('@/platform')>()), haptic: async () => {} }));

const { useData } = await import('@/store');
const { useUI } = await import('@/store/ui');
const { runResolvePlaces, placesBusyKey, resolveDoneText } = await import('./useResolvePlaces');
const { AIError } = await import('@/services/ai');

const base = (): Trip => ({
  id: 'trip-p',
  name: '西北太平洋',
  city: '西雅圖',
  startDate: '2027-03-02',
  endDate: '2027-03-05',
  localCurrency: 'USD',
  homeCurrency: 'TWD',
  rate: 31,
  members: ['我'],
  expenses: [],
  cover: { kind: 'orb' },
  ai: { dayChecks: {} },
  createdAt: 0,
  updatedAt: 0,
  items: [
    { id: 'i1', date: '2027-03-03', title: 'Space Needle', type: 'sight', done: false, createdAt: 0, updatedAt: 0, place: { query: 'Space Needle, Seattle', source: 'rule' }, geo: { lat: 1, lng: 1, source: 'geocode' } },
    { id: 'i2', date: '2027-03-05', title: '海邊', type: 'sight', done: false, createdAt: 0, updatedAt: 0 },
    { id: 'i3', date: '2027-03-05', title: '自己設定', type: 'sight', done: false, createdAt: 0, updatedAt: 0, place: { query: 'Mine', source: 'manual' } },
  ],
  days: {
    '2027-03-03': { label: '西雅圖', city: '西雅圖', source: 'rule' },
    '2027-03-05': { label: '海邊一日遊', city: '波特蘭', source: 'rule', geo: { lat: 45.5, lng: -122.7 } },
  },
});

const PART1: ResolvedPlaces = {
  days: { '2027-03-03': { city: '西雅圖', cityEn: 'Seattle', region: 'Washington', countryCode: 'US' } },
  items: { i1: { name: 'Space Needle', query: 'Space Needle, 400 Broad St, Seattle, WA, USA', navigable: true } },
};
const PART2: ResolvedPlaces = {
  days: { '2027-03-05': { city: '坎農海灘', cityEn: 'Cannon Beach', region: 'Oregon', countryCode: 'US' } },
  items: { i2: { name: 'Haystack Rock', query: 'Haystack Rock, Cannon Beach, OR, USA', navigable: true }, i3: { name: 'x', query: 'x', navigable: true } },
};

beforeEach(() => {
  useData.setState({ trips: { 'trip-p': base() }, activeTripId: 'trip-p', settings: { ...useData.getState().settings, anthropicApiKey: 'sk-ant-test' } });
  useUI.setState({ toasts: [], busy: {} });
  script.parts = [PART1, PART2];
  script.failAfter = -1;
  script.error = null;
  script.lastOpts = null;
  geocode.mockClear();
});

const lastToast = () => useUI.getState().toasts.at(-1);

describe('runResolvePlaces', () => {
  it('逐批寫入：導航目的地、每天城市（新城市先定位）、辨識時間；提示辨識數與花費', async () => {
    const r = await runResolvePlaces('trip-p');
    expect(r).toEqual({ status: 'done', items: 2, days: 2, costTwd: 5 });
    const t = useData.getState().trips['trip-p'];
    expect(t.items[0].place).toEqual({ query: 'Space Needle, 400 Broad St, Seattle, WA, USA', name: 'Space Needle', source: 'ai', navigable: true });
    expect(t.items[0].geo).toBeUndefined(); // 目的地變了，地圖重新定位
    expect(t.items[2].place).toEqual({ query: 'Mine', source: 'manual' });
    expect(t.days!['2027-03-05']).toMatchObject({ city: '坎農海灘', source: 'ai', geo: { lat: 45.89, lng: -123.96, label: '坎農海灘，美國', en: 'Cannon Beach', admin1: 'Oregon', countryCode: 'US' } });
    expect(geocode).toHaveBeenCalledWith('Cannon Beach, Oregon');
    expect(t.ai.placesResolvedAt).toBeGreaterThan(0);
    expect(lastToast()).toMatchObject({ text: 'AI 已辨識 2 個地點，花費約 NT$5', tone: 'good' });
    expect(useUI.getState().busy[placesBusyKey('trip-p')]).toBeUndefined();
    // 第一次辨識整趟
    expect(script.lastOpts?.itemIds).toBeNull();
  });

  it('辨識過之後：預設只送還沒辨識的；全部都辨識過就提示、不花錢', async () => {
    await runResolvePlaces('trip-p');
    useData.getState().upsertItem('trip-p', { id: 'i9', title: '新加的咖啡店', date: '2027-03-03' });
    script.parts = [];
    await runResolvePlaces('trip-p');
    expect(script.lastOpts?.itemIds).toEqual(['i9']);
    // i9 這次沒被回答：還是待辨識；指定 all: false 且沒有待辨識時不送
    useData.getState().deleteItem('trip-p', 'i9');
    script.lastOpts = null;
    const r = await runResolvePlaces('trip-p', { all: false });
    expect(r).toEqual({ status: 'skipped', reason: 'nothing' });
    expect(script.lastOpts).toBeNull();
    expect(lastToast()?.text).toBe('每個地點都已經辨識過了');
    await runResolvePlaces('trip-p', { all: true });
    expect((script.lastOpts as ResolvePlacesOptions | null)?.itemIds).toBeNull();
  });

  it('後面的批次失敗：前面已付費的結果保留，提示說明哪裡沒完成', async () => {
    script.failAfter = 1;
    script.error = new AIError('overloaded', 'AI 服務目前很忙，請稍後再試一次。');
    const r = await runResolvePlaces('trip-p');
    expect(r).toMatchObject({ status: 'error', items: 1, message: 'AI 服務目前很忙，請稍後再試一次。', costTwd: 2.5 });
    const t = useData.getState().trips['trip-p'];
    expect(t.items[0].place?.source).toBe('ai');
    expect(t.items[1].place).toBeUndefined();
    expect(t.ai.placesResolvedAt).toBeGreaterThan(0);
    expect(lastToast()).toMatchObject({ text: 'AI 已辨識 1 個地點，其餘沒有完成：AI 服務目前很忙，請稍後再試一次。', tone: 'bad' });
  });

  it('超過預算：顯示中文說明，什麼都不寫入', async () => {
    script.failAfter = 0;
    script.error = new AIError('budget', '本趟 AI 花費已達上限 NT$200，可到 更多 → App 設定 調高上限');
    const r = await runResolvePlaces('trip-p');
    expect(r).toMatchObject({ status: 'error', items: 0 });
    expect(lastToast()?.text).toBe('本趟 AI 花費已達上限 NT$200，可到 更多 → App 設定 調高上限');
    expect(useData.getState().trips['trip-p'].ai.placesResolvedAt).toBeUndefined();
  });

  it('同一趟同時只跑一次；找不到行程就提示', async () => {
    useUI.getState().setBusy(placesBusyKey('trip-p'), true);
    expect(await runResolvePlaces('trip-p')).toEqual({ status: 'skipped', reason: 'busy' });
    expect(await runResolvePlaces('nope')).toEqual({ status: 'skipped', reason: 'no_trip' });
  });

  it('完成提示的文字', () => {
    expect(resolveDoneText(42, 9, 5.6)).toBe('AI 已辨識 42 個地點，花費約 NT$6');
    expect(resolveDoneText(0, 3, 0.4)).toBe('AI 已辨識 3 天的城市，花費不到 NT$1');
    expect(resolveDoneText(0, 0, 0)).toBe('AI 這次沒有找到要更新的地點，花費不到 NT$1');
  });
});
