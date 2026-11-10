import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { DEFAULT_AI_MODEL } from '@/domain/constants';
import { uid } from '@/domain/ids';
import { carryRates, sanitizeRates } from '@/domain/money';
import type { Expense, Item, Settings, Trip } from '@/domain/types';
import { backupUnreadable, idbStorage, requestPersistentStorage, setWriteGate } from './persist';
import { migrate, SCHEMA_VERSION } from './migrations';
import { buildSampleTrip } from './sample';
import { healSettings, healTrips } from '@/features/more/backup';

/**
 * 持久化資料（存在手機的 IndexedDB）：所有行程、目前行程、設定。
 * 畫面狀態（分頁、彈出頁）在 ./ui.ts，不會存檔。
 */
export interface DataState {
  hydrated: boolean;
  /**
   * 啟動時讀不到手機裡的資料（iOS 偶爾斷線、資料壞掉、版本轉換出錯）。
   * 資料沒有被刪除：這時不會寫入任何東西，畫面要請使用者重新讀取（retryLoad）。null = 正常。
   */
  loadError: string | null;
  trips: Record<string, Trip>;
  activeTripId: string | null;
  settings: Settings;

  setActiveTrip: (id: string | null) => void;
  createTrip: (init: Partial<Trip> & Pick<Trip, 'name'>) => string;
  /** 以函式修改行程（傳入的是可直接修改的複本） */
  mutateTrip: (id: string, fn: (draft: Trip) => void) => void;
  replaceTrip: (trip: Trip) => void;
  deleteTrip: (id: string) => void;

  upsertItem: (tripId: string, item: Partial<Item> & Pick<Item, 'title'>) => string;
  deleteItem: (tripId: string, itemId: string) => void;
  toggleDone: (tripId: string, itemId: string) => void;

  upsertExpense: (tripId: string, e: Partial<Expense> & Pick<Expense, 'amount'>) => string;
  deleteExpense: (tripId: string, expenseId: string) => void;

  /** 寫入其他幣別的匯率（1 單位該幣別 = N 本國貨幣），例如查到 USD 的匯率後 */
  setRates: (tripId: string, rates: Record<string, number>) => void;

  updateSettings: (patch: Partial<Settings>) => void;
  /** 讀取失敗後重新讀取；成功前不會寫入，手機裡的舊資料不會被蓋掉 */
  retryLoad: () => Promise<void>;
}

/** IndexedDB 裡的 key */
export const STORAGE_KEY = 'travel-planner';

export const defaultSettings: Settings = {
  theme: 'system',
  anthropicApiKey: '',
  aiModel: DEFAULT_AI_MODEL,
  haptics: true,
  reminders: false,
  reminderLeadMin: 15,
  defaultHomeCurrency: 'TWD',
  aiTripBudgetTwd: 200,
  aiAutoResolvePlaces: true,
};

export function newTrip(init: Partial<Trip> & Pick<Trip, 'name'>, settings: Settings = defaultSettings): Trip {
  const now = Date.now();
  return {
    id: uid(),
    city: '',
    startDate: null,
    endDate: null,
    localCurrency: 'JPY',
    homeCurrency: settings.defaultHomeCurrency,
    rate: 1,
    members: ['我'],
    items: [],
    expenses: [],
    cover: { kind: 'orb', hue: 0 },
    ai: { dayChecks: {} },
    createdAt: now,
    updatedAt: now,
    ...init,
  };
}

/** 修改行程時同步調整出發／回程日，讓日期涵蓋所有行程點 */
function widenDates(t: Trip) {
  const ds = t.items.map((i) => i.date).filter((d): d is string => !!d).sort();
  if (!ds.length) return;
  if (!t.startDate || ds[0] < t.startDate) t.startDate = ds[0];
  if (!t.endDate || ds[ds.length - 1] > t.endDate) t.endDate = ds[ds.length - 1];
}

