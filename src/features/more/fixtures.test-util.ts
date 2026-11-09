/** 測試用的行程與設定（不 import store，避免在測試環境啟動 IndexedDB 持久化） */
import type { Settings, Trip } from '@/domain/types';

export function mkTrip(init: Partial<Trip> & Pick<Trip, 'name'>): Trip {
  return {
    id: Math.random().toString(36).slice(2, 10),
    city: '',
    startDate: null,
    endDate: null,
    localCurrency: 'JPY',
    homeCurrency: 'TWD',
    rate: 1,
    members: ['我'],
    items: [],
    expenses: [],
    cover: { kind: 'orb', hue: 0 },
    ai: { dayChecks: {} },
    createdAt: 0,
    updatedAt: 0,
    ...init,
  };
}

export const testSettings: Settings = {
  theme: 'system',
  anthropicApiKey: '',
  aiModel: 'claude-opus-5-5',
  haptics: true,
  reminders: false,
  reminderLeadMin: 15,
  defaultHomeCurrency: 'TWD',
};
