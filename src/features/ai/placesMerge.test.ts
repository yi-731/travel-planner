import { describe, expect, it } from 'vitest';
import type { Item, Trip } from '@/domain/types';
import type { ResolvedPlaces } from '@/services/ai';
import { applyResolvedPlaces, dayGeocodeRequests, dayGeoFrom, pendingPlaceIds, resolvedCityText, sameCity } from './placesMerge';

const item = (id: string, p: Partial<Item> = {}): Item => ({ id, date: '2027-03-03', title: id, type: 'sight', done: false, createdAt: 0, updatedAt: 5, ...p });

function trip(): Trip {
  return {
    id: 't', name: '西北太平洋', city: '西雅圖', startDate: '2027-03-02', endDate: '2027-03-05',
    localCurrency: 'USD', homeCurrency: 'TWD', rate: 31, members: ['我'], expenses: [], cover: { kind: 'orb' },
    ai: { dayChecks: {} }, createdAt: 0, updatedAt: 0,
    items: [
      item('rule', { place: { query: 'Space Needle, Seattle, WA, USA', source: 'rule' }, geo: { lat: 47.62, lng: -122.35, source: 'geocode' } }),
      item('same', { place: { query: 'Pike Place Market, Seattle, WA, USA', source: 'rule' }, geo: { lat: 47.6, lng: -122.34, source: 'geocode' } }),
      item('link', { geo: { lat: 1, lng: 2, source: 'link' } }),
      item('manual', { place: { query: 'My spot', source: 'manual' }, geo: { lat: 3, lng: 4, source: 'manual' } }),
      item('untouched'),
    ],
    days: {
      '2027-03-02': { label: '台北 → 西雅圖', city: '西雅圖', source: 'rule', geo: { lat: 47.6, lng: -122.33, label: '西雅圖，美國', timezone: 'America/Los_Angeles' } },
      '2027-03-03': { label: '西雅圖', city: 'Seattle', source: 'rule' },
      '2027-03-04': { label: '西雅圖 → 波特蘭', city: '西雅圖', source: 'rule', geo: { lat: 47.6, lng: -122.33, en: 'Seattle' } },
      '2027-03-05': { label: '海邊', city: '波特蘭', source: 'manual', geo: { lat: 45.5, lng: -122.7 } },
    },
  };
}

const res: ResolvedPlaces = {
  days: {
    '2027-03-02': { city: '西雅圖', cityEn: 'Seattle', region: 'Washington', countryCode: 'US' },
    '2027-03-03': { city: '西雅圖', cityEn: 'Seattle', region: 'Washington', countryCode: 'US' },
    '2027-03-04': { city: '波特蘭', cityEn: 'Portland', region: 'Oregon', countryCode: 'US' },
    '2027-03-05': { city: '坎農海灘', cityEn: 'Cannon Beach', region: 'Oregon', countryCode: 'US' },
  },
  items: {
    rule: { name: 'Space Needle', query: 'Space Needle, 400 Broad St, Seattle, WA, USA', navigable: true },
    same: { name: 'Pike Place Market', query: 'Pike Place Market, Seattle, WA, USA', navigable: true },
    link: { name: '海景點', query: 'Kerry Park, Seattle, WA, USA', navigable: true },
    manual: { name: '不該寫入', query: 'Overwrite, Seattle', navigable: true },
    ghost: { name: '不存在', query: 'Nowhere', navigable: true },
  },
};

describe('城市比對', () => {
  it('中英文、對照表別名、已定位的英文名都算同一個城市', () => {
    const r = res.days['2027-03-03'];
    expect(sameCity({ city: 'Seattle' }, r)).toBe(true);
    expect(sameCity({ city: '西雅图' }, r)).toBe(true);
    expect(sameCity({ city: 'Emerald City', geo: { lat: 0, lng: 0, en: 'seattle' } }, r)).toBe(true);
    expect(sameCity({ city: '波特蘭' }, r)).toBe(false);
    expect(sameCity(undefined, r)).toBe(false);
    expect(sameCity({ label: '只有日期列' }, r)).toBe(false);
  });
  it('存的城市文字：對照表有就用表上的顯示名，否則用 AI 的中文名', () => {
    expect(resolvedCityText({ city: '西雅图', cityEn: 'Seattle' })).toBe('西雅圖');
    expect(resolvedCityText({ city: '', cityEn: 'Portland' })).toBe('波特蘭');
    expect(resolvedCityText({ city: '坎農海灘', cityEn: 'Cannon Beach' })).toBe('坎農海灘');
  });
});

