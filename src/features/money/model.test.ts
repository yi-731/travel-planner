import { describe, expect, it } from 'vitest';
import type { Expense, Trip } from '@/domain/types';
import {
  categorySlices,
  currencyOptions,
  defaultExpenseDate,
  fmtDayHead,
  groupByDate,
  memberRows,
  normalizeSplit,
  parseAmount,
  rateLine,
  roundPercents,
  sanitizeAmountInput,
  summarize,
} from './model';

let seq = 0;
const ex = (p: Partial<Expense>): Expense => ({
  id: `e${++seq}`,
  date: '2026-11-21',
  title: '',
  amount: 1000,
  currency: 'JPY',
  category: 'food',
  payer: '我',
  split: [],
  createdAt: seq,
  updatedAt: seq,
  ...p,
});

const trip = (p: Partial<Trip> = {}): Trip => ({
  id: 't',
  name: '測試',
  city: 'KYOTO',
  startDate: '2026-11-21',
  endDate: '2026-11-25',
  localCurrency: 'JPY',
  homeCurrency: 'TWD',
  rate: 0.2,
  members: ['我', '旅伴'],
  items: [],
  expenses: [],
  cover: { kind: 'orb' },
  ai: { dayChecks: {} },
  createdAt: 0,
  updatedAt: 0,
  ...p,
});

describe('summarize', () => {
  it('旅途中以已過天數算日均，並算出剩餘預算', () => {
    const t = trip({
      budget: 1000,
      expenses: [ex({ date: '2026-11-21', amount: 1000 }), ex({ date: '2026-11-22', amount: 2000 })],
    });
    const s = summarize(t, '2026-11-22');
    expect(s.total).toBe(600);
    expect(s.today).toBe(400);
    expect(s.dailyAvg).toBe(300);
    expect(s.remaining).toBe(400);
    expect(s.used).toBeCloseTo(0.6);
    expect(s.over).toBe(false);
  });

  it('超支時 over = true、剩餘為負', () => {
    const t = trip({ budget: 100, expenses: [ex({ amount: 1000 })] });
    const s = summarize(t, '2026-11-01');
    expect(s.over).toBe(true);
    expect(s.remaining).toBe(-100);
  });

  it('沒有預算時不算比例；出發前預付的花費攤到全程天數，並算出距出發天數', () => {
    const t = trip({ expenses: [ex({ date: '2026-11-21', amount: 500 }), ex({ date: '2026-11-21', amount: 500 })] });
    const s = summarize(t, '2026-11-01');
    expect(s.budget).toBeNull();
    expect(s.used).toBeNull();
    expect(s.phase).toBe('before');
    expect(s.daysUntil).toBe(20);
    expect(s.tripDays).toBe(5);
    // 一晚飯店不再被當成「一天」：200 TWD ÷ 5 天
    expect(s.dailyAvg).toBe(40);
    expect(s.perDayLeft).toBeNull();
  });

  it('perDayLeft：剩餘預算平均到還沒過完的每一天', () => {
    // 預算 1000 TWD、已花 1000 JPY = 200 TWD，剩 800
    const t = trip({ budget: 1000, expenses: [ex({ date: '2026-11-21', amount: 1000 })] });
    expect(summarize(t, '2026-11-01').perDayLeft).toBe(160); // 出發前：800 ÷ 5 天
    expect(summarize(t, '2026-11-23').perDayLeft).toBe(800 / 3); // 第 3 天：含今天還有 3 天
    expect(summarize(t, '2026-11-23').daysUntil).toBeNull();
    expect(summarize(t, '2026-11-30').perDayLeft).toBeNull(); // 已結束
    expect(summarize(trip({ budget: 100, expenses: [ex({ amount: 1000 })] }), '2026-11-01').perDayLeft).toBe(0); // 超支
  });

  it('沒有日期的旅程：用有花費的天數算日均', () => {
    const t = trip({ startDate: null, endDate: null, expenses: [ex({ date: '2026-11-21', amount: 500 }), ex({ date: '2026-11-22', amount: 500 })] });
    const s = summarize(t, '2026-11-01');
    expect(s.phase).toBe('none');
    expect(s.tripDays).toBe(0);
    expect(s.dailyAvg).toBe(100);
  });
});

