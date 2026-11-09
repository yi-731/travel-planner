import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { DEFAULT_AI_MODEL } from '@/domain/constants';
import { uid } from '@/domain/ids';
import type { Expense, Item, Settings, Trip } from '@/domain/types';
import { idbStorage } from './persist';
import { migrate, SCHEMA_VERSION } from './migrations';
import { buildSampleTrip } from './sample';

/**
 * 持久化資料（存在手機的 IndexedDB）：所有行程、目前行程、設定。
 * 畫面狀態（分頁、彈出頁）在 ./ui.ts，不會存檔。
 */
export interface DataState {
  hydrated: boolean;
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

  updateSettings: (patch: Partial<Settings>) => void;
}

export const defaultSettings: Settings = {
  theme: 'system',
  anthropicApiKey: '',
  aiModel: DEFAULT_AI_MODEL,
  haptics: true,
  reminders: false,
  reminderLeadMin: 15,
  defaultHomeCurrency: 'TWD',
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
        draft.updatedAt = Date.now();
        set({ trips: { ...get().trips, [id]: draft } });
      };
      return {
        hydrated: false,
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

        updateSettings: (patch) => set({ settings: { ...get().settings, ...patch } }),
      };
    },
    {
      name: 'travel-planner',
      version: SCHEMA_VERSION,
      storage: createJSONStorage(() => idbStorage),
      migrate,
      partialize: (s) => ({ trips: s.trips, activeTripId: s.activeTripId, settings: s.settings }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<DataState>;
        return { ...current, ...p, settings: { ...defaultSettings, ...(p.settings ?? {}) } };
      },
      onRehydrateStorage: () => (state, error) => {
        if (error || !state) {
          useData.setState({ hydrated: true });
          return;
        }
        // 第一次開啟：建立範例行程
        if (!Object.keys(state.trips).length && !localStorageFlag('seeded')) {
          const t = buildSampleTrip();
          useData.setState({ trips: { [t.id]: t }, activeTripId: t.id });
          localStorageFlag('seeded', true);
        }
        const st = useData.getState();
        if (!st.activeTripId || !st.trips[st.activeTripId]) useData.setState({ activeTripId: Object.keys(st.trips)[0] ?? null });
        useData.setState({ hydrated: true });
      },
    },
  ),
);

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
