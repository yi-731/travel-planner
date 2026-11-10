import { describe, expect, it, vi } from 'vitest';
import { daySegments } from '@/domain/schedule';
import type { Item, Trip } from '@/domain/types';

// 只測純函式：不要在測試環境啟動 IndexedDB 持久化或 Capacitor
vi.mock('@/store/data', () => ({ useData: () => null, useActiveTrip: () => null }));
vi.mock('@/store/ui', () => ({ useUI: { getState: () => ({ toast: () => {} }) } }));
vi.mock('@/platform', () => ({ isNative: false, scheduleReminders: async () => false }));

const { buildReminders, reminderId, wallClockAt } = await import('./useReminders');

const item = (p: Partial<Item> & Pick<Item, 'id' | 'title'>): Item => ({
  date: '2030-05-02',
  type: 'sight',
  done: false,
  createdAt: 0,
  updatedAt: 0,
  ...p,
});

const trip = (items: Item[]): Trip => ({
  id: 'trip1',
  name: '京都',
  city: 'KYOTO',
  startDate: '2030-05-01',
  endDate: '2030-05-03',
  localCurrency: 'JPY',
  homeCurrency: 'TWD',
  rate: 0.21,
  members: ['我'],
  items,
  expenses: [],
  cover: { kind: 'orb', hue: 0 },
  ai: { dayChecks: {} },
  createdAt: 0,
  updatedAt: 0,
});

const NOW = new Date(2030, 4, 1, 12, 0).getTime();

describe('buildReminders', () => {
  it('提醒時間 = 抵達時間 − 提前分鐘數', () => {
    const [r] = buildReminders(trip([item({ id: 'a', title: '清水寺', time: '10:00' })]), 15, NOW);
    expect(r.title).toBe('出發提醒：清水寺');
    expect(r.body).toBe('10:00 抵達 · 點開導航');
    expect(r.at.getTime()).toBe(new Date(2030, 4, 2, 9, 45).getTime());
  });

  it('算得出最晚出發時間時，改用它往前推並寫在內文', () => {
    const t = trip([
      item({ id: 'a', title: '伏見稻荷', time: '09:00', geo: { lat: 34.967, lng: 135.773, source: 'manual' } }),
      item({ id: 'b', title: '金閣寺', time: '12:00', geo: { lat: 35.039, lng: 135.729, source: 'manual' } }),
    ]);
    const leaveBy = daySegments(t, '2030-05-02')[0].leaveBy!;
    expect(leaveBy).toBeLessThan(12 * 60);
    const rs = buildReminders(t, 10, NOW);
    const b = rs.find((r) => r.title.endsWith('金閣寺'))!;
    const hh = String(Math.floor(leaveBy / 60)).padStart(2, '0'), mm = String(leaveBy % 60).padStart(2, '0');
    expect(b.body).toBe(`12:00 抵達 · 最晚 ${hh}:${mm} 出發 · 點開導航`);
    expect(b.at.getTime()).toBe(new Date(2030, 4, 2, 0, leaveBy - 10).getTime());
  });

  it('略過已完成、沒時間、沒日期、已過去的行程點', () => {
    const rs = buildReminders(
      trip([
        item({ id: 'done', title: '完成', time: '10:00', done: true }),
        item({ id: 'notime', title: '沒時間' }),
        item({ id: 'nodate', title: '沒日期', date: null, time: '10:00' }),
        item({ id: 'past', title: '已過', date: '2030-05-01', time: '12:10' }),
        item({ id: 'ok', title: '要提醒', date: '2030-05-01', time: '13:00' }),
      ]),
      15,
      NOW,
    );
    expect(rs.map((r) => r.title)).toEqual(['出發提醒：要提醒']);
  });

  it('依提醒時間排序，id 穩定且不同', () => {
    const t = trip([
      item({ id: 'late', title: '晚', date: '2030-05-03', time: '08:00' }),
      item({ id: 'early', title: '早', date: '2030-05-02', time: '20:00' }),
    ]);
    const rs = buildReminders(t, 0, NOW);
    expect(rs.map((r) => r.title)).toEqual(['出發提醒：早', '出發提醒：晚']);
    expect(rs[0].id).toBe(reminderId('trip1', 'early'));
    expect(reminderId('trip1', 'early')).toBe(reminderId('trip1', 'early'));
    expect(reminderId('trip1', 'early')).not.toBe(reminderId('trip1', 'late'));
    for (const r of rs) expect(r.id).toBeGreaterThan(0), expect(r.id).toBeLessThanOrEqual(0x7fffffff);
  });

  it('用行程上的當地時間排程（浮動時間），不受手機目前時區影響', () => {
    const t = { ...trip([item({ id: 'a', title: '伏見稻荷', time: '09:00' })]), cityGeo: { lat: 35, lng: 135.7, timezone: 'Asia/Tokyo' } };
    const prevTZ = process.env.TZ;
    try {
      for (const tz of ['Asia/Taipei', 'Asia/Tokyo', 'America/New_York']) {
        process.env.TZ = tz;
        const [r] = buildReminders(t, 30, new Date(2030, 3, 1).getTime());
        // 京都 09:00 抵達、提前 30 分 → 不論手機在哪個時區，都是「當地 08:30」響
        expect(r.wall).toEqual({ year: 2030, month: 5, day: 2, hour: 8, minute: 30 });
        // at 只用來比較是否已過、排序：用手機目前時區換算
        expect(r.at.getTime()).toBe(new Date(2030, 4, 2, 8, 30).getTime());
      }
    } finally {
      if (prevTZ === undefined) delete process.env.TZ;
      else process.env.TZ = prevTZ;
    }
  });

  it('提前時間跨過午夜時，日期往前一天', () => {
    const [r] = buildReminders(trip([item({ id: 'a', title: '早班車', date: '2030-05-03', time: '00:10' })]), 30, NOW);
    expect(r.wall).toEqual({ year: 2030, month: 5, day: 2, hour: 23, minute: 40 });
  });
});

describe('wallClockAt', () => {
  it('分鐘數超過一天或為負值時正確跨日、跨月', () => {
    expect(wallClockAt('2030-05-31', 24 * 60 + 5)).toEqual({ year: 2030, month: 6, day: 1, hour: 0, minute: 5 });
    expect(wallClockAt('2030-01-01', -15)).toEqual({ year: 2029, month: 12, day: 31, hour: 23, minute: 45 });
    expect(wallClockAt('不是日期', 60)).toBeNull();
  });
});
