import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Trip } from '@/domain/types';
import type { RawSheets } from '@/services/importer';

// 測試環境沒有 IndexedDB：換成記憶體
vi.mock('idb-keyval', () => {
  const m = new Map<string, unknown>();
  return { get: async (k: string) => m.get(k), set: async (k: string, v: unknown) => void m.set(k, v), del: async (k: string) => void m.delete(k) };
});
// 讀 Google 試算表：每次呼叫都先掛著，由測試決定何時完成
const pending: { resolve: (raw: RawSheets) => void; reject: (e: unknown) => void }[] = [];
vi.mock('@/services/sheets', () => ({
  fetchGoogleSheet: vi.fn(() => new Promise<RawSheets>((resolve, reject) => pending.push({ resolve, reject }))),
}));
vi.mock('@/features/trips/enrich', () => ({ enrichNewTrip: vi.fn() }));
// 匯入後的 AI 地點辨識：只確認有沒有被叫用（不真的連 AI）
vi.mock('@/features/ai/useResolvePlaces', () => ({ runResolvePlaces: vi.fn(async () => {}) }));
vi.mock('@/services/ai', async (orig) => ({
  ...(await orig<typeof import('@/services/ai')>()),
  aiBudget: vi.fn(() => ({ used: 0, limit: 200, remaining: 200, exceeded: false })),
}));
vi.mock('@/platform', async (orig) => ({ ...(await orig<typeof import('@/platform')>()), haptic: async () => {} }));

const { useData } = await import('@/store');
const { useUI } = await import('@/store/ui');
const { fetchGoogleSheet } = await import('@/services/sheets');
const { default: ImportSheet } = await import('./ImportSheet');
const { runResolvePlaces } = await import('@/features/ai/useResolvePlaces');
const { aiBudget } = await import('@/services/ai');

const SHEET = 'https://docs.google.com/spreadsheets/d/abc/edit';
const SHEET_ROWS: RawSheets = { 行程: [['日期', '行程'], ['2026-11-21', '景福宮']] };

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
  Element.prototype.scrollIntoView ??= () => {};
});

let root: Root | null = null;
let host: HTMLElement | null = null;
beforeEach(() => {
  pending.length = 0;
  vi.mocked(fetchGoogleSheet).mockClear();
  const t: Trip = {
    id: 'kyoto', name: '京都', city: 'KYOTO', startDate: '2026-11-21', endDate: '2026-11-25', localCurrency: 'JPY', homeCurrency: 'TWD', rate: 0.21,
    members: ['我'], items: [], expenses: [], cover: { kind: 'orb' }, ai: { dayChecks: {} }, createdAt: 0, updatedAt: 0, sheetUrl: SHEET,
  };
  useData.setState({ trips: { kyoto: t }, activeTripId: 'kyoto', hydrated: true });
  useData.setState({ settings: { ...useData.getState().settings, anthropicApiKey: '', aiAutoResolvePlaces: true } });
  useUI.setState({ sheets: [{ name: 'import' } as never], toasts: [] });
  vi.mocked(runResolvePlaces).mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  act(() => root?.unmount());
  host?.remove();
  root = host = null;
});

function render() {
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  act(() => root!.render(createElement(ImportSheet)));
}
const button = (text: string | RegExp) => {
  const b = [...document.querySelectorAll('button')].find((el) => (typeof text === 'string' ? el.textContent?.includes(text) : text.test(el.textContent ?? '')));
  if (!b) throw new Error(`找不到按鈕：${text}`);
  return b;
};
const click = (el: HTMLElement) => act(() => el.click());
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}
/** React 受控輸入框：用原生 setter 改值再發 input 事件 */
function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('ImportSheet：同一時間只做一件事', () => {
  it('同步中：其他動作都停用，按 Enter 也不會再讀一次', async () => {
    render();
    click(button('立即同步'));
    expect(fetchGoogleSheet).toHaveBeenCalledTimes(1);
    expect(button('同步中').disabled).toBe(true);
    expect(button(/^讀取$/).disabled).toBe(true);
    expect(button('下載空白範本').disabled).toBe(true);

    const input = document.querySelector<HTMLInputElement>('input[type="url"]')!;
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    click(button(/^讀取$/));
    expect(fetchGoogleSheet).toHaveBeenCalledTimes(1);

    pending[0].resolve(SHEET_ROWS);
    await settle();
    expect(useData.getState().trips.kyoto.items.map((i) => i.title)).toEqual(['景福宮']);
  });

  it('讀取中連按兩次 Enter：只讀一次', async () => {
    render();
    const input = document.querySelector<HTMLInputElement>('input[type="url"]')!;
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(fetchGoogleSheet).toHaveBeenCalledTimes(1);
    expect(button('立即同步').disabled).toBe(true);
    pending[0].resolve(SHEET_ROWS);
    await settle();
    expect(button('立即同步').disabled).toBe(false);
    expect(document.querySelector('[aria-label="匯入預覽"]')).not.toBeNull();
  });

  it('同步途中關掉這頁：資料照樣更新，但不關掉之後打開的頁', async () => {
    render();
    click(button('立即同步'));
    act(() => root!.unmount());
    root = null;
    useUI.setState({ sheets: [{ name: 'expense' } as never] });
    pending[0].resolve(SHEET_ROWS);
    await settle();
    expect(useData.getState().trips.kyoto.items).toHaveLength(1);
    expect(useUI.getState().sheets).toHaveLength(1);
  });
});

