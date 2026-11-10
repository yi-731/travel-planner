import { describe, expect, it } from 'vitest';
import { buildSampleTrip } from '@/store/sample';
import {
  balances,
  byCategory,
  carryRates,
  expenseHome,
  hasRate,
  isConverted,
  missingRateCurrencies,
  rateFor,
  sanitizeRates,
  settle,
  toHome,
  totalHome,
  unconvertedCount,
} from './money';
import type { Expense, Trip } from './types';

/** 模擬「行程設定」改幣別：在複本上改，再跑 store 的 carryRates */
function changeCurrencies(t: Trip, local: string, home: string, rate: number): Trip {
  const d = structuredClone(t);
  d.localCurrency = local;
  d.homeCurrency = home;
  d.rate = rate;
  carryRates(t, d);
  return d;
}

let seq = 0;
const ex = (p: Partial<Expense>): Expense => ({
  id: `e${++seq}`, date: '2026-11-21', title: '', amount: 100, currency: 'TWD', category: 'food', payer: 'A', split: [], createdAt: 0, updatedAt: 0, ...p,
});
const trip = (p: Partial<Trip> = {}): Trip => ({
  id: 't', name: '測試', city: '', startDate: '2026-11-21', endDate: '2026-11-23', localCurrency: 'JPY', homeCurrency: 'TWD', rate: 0.2,
  members: ['A', 'B', 'C'], items: [], expenses: [], cover: { kind: 'orb' }, ai: { dayChecks: {} }, createdAt: 0, updatedAt: 0, ...p,
});

describe('換算', () => {
  it('範例行程總額 21234 TWD', () => {
    expect(totalHome(buildSampleTrip())).toBeCloseTo(21234, 6);
  });

  it('沒有匯率的幣別不當成 1:1', () => {
    const t = trip({ expenses: [ex({ amount: 30, currency: 'USD' }), ex({ amount: 1000, currency: 'JPY' }), ex({ amount: 50 })] });
    expect(toHome(t, 30, 'USD')).toBeNull();
    expect(hasRate(t, 'USD')).toBe(false);
    expect(isConverted(t, t.expenses[0])).toBe(false);
    expect(expenseHome(t, t.expenses[0])).toBe(0);
    expect(totalHome(t)).toBeCloseTo(250, 6);
    expect(unconvertedCount(t)).toBe(1);
    expect(missingRateCurrencies(t)).toEqual(['USD']);
  });

  it('rates 裡有匯率就換算', () => {
    const t = trip({ rates: { USD: 32 }, expenses: [ex({ amount: 30, currency: 'USD' }), ex({ amount: 1000, currency: 'JPY' })] });
    expect(rateFor(t, 'USD')).toBe(32);
    expect(totalHome(t)).toBeCloseTo(960 + 200, 6);
    expect(unconvertedCount(t)).toBe(0);
  });

  it('壞掉的 rates 值一律當成沒有匯率', () => {
    const t = trip({ rates: { USD: -1, EUR: Number.NaN, KRW: '0.02' as unknown as number } });
    for (const c of ['USD', 'EUR', 'KRW', 'constructor', 'toString']) expect(rateFor(t, c)).toBeNull();
    expect(rateFor(trip({ rates: 'oops' as unknown as Record<string, number> }), 'USD')).toBeNull();
    expect(sanitizeRates({ USD: 32, EUR: 0, KRW: '1', usd: 3, XAF: Infinity, GBP: 41.5 })).toEqual({ USD: 32, GBP: 41.5 });
    expect(sanitizeRates('oops')).toEqual({});
    expect(sanitizeRates([1, 2])).toEqual({});
  });

  it('分類比例不含尚未換算的花費', () => {
    const t = trip({ expenses: [ex({ amount: 99, currency: 'USD', category: 'shop' }), ex({ amount: 100, category: 'food' })] });
    expect(byCategory(t)).toEqual([{ key: 'food', total: 100 }]);
  });
});

