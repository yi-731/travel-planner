import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Trip } from '@/domain/types';

/*
 * 啟動讀取與存檔的保護（store/data.ts + store/persist.ts）。
 * IndexedDB 換成可控制的記憶體替身；每個測試重新載入模組，模擬重新開啟 App。
 */
const db = vi.hoisted(() => ({
  map: new Map<string, unknown>(),
  /** 接下來幾次讀取要失敗 */
  getFails: 0,
  /** 寫入要丟的錯誤（null = 正常） */
  setError: null as null | (() => unknown),
  /** 所有寫入（含失敗的） */
  sets: [] as [string, unknown][],
}));

vi.mock('idb-keyval', () => ({
  get: async (k: string) => {
    if (db.getFails > 0) {
      db.getFails--;
      throw new DOMException('Connection to Indexed Database server lost. Refresh the page to try again', 'UnknownError');
    }
    return db.map.get(k);
  },
  set: async (k: string, v: unknown) => {
    db.sets.push([k, v]);
    if (db.setError) throw db.setError();
    db.map.set(k, v);
  },
  del: async (k: string) => void db.map.delete(k),
  createStore: () => () => Promise.reject(new Error('測試替身不使用自訂連線')),
}));

const KEY = 'travel-planner';
const quota = () => new DOMException('The quota has been exceeded.', 'QuotaExceededError');

function storedTrip(id: string, name: string): Trip {
  return {
    id, name, city: '', startDate: null, endDate: null, localCurrency: 'JPY', homeCurrency: 'TWD', rate: 0.21,
    members: ['我'], items: [], expenses: [], cover: { kind: 'orb' }, ai: { dayChecks: {} }, createdAt: 1, updatedAt: 1,
  };
}
function seedStorage(names: string[]) {
  const trips = Object.fromEntries(names.map((n, i) => [`t${i}`, storedTrip(`t${i}`, n)]));
  const raw = JSON.stringify({ state: { trips, activeTripId: 't0', settings: { anthropicApiKey: 'sk-ant-secret' } }, version: 1 });
  db.map.set(KEY, raw);
  return raw;
}
const storedNames = () => {
  const raw = db.map.get(KEY);
  if (typeof raw !== 'string') return null;
  return Object.values((JSON.parse(raw) as { state: { trips: Record<string, Trip> } }).state.trips).map((t) => t.name);
};
const mainWrites = () => db.sets.filter(([k]) => k === KEY);

