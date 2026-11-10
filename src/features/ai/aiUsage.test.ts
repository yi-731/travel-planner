import { describe, expect, it } from 'vitest';
import { budgetLevel, budgetRatio, fmtLimit, fmtTokens, fmtTwd, fmtTwdRange, spentText, usageBreakdown, usageTitle } from './aiUsage';

describe('金額文字', () => {
  it('用量：小額留一位小數，10 元以上取整數', () => {
    expect(fmtTwd(0)).toBe('NT$0');
    expect(fmtTwd(Number.NaN)).toBe('NT$0');
    expect(fmtTwd(0.02)).toBe('不到 NT$0.1');
    expect(fmtTwd(0.44)).toBe('NT$0.4');
    expect(fmtTwd(6)).toBe('NT$6');
    expect(fmtTwd(6.27)).toBe('NT$6.3');
    expect(fmtTwd(12.4)).toBe('NT$12');
    expect(fmtTwd(1234.5)).toBe('NT$1,235');
  });
  it('完成提示與大約範圍', () => {
    expect(spentText(5.6)).toBe('花費約 NT$6');
    expect(spentText(0.3)).toBe('花費不到 NT$1');
    expect(fmtTwdRange([4.6, 9.7])).toBe('約 NT$5–10');
    expect(fmtTwdRange([0.4, 1.2])).toBe('約 NT$1');
    expect(fmtTwdRange([0.1, 0.3])).toBe('不到 NT$1');
  });
  it('上限與標題', () => {
    expect(fmtLimit(200)).toBe('NT$200');
    expect(fmtLimit(0)).toBe('不限制');
    expect(usageTitle(12.2, 200)).toBe('本趟 AI 已用 NT$12 / 200');
    expect(usageTitle(3.25, 0)).toBe('本趟 AI 已用 NT$3.3（不限制）');
  });
});

describe('預算進度', () => {
  it('比例與程度', () => {
    expect(budgetRatio(50, 200)).toBe(0.25);
    expect(budgetRatio(500, 200)).toBe(1);
    expect(budgetRatio(5, 0)).toBeNull();
    expect(budgetLevel(100, 200)).toBe('ok');
    expect(budgetLevel(170, 200)).toBe('warn');
    expect(budgetLevel(200, 200)).toBe('full');
    expect(budgetLevel(999, 0)).toBe('ok');
  });
});

describe('明細', () => {
  it('依固定順序列出有花費的功能，不認得的放最後', () => {
    const rows = usageBreakdown({ costTwd: 10, calls: 4, inputTokens: 0, outputTokens: 0, byFeature: { receipt: 0.5, places: 6, zzz: 1, dayCheck: 0, recommend: 2.5 } });
    expect(rows.map((r) => [r.label, r.costTwd])).toEqual([
      ['地點辨識', 6],
      ['景點推薦', 2.5],
      ['收據辨識', 0.5],
      ['zzz', 1],
    ]);
    expect(usageBreakdown(undefined)).toEqual([]);
  });
  it('token 數', () => {
    expect(fmtTokens(850)).toBe('850');
    expect(fmtTokens(12_345)).toBe('12.3K');
    expect(fmtTokens(1_250_000)).toBe('1.3M');
    expect(fmtTokens(-1)).toBe('0');
  });
});
