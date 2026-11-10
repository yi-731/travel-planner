import { describe, expect, it } from 'vitest';
import { tripPhase } from '@/domain/dates';
import type { SegmentInfo } from '@/domain/schedule';
import type { Expense, Item, Trip } from '@/domain/types';
import {
  cityFitLength,
  displayCity,
  eyebrowText,
  fmtDistance,
  hasCJK,
  isPastStop,
  leaveTone,
  pickNextStop,
  safeWeatherInfo,
  segmentInto,
  showHomeTiles,
  spendSummary,
  startsIn,
  travelInfo,
  travelTileKind,
  valueSizeClass,
  weatherSub,
} from './model';

const item = (id: string, time?: string, extra: Partial<Item> = {}): Item => ({
  id, date: '2026-11-20', time, title: id, type: 'sight', done: false, createdAt: 0, updatedAt: 0, ...extra,
});

const trip = (extra: Partial<Trip> = {}): Trip => ({
  id: 't', name: '京阪奈五日', city: 'KYOTO', startDate: '2026-11-20', endDate: '2026-11-24',
  localCurrency: 'JPY', homeCurrency: 'TWD', rate: 0.2, members: ['我'], items: [], expenses: [],
  cover: { kind: 'orb' }, ai: { dayChecks: {} }, createdAt: 0, updatedAt: 0, ...extra,
});

const seg = (extra: Partial<SegmentInfo> = {}): SegmentInfo => ({
  from: item('a', '09:00'), to: item('b', '10:00'), estimate: null, distanceKm: null, tight: false, leaveBy: null, ...extra,
});

const exp = (date: string, amount: number, currency = 'TWD'): Expense => ({
  id: `${date}-${amount}`, date, title: 'x', amount, currency, category: 'food', payer: '我', split: [], createdAt: 0, updatedAt: 0,
});

describe('eyebrowText', () => {
  it('依旅程階段顯示出發日、第幾天或結束（倒數天數在小卡，不重複）', () => {
    const t = trip();
    expect(eyebrowText(tripPhase(t, '2026-11-08'))).toBe('11/20（週五）出發');
    expect(eyebrowText(tripPhase(t, '2026-11-19'))).toBe('11/20（週五）出發');
    expect(eyebrowText(tripPhase(t, '2026-11-22'))).toBe('DAY 3 / 5 · 11/22（週日）');
    expect(eyebrowText(tripPhase(t, '2026-12-01'))).toBe('旅程已結束');
    expect(eyebrowText(tripPhase(trip({ startDate: null, endDate: null }), '2026-11-08'))).toBe('尚未設定日期');
  });
});

describe('城市名', () => {
  it('沒有城市時用行程名稱', () => {
    expect(displayCity({ city: '  ', name: '東京行' })).toBe('東京行');
    expect(displayCity({ city: 'Kyoto', name: 'x' })).toBe('Kyoto');
  });
  it('判斷中日韓文字', () => {
    expect(hasCJK('京都')).toBe(true);
    expect(hasCJK('서울')).toBe(true);
    expect(hasCJK('San Francisco')).toBe(false);
  });
  it('拉丁文 12 個字以內以整個名字計算（維持一行），更長的以最長的字計算；中文以總字數', () => {
    expect(cityFitLength('San Francisco')).toBe(9);
    expect(cityFitLength('HONG KONG')).toBe(9);
    expect(cityFitLength('  New   York ')).toBe(8);
    expect(cityFitLength('Kyoto')).toBe(5);
    expect(cityFitLength('Rome')).toBe(4);
    expect(cityFitLength('京都')).toBe(2);
    expect(cityFitLength('首爾 特別市')).toBe(5);
  });
});

describe('pickNextStop', () => {
  const day = [item('a', '09:00', { durationMin: 60 }), item('b', '12:00'), item('c', '18:00'), item('d')];
  it('出發前取第一站', () => {
    expect(pickNextStop('before', day, 0)).toEqual({ item: day[0], status: 'first' });
    expect(pickNextStop('before', [], 0)).toBeNull();
  });
  it('旅途中取還沒結束的第一站；正在停留時標成進行中', () => {
    expect(pickNextStop('during', day, 8 * 60)?.item.id).toBe('a');
    expect(pickNextStop('during', day, 9 * 60 + 30)).toEqual({ item: day[0], status: 'now' });
    expect(pickNextStop('during', day, 11 * 60)?.item.id).toBe('b');
  });
  it('時間已過但還沒打勾：開始＋停留時間早於現在才算', () => {
    expect(isPastStop(item('a', '08:10'), 10 * 60)).toBe(true);
    expect(isPastStop(item('a', '09:00', { durationMin: 90 }), 10 * 60)).toBe(false);
    expect(isPastStop(item('a', '09:00', { durationMin: 60 }), 10 * 60)).toBe(false);
    expect(isPastStop(item('a', '09:00', { durationMin: 59 }), 10 * 60)).toBe(true);
    expect(isPastStop(item('a', '16:30'), 10 * 60)).toBe(false);
    expect(isPastStop(item('a', '08:10', { done: true }), 10 * 60)).toBe(false);
    expect(isPastStop(item('a'), 23 * 60)).toBe(false);
  });
  it('跳過已完成；時間都過了就取第一個沒完成的', () => {
    const d2 = [{ ...day[0], done: true }, day[1], day[2]];
    expect(pickNextStop('during', d2, 8 * 60)?.item.id).toBe('b');
    expect(pickNextStop('during', d2, 23 * 60)?.item.id).toBe('b');
    expect(pickNextStop('during', d2.map((i) => ({ ...i, done: true })), 0)).toBeNull();
  });
  it('結束後或沒日期沒有下一站', () => {
    expect(pickNextStop('after', day, 0)).toBeNull();
    expect(pickNextStop('none', day, 0)).toBeNull();
  });
});

