import { describe, expect, it } from 'vitest';
import type { Trip } from '@/domain/types';
import { applyImport, interpretSheets, type RawSheets } from '@/services/importer';
import {
  cityCurrency,
  countsText,
  currencyHint,
  errorText,
  fmtSynced,
  guessLocalCurrency,
  newTripDraft,
  pickNewTripCurrency,
  previewDate,
  removedCount,
  resolveNewTrip,
  shortName,
} from './model';

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

describe('建立新行程的當地貨幣', () => {
  /** 和 ImportSheet 一樣：用某個當地貨幣辨識這份試算表（不套用出發日） */
  const parser = (raw: RawSheets) => (local: string | undefined) => interpretSheets(raw, { name: '', startDate: null, localCurrency: local });
  /** tripCurrency 空字串＝沒有目前行程 */
  const draft = (rows: unknown[][], tripCurrency = 'JPY', home = 'TWD') =>
    newTripDraft(parser({ 記帳: rows }), home, tripCurrency || undefined);
  const noCurrency = [
    ['日期', '項目', '金額'],
    ['11/21', '炸雞', '18000'],
    ['11/22', '烤肉', '45000'],
  ];
  const base = (localCurrency: string): Trip => ({
    id: 't-new', name: '首爾', city: '首爾', startDate: null, endDate: null, localCurrency, homeCurrency: 'TWD', rate: 1,
    members: ['我'], items: [], expenses: [], cover: { kind: 'orb', hue: 0 }, ai: { dayChecks: {} }, createdAt: 1, updatedAt: 1,
  });

  it('沒有幣別欄：依城市決定，不沿用目前行程的貨幣', () => {
    const d = draft(noCurrency, 'JPY');
    const { localCurrency, result } = resolveNewTrip(d, '首爾');
    expect(localCurrency).toBe('KRW');
    const t = applyImport(base(localCurrency), result, 'new');
    expect(t.localCurrency).toBe('KRW');
    expect(t.expenses.map((e) => e.currency)).toEqual(['KRW', 'KRW']);
    expect(t.expenses.map((e) => e.amount)).toEqual([18000, 45000]);
  });

  it('沒有幣別欄、也沒填城市：沿用目前行程的貨幣，沒有目前行程就是 JPY', () => {
    expect(resolveNewTrip(draft(noCurrency, 'THB'), '').result.expenses.map((e) => e.currency)).toEqual(['THB', 'THB']);
    expect(pickNewTripCurrency(draft(noCurrency, 'THB'), '火星')).toMatchObject({ code: 'THB', from: 'fallback' });
    expect(resolveNewTrip(draft(noCurrency, ''), '').localCurrency).toBe('JPY');
  });

  it('試算表寫明的幣別優先，城市空白也一樣', () => {
    const d = draft([
      ['日期', '項目', '金額', '幣別'],
      ['11/21', '炸雞', '18000', 'KRW'],
      ['11/21', '機場接送', '900', 'TWD'],
      ['11/22', '烤肉', '45000', ''],
    ], 'JPY');
    const r = resolveNewTrip(d, '');
    expect(r.localCurrency).toBe('KRW');
    // 本國貨幣照舊，沒寫的跟著當地貨幣
    expect(r.result.expenses.map((e) => e.currency)).toEqual(['KRW', 'TWD', 'KRW']);
    expect(pickNewTripCurrency(d, '東京')).toMatchObject({ code: 'KRW', from: 'sheet' });
  });

  it('只寫「¥」：一般算日圓，城市在中國才算人民幣', () => {
    const yen = [
      ['日期', '項目', '金額'],
      ['11/21', '拉麵', '¥1200'],
      ['11/21', '車票', '¥500'],
      ['11/22', '咖啡', '300'],
    ];
    const r = resolveNewTrip(draft(yen, 'KRW'), '');
    expect(r.localCurrency).toBe('JPY');
    expect(r.result.expenses.map((e) => e.currency)).toEqual(['JPY', 'JPY', 'JPY']);
    const sh = resolveNewTrip(draft(yen, 'JPY'), '上海');
    expect(sh.localCurrency).toBe('CNY');
    expect(sh.result.expenses.map((e) => e.currency)).toEqual(['CNY', 'CNY', 'CNY']);
  });

  it('預覽說明：寫出新行程會用的貨幣與來源', () => {
    expect(currencyHint(draft(noCurrency, 'JPY'), '首爾')).toBe('當地貨幣：KRW 韓元（依城市）。沒寫幣別的 2 筆記帳會以 KRW 計算。');
    expect(currencyHint(draft(noCurrency, 'JPY'), '')).toBe('當地貨幣先沿用目前行程的 JPY 日圓，填上城市就會改用當地貨幣。沒寫幣別的 2 筆記帳會以 JPY 計算。');
    expect(currencyHint(draft(noCurrency, ''), '')).toBe('當地貨幣先用 JPY 日圓，填上城市就會改用當地貨幣。沒寫幣別的 2 筆記帳會以 JPY 計算。');
    expect(currencyHint(draft(noCurrency, 'JPY'), '火星')).toMatch(/^認不出這個城市的貨幣，先用 JPY 日圓/);
    expect(currencyHint(draft([['日期', '項目', '金額', '幣別'], ['11/21', '炸雞', '18000', 'KRW']]), '')).toBe('當地貨幣：KRW 韓元（依試算表）。');
  });

  it('城市名稱 → 貨幣', () => {
    expect(cityCurrency('首爾')).toBe('KRW');
    expect(cityCurrency('KYOTO')).toBe('JPY');
    expect(cityCurrency('臺北市')).toBe('TWD');
    expect(cityCurrency('火星')).toBeNull();
    expect(cityCurrency('')).toBeNull();
  });
});
