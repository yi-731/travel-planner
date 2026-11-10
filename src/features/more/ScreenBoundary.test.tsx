import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// 測試環境沒有 IndexedDB：換成記憶體
vi.mock('idb-keyval', () => {
  const m = new Map<string, unknown>();
  return { get: async (k: string) => m.get(k), set: async (k: string, v: unknown) => void m.set(k, v), del: async (k: string) => void m.delete(k) };
});

const { ScreenBoundary } = await import('./ScreenBoundary');
const { useUI } = await import('@/store/ui');
const { useData } = await import('@/store/data');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

let broken = true;
function Boom() {
  if (broken) throw new Error('bad data');
  return createElement('p', null, '正常畫面');
}

describe('ScreenBoundary', () => {
  it('shows a Chinese fallback instead of a blank screen, and 回到首頁 recovers', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    useData.setState({ trips: {}, activeTripId: null });
    useUI.setState({ tab: 'map', sheets: [{ name: 'weather' }] });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    broken = true;
    act(() => root!.render(createElement(ScreenBoundary, null, createElement(Boom))));
    expect(host.textContent).toContain('這個畫面出了問題');
    expect(host.textContent).not.toContain('換別的行程'); // 沒有其他行程時不顯示

    broken = false;
    const home = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('回到首頁'))!;
    act(() => home.click());
    expect(useUI.getState().tab).toBe('home');
    expect(useUI.getState().sheets).toEqual([]);
    expect(host.textContent).toContain('正常畫面');
  });
});
