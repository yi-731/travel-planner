import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Trip } from '@/domain/types';
import type { ReceiptResult } from '@/services/ai';

/*
 * 「拍收據」辨識要好幾秒：完成時若使用者已經開了別的表單或換了旅程，
 * 結果不能直接疊上去（會把正在填的表單洗掉），要先存著等使用者回來點。
 */
const idb = vi.hoisted(() => new Map<string, unknown>());
vi.mock('idb-keyval', () => ({
  get: async (k: string) => idb.get(k),
  set: async (k: string, v: unknown) => void idb.set(k, v),
  del: async (k: string) => void idb.delete(k),
}));
const scans = vi.hoisted(() => [] as { resolve: (r: ReceiptResult) => void; reject: (e: unknown) => void }[]);
vi.mock('@/services/ai', async (orig) => ({
  ...(await orig<typeof import('@/services/ai')>()),
  aiReady: () => true,
  scanReceipt: vi.fn(() => new Promise<ReceiptResult>((resolve, reject) => scans.push({ resolve, reject }))),
}));
vi.mock('@/platform', async (orig) => ({
  ...(await orig<typeof import('@/platform')>()),
  haptic: async () => {},
  pickImage: async () => new Blob(['x'], { type: 'image/jpeg' }),
}));

const { useData } = await import('@/store');
const { useUI } = await import('@/store/ui');
const { deliverReceipt, openPendingReceipt, usePendingReceipts, useReceiptScan, SCAN_BUSY_KEY } = await import('./useReceiptScan');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

/** 掛上 useReceiptScan，回傳最新一次 render 的結果 */
function mountScan(tripId: string) {
  let last: ReturnType<typeof useReceiptScan> | null = null;
  const Probe = () => {
    last = useReceiptScan(tripId);
    return null;
  };
  const root = createRoot(document.createElement('div'));
  act(() => root.render(createElement(Probe)));
  return { current: () => last!, unmount: () => act(() => root.unmount()) };
}

const trip = (id: string, name: string): Trip => ({
  id,
  name,
  city: 'KYOTO',
  startDate: '2026-11-21',
  endDate: '2026-11-25',
  localCurrency: 'JPY',
  homeCurrency: 'TWD',
  rate: 0.21,
  members: ['我'],
  items: [],
  expenses: [],
  cover: { kind: 'orb' },
  ai: { dayChecks: {} },
  createdAt: 0,
  updatedAt: 0,
});

const RESULT: ReceiptResult = { amount: 1280, currency: 'JPY', title: '拉麵', category: 'food' };
const flush = () => new Promise((r) => setTimeout(r, 0));
const lastToast = () => useUI.getState().toasts.at(-1)?.text ?? '';

beforeEach(() => {
  scans.length = 0;
  idb.clear();
  usePendingReceipts.setState({}, true);
  useData.setState({ trips: { kyoto: trip('kyoto', '京都'), seoul: trip('seoul', '首爾') }, activeTripId: 'kyoto', hydrated: true });
  useUI.setState({ sheets: [], toasts: [], busy: {} });
});