describe('applyResolvedPlaces', () => {
  it('行程點：寫入 AI 目的地；手動的不動；目的地變了才清掉自動定位的座標（連結的保留）', () => {
    const d = structuredClone(trip());
    const stats = applyResolvedPlaces(d, res);
    const by = Object.fromEntries(d.items.map((i) => [i.id, i]));
    expect(stats.items).toBe(3);
    expect(by.rule.place).toEqual({ query: 'Space Needle, 400 Broad St, Seattle, WA, USA', name: 'Space Needle', source: 'ai', navigable: true });
    expect(by.rule.geo).toBeUndefined();
    expect(by.same.place?.source).toBe('ai');
    expect(by.same.geo).toEqual({ lat: 47.6, lng: -122.34, source: 'geocode' });
    expect(by.link.place?.query).toBe('Kerry Park, Seattle, WA, USA');
    expect(by.link.geo).toEqual({ lat: 1, lng: 2, source: 'link' });
    expect(by.manual.place).toEqual({ query: 'My spot', source: 'manual' });
    expect(by.manual.geo?.source).toBe('manual');
    expect(by.untouched.place).toBeUndefined();
    expect(by.rule.updatedAt).toBe(5); // AI 標註不算使用者編輯
  });

  it('每天：同城市只補英文名／州／國碼、保留座標；換城市就改城市、清座標；手動的不動；寫過的標成 ai', () => {
    const d = structuredClone(trip());
    const stats = applyResolvedPlaces(d, res);
    expect(stats.days).toBe(3);
    expect(stats.changedDays).toEqual(['2027-03-04']);
    expect(d.days!['2027-03-02']).toEqual({
      label: '台北 → 西雅圖',
      city: '西雅圖',
      source: 'ai',
      geo: { lat: 47.6, lng: -122.33, label: '西雅圖，美國', timezone: 'America/Los_Angeles', en: 'Seattle', admin1: 'Washington', countryCode: 'US' },
    });
    expect(d.days!['2027-03-03']).toEqual({ label: '西雅圖', city: 'Seattle', source: 'ai' });
    expect(d.days!['2027-03-04']).toEqual({ label: '西雅圖 → 波特蘭', city: '波特蘭', source: 'ai' });
    expect(d.days!['2027-03-05']).toEqual(trip().days!['2027-03-05']);
  });

  it('換城市時有先查好的座標就直接用；原本沒有的日子也會加上', () => {
    const d = structuredClone(trip());
    delete d.days;
    const geo = { lat: 45.89, lng: -123.96, label: '坎農海灘，美國', en: 'Cannon Beach', admin1: 'Oregon', countryCode: 'US' };
    const stats = applyResolvedPlaces(d, { days: { '2027-03-06': { city: '坎農海灘', cityEn: 'Cannon Beach', region: 'Oregon', countryCode: 'US' } }, items: {} }, new Map([['2027-03-06', geo]]));
    expect(stats).toEqual({ items: 0, days: 1, changedDays: ['2027-03-06'] });
    expect(d.days).toEqual({ '2027-03-06': { city: '坎農海灘', source: 'ai', geo } });
  });

  it('還沒辨識過的行程點（不是 ai 也不是 manual）', () => {
    const d = structuredClone(trip());
    expect(pendingPlaceIds(d)).toEqual(['rule', 'same', 'link', 'untouched']);
    applyResolvedPlaces(d, res);
    expect(pendingPlaceIds(d)).toEqual(['untouched']);
  });
});

describe('新城市先定位', () => {
  it('只有換了城市、而且城市對照表沒有的日子要另外定位（用英文名＋州）', () => {
    const t = trip();
    t.days!['2027-03-05'] = { label: '海邊', city: '波特蘭', source: 'rule' };
    expect(dayGeocodeRequests(t, res)).toEqual([
      { date: '2027-03-05', city: '坎農海灘', query: 'Cannon Beach, Oregon', en: 'Cannon Beach', admin1: 'Oregon', countryCode: 'US' },
    ]);
    // 手動的日子不動，也不用查
    expect(dayGeocodeRequests(trip(), res)).toEqual([]);
  });

  it('定位結果：標籤用中文城市名；國碼和 AI 判斷的不同就不採用', () => {
    const req = { date: '2027-03-05', city: '坎農海灘', query: 'Cannon Beach, Oregon', en: 'Cannon Beach', admin1: 'Oregon', countryCode: 'US' };
    expect(dayGeoFrom(req, { lat: 45.89, lng: -123.96, label: 'Cannon Beach, Oregon，美國', en: 'Cannon Beach, Oregon', countryCode: 'US', timezone: 'America/Los_Angeles' })).toEqual({
      lat: 45.89, lng: -123.96, label: '坎農海灘，美國', en: 'Cannon Beach', admin1: 'Oregon', timezone: 'America/Los_Angeles', countryCode: 'US',
    });
    expect(dayGeoFrom(req, { lat: 1, lng: 2, label: 'x', countryCode: 'GB' })).toBeNull();
  });
});
