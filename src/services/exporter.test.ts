import { describe, expect, it } from 'vitest';
import readXlsxFile from 'read-excel-file/universal';
import type { Expense, Item, Trip } from '@/domain/types';
import { templateXlsx, tripToMyMapsCsv, tripToXlsx } from './exporter';
import { interpretSheets, readSpreadsheetFile, type RawSheets } from './importer';

const now = 1;
const item = (p: Partial<Item> & Pick<Item, 'title'>): Item => ({ id: p.title, date: null, type: 'other', done: false, createdAt: now, updatedAt: now, ...p });
const expense = (p: Partial<Expense> & Pick<Expense, 'title' | 'amount'>): Expense => ({
  id: p.title, date: '2026-11-21', currency: 'JPY', category: 'other', payer: '我', split: [], createdAt: now, updatedAt: now, ...p,
});

function mkTrip(patch: Partial<Trip> = {}): Trip {
  return {
    id: 't', name: '京都', city: 'KYOTO', startDate: '2026-11-21', endDate: '2026-11-22', localCurrency: 'JPY', homeCurrency: 'TWD', rate: 0.21,
    members: ['我', '旅伴'], cover: { kind: 'orb', hue: 0 }, ai: { dayChecks: {} }, createdAt: now, updatedAt: now,
    items: [
      item({ title: '伏見稻荷', date: '2026-11-22', time: '07:30', type: 'sight', address: '伏見区深草', durationMin: 120, cost: 0, rating: 5 }),
      item({ title: '清水寺', date: '2026-11-21', time: '16:30', type: 'sight', address: '京都市東山区清水1-294', note: '夜間拜觀', cost: 500, durationMin: 90, link: 'https://www.kiyomizudera.or.jp/' }),
      item({ title: '先斗町晚餐', date: '2026-11-21', time: '19:00', type: 'food', note: '先訂位, 要"兩人"\n靠窗', cost: 5000.5 }),
      item({ title: '想去的咖啡店', date: null, type: 'food' }),
      item({ title: '第三天的寺', date: null, dayOffset: 3, type: 'sight' }),
    ],
    expenses: [
      expense({ title: '先斗町晚餐', amount: 9800, category: 'food', payer: '旅伴', split: ['我', '旅伴'] }),
      expense({ title: 'ICOCA', amount: 5600, category: 'transport', date: '2026-11-20' }),
      expense({ title: '飯店', amount: 18000.75, currency: 'TWD', category: 'stay' }),
    ],
    ...patch,
  };
}

async function readBack(blob: Blob): Promise<RawSheets> {
  const sheets = (await readXlsxFile(blob)) as unknown as { sheet: string; data: unknown[][] }[];
  return Object.fromEntries(sheets.map((s) => [s.sheet, s.data]));
}

