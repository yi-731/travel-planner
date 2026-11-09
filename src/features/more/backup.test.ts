import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '@/store/migrations';
import { mkTrip, testSettings as defaultSettings } from './fixtures.test-util';
import { BackupError, backupJson, buildBackup, normalizeTrip, parseBackup, restorePlan } from './backup';

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

describe('restorePlan', () => {
  it('counts replaced vs added', () => {
    const a = sample();
    const b = { ...sample(), id: 'other' };
    expect(restorePlan({ [a.id]: a }, [a, b])).toEqual({ added: 1, replaced: 1 });
  });
});
