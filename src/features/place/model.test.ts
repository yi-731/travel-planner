import { describe, expect, it } from 'vitest';
import { socialLinks } from '@/services/links';
import {
  clearPlacePatch,
  factsHint,
  fmtDuration,
  fmtRating,
  linkHost,
  manualPlacePatch,
  normalizeUrl,
  PLACE_SOURCE_LABEL,
  placeMeta,
  placeSocials,
  ratingPct,
  timeRange,
} from './model';

describe('fmtDuration', () => {
  it('formats minutes and hours', () => {
    expect(fmtDuration(45)).toBe('45 分鐘');
    expect(fmtDuration(60)).toBe('1 小時');
    expect(fmtDuration(90)).toBe('1 小時 30 分');
    expect(fmtDuration(180)).toBe('3 小時');
  });
  it('returns empty for missing or non-positive', () => {
    expect(fmtDuration(undefined)).toBe('');
    expect(fmtDuration(0)).toBe('');
    expect(fmtDuration(-5)).toBe('');
  });
});

describe('timeRange', () => {
  it('shows start only without duration', () => {
    expect(timeRange({ time: '16:30' })).toBe('16:30');
  });
  it('shows start – end with duration', () => {
    expect(timeRange({ time: '16:30', durationMin: 90 })).toBe('16:30 – 18:00');
  });
  it('does not wrap past midnight', () => {
    expect(timeRange({ time: '23:30', durationMin: 60 })).toBe('23:30');
  });
  it('is empty without time', () => {
    expect(timeRange({ durationMin: 60 })).toBe('');
  });
});

describe('normalizeUrl', () => {
  it('adds https when missing', () => {
    expect(normalizeUrl('example.com/a')).toBe('https://example.com/a');
  });
  it('keeps http(s) urls', () => {
    expect(normalizeUrl('http://a.jp/')).toBe('http://a.jp/');
  });
  it('rejects empty and non-web schemes', () => {
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl('   ')).toBeNull();
    expect(normalizeUrl('javascript://alert(1)')).toBeNull();
  });
});

describe('linkHost / rating', () => {
  it('strips www', () => {
    expect(linkHost('https://www.kiyomizudera.or.jp/x')).toBe('kiyomizudera.or.jp');
  });
  it('clamps rating', () => {
    expect(ratingPct(4.5)).toBe(90);
    expect(ratingPct(9)).toBe(100);
    expect(ratingPct(-1)).toBe(0);
    expect(fmtRating(4)).toBe('4.0');
  });
});

describe('placeMeta', () => {
  it('formats day, date, weekday and time', () => {
    expect(placeMeta(1, '11/21', '六', '16:30')).toBe('Day 1 · 11/21（週六）· 16:30');
    expect(placeMeta(2, '11/22', '日')).toBe('Day 2 · 11/22（週日）');
  });
  it('handles undated items', () => {
    expect(placeMeta(0, '', '', '09:00')).toBe('還沒排日期 · 09:00');
    expect(placeMeta(0, '', '')).toBe('還沒排日期');
  });
});

describe('placeSocials', () => {
  const links = (type: Parameters<typeof socialLinks>[1]['type']) => socialLinks('京都', { title: '清水寺', type });
  it('hides social links for transport', () => {
    expect(placeSocials('transport', links('transport'))).toEqual([]);
  });
  it('keeps only review sources for stays', () => {
    expect(placeSocials('stay', links('stay')).map((l) => l.label)).toEqual(['Google 評價', 'Instagram', 'Tripadvisor', 'Google 搜尋心得']);
  });
  it('keeps the full list for sights, food, shops and other', () => {
    for (const type of ['sight', 'food', 'shop', 'other'] as const) expect(placeSocials(type, links(type))).toEqual(links(type));
    expect(placeSocials('food', links('food')).some((l) => l.label.startsWith('Tabelog'))).toBe(true);
  });
  it('drops Tabelog when the day is known to be outside Japan', () => {
    const hasTabelog = (cc?: string) => placeSocials('food', links('food'), cc).some((l) => l.label.startsWith('Tabelog'));
    expect(hasTabelog('JP')).toBe(true);
    expect(hasTabelog('jp')).toBe(true);
    expect(hasTabelog(undefined)).toBe(true);
    expect(hasTabelog('US')).toBe(false);
    expect(placeSocials('food', links('food'), 'US').length).toBe(links('food').length - 1);
  });
});

describe('factsHint', () => {
  it('does not ask for a time that is already set', () => {
    expect(factsHint({ time: '08:10' })).not.toContain('、時間');
    expect(factsHint({ time: '08:10' })).toContain('停留時間');
    expect(factsHint({})).toContain('地址、時間或費用');
  });
});

describe('導航目的地', () => {
  const base = { id: 'a', title: 'Lakeside Buffet' };
  it('手動修改：source = manual、可以導航；用文字查到的座標清掉重新定位', () => {
    const it0 = { ...base, place: { query: 'Lakeside Buffet', source: 'rule' as const }, geo: { lat: 1, lng: 2, source: 'geocode' as const } };
    expect(manualPlacePatch(it0, '  Lakeside Buffet,  Grand Plaza, Seattle ')).toEqual({
      id: 'a',
      title: 'Lakeside Buffet',
      place: { query: 'Lakeside Buffet, Grand Plaza, Seattle', source: 'manual', navigable: true },
      geo: undefined,
    });
  });
  it('地圖連結、手動的座標保留', () => {
    const linked = { ...base, geo: { lat: 1, lng: 2, source: 'link' as const } };
    expect(manualPlacePatch(linked, 'X')?.geo).toEqual(linked.geo);
    expect(clearPlacePatch({ ...base, geo: { lat: 1, lng: 2, source: 'manual' as const } }).geo).toEqual({ lat: 1, lng: 2, source: 'manual' });
  });
  it('空白或沒改不用存；原本不能導航的設定後就能導航', () => {
    expect(manualPlacePatch(base, '  ')).toBeNull();
    expect(manualPlacePatch({ ...base, place: { query: 'X', source: 'manual', navigable: true } }, ' X ')).toBeNull();
    expect(manualPlacePatch({ ...base, place: { query: '起床', source: 'rule', navigable: false } }, '起床')?.place?.navigable).toBe(true);
  });
  it('改回自動辨識：拿掉目的地，舊座標清掉', () => {
    const p = clearPlacePatch({ ...base, geo: { lat: 1, lng: 2, source: 'geocode' } });
    expect('place' in p && p.place === undefined).toBe(true);
    expect(p.geo).toBeUndefined();
  });
  it('來源標籤', () => {
    expect(PLACE_SOURCE_LABEL.rule).toBe('自動辨識');
    expect(PLACE_SOURCE_LABEL.ai).toBe('AI');
    expect(PLACE_SOURCE_LABEL.manual).toBe('手動');
  });
});