describe('tripToMyMapsCsv', () => {
  it('有 BOM、欄位名稱、依日期時間排序，必要時加引號', () => {
    const csv = tripToMyMapsCsv(mkTrip());
    expect(csv.startsWith('\uFEFF名稱,地址,日期,時間,類型,備註\r\n')).toBe(true);
    const body = csv.slice(1).split('\r\n');
    expect(body[1]).toBe('清水寺,京都市東山区清水1-294,2026-11-21,16:30,景點,夜間拜觀');
    expect(body[2]).toBe('先斗町晚餐,先斗町晚餐 KYOTO,2026-11-21,19:00,餐廳,"先訂位, 要""兩人""\n靠窗"');
    expect(body[3]).toBe('伏見稻荷,伏見区深草,2026-11-22,07:30,景點,');
    // 沒日期的排最後
    expect(csv).toContain('想去的咖啡店,想去的咖啡店 KYOTO,,,餐廳,');
    expect(csv).toContain('第三天的寺,第三天的寺 KYOTO,第3天,,景點,');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('有城市中文名時用它補地址；都沒有就只用名稱', () => {
    const withLabel = tripToMyMapsCsv(mkTrip({ cityGeo: { lat: 0, lng: 0, label: '京都' }, items: [item({ title: '錦市場' })] }));
    expect(withLabel).toContain('錦市場,錦市場 京都,');
    const noCity = tripToMyMapsCsv(mkTrip({ city: '', items: [item({ title: ' 前後空白 ' })] }));
    expect(noCity).toContain('" 前後空白 ",前後空白,');
  });
});

describe('tripToXlsx', () => {
  it('產生「行程」「記帳」兩個工作表，可以再匯入且資料一致', async () => {
    const trip = mkTrip();
    const blob = await tripToXlsx(trip);
    expect(blob.size).toBeGreaterThan(1000);
    const raw = await readBack(blob);
    expect(Object.keys(raw)).toEqual(['行程', '記帳']);
    expect(raw['行程'][0]).toEqual(['日期', '時間', '行程', '類型', '地址', '停留(分)', '費用', '評分', '備註', '連結']);
    expect(raw['記帳'][0]).toEqual(['日期', '項目', '金額', '幣別', '分類', '付款人', '分攤']);

    const r = interpretSheets(raw, { name: '京都.xlsx', startDate: null, localCurrency: 'JPY' });
    expect(r.items.map((i) => [i.date, i.dayOffset, i.time, i.title, i.type])).toEqual([
      ['2026-11-21', undefined, '16:30', '清水寺', 'sight'],
      ['2026-11-21', undefined, '19:00', '先斗町晚餐', 'food'],
      ['2026-11-22', undefined, '07:30', '伏見稻荷', 'sight'],
      [null, undefined, undefined, '想去的咖啡店', 'food'],
      [null, 3, undefined, '第三天的寺', 'sight'],
    ]);
    expect(r.items[0]).toMatchObject({ address: '京都市東山区清水1-294', note: '夜間拜觀', cost: 500, durationMin: 90, link: 'https://www.kiyomizudera.or.jp/' });
    expect(r.items[1]).toMatchObject({ note: '先訂位, 要"兩人"\n靠窗', cost: 5000.5 });
    expect(r.items[2]).toMatchObject({ rating: 5, cost: 0, durationMin: 120 });
    expect(r.expenses).toEqual([
      { date: '2026-11-20', title: 'ICOCA', amount: 5600, currency: 'JPY', category: 'transport', payer: '我', split: [] },
      { date: '2026-11-21', title: '先斗町晚餐', amount: 9800, currency: 'JPY', category: 'food', payer: '旅伴', split: ['我', '旅伴'] },
      { date: '2026-11-21', title: '飯店', amount: 18000.75, currency: 'TWD', category: 'stay', payer: '我', split: [] },
    ]);
  });

  it('readSpreadsheetFile 也能讀匯出的 .xlsx（全部工作表）', async () => {
    const blob = await tripToXlsx(mkTrip());
    const raw = await readSpreadsheetFile(new File([blob], '京都.xlsx', { type: blob.type }));
    expect(Object.keys(raw)).toEqual(['行程', '記帳']);
    expect(raw['行程']).toHaveLength(6);
  });

  it('空行程也能匯出', async () => {
    const raw = await readBack(await tripToXlsx(mkTrip({ items: [], expenses: [] })));
    expect(raw['行程']).toHaveLength(1);
    expect(raw['記帳']).toHaveLength(1);
  });
});

describe('templateXlsx', () => {
  it('有欄位名稱與兩列（範例），匯入時會略過範例', async () => {
    const raw = await readBack(await templateXlsx());
    expect(Object.keys(raw)).toEqual(['行程', '記帳']);
    expect(raw['行程']).toHaveLength(3);
    expect(raw['記帳']).toHaveLength(3);
    expect(raw['行程'].slice(1).every((r) => String(r[2]).includes('（範例）'))).toBe(true);
    expect(raw['記帳'].slice(1).every((r) => String(r[1]).includes('（範例）'))).toBe(true);
    const r = interpretSheets(raw, { name: '範本.xlsx' });
    expect(r.items).toEqual([]);
    expect(r.expenses).toEqual([]);
    expect(r.warnings.some((w) => w.includes('範例'))).toBe(true);
  });
});
