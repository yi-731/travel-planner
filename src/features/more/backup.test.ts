import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '@/store/migrations';
import { mkTrip, testSettings as defaultSettings } from './fixtures.test-util';
import { buildSampleTrip } from '@/store/sample';
import type { Trip } from '@/domain/types';
import { BackupError, backupJson, buildBackup, healTrips, normalizeTrip, parseBackup, restorePlan } from './backup';

const sample = () =>
  mkTrip({
    name: '京都五日',
    city: 'KYOTO',
    startDate: '2026-11-21',
    endDate: '2026-11-25',
    items: [{ id: 'i1', title: '清水寺', type: 'sight', date: '2026-11-21', done: false, createdAt: 1, updatedAt: 1 }],
    weather: { fetchedAt: 1, lat: 1, lng: 2, days: [] },
  });

describe('buildBackup', () => {
  it('never includes the API key or weather cache', () => {
    const t = sample();
    const b = buildBackup({ [t.id]: t }, { ...defaultSettings, anthropicApiKey: 'sk-ant-secret' }, new Date(2026, 10, 9));
    const json = backupJson(b);
    expect(json).not.toContain('sk-ant-secret');
    expect(json).not.toContain('anthropicApiKey');
    expect(b.trips[0].weather).toBeUndefined();
    expect(b.schema).toBe(SCHEMA_VERSION);
    expect(b.settings.theme).toBe('system');
  });
  it('round-trips through parseBackup', () => {
    const t = sample();
    const parsed = parseBackup(backupJson(buildBackup({ [t.id]: t }, defaultSettings)));
    expect(parsed.trips).toHaveLength(1);
    expect(parsed.trips[0].id).toBe(t.id);
    expect(parsed.trips[0].items[0].title).toBe('清水寺');
    expect(parsed.exportedAt).not.toBeNull();
    expect(parsed.skipped).toBe(0);
  });
});

describe('parseBackup errors', () => {
  it('rejects non-JSON, wrong shape, newer schema and empty', () => {
    expect(() => parseBackup('not json')).toThrow(BackupError);
    expect(() => parseBackup('[1,2]')).toThrow(BackupError);
    expect(() => parseBackup('{"hello":1}')).toThrow('找不到行程資料');
    expect(() => parseBackup(JSON.stringify({ schema: SCHEMA_VERSION + 1, trips: [] }))).toThrow('較新版本');
    expect(() => parseBackup(JSON.stringify({ schema: SCHEMA_VERSION, trips: [{ nope: 1 }] }))).toThrow('沒有可以還原');
  });
  it('accepts the internal persisted format and a BOM', () => {
    const t = sample();
    const text = '﻿' + JSON.stringify({ state: { trips: { [t.id]: t } }, version: SCHEMA_VERSION });
    expect(parseBackup(text).trips[0].name).toBe('京都五日');
  });
  it('skips duplicates and broken trips', () => {
    const t = sample();
    const r = parseBackup(JSON.stringify({ schema: SCHEMA_VERSION, trips: [t, t, null, { id: 'x' }] }));
    expect(r.trips).toHaveLength(1);
    expect(r.skipped).toBe(3);
  });
});

describe('normalizeTrip', () => {
  it('fills defaults and drops broken children', () => {
    const t = normalizeTrip(
      {
        id: 'a',
        name: '首爾',
        localCurrency: 'krw',
        rate: -1,
        members: ['', 3, '我'],
        items: [{ title: '景福宮', type: 'weird', date: '11/21', dayOffset: 2 }, { title: '' }, 'junk'],
        expenses: [{ amount: 1000, category: 'food', split: ['我', 4] }, { amount: 'many' }],
        cover: { kind: 'image' },
        cityGeo: { lat: 'x' },
      },
      5,
    )!;
    expect(t.localCurrency).toBe('KRW');
    expect(t.homeCurrency).toBe('TWD');
    expect(t.rate).toBe(1);
    expect(t.members).toEqual(['我']);
    expect(t.items).toHaveLength(1);
    expect(t.items[0]).toMatchObject({ title: '景福宮', type: 'other', date: null, dayOffset: 2, done: false, createdAt: 5 });
    expect(t.expenses).toHaveLength(1);
    expect(t.expenses[0]).toMatchObject({ currency: 'KRW', payer: '我', split: ['我'] });
    expect(t.cover).toEqual({ kind: 'orb', hue: 0 });
    expect(t.cityGeo).toBeUndefined();
    expect(t.ai.dayChecks).toEqual({});
  });
  it('returns null without id or name', () => {
    expect(normalizeTrip({ name: 'x' })).toBeNull();
    expect(normalizeTrip({ id: 'x' })).toBeNull();
    expect(normalizeTrip('x')).toBeNull();
  });
});

