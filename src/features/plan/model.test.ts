import { describe, expect, it } from 'vitest';
import { durationWord } from '@/domain/constants';
import { fmtDayNo } from '@/domain/dates';
import type { Item } from '@/domain/types';
import {
  dayCost,
  dayOptionLabel,
  draftFromItem,
  draftToPatch,
  emptyDraft,
  fmtKm,
  fmtLocal,
  modeIcon,
  navQuery,
  neighborDay,
  parseNum,
  planEyebrow,
  resolveDate,
  segmentLine,
  tightDetail,
  validateDraft,
} from './model';

const item = (id: string, extra: Partial<Item> = {}): Item => ({
  id,
  date: '2026-11-20',
  title: id,
  type: 'sight',
  done: false,
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});
const DAYS = ['2026-11-20', '2026-11-21', '2026-11-22'];

describe('resolveDate / neighborDay', () => {
  it('keeps a valid selection, else today, else first day', () => {
    expect(resolveDate(DAYS, '2026-11-21', '2026-11-22')).toBe('2026-11-21');
    expect(resolveDate(DAYS, '2026-12-01', '2026-11-22')).toBe('2026-11-22');
    expect(resolveDate(DAYS, null, '2026-10-01')).toBe('2026-11-20');
    expect(resolveDate([], null, '2026-10-01')).toBeNull();
  });
  it('steps within range only', () => {
    expect(neighborDay(DAYS, '2026-11-20', 1)).toBe('2026-11-21');
    expect(neighborDay(DAYS, '2026-11-20', -1)).toBeNull();
    expect(neighborDay(DAYS, '2026-11-22', 1)).toBeNull();
    expect(neighborDay(DAYS, null, 1)).toBeNull();
  });
});

describe('eyebrow and money', () => {
  it('sums only numeric costs', () => {
    expect(dayCost([{ cost: 500 }, {}, { cost: 1200 }])).toBe(1700);
    expect(dayCost([{}, {}])).toBeNull();
  });
  it('formats local currency', () => {
    expect(fmtLocal(12800, 'JPY')).toBe('¥12,800');
    expect(fmtLocal(30, 'XYZ')).toBe('30 XYZ');
  });
  it('labels day numbers the same way everywhere', () => {
    expect(fmtDayNo(3)).toBe('第 3 天');
    expect(dayOptionLabel(DAYS, '2026-11-21')).toBe('第 2 天 · 11/21（週六）');
  });
  it('builds the eyebrow', () => {
    // 2026-11-21 是星期六
    expect(planEyebrow(DAYS, '2026-11-21', [{ cost: 3000 }], 'JPY')).toBe('第 2 天 · 11/21（週六）· 預估 ¥3,000');
    expect(planEyebrow(DAYS, '2026-11-21', [{}], 'JPY')).toBe('第 2 天 · 11/21（週六）');
    expect(planEyebrow([], null, [], 'JPY')).toBe('尚未設定日期');
  });
});

describe('segment line', () => {
  const base = { estimate: null, distanceKm: null, tight: false, leaveBy: null };
  it('prefers AI estimate', () => {
    const l = segmentLine({ ...base, estimate: { minutes: 24.6, mode: '電車' }, leaveBy: 725 });
    expect(l.text).toBe('約 25 分 · 電車');
    expect(l.hint).toBe(false);
    expect(l.icon).toBe('train');
    expect(l.leave).toBe('建議 12:05 出發');
  });
  it('falls back to distance and generic route', () => {
    expect(segmentLine({ ...base, distanceKm: 0.8 })).toMatchObject({ text: '直線 800 m', icon: 'walk' });
    expect(segmentLine({ ...base, distanceKm: 3.24 })).toMatchObject({ text: '直線 3.2 km', icon: 'train' });
    expect(segmentLine({ ...base, distanceKm: 0.8 }).hint).toBe(false);
    expect(segmentLine(base)).toMatchObject({ text: '查路線', hint: true, icon: 'navigate', warn: null, leave: null });
  });
  it('calls a ride 需時 and everything else 停留', () => {
    expect(durationWord('transport')).toBe('需時');
    expect(durationWord('sight')).toBe('停留');
    expect(durationWord('stay')).toBe('停留');
    expect(durationWord(undefined)).toBe('停留');
  });
  it('flags tight timing', () => {
    expect(segmentLine({ ...base, tight: true }).warn).toBe('時間可能不夠');
  });
  it('maps mode words to icons', () => {
    expect(modeIcon('步行')).toBe('walk');
    expect(modeIcon('計程車')).toBe('car');
    expect(modeIcon('Walking')).toBe('walk');
    expect(modeIcon('租單車')).toBe('bike');
    expect(modeIcon('JR 電車＋巴士')).toBe('train');
  });
  it('formats km', () => {
    expect(fmtKm(0.004)).toBe('10 m');
    expect(fmtKm(12.4)).toBe('12 km');
  });
  it('explains tight segments', () => {
    const from = item('a', { time: '10:00', durationMin: 90 });
    const to = item('b', { time: '11:30' });
    expect(tightDetail({ from, to, estimate: { minutes: 20, mode: '電車' }, distanceKm: null })).toEqual({
      leaveAt: '11:30',
      arriveAt: '11:50',
      lateMin: 20,
    });
    expect(tightDetail({ from, to: item('b', { time: '12:00' }), estimate: { minutes: 20, mode: '電車' }, distanceKm: null })).toBeNull();
  });
  it('avoids pasted URLs as navigation queries', () => {
    expect(navQuery({ title: '清水寺', address: 'https://maps.app.goo.gl/x', geo: { lat: 35, lng: 135, source: 'link' } })).toBe('35,135');
    expect(navQuery({ title: '清水寺', address: 'https://maps.app.goo.gl/x' })).toBe('清水寺');
    expect(navQuery({ title: '清水寺', address: '京都市東山区' })).toBe('京都市東山区');
  });
});

