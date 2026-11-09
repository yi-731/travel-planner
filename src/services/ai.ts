/**
 * AI 助理（Anthropic Claude API，使用者自備 API 金鑰，存在裝置上）。
 * 用官方 @anthropic-ai/sdk（瀏覽器模式）＋結構化輸出。
 * TODO（AI 代理）：實作
 */
import type { DayCheck, ExpenseCategory, ISODate, Trip, WeatherCache } from '@/domain/types';

export type AIErrorCode = 'no_key' | 'auth' | 'rate_limited' | 'overloaded' | 'network' | 'refused' | 'bad_output' | 'unknown';
export class AIError extends Error {
  constructor(public code: AIErrorCode, message: string) {
    super(message);
  }
}
/** 給使用者看的中文錯誤訊息 */
export function aiErrorMessage(_e: unknown): string {
  throw new Error('TODO');
}

export function aiReady(): boolean {
  throw new Error('TODO');
}

/** 檢查某天行程：估算相鄰兩站的移動時間、提醒太趕或營業時間問題 */
export async function checkDay(_trip: Trip, _date: ISODate, _signal?: AbortSignal): Promise<DayCheck> {
  throw new Error('TODO');
}

export interface Recommendation {
  name: string;
  nameZh: string;
  type: 'sight' | 'food' | 'shop' | 'other';
  why: string;
  bestTime?: string;
  price?: string;
}
/** 依需求推薦附近地點 */
export async function recommendPlaces(_trip: Trip, _date: ISODate, _query: string, _signal?: AbortSignal): Promise<Recommendation[]> {
  throw new Error('TODO');
}

/** 依天氣預報給穿搭與攜帶建議 */
export async function packingAdvice(_trip: Trip, _weather: WeatherCache, _signal?: AbortSignal): Promise<{ text: string; tips: string[] }> {
  throw new Error('TODO');
}

export interface ReceiptResult {
  amount: number;
  currency: string;
  title: string;
  category: ExpenseCategory;
  date?: ISODate;
}
/** 收據照片 → 金額、幣別、店名、分類 */
export async function scanReceipt(_trip: Trip, _image: Blob, _signal?: AbortSignal): Promise<ReceiptResult> {
  throw new Error('TODO');
}