describe('normalizeTrip with malformed fields (shared backup files)', () => {
  const base = { id: 't1', name: '大阪', startDate: '2026-12-01', endDate: '2026-12-03' };
  const one = (extra: Record<string, unknown>) => normalizeTrip({ ...base, ...extra }, 5)!;
  const oneItem = (extra: Record<string, unknown>) => one({ items: [{ id: 'i', title: '大阪城', date: '2026-12-01', ...extra }] }).items[0];

  it('drops item fields with the wrong type instead of crashing later', () => {
    const it = oneItem({ address: 123, time: 'noon', note: { x: 1 }, link: ['x'], durationMin: '60', cost: -5, rating: 'good', done: 'yes', geo: {} });
    expect(it).toEqual({ id: 'i', title: '大阪城', date: '2026-12-01', type: 'other', done: false, createdAt: 5, updatedAt: 5 });
    expect(oneItem({ geo: { lat: 'x', lng: 1 } }).geo).toBeUndefined();
    expect(oneItem({ geo: { lat: 100, lng: 1 } }).geo).toBeUndefined();
    expect(oneItem({ geo: { lat: 34.6, lng: 135.5, source: 'evil' } }).geo).toEqual({ lat: 34.6, lng: 135.5, source: 'geocode' });
    expect(oneItem({ time: '9:30', address: '大阪市', durationMin: 90 })).toMatchObject({ time: '9:30', address: '大阪市', durationMin: 90 });
    expect(oneItem({ date: '2026-13-45' }).date).toBeNull();
  });
  it('drops trip fields with the wrong type', () => {
    const t = one({ routeCode: { x: 1 }, budget: '45000', sheetUrl: 3, isExample: 'yes', rateUpdatedAt: 'now', cityGeo: { lat: 34.6, lng: 135.5, label: 5 }, extra: 'ignored' });
    expect(t.routeCode).toBeUndefined();
    expect(t.budget).toBeUndefined();
    expect(t.sheetUrl).toBeUndefined();
    expect(t.isExample).toBeUndefined();
    expect(t.rateUpdatedAt).toBeUndefined();
    expect(t.cityGeo).toEqual({ lat: 34.6, lng: 135.5 });
    expect((t as unknown as Record<string, unknown>).extra).toBeUndefined();
    expect(one({ budget: 45000, routeCode: 'TPE → KIX', isExample: true })).toMatchObject({ budget: 45000, routeCode: 'TPE → KIX', isExample: true });
  });
  it('keeps only complete AI day checks and packing', () => {
    const good = { at: 1, itemIds: ['i'], segments: [{ minutes: 12, mode: 'walk' }], warnings: [] };
    const t = one({
      ai: {
        dayChecks: {
          '2026-12-01': {},
          '2026-12-02': { ...good, segments: [{ minutes: 'x', mode: 'walk' }] },
          '2026-12-03': good,
          'not-a-date': good,
        },
        packing: { at: 1, text: '帶傘', tips: '多穿' },
      },
    });
    expect(Object.keys(t.ai.dayChecks)).toEqual(['2026-12-03']);
    expect(t.ai.dayChecks['2026-12-03']).toEqual(good);
    expect(t.ai.packing).toBeUndefined();
    expect(one({ ai: { packing: { at: 1, text: '帶傘', tips: ['外套', 3] } } }).ai.packing).toEqual({ at: 1, text: '帶傘', tips: ['外套'] });
    expect(one({ ai: 'junk' }).ai).toEqual({ dayChecks: {} });
  });
  it('sanitizes other-currency rates', () => {
    expect(one({ rates: { USD: 31.5, bad: 2, EUR: -1, KRW: '0.02' } }).rates).toEqual({ USD: 31.5 });
    expect(one({ rates: 'x' }).rates).toBeUndefined();
  });
});

describe('photo keys from backup files', () => {
  const base = { id: 't1', name: '大阪' };
  it('never trusts a cover key that is not a photo key', () => {
    for (const blobKey of ['travel-planner', 'travel-planner:backup-1', 'keyval', '', 'blob:', 'BLOB:abc', 7]) {
      expect(normalizeTrip({ ...base, cover: { kind: 'image', blobKey, hue: 40 } })!.cover).toEqual({ kind: 'orb', hue: 40 });
    }
    expect(normalizeTrip({ ...base, cover: { kind: 'image', blobKey: 'blob:lx3k9a2b7c', hue: 40 } })!.cover).toEqual({ kind: 'image', blobKey: 'blob:lx3k9a2b7c', hue: 40 });
  });
  it('drops receipt keys that are not photo keys', () => {
    const t = normalizeTrip({
      ...base,
      expenses: [
        { id: 'a', amount: 1, receiptBlobKey: 'travel-planner' },
        { id: 'b', amount: 1, receiptBlobKey: 'something-else' },
        { id: 'c', amount: 1, receiptBlobKey: 'blob:abc123' },
      ],
    })!;
    expect(t.expenses.map((e) => e.receiptBlobKey)).toEqual([undefined, undefined, 'blob:abc123']);
    expect('receiptBlobKey' in t.expenses[0]).toBe(false);
  });
});