describe('item form', () => {
  it('parses numbers leniently', () => {
    expect(parseNum('')).toBeUndefined();
    expect(parseNum('１,５００')).toBe(1500);
    expect(parseNum('¥800')).toBe(800);
    expect(parseNum('abc')).toBeNaN();
  });
  it('validates required and ranges', () => {
    const d = { ...emptyDraft('2026-11-20'), title: ' ', rating: '7', durationMin: 'x' };
    const e = validateDraft(d);
    expect(e.title).toBeTruthy();
    expect(e.rating).toBeTruthy();
    expect(e.durationMin).toBeTruthy();
    expect(validateDraft({ ...emptyDraft(null), title: '清水寺', cost: '500' })).toEqual({});
  });
  it('turns a pasted maps link into geo and keeps the address', () => {
    const d = { ...emptyDraft('2026-11-20'), title: '清水寺', address: 'https://www.google.com/maps/@34.9948,135.785,17z' };
    const p = draftToPatch(d, null, () => ({ lat: 34.9948, lng: 135.785 }));
    expect(p.geo).toEqual({ lat: 34.9948, lng: 135.785, source: 'link' });
    expect(p.address).toBe(d.address);
    expect(p.id).toBeUndefined();
  });
  it('survives a throwing parser and clears stale geo when the address changes', () => {
    const orig = item('a', { address: '舊地址', geo: { lat: 1, lng: 2, source: 'geocode' } });
    const d = { ...draftFromItem(orig), address: '新地址' };
    const p = draftToPatch(d, orig, () => {
      throw new Error('not ready');
    });
    expect(p.id).toBe('a');
    expect(p.geo).toBeUndefined();
    const same = draftToPatch(draftFromItem(orig), orig, () => null);
    expect(same.geo).toEqual(orig.geo);
  });
  describe('maps link in the 連結 field', () => {
    const parse = (s: string) => {
      const m = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(s);
      return m ? { lat: +m[1], lng: +m[2] } : null;
    };
    const KIYO = 'https://www.google.com/maps/@34.9948,135.785,17z';
    it('moves a geocoded pin when a maps link is pasted', () => {
      const orig = item('a', { address: '京都市東山区', geo: { lat: 10, lng: 10, source: 'geocode' } });
      const p = draftToPatch({ ...draftFromItem(orig), link: KIYO }, orig, parse);
      expect(p.geo).toEqual({ lat: 34.9948, lng: 135.785, source: 'link' });
    });
    it('moves the pin when an old maps link is replaced by a new one', () => {
      const orig = item('a', { link: 'https://www.google.com/maps/@1,2,17z', geo: { lat: 1, lng: 2, source: 'link' } });
      const p = draftToPatch({ ...draftFromItem(orig), link: KIYO }, orig, parse);
      expect(p.geo).toEqual({ lat: 34.9948, lng: 135.785, source: 'link' });
    });
    it('clears a pin that came from the old link when the link no longer has coordinates', () => {
      const orig = item('a', { link: KIYO, geo: { lat: 34.9948, lng: 135.785, source: 'link' } });
      expect(draftToPatch({ ...draftFromItem(orig), link: 'https://example.com/ticket' }, orig, parse).geo).toBeUndefined();
      expect(draftToPatch({ ...draftFromItem(orig), link: '' }, orig, parse).geo).toBeUndefined();
    });
    it('keeps a pin from the address when only a non-maps link changes', () => {
      const orig = item('a', { address: '京都市東山区', geo: { lat: 10, lng: 10, source: 'geocode' } });
      const p = draftToPatch({ ...draftFromItem(orig), link: 'https://example.com/ticket' }, orig, parse);
      expect(p.geo).toEqual(orig.geo);
    });
    it('still prefers a maps link pasted into 地址', () => {
      const orig = item('a', { address: 'https://www.google.com/maps/@5,6,17z', geo: { lat: 5, lng: 6, source: 'link' } });
      const p = draftToPatch({ ...draftFromItem(orig), link: KIYO }, orig, parse);
      expect(p.geo).toEqual({ lat: 5, lng: 6, source: 'link' });
    });
  });
  it('round-trips numbers and empties', () => {
    const orig = item('a', { durationMin: 90, cost: 500, rating: 4.5, time: '09:30' });
    const p = draftToPatch({ ...draftFromItem(orig), cost: '' }, orig, () => null);
    expect(p).toMatchObject({ durationMin: 90, rating: 4.5, time: '09:30', cost: undefined, date: '2026-11-20' });
  });
  it('clears dayOffset only when the date is changed', () => {
    const orig = item('a', { date: null, dayOffset: 2 });
    const p = draftToPatch({ ...draftFromItem(orig), date: '2026-11-22' }, orig, () => null);
    expect('dayOffset' in p && p.dayOffset === undefined).toBe(true);
    const q = draftToPatch(draftFromItem(orig), orig, () => null);
    expect('dayOffset' in q).toBe(false);
    expect(q.date).toBeNull();
  });
});
