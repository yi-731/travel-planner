import { describe, expect, it } from 'vitest';
import type { Item, Trip } from './types';
import { allItemsSorted, canNavigate, dayClock, daySegments, itemMinutes, itemsOfDay, placeQuery } from './schedule';

const item = (over: Partial<Item> = {}): Item => ({ id: 'a', date: '2026-12-04', title: '午餐', type: 'food', done: false, createdAt: 0, updatedAt: 0, ...over });

describe('placeQuery / canNavigate', () => {
  it('優先用地點辨識的目的地，其次地址、名稱', () => {
    expect(placeQuery(item({ address: '1000 S Seattle Blvd', place: { query: 'Maple Lodge, Seattle, WA, USA', source: 'rule' } }))).toBe('Maple Lodge, Seattle, WA, USA');
    expect(placeQuery(item({ address: ' 1000 S Seattle Blvd ' }))).toBe('1000 S Seattle Blvd');
    expect(placeQuery(item())).toBe('午餐');
  });
  it('沒有地點的行程（起床、整理）不能導航，有座標的可以', () => {
    const wake = item({ title: '起床', place: { query: '起床', source: 'rule', navigable: false } });
    expect(canNavigate(wake)).toBe(false);
    expect(canNavigate({ ...wake, geo: { lat: 47.6, lng: -122.3, source: 'manual' } })).toBe(true);
    expect(canNavigate(item())).toBe(true);
    expect(canNavigate(item({ title: '  ' }))).toBe(false);
  });
});

describe('一天的順序（itemsOfDay / allItemsSorted / itemMinutes）', () => {
  const D = '2026-12-04';
  const at = (id: string, time: string | undefined, seq?: number, date = D): Item => item({ id, title: id, time, date, ...(seq != null ? { seq } : {}) });
  const ids = (list: Item[]) => list.map((i) => i.id);

  it('試算表匯入的：跨換日線的航班照試算表順序（台北報到 → 起飛 → 抵達西雅圖）', () => {
    const t = { items: [at('tpe-checkin', '20:30', 0), at('takeoff', '23:55', 1), at('arrive-sea', '18:40', 2), at('train', '19:50', 3), at('hotel', '20:40', 4)] };
    expect(ids(itemsOfDay(t, D))).toEqual(['tpe-checkin', 'takeoff', 'arrive-sea', 'train', 'hotel']);
    // 實際時間照寫的（不是排序用的分鐘數）
    expect(itemMinutes(t, t.items[2])).toBe(18 * 60 + 40);
  });

  it('晚上行程後面的「0:45」是過了午夜：排最後，時間算 24:45', () => {
    const t = { items: [at('breakfast', '09:00', 0), at('concert', '19:30', 1), at('encore', '23:00', 2), at('back', '00:45', 3), at('sleep', '01:30', 4)] };
    expect(ids(itemsOfDay(t, D))).toEqual(['breakfast', 'concert', 'encore', 'back', 'sleep']);
    expect(itemMinutes(t, t.items[3])).toBe(24 * 60 + 45);
    expect(dayClock(t.items).map((c) => c.minutes)).toEqual([540, 1170, 1380, 1485, 1530]);
  });

  it('App 裡加的（沒有 seq）照時間；04:00 以前、排在晚上行程後面加入的才算深夜', () => {
    const sunrise = { items: [at('sunrise', '04:30'), at('dinner', '19:00'), at('wake', '03:30')] };
    // 04:30 看日出不會排到最後；03:30 在晚餐之後加入 → 深夜
    expect(ids(itemsOfDay(sunrise, D))).toEqual(['sunrise', 'dinner', 'wake']);
    const early = { items: [at('wake', '03:30'), at('dinner', '19:00')] };
    expect(ids(itemsOfDay(early, D))).toEqual(['wake', 'dinner']);
    // 沒有時間的排最後
    expect(ids(itemsOfDay({ items: [at('x', undefined), at('y', '10:00')] }, D))).toEqual(['y', 'x']);
  });

  it('混合：App 裡加的依時間插進試算表的順序裡；不同日期依日期', () => {
    const t = { items: [at('a', '09:00', 0), at('b', '12:00', 1), at('c', '18:00', 2), at('mine', '13:30'), at('next', '08:00', 3, '2026-12-05'), at('undated', '07:00', undefined, null as unknown as string)] };
    expect(ids(itemsOfDay(t, D))).toEqual(['a', 'b', 'mine', 'c']);
    expect(ids(allItemsSorted(t))).toEqual(['a', 'b', 'mine', 'c', 'next', 'undated']);
  });

  it('過了午夜的移動不會被當成「太趕」；跨換日線的不判斷', () => {
    const trip = { items: [at('encore', '23:00', 0), at('back', '00:45', 1), at('takeoff', '23:55', 2, '2026-12-05'), at('arrive', '18:40', 3, '2026-12-05')], ai: { dayChecks: {} } } as unknown as Trip;
    expect(daySegments(trip, D)[0].tight).toBe(false);
    expect(daySegments(trip, '2026-12-05')[0]).toMatchObject({ tight: false });
  });
});

describe('canNavigate：自動定位的座標不能推翻「沒有特定地點」', () => {
  it('geocode 來的座標＋navigable false → 不能導航；連結、手動的座標可以', () => {
    const wake = item({ title: '起床', place: { query: '起床, Seattle, WA, USA', source: 'rule', navigable: false } });
    expect(canNavigate({ ...wake, geo: { lat: 47.6, lng: -122.3, source: 'geocode' } })).toBe(false);
    expect(canNavigate({ ...wake, geo: { lat: 47.6, lng: -122.3, source: 'link' } })).toBe(true);
    expect(canNavigate(item({ geo: { lat: 1, lng: 2, source: 'geocode' } }))).toBe(true);
  });
  it('placeQuery 不會回傳網址', () => {
    expect(placeQuery(item({ address: 'https://maps.app.goo.gl/x', geo: { lat: 35, lng: 135, source: 'link' } }))).toBe('35,135');
    expect(placeQuery(item({ address: 'https://maps.app.goo.gl/x' }))).toBe('午餐');
  });
});