describe('ImportSheet：建立為新行程的當地貨幣', () => {
  it('記帳沒有幣別欄、填了城市「首爾」：新行程用韓元，不沿用目前行程的日圓', async () => {
    render();
    click(button(/^讀取$/));
    pending[0].resolve({ 記帳: [['日期', '項目', '金額'], ['11/21', '炸雞', '18000'], ['11/22', '烤肉', '45000']] });
    await settle();
    const city = [...document.querySelectorAll<HTMLInputElement>('input')].find((el) => el.placeholder === 'KYOTO')!;
    type(city, '首爾');
    expect(document.querySelector('[aria-label="匯入預覽"]')?.textContent).toContain('當地貨幣：KRW 韓元（依城市）');
    click(button('建立為新行程'));
    await settle();
    const st = useData.getState();
    const t = st.trips[st.activeTripId!];
    expect(t.id).not.toBe('kyoto');
    expect(t.localCurrency).toBe('KRW');
    expect(t.expenses.map((e) => e.currency)).toEqual(['KRW', 'KRW']);
  });
});

/** 合成的手排行程表（結構仿照使用者的 Google 試算表：圖例＋第一天日期列寫在標題格、日期列、★ ◇、「地點 / 交通」） */
const REAL_SHEET: RawSheets = {
  行程: [
    ['★ = 必做 ◇ = 可省略 日期 12/10（四）｜台北 → 舊金山｜住 Harbor View Inn', '時間 ', '類別 ', '行程內容 ', '地點 / 交通 ', '預估花費 ', '備註 '],
    ['', '20:10', '交通', '★ 搭捷運進市區', 'SFO → Powell St', '$11', ''],
    ['', '21:00', '住宿', '★ Harbor View Inn check-in', '500 Market St', '已訂', ''],
    ['12/11（五）｜舊金山 → 西雅圖｜住 Rainier Suites', '', '', '', '', '', ''],
    ['', '14:00', '景點', '◇ 派克市場', '85 Pike St', '免費', ''],
  ],
};

describe('ImportSheet：真實格式的試算表', () => {
  async function readReal() {
    // 沒寫年份的 12/10：以 2026-11-10 為今天推算（只換 Date，計時器照常）
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 10, 12));
    render();
    click(button(/^讀取$/));
    pending[0].resolve(REAL_SHEET);
    await settle();
    return document.querySelector('[aria-label="匯入預覽"]')!;
  }

  it('預覽顯示每天的城市與住宿、必做／可省略、每一站的導航目的地', async () => {
    const pv = await readReal();
    const text = pv.textContent ?? '';
    expect(text).toContain('每天的城市與住宿');
    expect(text).toContain('台北 → 舊金山 · 住 Harbor View Inn');
    expect(text).toContain('舊金山 → 西雅圖 · 住 Rainier Suites');
    expect(text).toContain('★ 必做 2');
    expect(text).toContain('◇ 可省略 1');
    expect(text).toMatch(/導航目的地.*San Francisco/);
    // 沒填城市：用最常過夜的城市
    expect([...pv.querySelectorAll<HTMLInputElement>('input')].some((el) => el.placeholder === 'SAN FRANCISCO')).toBe(true);
  });

  it('建立新行程：城市、當地貨幣跟著試算表；沒有 AI 金鑰時不跑 AI', async () => {
    await readReal();
    click(button('建立為新行程'));
    await settle();
    const st = useData.getState();
    const t = st.trips[st.activeTripId!];
    expect(t.id).not.toBe('kyoto');
    expect(t).toMatchObject({ city: 'SAN FRANCISCO', localCurrency: 'USD', startDate: '2026-12-10' });
    expect(t.days?.['2026-12-11']).toMatchObject({ city: '西雅圖', lodging: 'Rainier Suites' });
    expect(t.items.every((i) => i.place?.query)).toBe(true);
    expect(runResolvePlaces).not.toHaveBeenCalled();
    expect(useUI.getState().toasts.map((x) => x.text).join()).toContain('已建立');
  });

  it('有 AI 金鑰、開著自動辨識：建立後在背景用 AI 辨識地點並提示費用', async () => {
    useData.setState({ settings: { ...useData.getState().settings, anthropicApiKey: 'sk-ant-test' } });
    const pv = await readReal();
    expect(pv.textContent).toContain('建立後會用 AI 辨識每一站的導航地點（約 NT$5–10）');
    click(button('建立為新行程'));
    await settle();
    const st = useData.getState();
    expect(runResolvePlaces).toHaveBeenCalledWith(st.activeTripId);
    expect(useUI.getState().toasts.map((x) => x.text)).toContain('已匯入，AI 正在辨識地點（約 NT$5–10）');
  });

  it('關掉自動辨識或本趟 AI 預算用完：不跑 AI', async () => {
    useData.setState({ settings: { ...useData.getState().settings, anthropicApiKey: 'sk-ant-test', aiAutoResolvePlaces: false } });
    await readReal();
    click(button('建立為新行程'));
    await settle();
    expect(runResolvePlaces).not.toHaveBeenCalled();

    act(() => root?.unmount());
    host?.remove();
    root = host = null;
    pending.length = 0;
    useData.setState({ settings: { ...useData.getState().settings, aiAutoResolvePlaces: true } });
    vi.mocked(aiBudget).mockReturnValueOnce({ used: 200, limit: 200, remaining: 0, exceeded: true });
    await readReal();
    click(button('建立為新行程'));
    await settle();
    expect(runResolvePlaces).not.toHaveBeenCalled();
  });
});
