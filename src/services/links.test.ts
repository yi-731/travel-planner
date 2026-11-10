import { describe, expect, it } from 'vitest';
import { gmapsDayRoute, googleCalendar } from './links';

describe('googleCalendar', () => {
  const tokyo = { name: '東京五日', cityGeo: { lat: 35.68, lng: 139.76, timezone: 'Asia/Tokyo' } };
  const timed = { title: '午餐', date: '2026-12-01', time: '12:30', durationMin: 80 };

  it('有時間的行程點帶上旅程城市的時區', () => {
    const url = googleCalendar(tokyo, timed)!;
    expect(url).toContain('dates=20261201T123000/20261201T135000');
    expect(url).toContain('ctz=Asia%2FTokyo');
  });

  it('整天的活動、或不知道時區時，不帶時區', () => {
    const allDay = googleCalendar(tokyo, { title: '自由活動', date: '2026-12-01' })!;
    expect(allDay).toContain('dates=20261201/20261202');
    expect(allDay).not.toContain('ctz=');
    expect(googleCalendar({ name: 'x' }, timed)).not.toContain('ctz=');
    expect(googleCalendar({ name: 'x', cityGeo: { lat: 1, lng: 2 } }, timed)).not.toContain('ctz=');
  });

  it('沒有日期回傳 null', () => {
    expect(googleCalendar(tokyo, { title: 'x', date: null })).toBeNull();
  });
});

describe('gmapsDayRoute', () => {
  const stop = (query: string) => ({ title: query, place: { query, source: 'rule' as const } });
  it('連續同一個地方只算一次（大小寫、空白不同也算），不浪費 9 個中途點', () => {
    const url = decodeURIComponent(
      gmapsDayRoute([stop('Maple Lodge, Seattle, WA, USA'), stop('maple lodge,  Seattle, WA, USA'), stop('Vancouver, British Columbia, Canada'), stop('Vancouver, British Columbia, Canada'), stop('Stanley Park, Vancouver, British Columbia, Canada'), stop('Maple Lodge, Seattle, WA, USA'), stop('Maple Lodge, Seattle, WA, USA')])!,
    );
    expect(url).toContain('origin=Maple Lodge, Seattle, WA, USA&destination=Maple Lodge, Seattle, WA, USA&waypoints=Vancouver, British Columbia, Canada|Stanley Park, Vancouver, British Columbia, Canada&');
    expect(gmapsDayRoute([stop('A'), stop('a')])).toBeNull();
  });
});

describe('googleCalendar：多城市與過午夜', () => {
  const days = {
    '2026-12-03': { city: '波特蘭', geo: { lat: 45.52, lng: -122.68, timezone: 'America/Los_Angeles', countryCode: 'US' } },
    '2026-12-06': { city: '溫哥華', geo: { lat: 49.28, lng: -123.12, timezone: 'America/Vancouver', countryCode: 'CA' } },
    '2026-12-05': { city: '西雅圖', geo: { lat: 47.61, lng: -122.33, timezone: 'America/Los_Angeles', countryCode: 'US' } },
  };
  const base = { name: '美西北', city: 'SEATTLE', cityGeo: { lat: 47.61, lng: -122.33, timezone: 'America/Los_Angeles', countryCode: 'US' }, days };
  it('時區用那一站所在的城市；在別的國家又不知道時區就不帶', () => {
    const park = googleCalendar(base, { title: 'Stanley Park', date: '2026-12-06', time: '14:00', place: { query: 'Stanley Park, Vancouver, British Columbia, Canada', source: 'rule' } })!;
    expect(park).toContain('ctz=America%2FVancouver');
    // 一日遊那天早上還在西雅圖
    const morning = googleCalendar(base, { title: '起床', date: '2026-12-06', time: '06:30', place: { query: 'Maple Lodge, Seattle, WA, USA', source: 'rule' } })!;
    expect(morning).toContain('ctz=America%2FLos_Angeles');
    // 抵達波特蘭那天的「桃園機場報到」（台北時間）：不帶時區
    const tpe = googleCalendar(base, { title: '桃園機場第二航廈報到', date: '2026-12-03', time: '20:30', place: { query: 'TPE airport Terminal 2, Taoyuan, Taiwan', source: 'rule' } })!;
    expect(tpe).not.toContain('ctz=');
    expect(tpe).toContain('location=' + encodeURIComponent('TPE airport Terminal 2, Taoyuan, Taiwan'));
  });
  it('晚上行程後面的「0:45」記在隔天', () => {
    const items = [
      { id: 'p', title: '演唱會', date: '2026-12-05', time: '23:00', seq: 0, type: 'sight' as const, done: false, createdAt: 0, updatedAt: 0 },
      { id: 'b', title: '回飯店', date: '2026-12-05', time: '00:45', seq: 1, type: 'transport' as const, done: false, createdAt: 0, updatedAt: 0 },
    ];
    const url = googleCalendar({ ...base, items }, items[1])!;
    expect(url).toContain('dates=20261206T004500/20261206T014500');
    expect(googleCalendar({ ...base, items }, items[0])).toContain('dates=20261205T230000/20261205T235900');
  });
});
