import { describe, expect, it } from 'vitest';
import { barInset, citiesText, distinctCities, fmtUpdated, groupByCity, rainLong, rainText, sameCityName, tempScale } from './model';

describe('tempScale', () => {
  it('spans min..max across days', () => {
    expect(tempScale([{ tMin: 8, tMax: 16 }, { tMin: 5.4, tMax: 12 }])).toEqual({ lo: 5, hi: 16 });
  });
  it('is null without data and never zero-width', () => {
    expect(tempScale([])).toBeNull();
    expect(tempScale([{ tMin: 10, tMax: 10 }])).toEqual({ lo: 10, hi: 11 });
  });
});

describe('barInset', () => {
  const scale = { lo: 0, hi: 20 };
  it('positions the segment', () => {
    expect(barInset({ tMin: 5, tMax: 15 }, scale)).toEqual({ left: 25, right: 25 });
    expect(barInset({ tMin: 0, tMax: 20 }, scale)).toEqual({ left: 0, right: 0 });
  });
  it('keeps a minimum visible width', () => {
    const r = barInset({ tMin: 10, tMax: 10 }, scale);
    expect(100 - r.left - r.right).toBeGreaterThanOrEqual(7.9);
  });
  it('clamps out-of-range values', () => {
    const r = barInset({ tMin: -5, tMax: 30 }, scale);
    expect(r).toEqual({ left: 0, right: 0 });
  });
});

describe('rain', () => {
  it('shows probability from 10%', () => {
    expect(rainText({ rainProb: 30 })).toBe('30%');
    expect(rainText({ rainProb: 5 })).toBe('');
  });
  it('shows climate millimetres', () => {
    expect(rainText({ rainMm: 2.44 })).toBe('2.4 mm');
    expect(rainText({ rainMm: 12.6 })).toBe('13 mm');
    expect(rainText({ rainMm: 0.1 })).toBe('');
  });
  it('long form includes zero', () => {
    expect(rainLong({ rainProb: 0 })).toEqual({ label: '降雨機率', value: '0%' });
    expect(rainLong({})).toBeNull();
  });
});

describe('fmtUpdated', () => {
  it('shows time only for today', () => {
    const now = new Date(2026, 10, 9, 18, 0);
    expect(fmtUpdated(new Date(2026, 10, 9, 9, 5).getTime(), now)).toBe('09:05');
    expect(fmtUpdated(new Date(2026, 10, 8, 21, 40).getTime(), now)).toBe('11/8 21:40');
  });
});

describe('多城市', () => {
  it('同一個城市的不同寫法算同一個', () => {
    expect(sameCityName('波特蘭', 'Portland')).toBe(true);
    expect(sameCityName('PORTLAND', 'portland')).toBe(true);
    expect(sameCityName('西雅圖', '波特蘭')).toBe(false);
    expect(sameCityName('', '')).toBe(false);
    expect(distinctCities(['西雅圖', 'Seattle', ' ', undefined, '波特蘭'])).toEqual(['西雅圖', '波特蘭']);
  });
  it('依連續的城市分段，不知道城市的日子併進前一段', () => {
    const city: Record<string, string | undefined> = { a: '西雅圖', b: 'Portland', c: undefined, d: '波特蘭', e: '西雅圖' };
    expect(groupByCity(['a', 'b', 'c', 'd', 'e'], (d) => city[d])).toEqual([
      { city: '西雅圖', dates: ['a'] },
      { city: 'Portland', dates: ['b', 'c', 'd'] },
      { city: '西雅圖', dates: ['e'] },
    ]);
    expect(groupByCity(['x', 'y'], (d) => (d === 'y' ? '京都' : undefined))).toEqual([{ city: '京都', dates: ['x', 'y'] }]);
    expect(groupByCity([], () => 'x')).toEqual([]);
  });
  it('標題列的城市清單', () => {
    expect(citiesText(['西雅圖', '波特蘭', '西雅圖'])).toBe('西雅圖、波特蘭');
    expect(citiesText(['西雅圖', '波特蘭', '溫哥華'])).toBe('西雅圖 等 3 個城市');
    expect(citiesText([])).toBe('');
  });
});
