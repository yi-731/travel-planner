import type { ExpenseCategory, ItemType } from './types';

export interface Option<K extends string> {
  key: K;
  label: string;
  /** CSS 變數名稱，例如 --t-sight */
  color: string;
}

export const ITEM_TYPES: Option<ItemType>[] = [
  { key: 'sight', label: '景點', color: '--t-sight' },
  { key: 'food', label: '餐廳', color: '--t-food' },
  { key: 'transport', label: '交通', color: '--t-transport' },
  { key: 'stay', label: '住宿', color: '--t-stay' },
  { key: 'shop', label: '購物', color: '--t-shop' },
  { key: 'other', label: '其他', color: '--t-other' },
];

export const EXPENSE_CATEGORIES: Option<ExpenseCategory>[] = [
  { key: 'food', label: '餐飲', color: '--t-food' },
  { key: 'transport', label: '交通', color: '--t-transport' },
  { key: 'stay', label: '住宿', color: '--t-stay' },
  { key: 'ticket', label: '門票', color: '--t-sight' },
  { key: 'shop', label: '購物', color: '--t-shop' },
  { key: 'other', label: '其他', color: '--t-other' },
];

export const itemType = (k: ItemType | string | undefined) => ITEM_TYPES.find((t) => t.key === k) ?? ITEM_TYPES[5];
export const expenseCategory = (k: ExpenseCategory | string | undefined) =>
  EXPENSE_CATEGORIES.find((t) => t.key === k) ?? EXPENSE_CATEGORIES[5];
/** 用在 style 屬性：{ '--c': cssVar(color) } */
export const cssVar = (name: string) => `var(${name})`;

export const COMMON_CURRENCIES = ['TWD', 'JPY', 'KRW', 'USD', 'EUR', 'GBP', 'HKD', 'CNY', 'THB', 'SGD', 'VND', 'AUD', 'CAD', 'CHF', 'MYR', 'PHP', 'IDR'];

/** Claude 模型選項（設定頁可切換） */
export const AI_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5（預設，最聰明）' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5（較快、較省）' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5（最快、最省）' },
];

export const DEFAULT_AI_MODEL = 'claude-opus-5-5';
export const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
