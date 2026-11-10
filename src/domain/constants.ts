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
/** 行程點的時間長度怎麼稱呼：交通（電車、巴士、航班…）是「需時」，其他都是「停留」 */
export const durationWord = (type: ItemType | string | undefined) => (type === 'transport' ? '需時' : '停留');
export const expenseCategory = (k: ExpenseCategory | string | undefined) =>
  EXPENSE_CATEGORIES.find((t) => t.key === k) ?? EXPENSE_CATEGORIES[5];
/** 用在 style 屬性：{ '--c': cssVar(color) } */
export const cssVar = (name: string) => `var(${name})`;

export const COMMON_CURRENCIES = ['TWD', 'JPY', 'KRW', 'USD', 'EUR', 'GBP', 'HKD', 'CNY', 'THB', 'SGD', 'VND', 'AUD', 'CAD', 'CHF', 'MYR', 'PHP', 'IDR'];

/**
 * Claude 模型選項（設定頁可切換）。
 * cost：一次 AI 功能（排程檢查、推薦、收據辨識…）的大約費用，依 Anthropic 定價估算
 * （Opus 5.5 每百萬 token 輸入 $4／輸出 $20、Sonnet 5.5 $2／$10、Haiku 5.5 $0.10／$0.50）。
 * 改定價或換模型時一起更新。
 */
export const AI_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5（預設，最聰明）', cost: '每次約 NT$1–5' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5（較快、較省）', cost: '每次約 NT$0.5–2' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5（最快、最省）', cost: '每次不到 NT$0.2' },
];

/** 模型選單下方的費用小字（跟著選到的模型變） */
export function aiCostHint(model: string): string {
  const cost = AI_MODELS.find((m) => m.id === model)?.cost;
  return cost ? `${cost}，實際依 Anthropic 用量計費` : '費用依 Anthropic 用量計費';
}

export const DEFAULT_AI_MODEL = 'claude-opus-5-5';
export const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