export const useData = create<DataState>()(
  persist(
    (set, get) => {
      const mutate = (id: string, fn: (d: Trip) => void) => {
        const cur = get().trips[id];
        if (!cur) return;
        const draft = structuredClone(cur);
        fn(draft);
        // 改了當地／本國貨幣：已記的花費維持原本的換算結果
        carryRates(cur, draft);
        draft.updatedAt = Date.now();
        set({ trips: { ...get().trips, [id]: draft } });
      };
      return {
        hydrated: false,
        loadError: null,
        trips: {},
        activeTripId: null,
        settings: defaultSettings,

        setActiveTrip: (id) => set({ activeTripId: id }),
        createTrip: (init) => {
          const t = newTrip(init, get().settings);
          widenDates(t);
          set({ trips: { ...get().trips, [t.id]: t }, activeTripId: t.id });
          return t.id;
        },
        mutateTrip: mutate,
        replaceTrip: (trip) => set({ trips: { ...get().trips, [trip.id]: { ...trip, updatedAt: Date.now() } } }),
        deleteTrip: (id) => {
          const trips = { ...get().trips };
          delete trips[id];
          const next = get().activeTripId === id ? (Object.keys(trips)[0] ?? null) : get().activeTripId;
          set({ trips, activeTripId: next });
        },

        upsertItem: (tripId, patch) => {
          const id = patch.id ?? uid();
          mutate(tripId, (t) => {
            const now = Date.now();
            const k = t.items.findIndex((i) => i.id === id);
            if (k >= 0) t.items[k] = { ...t.items[k], ...patch, id, updatedAt: now };
            else t.items.push({ type: 'other', date: null, done: false, createdAt: now, ...patch, id, updatedAt: now } as Item);
            widenDates(t);
          });
          return id;
        },
        deleteItem: (tripId, itemId) => mutate(tripId, (t) => void (t.items = t.items.filter((i) => i.id !== itemId))),
        toggleDone: (tripId, itemId) =>
          mutate(tripId, (t) => {
            const it = t.items.find((i) => i.id === itemId);
            if (it) it.done = !it.done;
          }),

        upsertExpense: (tripId, patch) => {
          const id = patch.id ?? uid();
          mutate(tripId, (t) => {
            const now = Date.now();
            const k = t.expenses.findIndex((e) => e.id === id);
            if (k >= 0) t.expenses[k] = { ...t.expenses[k], ...patch, id, updatedAt: now };
            else
              t.expenses.push({
                date: new Date().toISOString().slice(0, 10), title: '', currency: t.localCurrency, category: 'other',
                payer: t.members[0] ?? '我', split: [], createdAt: now, ...patch, id, updatedAt: now,
              } as Expense);
          });
          return id;
        },
        deleteExpense: (tripId, expenseId) => mutate(tripId, (t) => void (t.expenses = t.expenses.filter((e) => e.id !== expenseId))),

        setRates: (tripId, rates) =>
          mutate(tripId, (t) => {
            const next = { ...sanitizeRates(t.rates), ...sanitizeRates(rates) };
            // 本國貨幣固定是 1、當地貨幣用 trip.rate
            delete next[t.homeCurrency];
            delete next[t.localCurrency];
            if (Object.keys(next).length) t.rates = next;
            else delete t.rates;
          }),

        updateSettings: (patch) => set({ settings: { ...get().settings, ...patch } }),
        retryLoad: async () => {
          // 畫面維持在錯誤頁，直到讀取成功（成功時才清掉 loadError）
          setWriteGate('pending');
          await useData.persist.rehydrate();
        },
      };
    },
    {
      name: STORAGE_KEY,
      version: SCHEMA_VERSION,
      storage: createJSONStorage(() => idbStorage),
      migrate,
      partialize: (s) => ({ trips: s.trips, activeTripId: s.activeTripId, settings: s.settings }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<DataState>;
        return { ...current, ...p, trips: healTrips(p.trips ?? current.trips), settings: healSettings(p.settings, defaultSettings) };
      },
      onRehydrateStorage: () => (state, error) => {
        if (error || !state) {
          // 讀不到或讀到壞資料：絕對不能寫入，否則空白的初始狀態會蓋掉手機裡所有的行程與金鑰
          setWriteGate('pending');
          console.error('[travel-planner] 讀取資料失敗', error);
          void backupUnreadable(STORAGE_KEY);
          useData.setState({ hydrated: true, loadError: describeError(error) });
          setWriteGate('blocked');
          return;
        }
        // 讀取成功才開放寫入（下面這些 setState 會把讀到的資料連同變更一起存回去）
        setWriteGate('open');
        void requestPersistentStorage();
        // 第一次開啟：建立範例行程
        if (!Object.keys(state.trips).length && !localStorageFlag('seeded')) {
          const t = buildSampleTrip();
          useData.setState({ trips: { [t.id]: t }, activeTripId: t.id });
          localStorageFlag('seeded', true);
        }
        const st = useData.getState();
        if (!st.activeTripId || !st.trips[st.activeTripId]) useData.setState({ activeTripId: Object.keys(st.trips)[0] ?? null });
        useData.setState({ hydrated: true, loadError: null });
      },
    },
  ),
);

function describeError(e: unknown): string {
  if (e instanceof Error) return e.name && e.name !== 'Error' ? `${e.name}: ${e.message}` : e.message || '未知錯誤';
  return e == null ? '未知錯誤' : String(e);
}

function localStorageFlag(key: string, value?: boolean): boolean {
  try {
    if (value !== undefined) localStorage.setItem(`tp:${key}`, value ? '1' : '0');
    return localStorage.getItem(`tp:${key}`) === '1';
  } catch {
    return false;
  }
}

/** 目前選取的行程（沒有則 null） */
export const useActiveTrip = (): Trip | null => useData((s) => (s.activeTripId ? s.trips[s.activeTripId] ?? null : null));
