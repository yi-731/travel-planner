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

/**
 * Anthropic 官方單價（美元／每百萬 token），用來把每次回應的實際 token 數換成費用（services/ai.ts 的 usageCostUsd）。
 * 設定頁可選的三個模型，加上伺服器端 refusal 備援可能改用的模型（Opus 5.5 → Opus 5 / Opus 4.8、Sonnet 5.5 → Sonnet 5）。
 * 快取讀取按輸入單價的 10%、寫入 125% 計。Haiku 5.5 的提示超過 10 萬 token 時單價較高，本 App 的請求遠小於此，不另計。
 * 改定價或換模型時一起更新（AI_MODELS 的 cost 文字也要改）。
 */
export const AI_PRICES: Record<string, { input: number; output: number }> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
};
export const AI_CACHE_READ_FACTOR = 0.1;
export const AI_CACHE_WRITE_FACTOR = 1.25;
/** 行程沒有美元匯率時，用這個匯率把 AI 費用換成新台幣 */
export const USD_TWD_FALLBACK = 32;

/** 每趟 AI 花費上限的選項（新台幣；0 = 不限制）；預設 200（store/data.ts 的 defaultSettings） */
export const AI_BUDGET_CHOICES = [100, 200, 300, 500, 0];
/** AI 地點辨識開始前，本趟剩餘額度至少要有這麼多（新台幣；一批 60 站最多約這個數） */
export const AI_PLACES_MIN_TWD = 15;

/** 各 AI 功能的名稱（AIUsage.byFeature 的 key → 顯示名稱） */
export const AI_FEATURES = [
  { key: 'places', label: '地點辨識', unit: '每 60 站' },
  { key: 'dayCheck', label: '排程檢查', unit: '每天' },
  { key: 'recommend', label: '景點推薦', unit: '每次' },
  { key: 'packing', label: '穿搭建議', unit: '每次' },
  { key: 'receipt', label: '收據辨識', unit: '每張' },
] as const;
export type AIFeature = (typeof AI_FEATURES)[number]['key'];
export const aiFeatureLabel = (k: string) => AI_FEATURES.find((f) => f.key === k)?.label ?? k;

/**
 * 各功能一次請求大約用掉的 token（輸入；輸出含思考的低～高），設定頁依選到的模型換算成大約費用。
 * 依實際請求量測：地點辨識一批 60 站的提示約 6K token，回覆加思考 6K–14K；其他功能的回覆都在 1K–6K。
 */
export const AI_FEATURE_TOKENS: Record<AIFeature, { input: number; output: [number, number] }> = {
  places: { input: 6000, output: [6000, 14000] },
  dayCheck: { input: 1500, output: [1500, 4500] },
  recommend: { input: 2000, output: [2500, 6000] },
  packing: { input: 1200, output: [1000, 2500] },
  receipt: { input: 2000, output: [600, 1500] },
};
export const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
