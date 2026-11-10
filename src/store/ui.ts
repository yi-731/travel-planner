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
  | { name: 'expenseForm'; expenseId?: string; prefill?: Partial<Expense>; /** prefill 來自 AI 收據辨識 */ fromAI?: boolean }
  | { name: 'import' }
  | { name: 'appSettings' };

export interface Toast {
  id: number;
  text: string;
  tone?: 'default' | 'good' | 'bad';
}

interface UIState {
  tab: Tab;
  /** 行程／導航分頁目前選的日期 */
  selectedDate: ISODate | null;
  sheets: SheetRoute[];
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
  toast: (text: string, tone?: Toast['tone']) => void;
  setBusy: (key: string, on: boolean) => void;
}

let toastSeq = 1;

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
  openSheet: (r) => set({ sheets: [...get().sheets, r] }),
  replaceSheet: (r) => set({ sheets: [...get().sheets.slice(0, -1), r] }),
  closeSheet: () => set({ sheets: get().sheets.slice(0, -1) }),
  closeAllSheets: () => set({ sheets: [] }),
  toast: (text, tone = 'default') => {
    const id = toastSeq++;
    set({ toasts: [...get().toasts, { id, text, tone }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 2600);
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
