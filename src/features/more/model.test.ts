import { describe, expect, it } from 'vitest';
import type { Item, Trip } from '@/domain/types';
import { mkTrip } from './fixtures.test-util';
import {
  applyForm,
  backupFileName,
  currencyChoices,
  fmtRateInput,
  fmtSyncTime,
  formDirty,
  initialForm,
  memberError,
  memberExpenseCount,
  orphanBlobKeys,
  parseDecimal,
  platformLabel,
  ratePreview,
  safeFileName,
  shiftDaysFor,
  tripDateSummary,
  validateForm,
} from './model';

const item = (p: Partial<Item>): Item => ({ id: p.id ?? Math.random().toString(36).slice(2), title: 'x', type: 'sight', date: null, done: false, createdAt: 0, updatedAt: 0, ...p });
const trip = (p: Partial<Trip> = {}): Trip => mkTrip({ name: '京都', city: 'KYOTO', ...p });

describe('format helpers', () => {
  it('fmtSyncTime pads time but not month/day', () => {
    expect(fmtSyncTime(new Date(2026, 10, 9, 7, 5).getTime())).toBe('11/9 07:05');
  });
  it('backupFileName is YYYYMMDD', () => {
    expect(backupFileName(new Date(2026, 0, 3))).toBe('travel-planner-backup-20260103.json');
  });
  it('safeFileName strips forbidden characters', () => {
    expect(safeFileName('京都/大阪: 5 日?')).toBe('京都-大阪- 5 日-');
    expect(safeFileName('  ')).toBe('旅途手帳');
  });
  it('platformLabel', () => {
    expect(platformLabel(true, false)).toBe('原生 App');
    expect(platformLabel(false, true)).toBe('已安裝的 PWA');
    expect(platformLabel(false, false)).toBe('瀏覽器');
  });
  it('tripDateSummary', () => {
    expect(tripDateSummary({ startDate: '2026-11-21', endDate: '2026-11-25' })).toBe('11/21 – 11/25 · 5 天');
    expect(tripDateSummary({ startDate: '2026-11-21', endDate: null })).toBe('11/21 出發');
    expect(tripDateSummary({ startDate: null, endDate: null })).toBe('尚未設定日期');
  });
  it('rate formatting and preview', () => {
    expect(fmtRateInput(0.210434)).toBe('0.2104');
    expect(fmtRateInput(31.5234)).toBe('31.52');
    expect(fmtRateInput(0)).toBe('');
    expect(ratePreview(0.21)).toEqual({ amount: 100, converted: 21 });
    expect(ratePreview(31.5)).toEqual({ amount: 1, converted: 31.5 });
    expect(ratePreview(0.0234)?.amount).toBe(1000);
  });
  it('parseDecimal handles full-width, commas and garbage', () => {
    expect(parseDecimal('４５,０００')).toBe(45000);
    expect(parseDecimal(' 0.21 ')).toBe(0.21);
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('abc')).toBeNaN();
    expect(parseDecimal('-5')).toBeNaN();
  });
  it('currencyChoices adds unknown current values', () => {
    expect(currencyChoices(['TWD', 'JPY'], 'JPY', 'XAF')).toEqual(['XAF', 'TWD', 'JPY']);
  });
});

describe('validateForm', () => {
  const base = initialForm(trip({ startDate: '2026-11-21', endDate: '2026-11-25', localCurrency: 'JPY', homeCurrency: 'TWD', rate: 0.21 }));
  it('accepts a normal form', () => {
    expect(validateForm(base)).toEqual({});
  });
  it('rejects end before start, end without start, too long', () => {
    expect(validateForm({ ...base, endDate: '2026-11-20' }).dates).toMatch('回程日不能早於出發日');
    expect(validateForm({ ...base, startDate: '' }).dates).toMatch('請先填出發日');
    expect(validateForm({ ...base, endDate: '2027-11-25' }).dates).toMatch('90');
  });
  it('rate must be positive unless same currency', () => {
    expect(validateForm({ ...base, rate: '0' }).rate).toBeTruthy();
    expect(validateForm({ ...base, rate: 'x' }).rate).toBeTruthy();
    expect(validateForm({ ...base, rate: '', homeCurrency: 'JPY' }).rate).toBeUndefined();
  });
  it('requires name and a member; budget must be numeric', () => {
    const e = validateForm({ ...base, name: ' ', members: [], budget: '很多' });
    expect(e.name).toBeTruthy();
    expect(e.members).toBeTruthy();
    expect(e.budget).toBeTruthy();
  });
  it('formDirty ignores shiftItems and rateUpdatedAt', () => {
    expect(formDirty({ ...base, shiftItems: false, rateUpdatedAt: 5 }, base)).toBe(false);
    expect(formDirty({ ...base, members: ['我', '阿明'] }, base)).toBe(true);
  });
});