describe('categorySlices / roundPercents', () => {
  it('百分比加總剛好 100', () => {
    expect(roundPercents([1 / 3, 1 / 3, 1 / 3]).reduce((a, b) => a + b, 0)).toBe(100);
    const t = trip({ expenses: [ex({ category: 'food', amount: 1 }), ex({ category: 'stay', amount: 1 }), ex({ category: 'shop', amount: 1 })] });
    const sl = categorySlices(t);
    expect(sl.map((x) => x.pct).reduce((a, b) => a + b, 0)).toBe(100);
    expect(sl[0].label).toBeTruthy();
  });
  it('沒有花費回傳空陣列', () => {
    expect(categorySlices(trip())).toEqual([]);
  });
});

describe('memberRows', () => {
  it('付款與分攤一致，淨額加總為 0', () => {
    const t = trip({
      rate: 1,
      expenses: [ex({ amount: 100, payer: '我' }), ex({ amount: 50, payer: '旅伴', split: ['旅伴'] })],
    });
    const rows = memberRows(t);
    const me = rows.find((r) => r.name === '我')!;
    const pal = rows.find((r) => r.name === '旅伴')!;
    expect(me.paid).toBe(100);
    expect(me.share).toBe(50);
    expect(pal.share).toBe(100);
    expect(me.net + pal.net).toBeCloseTo(0);
  });
});

describe('groupByDate', () => {
  it('新的日期在上，並算出當日小計', () => {
    const t = trip({ rate: 1, expenses: [ex({ date: '2026-11-21', amount: 10 }), ex({ date: '2026-11-22', amount: 5 }), ex({ date: '2026-11-21', amount: 20 })] });
    const g = groupByDate(t);
    expect(g.map((x) => x.date)).toEqual(['2026-11-22', '2026-11-21']);
    expect(g[1].total).toBe(30);
    expect(g[1].expenses[0].amount).toBe(20);
  });
  it('日期標題含週幾', () => {
    expect(fmtDayHead('2026-11-21')).toBe('11/21（週六）');
  });
});

describe('金額輸入', () => {
  it('parseAmount 接受千分位、全形數字；拒絕 0 與非數字', () => {
    expect(parseAmount('1,280')).toBe(1280);
    expect(parseAmount('１２３．５')).toBe(123.5);
    expect(parseAmount('12.')).toBe(12);
    expect(parseAmount('0')).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });
  it('sanitizeAmountInput 只留數字與一個小數點（最多兩位小數）', () => {
    expect(sanitizeAmountInput('¥1,280')).toBe('1280');
    expect(sanitizeAmountInput('1.2.345')).toBe('1.23');
  });
});

describe('其他', () => {
  it('rateLine 顯示匯率與更新日', () => {
    expect(rateLine(trip())).toBe('1 JPY = 0.2 TWD');
    expect(rateLine(trip({ rateUpdatedAt: new Date(2026, 10, 9, 12).getTime() }))).toBe('1 JPY = 0.2 TWD · 更新於 11/9');
    expect(rateLine(trip({ localCurrency: 'TWD' }))).toBe('以 TWD 記帳');
  });
  it('currencyOptions 不重複且含目前值', () => {
    const o = currencyOptions(trip(), 'MOP');
    expect(o.slice(0, 3)).toEqual(['JPY', 'TWD', 'MOP']);
    expect(new Set(o).size).toBe(o.length);
  });
  it('defaultExpenseDate：今天在旅程內用今天，否則選取日或第一天', () => {
    const t = trip();
    expect(defaultExpenseDate(t, null, '2026-11-23')).toBe('2026-11-23');
    expect(defaultExpenseDate(t, '2026-11-24', '2026-11-01')).toBe('2026-11-24');
    expect(defaultExpenseDate(t, null, '2026-11-01')).toBe('2026-11-21');
  });
  it('normalizeSplit：全員或沒人都存成空陣列', () => {
    expect(normalizeSplit(['我', '旅伴'], ['我', '旅伴'])).toEqual([]);
    expect(normalizeSplit(['我', '旅伴'], [])).toEqual([]);
    expect(normalizeSplit(['我', '旅伴', 'C'], ['C', '我'])).toEqual(['我', 'C']);
  });
});