/** 模擬開啟 App：重新載入 store，等讀取結束 */
async function launch() {
  vi.resetModules();
  const data = await import('./data');
  const ui = await import('./ui');
  await vi.waitFor(() => expect(data.useData.getState().hydrated).toBe(true), { timeout: 4000, interval: 20 });
  return { useData: data.useData, useUI: ui.useUI };
}
const flushPromises = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  db.map.clear();
  db.sets.length = 0;
  db.getFails = 0;
  db.setError = null;
  localStorage.setItem('tp:seeded', '1');
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('啟動讀取', () => {
  it('正常讀取：載入行程，之後的變更會存檔', async () => {
    seedStorage(['京都', '首爾', '曼谷']);
    const { useData } = await launch();
    expect(useData.getState().loadError).toBeNull();
    expect(Object.keys(useData.getState().trips)).toHaveLength(3);
    useData.getState().createTrip({ name: '大阪' });
    await flushPromises();
    expect(storedNames()).toEqual(['京都', '首爾', '曼谷', '大阪']);
  });

  it('讀取失敗一次：自動重試成功，不會蓋掉資料', async () => {
    seedStorage(['京都', '首爾', '曼谷']);
    db.getFails = 1;
    const { useData } = await launch();
    expect(useData.getState().loadError).toBeNull();
    expect(Object.keys(useData.getState().trips)).toHaveLength(3);
    expect(mainWrites().every(([, v]) => (v as string).includes('京都'))).toBe(true);
  });

  it('一直讀不到：顯示錯誤、絕不寫入空白資料；重新讀取成功後恢復', async () => {
    seedStorage(['京都', '首爾', '曼谷']);
    db.getFails = 99;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { useData, useUI } = await launch();
    expect(useData.getState().loadError).toContain('Indexed Database');
    expect(useData.getState().trips).toEqual({});
    expect(mainWrites()).toEqual([]);

    // 錯誤狀態下還是有人改資料：不寫入，只提示一次
    useData.getState().createTrip({ name: '空白狀態下新增' });
    useData.getState().updateSettings({ haptics: false });
    await flushPromises();
    expect(mainWrites()).toEqual([]);
    expect(useUI.getState().toasts.filter((t) => t.tone === 'bad')).toHaveLength(1);
    expect(storedNames()).toEqual(['京都', '首爾', '曼谷']);

    // 連線恢復後按「重新讀取」
    db.getFails = 0;
    await useData.getState().retryLoad();
    expect(useData.getState().loadError).toBeNull();
    expect(Object.values(useData.getState().trips).map((t) => t.name)).toEqual(['京都', '首爾', '曼谷']);
    expect(useData.getState().settings.anthropicApiKey).toBe('sk-ant-secret');
    useData.getState().createTrip({ name: '大阪' });
    await flushPromises();
    expect(storedNames()).toEqual(['京都', '首爾', '曼谷', '大阪']);
  });

  it('重新讀取又失敗：維持錯誤狀態，仍不寫入', async () => {
    seedStorage(['京都']);
    db.getFails = 99;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { useData } = await launch();
    await useData.getState().retryLoad();
    expect(useData.getState().loadError).not.toBeNull();
    expect(mainWrites()).toEqual([]);
    expect(storedNames()).toEqual(['京都']);
  });

  it('資料壞掉（JSON 解析失敗）：不覆蓋，並另存一份原始資料', async () => {
    const raw = seedStorage(['京都', '首爾']).slice(0, 80);
    db.map.set(KEY, raw);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { useData } = await launch();
    await flushPromises();
    expect(useData.getState().loadError).not.toBeNull();
    expect(mainWrites()).toEqual([]);
    expect(db.map.get(KEY)).toBe(raw);
    const backups = [...db.map.entries()].filter(([k]) => k.startsWith(`${KEY}:backup-`));
    expect(backups).toHaveLength(1);
    expect(backups[0][1]).toBe(raw);

    // 重試不會重複另存同一份
    await useData.getState().retryLoad();
    await flushPromises();
    expect([...db.map.keys()].filter((k) => k.startsWith(`${KEY}:backup-`))).toHaveLength(1);
  });

  it('版本轉換出錯：不覆蓋資料', async () => {
    db.map.set(KEY, JSON.stringify({ state: { trips: { t0: storedTrip('t0', '京都') } }, version: 0 }));
    vi.doMock('./migrations', () => ({
      SCHEMA_VERSION: 1,
      migrate: () => {
        throw new Error('資料從第 0 版轉換到第 1 版時失敗：測試');
      },
    }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { useData } = await launch();
      expect(useData.getState().loadError).toContain('第 0 版');
      expect(mainWrites()).toEqual([]);
    } finally {
      vi.doUnmock('./migrations');
    }
  });

  it('第一次開啟（沒有資料）：建立範例行程並存檔', async () => {
    localStorage.removeItem('tp:seeded');
    const { useData } = await launch();
    await flushPromises();
    expect(useData.getState().loadError).toBeNull();
    expect(storedNames()).toEqual(['京阪奈五日（範例）']);
  });
});

describe('存檔失敗', () => {
  it('空間不足：不丟出未處理的錯誤、只提示一次；空間清出後自動補存', async () => {
    seedStorage(['京都']);
    const { useData, useUI } = await launch();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    db.setError = quota;

    // zustand 的 setState 會回傳存檔的 promise：不可以 reject
    await expect(useData.setState({ activeTripId: 't0' }) as unknown as Promise<void>).resolves.toBeUndefined();
    useData.getState().createTrip({ name: '新增的大阪行' });
    useData.getState().createTrip({ name: '新增的東京行' });
    await flushPromises();
    const bad = useUI.getState().toasts.filter((t) => t.tone === 'bad');
    expect(bad).toHaveLength(1);
    expect(bad[0].text).toContain('儲存空間');
    expect(storedNames()).toEqual(['京都']);

    // 清出空間、回到 App
    db.setError = null;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(storedNames()).toEqual(['京都', '新增的大阪行', '新增的東京行']));
    expect(useUI.getState().toasts.some((t) => t.tone === 'good' && t.text.includes('補存'))).toBe(true);
  });

  it('其他錯誤（連線中斷）：換新連線重試，下一次變更成功就補存', async () => {
    seedStorage(['京都']);
    const { useData, useUI } = await launch();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    db.setError = () => new DOMException('Connection to Indexed Database server lost', 'UnknownError');
    useData.getState().createTrip({ name: '大阪' });
    await flushPromises();
    await flushPromises();
    expect(useUI.getState().toasts.filter((t) => t.tone === 'bad')).toHaveLength(1);
    db.setError = null;
    useData.getState().createTrip({ name: '東京' });
    await vi.waitFor(() => expect(storedNames()).toEqual(['京都', '大阪', '東京']));
    expect(useUI.getState().toasts.some((t) => t.tone === 'good')).toBe(true);
  });
});

describe('匯率', () => {
  it('改當地貨幣時保留舊匯率；setRates 只收有效值', async () => {
    seedStorage(['京都']);
    const { useData } = await launch();
    const st = useData.getState();
    st.upsertExpense('t0', { amount: 1000, currency: 'JPY' });
    st.mutateTrip('t0', (d) => {
      d.localCurrency = 'KRW';
      d.rate = 0.023;
    });
    expect(useData.getState().trips.t0.rates).toEqual({ JPY: 0.21 });
    st.setRates('t0', { USD: 32, EUR: -1, TWD: 5, KRW: 9, xx: 3 });
    expect(useData.getState().trips.t0.rates).toEqual({ JPY: 0.21, USD: 32 });
  });
});
