import { describe, expect, it } from 'vitest';
import { socialLinks } from '@/services/links';
import { factsHint, fmtDuration, fmtRating, linkHost, normalizeUrl, placeMeta, placeSocials, ratingPct, timeRange } from './model';

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
});

describe('factsHint', () => {
  it('does not ask for a time that is already set', () => {
    expect(factsHint({ time: '08:10' })).not.toContain('、時間');
    expect(factsHint({ time: '08:10' })).toContain('停留時間');
    expect(factsHint({})).toContain('地址、時間或費用');
  });
});