describe('deliverReceipt', () => {
  it('畫面空著、同一趟旅程：直接開記帳表單（記在那一趟）', () => {
    expect(deliverReceipt('kyoto', { prefill: { amount: 1280, receiptBlobKey: 'blob:a' }, fromAI: true })).toBe(true);
    expect(useUI.getState().sheets).toMatchObject([
      { name: 'expenseForm', tripId: 'kyoto', prefill: { amount: 1280, receiptBlobKey: 'blob:a' }, fromAI: true },
    ]);
    expect(usePendingReceipts.getState()).toEqual({});
  });

  it('已經開著別的彈出頁：不疊上去，先存著並提示', () => {
    useUI.getState().openSheet({ name: 'expenseForm', tripId: 'kyoto' });
    expect(deliverReceipt('kyoto', { prefill: { amount: 1280, receiptBlobKey: 'blob:a' }, fromAI: true })).toBe(false);
    expect(useUI.getState().sheets).toHaveLength(1);
    expect(useUI.getState().sheets[0]).not.toHaveProperty('prefill');
    expect(usePendingReceipts.getState().kyoto?.prefill.amount).toBe(1280);
    expect(lastToast()).toBe('收據辨識好了，回到記帳頁點「查看辨識結果」');

    // 使用者關掉手上的表單，回記帳頁點按鈕
    useUI.getState().closeSheet();
    openPendingReceipt('kyoto');
    expect(useUI.getState().sheets).toMatchObject([{ name: 'expenseForm', tripId: 'kyoto', prefill: { amount: 1280 }, fromAI: true }]);
    expect(usePendingReceipts.getState()).toEqual({});
  });

  it('已經換到別趟旅程：存在原本那一趟，提示寫出旅程名稱', () => {
    useData.setState({ activeTripId: 'seoul' });
    expect(deliverReceipt('kyoto', { prefill: { receiptBlobKey: 'blob:a' }, fromAI: false })).toBe(false);
    expect(useUI.getState().sheets).toEqual([]);
    expect(Object.keys(usePendingReceipts.getState())).toEqual(['kyoto']);
    expect(lastToast()).toBe('「京都」的收據照片先幫你留著，切回這趟旅程後到記帳頁點「填寫收據」');
  });

  it('同一趟又有新的在等：舊照片從手機清掉', async () => {
    idb.set('blob:old', 1);
    useData.setState({ activeTripId: 'seoul' });
    deliverReceipt('kyoto', { prefill: { receiptBlobKey: 'blob:old' }, fromAI: false });
    deliverReceipt('kyoto', { prefill: { receiptBlobKey: 'blob:new' }, fromAI: true });
    await flush();
    expect(idb.has('blob:old')).toBe(false);
    expect(usePendingReceipts.getState().kyoto?.prefill.receiptBlobKey).toBe('blob:new');
  });
});

describe('useReceiptScan', () => {
  it('辨識中使用者開了「記一筆」：結果不會蓋掉手動表單', async () => {
    const h = mountScan('kyoto');
    let done!: Promise<void>;
    await act(async () => {
      done = h.current().scan();
      await flush();
    });
    expect(useUI.getState().busy[SCAN_BUSY_KEY]).toBe(true);
    expect(scans).toHaveLength(1);

    act(() => useUI.getState().openSheet({ name: 'expenseForm', tripId: 'kyoto' }));
    await act(async () => {
      scans[0].resolve(RESULT);
      await done;
    });

    expect(useUI.getState().sheets).toHaveLength(1);
    expect(useUI.getState().sheets[0]).not.toHaveProperty('prefill');
    expect(useUI.getState().busy[SCAN_BUSY_KEY]).toBeUndefined();
    const p = usePendingReceipts.getState().kyoto;
    expect(p?.fromAI).toBe(true);
    expect(p?.prefill).toMatchObject({ amount: 1280, title: '拉麵' });
    expect(idb.has(p!.prefill.receiptBlobKey!)).toBe(true);
    expect(h.current().pending).toEqual(p);
    h.unmount();
  });

  it('辨識失敗且已換旅程：照片留著，讓使用者回來手動填', async () => {
    const h = mountScan('kyoto');
    let done!: Promise<void>;
    await act(async () => {
      done = h.current().scan();
      await flush();
    });
    useData.setState({ activeTripId: 'seoul' });
    await act(async () => {
      scans[0].reject(new Error('boom'));
      await done;
    });
    expect(useUI.getState().sheets).toEqual([]);
    expect(usePendingReceipts.getState().kyoto?.fromAI).toBe(false);
    expect(usePendingReceipts.getState().kyoto?.prefill.receiptBlobKey).toBeTruthy();
    h.unmount();
  });

  it('畫面空著：辨識完直接開表單', async () => {
    const h = mountScan('kyoto');
    let done!: Promise<void>;
    await act(async () => {
      done = h.current().scan();
      await flush();
      scans[0].resolve(RESULT);
      await done;
    });
    expect(useUI.getState().sheets).toMatchObject([{ name: 'expenseForm', tripId: 'kyoto', fromAI: true, prefill: { amount: 1280 } }]);
    expect(usePendingReceipts.getState()).toEqual({});
    h.unmount();
  });
});
