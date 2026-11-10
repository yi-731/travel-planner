import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DayCheck, Trip } from '@/domain/types';

/*
 * AI 排程檢查的「檢查中」狀態要跟著旅程：
 * A 旅程 11/22 正在檢查時，切到同樣有 11/22 的 B 旅程，B 的按鈕不能顯示檢查中、也不能被鎖住。
 */
vi.mock('idb-keyval', () => ({ get: async () => undefined, set: async () => {}, del: async () => {} }));
const checks = vi.hoisted(() => [] as { tripId: string; resolve: (r: DayCheck) => void }[]);
vi.mock('@/services/ai', async (orig) => ({
  ...(await orig<typeof import('@/services/ai')>()),
  aiReady: () => true,
  checkDay: vi.fn((trip: Trip) => new Promise<DayCheck>((resolve) => checks.push({ tripId: trip.id, resolve }))),
}));
vi.mock('@/platform', async (orig) => ({
  ...(await orig<typeof import('@/platform')>()),
  haptic: async () => {},
}));

const { useData } = await import('@/store');
const { useUI } = await import('@/store/ui');
const { useDayCheck, dayCheckBusyKey } = await import('./useDayCheck');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

function mount(tripId: string, date: string) {
  let last: ReturnType<typeof useDayCheck> | null = null;
  const Probe = () => {
    last = useDayCheck(tripId, date);
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

const RESULT: DayCheck = { at: 1, itemIds: [], segments: [], warnings: [] };
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  checks.length = 0;
  useData.setState({ trips: { a: trip('a', '京都'), b: trip('b', '首爾') }, activeTripId: 'a', hydrated: true });
  useUI.setState({ sheets: [], toasts: [], busy: {} });
});

describe('useDayCheck', () => {
  it('檢查中的狀態只算在那一趟旅程，同一天的別趟旅程不受影響', async () => {
    const a = mount('a', '2026-11-22');
    const b = mount('b', '2026-11-22');

    let doneA!: Promise<void>;
    await act(async () => {
      doneA = a.current().run();
      await flush();
    });
    expect(useUI.getState().busy[dayCheckBusyKey('a', '2026-11-22')]).toBe(true);
    expect(a.current().busy).toBe(true);
    expect(b.current().busy).toBe(false);

    // B 也能同時檢查自己的 11/22
    let doneB!: Promise<void>;
    await act(async () => {
      doneB = b.current().run();
      await flush();
    });
    expect(checks.map((c) => c.tripId)).toEqual(['a', 'b']);
    expect(b.current().busy).toBe(true);

    await act(async () => {
      checks[0].resolve(RESULT);
      await doneA;
    });
    expect(a.current().busy).toBe(false);
    expect(b.current().busy).toBe(true);
    expect(useData.getState().trips.a?.ai.dayChecks['2026-11-22']).toEqual(RESULT);
    expect(useData.getState().trips.b?.ai.dayChecks['2026-11-22']).toBeUndefined();

    await act(async () => {
      checks[1].resolve(RESULT);
      await doneB;
    });
    expect(useUI.getState().busy).toEqual({});
    a.unmount();
    b.unmount();
  });

  it('同一趟同一天檢查中再按一次：不會重複送出', async () => {
    const a = mount('a', '2026-11-22');
    let done!: Promise<void>;
    await act(async () => {
      done = a.current().run();
      await flush();
    });
    await act(async () => {
      await a.current().run();
    });
    expect(checks).toHaveLength(1);
    await act(async () => {
      checks[0].resolve(RESULT);
      await done;
    });
    a.unmount();
  });
});
