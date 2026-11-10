import { describe, expect, it } from 'vitest';
import type { Item } from './types';
import { canNavigate, placeQuery } from './schedule';

const item = (over: Partial<Item> = {}): Item => ({ id: 'a', date: '2026-12-04', title: '午餐', type: 'food', done: false, createdAt: 0, updatedAt: 0, ...over });

describe('placeQuery / canNavigate', () => {
  it('優先用地點辨識的目的地，其次地址、名稱', () => {
    expect(placeQuery(item({ address: '1000 S Las Vegas Blvd', place: { query: 'Maple Lodge, Las Vegas, NV, USA', source: 'rule' } }))).toBe('Maple Lodge, Las Vegas, NV, USA');
    expect(placeQuery(item({ address: ' 1000 S Las Vegas Blvd ' }))).toBe('1000 S Las Vegas Blvd');
    expect(placeQuery(item())).toBe('午餐');
  });
  it('沒有地點的行程（起床、整理）不能導航，有座標的可以', () => {
    const wake = item({ title: '起床', place: { query: '起床', source: 'rule', navigable: false } });
    expect(canNavigate(wake)).toBe(false);
    expect(canNavigate({ ...wake, geo: { lat: 36.1, lng: -115.1, source: 'manual' } })).toBe(true);
    expect(canNavigate(item())).toBe(true);
    expect(canNavigate(item({ title: '  ' }))).toBe(false);
  });
});
