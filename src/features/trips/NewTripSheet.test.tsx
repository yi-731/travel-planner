import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * 新增行程：填了東西後誤點背景／往下滑／Esc，先問要不要放棄，不直接丟掉輸入。
 * 什麼都沒填就直接關。
 */
vi.mock('idb-keyval', () => {
  const m = new Map<string, unknown>();
  return { get: async (k: string) => m.get(k), set: async (k: string, v: unknown) => void m.set(k, v), del: async (k: string) => void m.delete(k) };
});
vi.mock('@/platform', async (orig) => ({ ...(await orig<typeof import('@/platform')>()), haptic: async () => {} }));
vi.mock('./enrich', () => ({ enrichNewTrip: vi.fn() }));

const { useData } = await import('@/store');
const { useUI } = await import('@/store/ui');
const { default: NewTripSheet } = await import('./NewTripSheet');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
});

let root: Root | null = null;
let host: HTMLElement | null = null;
beforeEach(() => {
  useData.setState({ trips: {}, activeTripId: null, hydrated: true });
  useUI.setState({ sheets: [{ name: 'newTrip' } as never], toasts: [], busy: {} });
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  act(() => root!.render(createElement(NewTripSheet)));
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = host = null;
});

const sheets = () => useUI.getState().sheets.length;
const esc = () => act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
const findButton = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
const button = (text: string) => {
  const b = findButton(text);
  if (!b) throw new Error(`找不到按鈕：${text}`);
  return b;
};
const prompt = () => document.body.textContent?.includes('還沒建立，要放棄這趟行程嗎？') ?? false;
const field = (label: string) => {
  const l = [...document.querySelectorAll('label')].find((el) => el.textContent?.includes(label));
  const el = (l?.htmlFor ? document.getElementById(l.htmlFor) : l?.querySelector('input, select')) as HTMLInputElement | HTMLSelectElement | null;
  if (!el) throw new Error(`找不到欄位：${label}`);
  return el;
};
/** React 受控欄位：用原生 setter 改值再發事件 */
function type(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

describe('NewTripSheet：誤關前先確認', () => {
  it('什麼都沒填：直接關閉', () => {
    esc();
    expect(sheets()).toBe(0);
  });

  it('填了名稱：先問要不要放棄，按「繼續填寫」回到建立，名稱還在', () => {
    type(field('行程名稱') as HTMLInputElement, '京阪奈五日');
    esc();
    expect(sheets()).toBe(1);
    expect(prompt()).toBe(true);
    expect(findButton('建立')).toBeUndefined();

    act(() => button('繼續填寫').click());
    expect(prompt()).toBe(false);
    expect(findButton('建立')).toBeDefined();
    expect((field('行程名稱') as HTMLInputElement).value).toBe('京阪奈五日');
    expect(sheets()).toBe(1);
  });

  it('按「放棄」才關閉，不建立行程', () => {
    type(field('城市') as HTMLInputElement, 'KYOTO');
    esc();
    act(() => button('放棄').click());
    expect(sheets()).toBe(0);
    expect(Object.keys(useData.getState().trips)).toHaveLength(0);
  });

  it('問的時候又改了欄位：收起提示，回到「建立」', () => {
    type(field('出發日') as HTMLInputElement, '2026-12-01');
    esc();
    expect(prompt()).toBe(true);
    type(field('回程日') as HTMLInputElement, '2026-12-05');
    expect(prompt()).toBe(false);
    expect(findButton('建立')).toBeDefined();
  });

  it('只改了本國貨幣也算有填', () => {
    type(field('本國貨幣') as HTMLSelectElement, 'JPY');
    esc();
    expect(sheets()).toBe(1);
    expect(prompt()).toBe(true);
  });

  it('建立後直接關閉，不會跳出放棄提示', () => {
    type(field('行程名稱') as HTMLInputElement, '首爾三日');
    act(() => button('建立').click());
    expect(sheets()).toBe(0);
    expect(Object.values(useData.getState().trips).map((t) => t.name)).toContain('首爾三日');
  });
});