describe('healTrips (persisted data on launch)', () => {
  const roundTrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  const rich = (): Trip =>
    mkTrip({
      id: 'rich',
      name: '京都五日',
      city: 'KYOTO',
      cityGeo: { lat: 35, lng: 135.7, label: '京都', timezone: 'Asia/Tokyo', countryCode: 'JP' },
      routeCode: 'TPE → KIX',
      startDate: '2026-11-21',
      endDate: '2026-11-25',
      rate: 0.2104,
      rateUpdatedAt: 99,
      rates: { USD: 31.5 },
      budget: 45000,
      members: ['我', '阿明'],
      items: [
        { id: 'i1', title: '清水寺', type: 'sight', date: '2026-11-21', time: '09:30', address: '', geo: { lat: 35, lng: 135.78, source: 'link' }, durationMin: 90, cost: 500, rating: 4.5, note: '早點去', link: 'https://example.com', done: true, createdAt: 1, updatedAt: 2 },
        { id: 'i2', title: '', type: 'other', date: null, dayOffset: 3, done: false, createdAt: 1, updatedAt: 1 },
      ],
      expenses: [
        { id: 'e1', date: '2026-11-21', title: '門票', amount: 500, currency: 'JPY', category: 'ticket', payer: '阿明', split: ['我', '阿明'], receiptBlobKey: 'blob:abc', fromSheet: true, createdAt: 1, updatedAt: 1 },
      ],
      sheetUrl: 'https://docs.google.com/spreadsheets/d/x',
      sheetSyncedAt: 7,
      cover: { kind: 'image', blobKey: 'blob:cover1', hue: 20 },
      ai: {
        dayChecks: { '2026-11-21': { at: 1, itemIds: ['i1'], segments: [{ minutes: 10, mode: 'walk', tip: '走路' }], warnings: ['太趕'], summary: 'OK' } },
        packing: { at: 1, text: '帶外套', tips: ['外套'] },
      },
      weather: { fetchedAt: 1, lat: 35, lng: 135.7, days: [{ date: '2026-11-21', code: 3, tMax: 15, tMin: 8, rainProb: 20, sunrise: '06:30', sunset: '16:50', kind: 'forecast' }] },
      isExample: true,
      createdAt: 1,
      updatedAt: 2,
    });

  it('leaves valid data exactly as it was (nothing silently dropped)', () => {
    const sample = buildSampleTrip();
    const stored = roundTrip({ [sample.id]: sample, rich: rich() });
    expect(healTrips(roundTrip(stored), 1)).toEqual(stored);
  });
  it('repairs broken fields without dropping trips, and uses the storage key as id', () => {
    const healed = healTrips(
      {
        k1: { id: 'other', name: '', routeCode: { x: 1 }, items: [{ title: 5, address: 123 }], cover: { kind: 'image', blobKey: 'travel-planner' } },
        k2: { id: 'k2', name: '首爾', ai: { dayChecks: { '2026-12-01': {} } }, weather: { lat: 1 } },
        k3: null,
      },
      3,
    );
    expect(Object.keys(healed)).toEqual(['k1', 'k2']);
    expect(healed.k1).toMatchObject({ id: 'k1', name: '未命名行程', cover: { kind: 'orb', hue: 0 } });
    expect(healed.k1.routeCode).toBeUndefined();
    expect(healed.k1.items[0]).toMatchObject({ title: '5', type: 'other' });
    expect(healed.k1.items[0].address).toBeUndefined();
    expect(healed.k2.ai.dayChecks).toEqual({});
    expect(healed.k2.weather).toBeUndefined();
  });
  it('backups still drop the weather cache', () => {
    expect(normalizeTrip(rich())!.weather).toBeUndefined();
    expect(healTrips({ rich: rich() }).rich.weather?.days).toHaveLength(1);
  });
  it('is not fooled by non-object input', () => {
    expect(healTrips(null)).toEqual({});
    expect(healTrips([1, 2])).toEqual({});
  });
});

describe('restorePlan', () => {
  it('counts replaced vs added', () => {
    const a = sample();
    const b = { ...sample(), id: 'other' };
    expect(restorePlan({ [a.id]: a }, [a, b])).toEqual({ added: 1, replaced: 1 });
  });
});
