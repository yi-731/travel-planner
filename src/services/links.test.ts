import { describe, expect, it } from 'vitest';
import { googleCalendar } from './links';

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
