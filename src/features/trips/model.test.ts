import { describe, expect, it } from 'vitest';
import { currencyForCountry, currencyLabel, currencyList, dateRange, isCjk, sortTrips, tripCity, tripSubtitle } from './model';

const base = { name: '京阪奈五日', city: 'KYOTO', cityGeo: undefined, startDate: '2026-11-20', endDate: '2026-11-24', items: [], createdAt: 1 };

describe('trips model', () => {
  it('detects CJK city names', () => {
    expect(isCjk('京都')).toBe(true);
    expect(isCjk('서울')).toBe(true);
    expect(isCjk('KYOTO')).toBe(false);
  });

  it('falls back from city to geo label to name', () => {
    expect(tripCity(base)).toEqual({ text: 'KYOTO', fromName: false });
    expect(tripCity({ ...base, city: ' ', cityGeo: { lat: 0, lng: 0, label: '京都，日本' } })).toEqual({ text: '京都', fromName: false });
    expect(tripCity({ ...base, city: '' })).toEqual({ text: '京阪奈五日', fromName: true });
  });

  it('formats date ranges', () => {
    expect(dateRange('2026-11-20', '2026-11-24')).toBe('11/20–11/24');
    expect(dateRange('2026-11-20', null)).toBe('11/20');
    expect(dateRange('2026-11-20', '2026-11-20')).toBe('11/20');
    expect(dateRange(null, null)).toBe('');
  });

  it('builds subtitle without repeating the name', () => {
    expect(tripSubtitle({ ...base, items: [{} as never, {} as never] })).toBe('京阪奈五日 · 11/20–11/24 · 2 站');
    expect(tripSubtitle({ ...base, city: '', startDate: null, endDate: null })).toBe('日期未定 · 0 站');
  });

  it('sorts by start date, undated last', () => {
    const list = [
      { id: 'c', startDate: null, createdAt: 1 },
      { id: 'b', startDate: '2026-12-01', createdAt: 2 },
      { id: 'a', startDate: '2026-11-01', createdAt: 3 },
      { id: 'd', startDate: null, createdAt: 0 },
    ];
    expect(sortTrips(list).map((t) => t.id)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('maps currencies', () => {
    expect(currencyForCountry('jp')).toBe('JPY');
    expect(currencyForCountry('FR')).toBe('EUR');
    expect(currencyForCountry('ZZ')).toBeNull();
    expect(currencyLabel('JPY')).toBe('JPY 日圓');
    expect(currencyLabel('XYZ')).toBe('XYZ');
    expect(currencyList(['NZD', 'JPY']).slice(-1)).toEqual(['NZD']);
  });
});
