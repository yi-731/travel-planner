import { describe, expect, it } from 'vitest';
import { countsText, errorText, fmtSynced, guessLocalCurrency, previewDate, removedCount, shortName } from './model';

describe('importer model', () => {
  it('formats sync time', () => {
    expect(fmtSynced(new Date(2026, 10, 9, 8, 5).getTime())).toBe('11/9 08:05');
  });

  it('summarises counts', () => {
    const it2 = [{}, {}] as never[];
    expect(countsText({ items: it2, expenses: [{}] as never[] })).toBe('2 個行程點 · 1 筆記帳');
    expect(countsText({ items: it2, expenses: [] })).toBe('2 個行程點');
    expect(countsText({ items: [], expenses: [] })).toBe('沒有資料');
  });

  it('shows preview dates', () => {
    expect(previewDate({ date: '2026-11-20' })).toBe('11/20');
    expect(previewDate({ date: null, dayOffset: 2 })).toBe('第 2 天');
    expect(previewDate({ date: null })).toBe('—');
  });

  it('shortens long names', () => {
    expect(shortName('京都')).toBe('京都');
    expect(shortName('一二三四五六七八九十十一', 10)).toBe('一二三四五六七八九…');
    expect(shortName('京阪奈五日（範例）', 7)).toBe('京阪奈五日');
    expect(shortName('Tokyo Trip (draft)', 12)).toBe('Tokyo Trip');
  });

  it('guesses the local currency from expenses', () => {
    const ex = (currency: string) => ({ currency }) as never;
    expect(guessLocalCurrency({ expenses: [ex('KRW'), ex('TWD'), ex('KRW'), ex('USD')] }, 'TWD', 'JPY')).toBe('KRW');
    expect(guessLocalCurrency({ expenses: [ex('TWD')] }, 'TWD', 'JPY')).toBe('JPY');
  });

  it('counts removed items', () => {
    expect(removedCount({ items: [{ id: 'a' }, { id: 'b' }] as never[] }, { items: [{ id: 'b' }, { id: 'c' }] as never[] })).toBe(1);
  });

  it('hides placeholder errors', () => {
    expect(errorText(new Error('TODO'), '讀取失敗')).toBe('讀取失敗');
    expect(errorText(new Error('網路斷線'), '讀取失敗')).toBe('網路斷線');
    expect(errorText(null, '讀取失敗')).toBe('讀取失敗');
  });
});
