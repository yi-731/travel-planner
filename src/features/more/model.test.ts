import { describe, expect, it } from 'vitest';
import { tripDays } from '@/domain/dates';
import type { Expense, Item, Trip } from '@/domain/types';
import { mkTrip } from './fixtures.test-util';
import {
  applyForm,
  backupFileName,
  currencyChoices,
  fmtRateInput,
  fmtSyncTime,
  formDirty,
  initialForm,
  isBlobKey,
  memberError,
  memberExpenseCount,
  orphanBlobKeys,
  parseDecimal,
  platformLabel,
  ratePreview,
  safeFileName,
  shiftDaysFor,
  shiftedEndDate,
  shiftPlanFor,
  tripDateSummary,
  validateForm,
} from './model';

const item = (p: Partial<Item>): Item => ({ id: p.id ?? Math.random().toString(36).slice(2), title: 'x', type: 'sight', date: null, done: false, createdAt: 0, updatedAt: 0, ...p });
const trip = (p: Partial<Trip> = {}): Trip => mkTrip({ name: '京都', city: 'KYOTO', ...p });
const expense = (p: Partial<Expense>): Expense => ({ id: Math.random().toString(36).slice(2), date: '2026-12-01', title: '', amount: 1, currency: 'JPY', category: 'food', payer: '我', split: [], createdAt: 0, updatedAt: 0, ...p });

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
  it('shifts the per-day cities (days) with the items, keeping their geo', () => {
    const geo = { lat: 45.52, lng: -122.68, en: 'Portland' };
    const t = trip({
      city: 'SEATTLE',
      startDate: '2026-12-03',
      endDate: '2026-12-05',
      days: {
        '2026-12-03': { label: '西雅圖', city: '西雅圖', source: 'rule' },
        '2026-12-04': { label: '西雅圖 → 波特蘭｜住 Maple Lodge', city: '波特蘭', lodging: 'Maple Lodge', geo, source: 'rule' },
        '2026-12-05': { label: '波特蘭', city: '波特蘭', lodging: 'Maple Lodge', geo, source: 'rule' },
      },
      items: [item({ id: 'a', date: '2026-12-04', title: '晚餐 Blue Fin', address: '1000 SE Portland Ave' })],
    });
    applyForm(t, { ...initialForm(t), startDate: '2027-12-03', endDate: '2027-12-05' });
    expect(t.items[0].date).toBe('2027-12-04');
    expect(Object.keys(t.days!).sort()).toEqual(['2027-12-03', '2027-12-04', '2027-12-05']);
    expect(t.days!['2027-12-04']).toMatchObject({ city: '波特蘭', lodging: 'Maple Lodge', geo });
    // 導航目的地依移動後的那天重新辨識
    expect(t.items[0].place?.query).toBe('Blue Fin, 1000 SE Portland Ave, Portland, OR, USA');
  });
  it('converts 第 N 天 day banners (__D3) once a start date is set', () => {
    const t = trip({
      days: { __D1: { label: '大阪 → 京都｜住 Hotel Kyoto', city: '京都', lodging: 'Hotel Kyoto', source: 'rule' }, __D2: { label: '奈良一日遊', city: '奈良', source: 'rule' } },
      items: [item({ dayOffset: 1, title: '清水寺', address: '清水寺' })],
    });
    applyForm(t, { ...initialForm(t), startDate: '2026-12-01' });
    expect(Object.keys(t.days!).sort()).toEqual(['2026-12-01', '2026-12-02']);
    expect(t.days!['2026-12-02']).toMatchObject({ city: '奈良', lodging: 'Hotel Kyoto' });
    expect(t.items[0]).toMatchObject({ date: '2026-12-01', place: { query: '清水寺, Kyoto, Japan' } });
  });
  it('a new trip city reaches the days without banners (stale auto-filled days are dropped)', () => {
    const t = trip({
      city: '大阪',
      startDate: '2026-12-01',
      endDate: '2026-12-02',
      // 舊版會把沒有日期列的日子存成行程城市
      days: { '2026-12-01': { city: '大阪', source: 'rule' }, '2026-12-02': { city: '大阪', source: 'rule' } },
      items: [item({ date: '2026-12-02', title: '清水寺', address: '清水寺' })],
    });
    applyForm(t, { ...initialForm(t), city: '京都' }, { cityGeo: { lat: 35.01, lng: 135.77, label: '京都，日本', countryCode: 'JP' } });
    expect(t.days).toEqual({});
    expect(t.items[0].place?.query).toBe('清水寺, Kyoto, Japan');
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
  it('moving the start date with the switch on keeps the trip length and moves in-trip expenses', () => {
    const t = trip({
      startDate: '2026-12-01',
      endDate: '2026-12-05',
      items: ['01', '02', '03', '04', '05'].map((d) => item({ date: `2026-12-${d}` })),
      expenses: [expense({ id: 'hotel', date: '2026-12-01' }), expense({ id: 'booking', date: '2026-11-20' }), expense({ id: 'after', date: '2026-12-09' })],
    });
    const before = tripDays(t).length;
    expect(shiftPlanFor(t, '2026-12-03')).toEqual({ days: 2, items: 5, expenses: 1 });
    const f = initialForm(t);
    const next = { ...f, startDate: '2026-12-03', endDate: shiftedEndDate(f, '2026-12-03', true) };
    expect(next.endDate).toBe('2026-12-07');
    applyForm(t, next, { initial: f });
    expect(tripDateSummary(t)).toBe('12/3 – 12/7 · 5 天');
    expect(tripDays(t)).toHaveLength(before);
    expect(t.items.map((i) => i.date)).toEqual(['2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06', '2026-12-07']);
    const dates = Object.fromEntries(t.expenses.map((e) => [e.id, e.date]));
    // 行程期間內的移動；出發前、回國後的不動
    expect(dates).toEqual({ hotel: '2026-12-03', booking: '2026-11-20', after: '2026-12-09' });
  });
  it('a long move no longer trips the end-before-start validation', () => {
    const t = trip({ startDate: '2026-12-01', endDate: '2026-12-05', items: [item({ date: '2026-12-01' })] });
    const f = initialForm(t);
    const next = { ...f, startDate: '2026-12-10', endDate: shiftedEndDate(f, '2026-12-10', true) };
    expect(validateForm(next)).toEqual({});
    expect(next.endDate).toBe('2026-12-14');
  });
  it('shiftedEndDate keeps the old end date when not following or dates are missing', () => {
    const f = { startDate: '2026-12-01', endDate: '2026-12-05' };
    expect(shiftedEndDate(f, '2026-11-29', true)).toBe('2026-12-03');
    expect(shiftedEndDate(f, '2026-12-03', false)).toBe('2026-12-05');
    expect(shiftedEndDate(f, '', true)).toBe('2026-12-05');
    expect(shiftedEndDate({ startDate: '', endDate: '' }, '2026-12-03', true)).toBe('');
  });
  it('safety net: shifting extends the end date to cover the last item even if the form kept the old end', () => {
    const t = trip({ startDate: '2026-12-01', endDate: '2026-12-05', items: [item({ date: '2026-12-01' }), item({ date: '2026-12-05' })] });
    applyForm(t, { ...initialForm(t), startDate: '2026-12-03' });
    expect(t.startDate).toBe('2026-12-03');
    expect(t.endDate).toBe('2026-12-07');
  });
  it('moving the start date later with the switch off never pulls the start date back', () => {
    const t = trip({ startDate: '2026-12-01', endDate: '2026-12-05', items: [item({ date: '2026-12-01' }), item({ date: '2026-12-02' })], expenses: [expense({ date: '2026-12-01' })] });
    applyForm(t, { ...initialForm(t), startDate: '2026-12-02', shiftItems: false });
    expect(t.startDate).toBe('2026-12-02');
    expect(t.endDate).toBe('2026-12-05');
    expect(t.items.map((i) => i.date)).toEqual(['2026-12-01', '2026-12-02']);
    expect(t.expenses[0].date).toBe('2026-12-01');
  });
  it('shiftPlanFor counts expenses even without dated items, and nothing when the date is unchanged', () => {
    const t = trip({ startDate: '2026-12-01', endDate: '2026-12-02', expenses: [expense({ date: '2026-12-02' })] });
    expect(shiftPlanFor(t, '2026-12-05')).toEqual({ days: 4, items: 0, expenses: 1 });
    expect(shiftPlanFor(t, '2026-12-01').days).toBe(0);
    expect(shiftPlanFor(trip({ startDate: '2026-12-01' }), '2026-12-05').days).toBe(0);
  });
  it('a rate fetched in the background is not overwritten by the form opened before it landed', () => {
    const t = trip({ localCurrency: 'JPY', homeCurrency: 'TWD', rate: 1 });
    const f = initialForm(t); // 打開表單時還是 1
    t.rate = 0.2104;
    t.rateUpdatedAt = 1234; // 背景查到即時匯率
    applyForm(t, { ...f, members: ['我', '旅伴'] }, { initial: f });
    expect(t.rate).toBe(0.2104);
    expect(t.rateUpdatedAt).toBe(1234);
    expect(t.members).toEqual(['我', '旅伴']);
  });
  it('a rate the user typed is still saved, and an in-form refresh keeps the full-precision stored rate', () => {
    const a = trip({ rate: 0.2104, rateUpdatedAt: 5 });
    const fa = initialForm(a);
    applyForm(a, { ...fa, rate: '0.25', rateUpdatedAt: undefined }, { initial: fa });
    expect(a.rate).toBe(0.25);
    expect(a.rateUpdatedAt).toBeUndefined();
    const b = trip({ rate: 0.210434, rateUpdatedAt: 9 });
    const fb = initialForm(b);
    applyForm(b, { ...fb, rate: '0.2104', rateUpdatedAt: 10 }, { initial: { ...fb, rate: '0.2' } });
    expect(b.rate).toBe(0.210434);
    expect(b.rateUpdatedAt).toBe(9);
  });
  it('changing currencies always takes the form rate', () => {
    const t = trip({ localCurrency: 'JPY', homeCurrency: 'TWD', rate: 0.21 });
    const f = initialForm(t);
    applyForm(t, { ...f, localCurrency: 'KRW', rate: '0.023', rateUpdatedAt: 7 }, { initial: f });
    expect(t.rate).toBe(0.023);
    expect(t.rateUpdatedAt).toBe(7);
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
    const exp = (k: string) => expense({ id: k, receiptBlobKey: k });
    const a = trip({ cover: { kind: 'image', blobKey: 'blob:c1' }, expenses: [exp('blob:r1'), exp('blob:shared')] });
    const b = trip({ expenses: [exp('blob:shared')] });
    expect(orphanBlobKeys(a, [a, b]).sort()).toEqual(['blob:c1', 'blob:r1']);
  });
  it('orphanBlobKeys never returns keys that are not photo keys (e.g. the app state key)', () => {
    const a = trip({ cover: { kind: 'image', blobKey: 'travel-planner' }, expenses: [expense({ receiptBlobKey: 'keyval' }), expense({ receiptBlobKey: 'blob:ok1' })] });
    expect(orphanBlobKeys(a, [a])).toEqual(['blob:ok1']);
    expect(isBlobKey('blob:lx3k9a2b7c')).toBe(true);
    expect(isBlobKey('travel-planner')).toBe(false);
    expect(isBlobKey('travel-planner:backup-1')).toBe(false);
    expect(isBlobKey('blob:')).toBe(false);
  });
});