describe('startsIn', () => {
  it('三小時內才顯示', () => {
    expect(startsIn({ time: '10:25' }, 10 * 60)).toBe('25 分鐘後');
    expect(startsIn({ time: '11:05' }, 10 * 60)).toBe('1 小時 5 分後');
    expect(startsIn({ time: '12:00' }, 10 * 60)).toBe('2 小時後');
    expect(startsIn({ time: '14:00' }, 10 * 60)).toBeNull();
    expect(startsIn({ time: '09:00' }, 10 * 60)).toBeNull();
    expect(startsIn({}, 10 * 60)).toBeNull();
  });
});

describe('移動資訊', () => {
  it('找出抵達某站的那段', () => {
    const s = seg();
    expect(segmentInto([s], 'b')).toBe(s);
    expect(segmentInto([s], 'a')).toBeNull();
    expect(segmentInto([s], undefined)).toBeNull();
  });
  it('AI 估計 → 直線距離 → 路線 → 路況', () => {
    expect(travelInfo(null)).toEqual({ kind: 'traffic' });
    expect(travelInfo(seg({ estimate: { minutes: 24.6, mode: '地鐵' } }))).toMatchObject({ kind: 'estimate', minutes: 25, mode: '地鐵' });
    expect(travelInfo(seg({ distanceKm: 1.24 }))).toMatchObject({ kind: 'distance', km: 1.24 });
    expect(travelInfo(seg())).toMatchObject({ kind: 'route' });
  });
  it('第三張小卡依階段：出發前倒數、沒日期提醒設定、旅途中才看移動', () => {
    const t = trip();
    expect(travelTileKind(tripPhase(t, '2026-11-08'), null)).toEqual({ kind: 'countdown', daysUntil: 12, tripDays: 5 });
    expect(travelTileKind(tripPhase(t, '2026-11-19'), seg())).toEqual({ kind: 'countdown', daysUntil: 1, tripDays: 5 });
    expect(travelTileKind(tripPhase(trip({ startDate: null, endDate: null }), '2026-11-08'), null)).toEqual({ kind: 'setDates' });
    expect(travelTileKind(tripPhase(t, '2026-11-21'), null)).toEqual({ kind: 'traffic' });
    expect(travelTileKind(tripPhase(t, '2026-11-21'), seg({ distanceKm: 2 }))).toMatchObject({ kind: 'distance', km: 2 });
  });
  it('旅程結束後首頁不顯示小卡', () => {
    expect(showHomeTiles('after')).toBe(false);
    expect(showHomeTiles('before')).toBe(true);
    expect(showHomeTiles('during')).toBe(true);
    expect(showHomeTiles('none')).toBe(true);
  });
  it('距離格式', () => {
    expect(fmtDistance(0.853)).toEqual({ value: '850', unit: 'm' });
    expect(fmtDistance(0.001)).toEqual({ value: '10', unit: 'm' });
    expect(fmtDistance(3.24)).toEqual({ value: '3.2', unit: 'km' });
    expect(fmtDistance(42.6)).toEqual({ value: '43', unit: 'km' });
  });
  it('太趕或建議出發時間已過時提醒', () => {
    expect(leaveTone(null, 'during', 0)).toBe('calm');
    expect(leaveTone(seg({ tight: true }), 'before', 0)).toBe('warn');
    expect(leaveTone(seg({ leaveBy: 600 }), 'during', 601)).toBe('warn');
    expect(leaveTone(seg({ leaveBy: 600 }), 'during', 500)).toBe('calm');
    expect(leaveTone(seg({ leaveBy: 600 }), 'before', 700)).toBe('calm');
  });
});

describe('spendSummary', () => {
  const t = trip({ budget: 1000, expenses: [exp('2026-11-20', 300), exp('2026-11-21', 1000, 'JPY')] });
  it('旅途中看今天，其他時候看總額；預算以總額計', () => {
    const during = spendSummary(t, tripPhase(t, '2026-11-20'));
    expect(during).toMatchObject({ label: '今日花費', value: 300, currency: 'TWD', budgetPct: 50, budgetText: '預算 50%' });
    const before = spendSummary(t, tripPhase(t, '2026-11-01'));
    expect(before).toMatchObject({ label: '花費', value: 500 });
  });
  it('超支時顯示超出多少', () => {
    const over = trip({ budget: 400, expenses: [exp('2026-11-20', 500)] });
    expect(spendSummary(over, tripPhase(over, '2026-11-01')).budgetText).toBe('超支 25%');
  });
  it('沒有預算不顯示百分比', () => {
    expect(spendSummary(trip(), tripPhase(trip(), '2026-11-01'))).toMatchObject({ budgetPct: null, budgetText: null });
  });
});

describe('天氣與數字', () => {
  it('天氣代碼轉換失敗時不會讓首頁壞掉', () => {
    expect(safeWeatherInfo(Number.NaN).icon).toBeTruthy();
  });
  it('副標放不下時保留重點', () => {
    expect(weatherSub('晴', 'forecast')).toBe('晴 · 預報');
    expect(weatherSub('雷雨夾冰雹', 'forecast')).toBe('雷雨夾冰雹');
    expect(weatherSub('多雲', 'climate')).toBe('多雲 · 歷年平均');
    expect(weatherSub('大致晴朗', 'climate')).toBe('歷年平均');
    expect(weatherSub('', 'forecast')).toBe('預報');
  });
  it('數字越長字越小', () => {
    expect(valueSizeClass('21,234')).toBe('md');
    expect(valueSizeClass('123,456')).toBe('sm');
    expect(valueSizeClass('12,345,678')).toBe('xs');
  });
});
