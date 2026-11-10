import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useKeyboardInset } from './useKeyboardInset';

// jsdom 沒有 visualViewport：做一個可以調整高度的假物件
class FakeViewport extends EventTarget {
  height = 844;
  offsetTop = 0;
  scale = 1;
}

let vv: FakeViewport;
let root: Root | null = null;
let host: HTMLElement;
const html = document.documentElement;
const frame = () => act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));

function Probe() {
  useKeyboardInset();
  return createElement('input', { 'aria-label': '名稱' });
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(html, 'clientHeight', { configurable: true, get: () => 844 });
});

beforeEach(() => {
  vv = new FakeViewport();
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(Probe)));
});

afterEach(() => {
  act(() => root?.unmount());
  host.remove();
});

describe('useKeyboardInset', () => {
  it('輸入框有焦點且可見區域變矮時，設定鍵盤高度；收起後清掉', async () => {
    host.querySelector('input')!.focus();
    vv.height = 844 - 336;
    vv.dispatchEvent(new Event('resize'));
    await frame();
    expect(html.style.getPropertyValue('--kb')).toBe('336px');
    expect(html.style.getPropertyValue('--vvh')).toBe('508px');
    expect(html.hasAttribute('data-kb')).toBe(true);

    vv.height = 844;
    vv.dispatchEvent(new Event('resize'));
    await frame();
    expect(html.style.getPropertyValue('--kb')).toBe('');
    expect(html.hasAttribute('data-kb')).toBe(false);
  });

  it('iOS 把可見區域往下捲時（offsetTop），鍵盤高度要扣掉捲動量', async () => {
    host.querySelector('input')!.focus();
    vv.height = 500;
    vv.offsetTop = 120;
    vv.dispatchEvent(new Event('scroll'));
    await frame();
    expect(html.style.getPropertyValue('--kb')).toBe('224px');
  });

  it('沒有輸入框焦點（例如雙指放大）或變化太小（工具列）時不處理', async () => {
    vv.height = 400;
    vv.dispatchEvent(new Event('resize'));
    await frame();
    expect(html.style.getPropertyValue('--kb')).toBe('');

    host.querySelector('input')!.focus();
    vv.height = 844 - 50;
    vv.dispatchEvent(new Event('resize'));
    await frame();
    expect(html.style.getPropertyValue('--kb')).toBe('');
  });

  it('卸載時清掉設定', async () => {
    host.querySelector('input')!.focus();
    vv.height = 500;
    vv.dispatchEvent(new Event('resize'));
    await frame();
    expect(html.style.getPropertyValue('--kb')).toBe('344px');
    act(() => root!.unmount());
    root = null;
    expect(html.style.getPropertyValue('--kb')).toBe('');
    expect(html.hasAttribute('data-kb')).toBe(false);
  });
});
