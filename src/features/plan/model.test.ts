import { describe, expect, it } from 'vitest';
import { durationWord } from '@/domain/constants';
import { fmtDayNo } from '@/domain/dates';
import type { Item } from '@/domain/types';
import {
  advancedSummary,
  cardInfo,
  cityFeedback,
  dayCost,
  dayHeader,
  dropStaleGeo,
  editDayMeta,
  geoLine,
  routeText,
  segmentRoute,
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
  describe('imported routes (A → B) and sheet order', () => {
    const orig = item('a', { title: '搭 Tram 去會場', route: { from: 'Maple Lodge', to: 'Central 站' }, seq: 4, time: '16:00', place: { query: 'Central station, Seattle, WA, USA', source: 'rule' } });
    it('shows the route in the address field and keeps it when untouched', () => {
      const d = draftFromItem(orig);
      expect(d.address).toBe('Maple Lodge → Central 站');
      const p = draftToPatch(d, orig, () => null);
      expect(p.address).toBeUndefined();
      expect('route' in p).toBe(false);
      expect(p.place).toEqual(orig.place);
      expect('seq' in p).toBe(false);
    });
    it('a typed address replaces the route (navigation follows the edit)', () => {
      const p = draftToPatch({ ...draftFromItem(orig), address: 'Convention Center Station' }, orig, () => null);
      expect(p).toMatchObject({ address: 'Convention Center Station', route: undefined, place: undefined });
      expect('route' in p).toBe(true);
      // 清空地址欄＝不要這條路線
      expect('route' in draftToPatch({ ...draftFromItem(orig), address: '' }, orig, () => null)).toBe(true);
    });
    it('changing the time or date drops the sheet order (sorted by time again)', () => {
      expect('seq' in draftToPatch({ ...draftFromItem(orig), time: '15:30' }, orig, () => null)).toBe(true);
      expect('seq' in draftToPatch({ ...draftFromItem(orig), date: '2026-11-21' }, orig, () => null)).toBe(true);
      expect('seq' in draftToPatch({ ...draftFromItem(orig), note: '改備註' }, orig, () => null)).toBe(false);
    });
  });
  it('navQuery never returns a pasted URL, even from the place query', () => {
    expect(navQuery({ title: '清水寺', address: 'https://maps.app.goo.gl/x', place: { query: 'https://maps.app.goo.gl/x', source: 'manual' }, geo: { lat: 35, lng: 135, source: 'link' } })).toBe('35,135');
    expect(navQuery({ title: '清水寺', address: 'https://maps.app.goo.gl/x', place: { query: '清水寺, Kyoto, Japan', source: 'rule' } })).toBe('清水寺, Kyoto, Japan');
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

describe('item form: 進階欄位與導航目的地', () => {
  const rule = { query: '600 Guerrero St, San Francisco, CA, USA', source: 'rule' as const, navigable: true };
  it('round-trips flag, tag, transit and only a manual place query', () => {
    const orig = item('a', { flag: 'must', tag: '早餐', transit: '步行 5 分', place: rule });
    const d = draftFromItem(orig);
    expect(d).toMatchObject({ flag: 'must', tag: '早餐', transit: '步行 5 分', placeQuery: '' });
    const p = draftToPatch(d, orig, () => null);
    expect(p).toMatchObject({ flag: 'must', tag: '早餐', transit: '步行 5 分', place: rule });
    expect(draftFromItem(item('b', { place: { query: 'Grand Plaza, Seattle', source: 'manual' } })).placeQuery).toBe('Grand Plaza, Seattle');
  });
  it('clears empty advanced fields', () => {
    const orig = item('a', { flag: 'optional', tag: '演唱會', transit: 'Uber' });
    const p = draftToPatch({ ...draftFromItem(orig), flag: '', tag: ' ', transit: '' }, orig, () => null);
    expect(p.flag).toBeUndefined();
    expect(p.tag).toBeUndefined();
    expect(p.transit).toBeUndefined();
  });
  it('a typed destination becomes a manual place and re-geocodes a geocoded pin', () => {
    const orig = item('a', { place: rule, geo: { lat: 1, lng: 2, source: 'geocode' } });
    const p = draftToPatch({ ...draftFromItem(orig), placeQuery: ' Tartine, San Francisco ' }, orig, () => null);
    expect(p.place).toEqual({ query: 'Tartine, San Francisco', source: 'manual', navigable: true });
    expect(p.geo).toBeUndefined();
    // 地圖連結來的座標不受影響
    const linked = item('b', { place: rule, geo: { lat: 1, lng: 2, source: 'link' }, link: 'https://maps.app/x' });
    expect(draftToPatch({ ...draftFromItem(linked), placeQuery: 'X' }, linked, () => ({ lat: 1, lng: 2 })).geo).toEqual(linked.geo);
  });
  it('keeps the same manual place object when unchanged, clearing it goes back to automatic', () => {
    const manual = { query: 'Grand Plaza, Seattle', source: 'manual' as const, navigable: true };
    const orig = item('a', { place: manual, geo: { lat: 1, lng: 2, source: 'geocode' } });
    const same = draftToPatch(draftFromItem(orig), orig, () => null);
    expect(same.place).toBe(manual);
    expect(same.geo).toEqual(orig.geo);
    const cleared = draftToPatch({ ...draftFromItem(orig), placeQuery: '' }, orig, () => null);
    expect('place' in cleared && cleared.place === undefined).toBe(true);
    expect(cleared.geo).toBeUndefined();
  });
  it('drops an automatic place when the address, title or date changes', () => {
    const orig = item('a', { address: '600 Guerrero St', place: rule });
    expect(draftToPatch({ ...draftFromItem(orig), address: '1 Ferry Building' }, orig, () => null).place).toBeUndefined();
    expect(draftToPatch({ ...draftFromItem(orig), title: '別的店' }, orig, () => null).place).toBeUndefined();
    expect(draftToPatch({ ...draftFromItem(orig), date: '2026-11-21' }, orig, () => null).place).toBeUndefined();
    expect(draftToPatch({ ...draftFromItem(orig), note: '記得訂位' }, orig, () => null).place).toBe(rule);
  });
  it('summarises the advanced section', () => {
    expect(advancedSummary(emptyDraft(null))).toBe('');
    expect(advancedSummary({ flag: 'must', tag: '演唱會', transit: '步行 5 分', placeQuery: 'X' })).toBe('必做 · 演唱會 · 步行 5 分 · 自訂導航目的地');
    expect(advancedSummary({ flag: 'optional', tag: '', transit: '', placeQuery: '' })).toBe('可省略');
  });
});

describe('timeline card info', () => {
  it('prefers the user tag over the type label and truncates long tags', () => {
    expect(cardInfo({ type: 'food', title: 'x', tag: ' 早餐 ' }).tag).toBe('早餐');
    expect(cardInfo({ type: 'food', title: 'x' }).tag).toBe('餐廳');
    expect(cardInfo({ type: 'other', title: 'x', tag: '一二三四五六七八九十' }).tag).toBe('一二三四五六七…');
  });
  it('keeps the flag', () => {
    expect(cardInfo({ type: 'sight', title: 'x', flag: 'must' }).flag).toBe('must');
    expect(cardInfo({ type: 'sight', title: 'x' }).flag).toBeUndefined();
  });
  it('joins route and transit on one line without repeating the title', () => {
    expect(cardInfo({ type: 'transport', title: 'Uber 到機場', route: { from: 'Hotel', to: 'SFO' }, transit: 'Uber 30 分' }).line).toBe(
      'Hotel → SFO · Uber 30 分',
    );
    expect(cardInfo({ type: 'transport', title: 'Alaska SEA → PDX', route: { from: 'SEA', to: 'PDX' } }).line).toBe('');
    expect(cardInfo({ type: 'food', title: '午餐（步行 10 分）', transit: '步行 10 分' }).line).toBe('');
    expect(cardInfo({ type: 'food', title: '午餐', transit: '  步行  10 分 ' }).line).toBe('步行 10 分');
    expect(cardInfo({ type: 'food', title: '午餐' }).line).toBe('');
  });
  it('formats one-sided routes', () => {
    expect(routeText({ from: 'SEA', to: 'PDX' })).toBe('SEA → PDX');
    expect(routeText({ from: '', to: 'Hilltop Observatory' })).toBe('→ Hilltop Observatory');
    expect(routeText({ from: 'Hotel Zephyr', to: ' ' })).toBe('Hotel Zephyr →');
    expect(routeText(undefined)).toBe('');
  });
});

describe('segment route', () => {
  const nav = (title: string, extra: Partial<Item> = {}) => item(title, { title, ...extra });
  const wake = nav('起床', { place: { query: '起床', source: 'rule', navigable: false } });
  it('starts from the current location after a stop without a place', () => {
    expect(segmentRoute(wake, nav('早餐', { place: { query: 'Tartine, San Francisco, CA, USA', source: 'rule' } }))).toEqual({
      origin: null,
      dest: 'Tartine, San Francisco, CA, USA',
    });
  });
  it('has no route into a stop without a place', () => {
    expect(segmentRoute(nav('早餐'), wake)).toBeNull();
  });
  it('uses place queries on both ends', () => {
    expect(segmentRoute(nav('A', { address: 'a st' }), nav('B', { place: { query: 'B, Seattle', source: 'ai' } }))).toEqual({ origin: 'a st', dest: 'B, Seattle' });
  });
  it('navQuery prefers the place query even when the address is a pasted link', () => {
    expect(navQuery({ title: 'x', address: 'https://maps.app/x', place: { query: 'X, Kyoto', source: 'rule' } })).toBe('X, Kyoto');
  });
});

describe('day info', () => {
  const SEA = { lat: 47.6, lng: -122.3, en: 'Seattle', admin1: 'Washington', countryCode: 'US', label: '西雅圖，美國' };
  it('reads the header line', () => {
    expect(dayHeader({ city: ' 波特蘭 ', lodging: 'Harbor Inn' })).toEqual({ city: '波特蘭', lodging: 'Harbor Inn' });
    expect(dayHeader(undefined)).toEqual({ city: '', lodging: '' });
  });
  it('returns null when nothing changed', () => {
    const m = { city: '西雅圖', lodging: 'Ace', geo: SEA, source: 'rule' as const };
    expect(editDayMeta(m, m, { city: ' 西雅圖', lodging: 'Ace ' })).toBeNull();
  });
  it('marks a changed city manual and clears the old geo', () => {
    const own = { label: '舊金山 → 西雅圖｜住 Ace', city: '西雅圖', lodging: 'Ace', geo: SEA, source: 'rule' as const };
    expect(editDayMeta(own, own, { city: '波特蘭', lodging: 'Ace' })).toEqual({ label: own.label, city: '波特蘭', lodging: 'Ace', source: 'manual' });
  });
  it('keeps the geo when only the lodging changes, also for an inherited city', () => {
    const shown = { city: '西雅圖', lodging: 'Ace', geo: SEA, source: 'rule' as const };
    expect(editDayMeta(undefined, shown, { city: '西雅圖', lodging: 'Thompson' })).toEqual({ city: '西雅圖', lodging: 'Thompson', geo: SEA, source: 'manual' });
  });
  it('clearing the city falls back to the previous day', () => {
    const own = { city: '西雅圖', geo: SEA, source: 'rule' as const };
    expect(editDayMeta(own, own, { city: '', lodging: '' })).toEqual({ source: 'manual' });
  });
  it('drops geocoded pins whose destination changed', () => {
    const a = item('a', { place: { query: 'A, Paris', source: 'rule' }, geo: { lat: 1, lng: 1, source: 'geocode' } });
    const b = item('b', { place: { query: 'B', source: 'rule' }, geo: { lat: 2, lng: 2, source: 'link' } });
    const c = item('c', { place: { query: 'C', source: 'rule' }, geo: { lat: 3, lng: 3, source: 'geocode' } });
    const after = [
      { ...a, place: { query: 'A, Seattle, WA, USA', source: 'rule' as const } },
      { ...b, place: { query: 'B, Seattle', source: 'rule' as const } },
      c,
    ];
    const out = dropStaleGeo([a, b, c], after);
    expect(out[0].geo).toBeUndefined();
    expect(out[1].geo).toEqual(b.geo);
    expect(out[2]).toBe(c);
  });
  it('explains whether the city will be found', () => {
    expect(cityFeedback('', undefined).tone).toBe('info');
    const ok = cityFeedback('西雅圖', { city: '西雅圖', geo: SEA });
    expect(ok.tone).toBe('ok');
    expect(ok.text).toContain('Seattle · Washington');
    expect(cityFeedback('波特蘭', { city: '西雅圖', geo: SEA })).toMatchObject({ tone: 'ok' });
    expect(cityFeedback('波特蘭', { city: '西雅圖', geo: SEA }).text).toContain('Portland');
    expect(cityFeedback('不存在的小鎮', undefined).tone).toBe('warn');
    expect(cityFeedback('Hood River', undefined).tone).toBe('info');
  });
  it('formats the located city', () => {
    expect(geoLine(undefined)).toBe('');
    expect(geoLine({ lat: 0, lng: 0, label: '京都，日本' })).toBe('京都');
  });
});