describe('applyForm', () => {
  it('shifts dated items and day checks when start date moves', () => {
    const t = trip({
      startDate: '2026-11-21',
      endDate: '2026-11-22',
      items: [item({ id: 'a', date: '2026-11-21' }), item({ id: 'b', date: '2026-11-22' })],
      ai: { dayChecks: { '2026-11-21': { at: 1, itemIds: ['a'], segments: [], warnings: [] } } },
    });
    expect(shiftDaysFor(t, '2026-11-28')).toBe(7);
    applyForm(t, { ...initialForm(t), startDate: '2026-11-28', endDate: '2026-11-29' });
    expect(t.items.map((i) => i.date)).toEqual(['2026-11-28', '2026-11-29']);
    expect(Object.keys(t.ai.dayChecks)).toEqual(['2026-11-28']);
  });
  it('keeps item dates when shiftItems is off', () => {
    const t = trip({ startDate: '2026-11-21', items: [item({ date: '2026-11-21' })] });
    applyForm(t, { ...initialForm(t), startDate: '2026-12-01', shiftItems: false });
    expect(t.items[0].date).toBe('2026-11-21');
    expect(t.startDate).toBe('2026-12-01');
  });
  it('resolves dayOffset items once a start date exists and widens empty end date', () => {
    const t = trip({ items: [item({ dayOffset: 1 }), item({ dayOffset: 3 })] });
    applyForm(t, { ...initialForm(t), startDate: '2026-11-21' });
    expect(t.items.map((i) => i.date)).toEqual(['2026-11-21', '2026-11-23']);
    expect(t.items.every((i) => i.dayOffset === undefined)).toBe(true);
    expect(t.endDate).toBe('2026-11-23');
  });
  it('city change replaces geo and clears weather; removes isExample; parses numbers', () => {
    const t = trip({ isExample: true, cityGeo: { lat: 1, lng: 2, label: '京都' }, weather: { fetchedAt: 1, lat: 1, lng: 2, days: [] } });
    applyForm(
      t,
      { ...initialForm(t), city: ' OSAKA ', rate: '0.2', rateUpdatedAt: 99, budget: '45,000', members: ['我', ' 阿明 ', '我'] },
      { cityGeo: { lat: 34.7, lng: 135.5, label: '大阪，日本' } },
    );
    expect(t.city).toBe('OSAKA');
    expect(t.cityGeo?.label).toBe('大阪，日本');
    expect(t.weather).toBeUndefined();
    expect(t.isExample).toBeUndefined();
    expect(t.rate).toBe(0.2);
    expect(t.rateUpdatedAt).toBe(99);
    expect(t.budget).toBe(45000);
    expect(t.members).toEqual(['我', '阿明']);
  });
  it('failed geocode on a changed city drops stale geo; unchanged city keeps it', () => {
    const a = trip({ cityGeo: { lat: 1, lng: 2 } });
    applyForm(a, { ...initialForm(a), city: '不存在市' });
    expect(a.cityGeo).toBeUndefined();
    const b = trip({ cityGeo: { lat: 1, lng: 2 } });
    applyForm(b, { ...initialForm(b), name: '新名字' });
    expect(b.cityGeo).toEqual({ lat: 1, lng: 2 });
  });
  it('same currency forces rate 1 and empty budget clears it', () => {
    const t = trip({ rate: 0.21, budget: 100 });
    applyForm(t, { ...initialForm(t), localCurrency: 'TWD', homeCurrency: 'TWD', budget: '' });
    expect(t.rate).toBe(1);
    expect(t.budget).toBeUndefined();
  });
});

describe('members and blobs', () => {
  it('memberError', () => {
    expect(memberError(' ', ['我'])).toBeTruthy();
    expect(memberError('我', ['我'])).toMatch('已經有');
    expect(memberError('阿明', ['我'])).toBeNull();
  });
  it('memberExpenseCount counts payer and split', () => {
    const t = trip({
      expenses: [
        { id: '1', date: '2026-11-21', title: '', amount: 1, currency: 'JPY', category: 'food', payer: '阿明', split: [], createdAt: 0, updatedAt: 0 },
        { id: '2', date: '2026-11-21', title: '', amount: 1, currency: 'JPY', category: 'food', payer: '我', split: ['我', '阿明'], createdAt: 0, updatedAt: 0 },
        { id: '3', date: '2026-11-21', title: '', amount: 1, currency: 'JPY', category: 'food', payer: '我', split: [], createdAt: 0, updatedAt: 0 },
      ],
    });
    expect(memberExpenseCount(t, '阿明')).toBe(2);
  });
  it('orphanBlobKeys keeps photos other trips still use', () => {
    const exp = (k: string) => ({ id: k, date: '2026-11-21', title: '', amount: 1, currency: 'JPY', category: 'food' as const, payer: '我', split: [], receiptBlobKey: k, createdAt: 0, updatedAt: 0 });
    const a = trip({ cover: { kind: 'image', blobKey: 'c1' }, expenses: [exp('r1'), exp('shared')] });
    const b = trip({ expenses: [exp('shared')] });
    expect(orphanBlobKeys(a, [a, b]).sort()).toEqual(['c1', 'r1']);
  });
});
