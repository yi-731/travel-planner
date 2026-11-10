import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Trip } from '@/domain/types';

/*
 * 記帳表單沒經過「關閉／儲存」就被拿掉時（例如點通知整疊彈出頁被關掉），
 * 這次新增的收據照片要從手機清掉；但開發模式 StrictMode 的假卸載、或表單還在堆疊裡時要留著。
 */
const idb = vi.hoisted(() => new Map<string, unknown>());
vi.mock('idb-keyval', () => ({
  get: async (k: string) => idb.get(k),
  set: async (k: string, v: unknown) => void idb.set(k, v),
  del: async (k: string) => void idb.delete(k),
}));
vi.mock('@/platform', async (orig) => ({ ...(await orig<typeof import('@/platform')>()), haptic: async () => {} }));

const { useData } = await import('@/store');
const { useUI } = await import('@/store/ui');
const { default: ExpenseFormSheet } = await import('./ExpenseFormSheet');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
  URL.createObjectURL ??= () => 'blob:test';
  URL.revokeObjectURL ??= () => {};
});

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

let root: Root | null = null;
let host: HTMLElement | null = null;
beforeEach(() => {
  idb.clear();
  idb.set('blob:r', new Blob(['x']));
  useData.setState({ trips: { kyoto: trip('kyoto', '京都'), seoul: trip('seoul', '首爾') }, activeTripId: 'kyoto', hydrated: true });
  useUI.setState({ sheets: [], toasts: [], busy: {} });
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = host = null;
});

const PROPS = { prefill: { amount: 1280, receiptBlobKey: 'blob:r' }, fromAI: true, tripId: 'kyoto' };
function render(props: Parameters<typeof ExpenseFormSheet>[0] = PROPS) {
  useUI.setState({ sheets: [{ name: 'expenseForm', ...props }] });
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  act(() => root!.render(createElement(StrictMode, null, createElement(ExpenseFormSheet, props))));
}
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

describe('ExpenseFormSheet 收據照片', () => {
  it('StrictMode 的假卸載不會刪掉帶進來的收據', async () => {
    render();
    await settle();
    expect(idb.has('blob:r')).toBe(true);
  });

  it('整疊彈出頁被關掉、表單直接卸載：這次新增的照片要清掉', async () => {
    render();
    await settle();
    useUI.getState().closeAllSheets();
    act(() => root!.unmount());
    root = null;
    await settle();
    expect(idb.has('blob:r')).toBe(false);
  });

  it('表單還在堆疊裡（上面疊了別的頁）：照片留著，之後回來還看得到', async () => {
    render();
    await settle();
    useUI.getState().openSheet({ name: 'appSettings' });
    act(() => root!.unmount());
    root = null;
    await settle();
    expect(idb.has('blob:r')).toBe(true);
  });

  it('記在指定的旅程，不受目前旅程影響', async () => {
    useData.setState({ activeTripId: 'seoul' });
    render();
    await settle();
    const save = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('儲存'))!;
    act(() => save.click());
    await settle();
    expect(useData.getState().trips.kyoto.expenses).toHaveLength(1);
    expect(useData.getState().trips.seoul.expenses).toHaveLength(0);
    expect(useData.getState().trips.kyoto.expenses[0].receiptBlobKey).toBe('blob:r');
    expect(idb.has('blob:r')).toBe(true);
  });
});
