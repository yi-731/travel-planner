import { create } from 'zustand';
import type { Expense, ISODate } from '@/domain/types';

export type Tab = 'home' | 'plan' | 'map' | 'money' | 'more';

/**
 * 彈出頁（bottom sheet）路由。新增一種彈出頁：
 *  1. 在這裡加一個型別
 *  2. 在 src/app/sheetRegistry.tsx 對應到元件
 */
export type SheetRoute =
  | { name: 'place'; itemId: string }
  | { name: 'itemForm'; itemId?: string; date?: ISODate }
  | { name: 'segment'; fromId: string; toId: string }
  | { name: 'weather' }
  | { name: 'recommend'; date?: ISODate }
  | { name: 'tripPicker' }
  | { name: 'newTrip' }
  | { name: 'tripSettings' }
  | { name: 'expenseForm'; expenseId?: string; prefill?: Partial<Expense>; /** prefill 來自 AI 收據辨識 */ fromAI?: boolean; /** 記在哪趟旅程（預設目前旅程） */ tripId?: string }
  | { name: 'import' }
  | { name: 'appSettings' };

export interface Toast {
  id: number;
  text: string;
  tone?: 'default' | 'good' | 'bad';
}

/**
 * 堆疊中的彈出頁：openSheet／replaceSheet 每次都給新的 key，
 * 還在滑出動畫中的舊頁面才不會被重新開啟的同名頁面沿用。
 * （key 設成選填只是讓測試能直接 setState；App 內一律經由 openSheet）
 */
export type SheetEntry = SheetRoute & { key?: number };

interface UIState {
  tab: Tab;
  /** 行程／導航分頁目前選的日期 */
  selectedDate: ISODate | null;
  sheets: SheetEntry[];
  toasts: Toast[];
  /** 進行中的背景工作（AI、同步…），key → true */
  busy: Record<string, boolean>;

  setTab: (t: Tab) => void;
  selectDate: (d: ISODate | null) => void;
  openSheet: (r: SheetRoute) => void;
  /** 取代最上層彈出頁 */
  replaceSheet: (r: SheetRoute) => void;
  closeSheet: () => void;
  closeAllSheets: () => void;
  /** ms：顯示多久（預設 2.6 秒；字比較多的重要訊息可以加長） */
  toast: (text: string, tone?: Toast['tone'], ms?: number) => void;
  setBusy: (key: string, on: boolean) => void;
}

let toastSeq = 1;
let sheetSeq = 1;

/**
 * 開第一層彈出頁前有焦點的元素（按鈕等）：全部關閉後把焦點還給它（鍵盤、VoiceOver 才不會迷路）。
 * 要在這裡記：彈出頁畫出來時，底下的頁面已經 inert，焦點早就掉到 body 了。
 */
let sheetOpener: HTMLElement | null = null;
function rememberOpener() {
  if (typeof document === 'undefined') return;
  const a = document.activeElement;
  // 焦點還在正在關閉的彈出頁裡（例如 closeAllSheets 後馬上開新的一頁）：保留原本記下的
  if (a instanceof HTMLElement && a.closest('[role="dialog"]')) return;
  sheetOpener = a instanceof HTMLElement && a !== document.body ? a : null;
}
/** 取出並清除「開啟彈出頁的元素」（彈出頁全部關閉後由 AppShell 呼叫） */
export function takeSheetOpener(): HTMLElement | null {
  const el = sheetOpener;
  sheetOpener = null;
  return el;
}

export const useUI = create<UIState>()((set, get) => ({
  tab: readTab(),
  selectedDate: null,
  sheets: [],
  toasts: [],
  busy: {},

  setTab: (tab) => {
    set({ tab });
    try {
      sessionStorage.setItem('tp:tab', tab);
    } catch {
      /* ignore */
    }
  },
  selectDate: (selectedDate) => set({ selectedDate }),
  openSheet: (r) => {
    if (get().sheets.length === 0) rememberOpener();
    set({ sheets: [...get().sheets, { ...r, key: sheetSeq++ }] });
  },
  replaceSheet: (r) => {
    if (get().sheets.length === 0) rememberOpener();
    set({ sheets: [...get().sheets.slice(0, -1), { ...r, key: sheetSeq++ }] });
  },
  closeSheet: () => set({ sheets: get().sheets.slice(0, -1) }),
  closeAllSheets: () => set({ sheets: [] }),
  toast: (text, tone = 'default', ms = 2600) => {
    const id = toastSeq++;
    set({ toasts: [...get().toasts, { id, text, tone }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), ms);
  },
  setBusy: (key, on) => {
    const busy = { ...get().busy };
    if (on) busy[key] = true;
    else delete busy[key];
    set({ busy });
  },
}));

function readTab(): Tab {
  try {
    const t = sessionStorage.getItem('tp:tab') as Tab | null;
    if (t && ['home', 'plan', 'map', 'money', 'more'].includes(t)) return t;
  } catch {
    /* ignore */
  }
  return 'home';
}
