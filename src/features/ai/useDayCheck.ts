/**
 * AI 排程檢查 hook：執行 checkDay 並把結果存進 trip.ai.dayChecks[date]。
 * TODO（AI 代理）：實作
 */
import type { ISODate } from '@/domain/types';

export function useDayCheck(_tripId: string, _date: ISODate | null): { run: () => Promise<void>; busy: boolean; error: string | null } {
  return { run: async () => {}, busy: false, error: null };
}