describe('改幣別時保留舊花費的換算', () => {
  it('只改當地貨幣為 KRW：總額仍是 21234', () => {
    const s = buildSampleTrip();
    const t = changeCurrencies(s, 'KRW', 'TWD', 0.023);
    expect(t.rates).toEqual({ JPY: 0.21 });
    expect(totalHome(t)).toBeCloseTo(21234, 6);
    expect(unconvertedCount(t)).toBe(0);
  });

  it('改本國貨幣為 USD：18000 TWD 的飯店不會變成 18000 USD', () => {
    const s = buildSampleTrip();
    const t = changeCurrencies(s, 'JPY', 'USD', 0.0065);
    const hotel = t.expenses.find((e) => e.currency === 'TWD')!;
    expect(expenseHome(t, hotel)).toBeCloseTo((18000 * 0.0065) / 0.21, 6);
    expect(expenseHome(t, hotel)).toBeLessThan(1000);
    // 整趟換算成 USD，等於原本的 TWD 總額 × (USD / TWD)
    expect(totalHome(t)).toBeCloseTo((21234 * 0.0065) / 0.21, 6);
  });

  it('本國和當地貨幣互換：用舊匯率倒算', () => {
    const s = buildSampleTrip();
    const t = changeCurrencies(s, 'TWD', 'JPY', 1 / 0.21);
    expect(totalHome(t)).toBeCloseTo(21234 / 0.21, 4);
    expect(t.rates).toBeUndefined();
  });

  it('本國貨幣在 rates 裡有匯率：用它換算其他幣別', () => {
    const s = trip({ rates: { USD: 32, EUR: 35 }, expenses: [ex({ amount: 10, currency: 'EUR' }), ex({ amount: 320, currency: 'TWD' })] });
    const t = changeCurrencies(s, 'KRW', 'USD', 0.0007);
    expect(t.rates?.USD).toBeUndefined();
    expect(t.rates?.TWD).toBeCloseTo(1 / 32, 9);
    expect(totalHome(t)).toBeCloseTo((350 + 320) / 32, 6);
  });

  it('兩個都改又推不出匯率：舊花費改成尚未換算，不會亂算', () => {
    const s = buildSampleTrip();
    const t = changeCurrencies(s, 'KRW', 'USD', 0.0007);
    expect(t.rates).toBeUndefined();
    expect(unconvertedCount(t)).toBe(3);
    expect(totalHome(t)).toBe(0);
  });

  it('幣別沒變：不動 rates', () => {
    const s = trip({ rates: { USD: 32 } });
    const d = structuredClone(s);
    d.rate = 0.21;
    carryRates(s, d);
    expect(d.rates).toEqual({ USD: 32 });
  });
});

describe('分帳', () => {
  const sum = (b: Record<string, number>) => Object.values(b).reduce((s, v) => s + v, 0);

  it('付款人被移除：整筆不算，淨額加總為 0', () => {
    const t = trip({ members: ['A', 'B'], expenses: [ex({ payer: 'C', amount: 300 }), ex({ payer: 'A', amount: 100 })] });
    const b = balances(t);
    expect(b).toEqual({ A: 50, B: -50 });
    expect(sum(b)).toBeCloseTo(0, 9);
    expect(settle(t)).toEqual([{ from: 'B', to: 'A', amount: 50 }]);
  });

  it('只是分攤者被移除：由其他分攤者平分', () => {
    const t = trip({ members: ['A', 'B'], expenses: [ex({ payer: 'A', amount: 300, split: ['A', 'B', 'C'] })] });
    expect(balances(t)).toEqual({ A: 150, B: -150 });
  });

  it('尚未換算的花費不算進分帳', () => {
    const t = trip({ members: ['A', 'B'], expenses: [ex({ payer: 'A', amount: 300, currency: 'USD' })] });
    expect(balances(t)).toEqual({ A: 0, B: 0 });
  });

  it('成員名字剛好是物件內建屬性也不會出錯', () => {
    const t = trip({ members: ['A', 'B'], expenses: [ex({ payer: 'constructor', amount: 300 }), ex({ payer: 'A', amount: 100, split: ['toString', 'B'] })] });
    expect(balances(t)).toEqual({ A: 100, B: -100 });
  });
});
