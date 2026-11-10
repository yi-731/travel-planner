/**
 * AI 用量與費用的顯示（純函式，有測試 aiUsage.test.ts）：更多分頁的「本趟 AI 已用」、App 設定的各功能大約費用、完成提示。
 * 費用怎麼算見 services/ai.ts 的 usageCostUsd；單價在 domain/constants.ts。
 */
import { AI_FEATURES, aiFeatureLabel } from '@/domain/constants';
import type { AIUsage } from '@/domain/types';

const thousands = (n: number) => Math.round(n).toLocaleString('en-US');

/** 用量金額：不到 0.1 元寫「不到 NT$0.1」，10 元以下留一位小數（NT$6.3），以上取整數（NT$12） */
export function fmtTwd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return 'NT$0';
  if (n < 0.05) return '不到 NT$0.1';
  if (n < 9.95) return `NT$${(Math.round(n * 10) / 10).toString()}`;
  return `NT$${thousands(n)}`;
}

/** 完成提示用的大約金額：「花費約 NT$6」「花費不到 NT$1」 */
export function spentText(n: number): string {
  return !Number.isFinite(n) || n < 1 ? '花費不到 NT$1' : `花費約 NT$${thousands(n)}`;
}

/** 大約費用範圍：「約 NT$5–10」「約 NT$2」「不到 NT$1」 */
export function fmtTwdRange([lo, hi]: readonly [number, number]): string {
  if (!Number.isFinite(hi) || hi < 1) return '不到 NT$1';
  const a = Math.max(1, Math.round(lo));
  const b = Math.max(a, Math.round(hi));
  return a === b ? `約 NT$${a}` : `約 NT$${a}–${b}`;
}

/** 上限的文字：「NT$200」「不限制」 */
export const fmtLimit = (limit: number) => (limit > 0 ? `NT$${thousands(limit)}` : '不限制');

/** 「本趟 AI 已用 NT$12 / 200」 */
export function usageTitle(used: number, limit: number): string {
  return limit > 0 ? `本趟 AI 已用 ${fmtTwd(used)} / ${thousands(limit)}` : `本趟 AI 已用 ${fmtTwd(used)}（不限制）`;
}

/** 已用比例 0–1（不限制時為 null） */
export function budgetRatio(used: number, limit: number): number | null {
  if (!(limit > 0)) return null;
  return Math.min(1, Math.max(0, (Number.isFinite(used) ? used : 0) / limit));
}

/** 進度條的程度：ok（八成以下）、warn（八成以上）、full（用完） */
export function budgetLevel(used: number, limit: number): 'ok' | 'warn' | 'full' {
  const r = budgetRatio(used, limit);
  if (r == null || r < 0.8) return 'ok';
  return r >= 1 ? 'full' : 'warn';
}

/** token 數：「850」「12.3K」「1.2M」 */
export function fmtTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(Math.round(n / 100) / 10).toString()}K`;
  return `${(Math.round(n / 100_000) / 10).toString()}M`;
}

/** 依功能列出花費（固定順序：地點辨識、排程檢查、推薦、穿搭、收據，其他放最後）；0 元的不列 */
export function usageBreakdown(usage: AIUsage | undefined): { key: string; label: string; costTwd: number }[] {
  const by = usage?.byFeature ?? {};
  const known: string[] = AI_FEATURES.map((f) => f.key);
  const keys = [...known, ...Object.keys(by).filter((k) => !known.includes(k)).sort()];
  return keys
    .map((key) => ({ key, label: aiFeatureLabel(key), costTwd: typeof by[key] === 'number' && Number.isFinite(by[key]) ? by[key] : 0 }))
    .filter((r) => r.costTwd > 0);
}
