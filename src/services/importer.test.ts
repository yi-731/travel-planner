import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Item, Trip } from '@/domain/types';
import { applyImport, interpretSheets, readPastedText, readSpreadsheetFile, type ImportResult, type RawSheets } from './importer';

type Opts = { name: string; startDate: string | null; localCurrency: string };
const opts: Opts = { name: '京都.xlsx', startDate: '2026-11-21', localCurrency: 'JPY' };
/** 一個工作表：第一列是標題 */
const one = (rows: unknown[][], name = '行程'): RawSheets => ({ [name]: rows });
const run = (rows: unknown[][], o: Partial<Opts> = {}) =>
  interpretSheets(one(rows), { ...opts, ...o });
/** xlsx 讀出來的日期是 UTC 午夜 */
const xlsxDate = (y: number, m: number, d: number, hh = 0, mm = 0) => new Date(Date.UTC(y, m - 1, d, hh, mm));

function mkTrip(patch: Partial<Trip> = {}): Trip {
  return {
    id: 't1', name: '測試', city: 'KYOTO', startDate: null, endDate: null, localCurrency: 'JPY', homeCurrency: 'TWD', rate: 0.21,
    members: ['我'], items: [], expenses: [], cover: { kind: 'orb', hue: 0 }, ai: { dayChecks: {} }, createdAt: 1, updatedAt: 1,
    ...patch,
  };
}
function mkItem(patch: Partial<Item> & Pick<Item, 'title'>): Item {
  return { id: Math.random().toString(36).slice(2), date: null, type: 'other', done: false, createdAt: 1, updatedAt: 1, ...patch };
}

afterEach(() => vi.useRealTimers());

describe('interpretSheets：欄位辨識', () => {
  it('讀取完整的行程表', () => {
    const r = run([
      ['日期', '時間', '行程', '類型', '地址', '備註', '費用', '連結', '停留時間', '評分'],
      ['2026-11-21', '09:30', '清水寺', '景點', '京都市東山區清水1-294', '早點去', '¥500', 'https://kiyomizudera.or.jp', '90', '4.5'],
    ]);
    expect(r.items).toEqual([
      {
        date: '2026-11-21', time: '09:30', title: '清水寺', type: 'sight', address: '京都市東山區清水1-294', note: '早點去',
        cost: 500, link: 'https://kiyomizudera.or.jp', durationMin: 90, rating: 4.5, done: false,
      },
    ]);
    expect(r.expenses).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.suggestedName).toBe('京都');
    expect(r.hasRelativeDays).toBe(false);
  });

  it('標題列不在第一列：往下找，並用上方的文字當行程名稱', () => {
    const r = interpretSheets(one([['京都五日遊'], [], ['日期', '景點名稱', '預估費用'], ['11/21', '金閣寺', '500']]), { name: '' , startDate: '2026-11-21' });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ title: '金閣寺', cost: 500, date: '2026-11-21' });
    expect(r.suggestedName).toBe('京都五日遊');
  });

  it('英文標題、大小寫不分、包含比對', () => {
    const r = run([
      ['Date', 'Start Time', 'Place Name', 'Category', 'Location', 'Notes', 'Total Price', 'Google Maps URL'],
      ['2026-11-22', '10:00', 'Fushimi Inari', 'sight', 'Fushimi', 'go early', '0', 'https://maps.app.goo.gl/x'],
    ]);
    expect(r.items[0]).toMatchObject({
      date: '2026-11-22', time: '10:00', title: 'Fushimi Inari', type: 'sight', address: 'Fushimi', note: 'go early', cost: 0,
      link: 'https://maps.app.goo.gl/x',
    });
  });

  it('中文複合欄名取最後的詞：「行程類型」是類型、「停留(分)」是停留、「出發地」不是時間', () => {
    const r = run([
      ['行程名稱', '行程類型', '停留(分)', '出發地', '店家地址'],
      ['一蘭拉麵', '餐廳', '45', '京都站', '四條河原町'],
    ]);
    expect(r.items[0]).toMatchObject({ title: '一蘭拉麵', type: 'food', durationMin: 45, address: '四條河原町' });
    expect(r.items[0].time).toBeUndefined();
  });

  it('找不到標題列的工作表會略過並提醒', () => {
    const r = interpretSheets({ 封面: [['京都'], ['2026']], 行程: [['日期', '行程'], ['11/21', '清水寺']] }, opts);
    expect(r.items).toHaveLength(1);
    expect(r.warnings.some((w) => w.includes('「封面」') && w.includes('略過'))).toBe(true);
  });

  it('只有一個欄位相符不算標題列', () => {
    const r = run([['行程'], ['清水寺']]);
    expect(r.items).toEqual([]);
    expect(r.warnings[0]).toContain('找不到欄位名稱列');
  });

  it('完全沒有資料時提示檢查欄位名稱', () => {
    const r = interpretSheets({ 行程: [] }, opts);
    expect(r.items).toEqual([]);
    expect(r.warnings[0]).toContain('找不到可以匯入的資料');
  });
});

describe('interpretSheets：日期', () => {
  const dates = (cells: unknown[], o: { startDate?: string | null } = {}) =>
    run([['日期', '行程'], ...cells.map((c, k) => [c, `站${k}`])], o).items.map((i) => i.date);

  it('xlsx 的 Date 物件（UTC 午夜）不受時區影響', () => {
    expect(dates([xlsxDate(2026, 11, 21), xlsxDate(2027, 1, 2)])).toEqual(['2026-11-21', '2027-01-02']);
  });

  it('程式建立的當地午夜 Date 也正確', () => {
    expect(dates([new Date(2026, 10, 23)])).toEqual(['2026-11-23']);
  });

  it('Excel 日期序號', () => {
    expect(dates([46000, 46347, '46347'])).toEqual(['2025-12-09', '2026-11-21', '2026-11-21']);
  });

  it('各種文字格式', () => {
    expect(
      dates(['2026-11-21', '2026/11/22', '2026/1/3', '2026年11月24日', '2026.11.25', '11/26', '11月27日', '11/28（六）', '11/29/2026', '30/11/2026', '２０２６－１２－０１']),
    ).toEqual(['2026-11-21', '2026-11-22', '2026-01-03', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01']);
  });

  it('沒寫年份時取出發日的年份，跨年也正確', () => {
    expect(dates(['12/30', '12/31', '1/1', '1/2'], { startDate: '2026-12-30' })).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  });

  it('沒寫年份也沒有出發日：用今年，已過很久的日期視為明年', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 9, 12));
    expect(dates(['11/21'], { startDate: null })).toEqual(['2026-11-21']);
    expect(dates(['9/30'], { startDate: null })).toEqual(['2026-09-30']);
    expect(dates(['1/5'], { startDate: null })).toEqual(['2027-01-05']);
  });

  it('不存在的日期當作沒有日期', () => {
    const r = run([['日期', '行程'], ['2026-02-30', '某處'], ['13/45', '某處2']]);
    expect(r.items.map((i) => i.date)).toEqual([null, null]);
    expect(r.warnings.some((w) => w.startsWith('2 個行程點沒有日期'))).toBe(true);
  });

  it('「未定」等文字代表沒有日期，不沿用上一列', () => {
    const r = run([['日期', '行程'], ['11/21', 'a'], ['未定', 'b'], ['待定', 'c']]);
    expect(r.items.map((i) => i.date)).toEqual(['2026-11-21', null, null]);
  });

  it('空白日期沿用上一列（合併儲存格），只有日期的列當作分隔', () => {
    const r = run([
      ['日期', '時間', '行程'],
      ['11/21', '09:00', '清水寺'],
      [null, '12:00', '午餐'],
      ['', '15:00', '八坂神社'],
      ['11/22', '', ''],
      [null, '08:00', '伏見稻荷'],
    ]);
    expect(r.items.map((i) => [i.date, i.title])).toEqual([
      ['2026-11-21', '清水寺'], ['2026-11-21', '午餐'], ['2026-11-21', '八坂神社'], ['2026-11-22', '伏見稻荷'],
    ]);
    expect(r.warnings).toEqual([]);
  });

  it('第 N 天：有出發日就換算', () => {
    const r = run([['日期', '行程'], ['第1天', 'a'], ['第二天', 'b'], ['Day 3', 'c'], ['D4', 'd'], ['5天', 'e'], [6, 'f'], ['第十天', 'g'], [null, 'h']]);
    expect(r.items.map((i) => i.date)).toEqual(['2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-30', '2026-11-30']);
    expect(r.items.every((i) => i.dayOffset === undefined)).toBe(true);
    expect(r.hasRelativeDays).toBe(false);
    expect(r.warnings.some((w) => w.includes('已依出發日 11/21'))).toBe(true);
  });

  it('第 N 天：沒有出發日就記下天數，等設定出發日再換算', () => {
    const r = run([['天', '行程'], ['Day 1', 'a'], [null, 'b'], ['Day 2', 'c']], { startDate: null });
    expect(r.items.map((i) => [i.date, i.dayOffset])).toEqual([[null, 1], [null, 1], [null, 2]]);
    expect(r.hasRelativeDays).toBe(true);
    expect(r.warnings.some((w) => w.includes('設定出發日後'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('沒有日期'))).toBe(false);
  });

  it('日期格內附時間：沒有時間欄時採用', () => {
    const r = run([['日期時間', '行程'], ['2026/11/21 14:30', '茶屋'], [xlsxDate(2026, 11, 22, 9, 15), '早餐']]);
    expect(r.items.map((i) => [i.date, i.time])).toEqual([['2026-11-21', '14:30'], ['2026-11-22', '09:15']]);
  });
});

describe('interpretSheets：時間', () => {
  const times = (cells: unknown[]) => run([['日期', '時間', '行程'], ...cells.map((c, k) => ['11/21', c, `站${k}`])]).items.map((i) => i.time);

  it('xlsx Date 物件與一天的比例', () => {
    // 套件把 0.395833 轉成 1899-12-30T09:29:59.999Z
    expect(times([new Date(Math.floor((0.3958333 - 25569) * 86_400_000)), 0.395833, 0.75, xlsxDate(2026, 11, 21, 18, 5)])).toEqual(['09:30', '09:30', '18:00', '18:05']);
  });

  it('各種文字格式', () => {
    expect(times(['9:30', '09:30:00', '9時30分', '9點', '9點30', '9點半', '0930', 930, '1430', '７：４５', 8])).toEqual([
      '09:30', '09:30', '09:30', '09:00', '09:30', '09:30', '09:30', '09:30', '14:30', '07:45', '08:00',
    ]);
  });

  it('上午／下午與 AM／PM', () => {
    expect(times(['下午2:30', '上午 9:00', '2:30 PM', '12:15 AM', '晚上7點', '中午12點', '凌晨1點', '9am'])).toEqual([
      '14:30', '09:00', '14:30', '00:15', '19:00', '12:00', '01:00', '09:00',
    ]);
  });

  it('時間範圍：取開始時間並算出停留分鐘', () => {
    const r = run([['日期', '時間', '行程'], ['11/21', '09:30-11:00', '清水寺'], ['11/21', '13:00～14:15', '二年坂'], ['11/21', '23:30-00:30', '夜景']]);
    expect(r.items.map((i) => [i.time, i.durationMin])).toEqual([['09:30', 90], ['13:00', 75], ['23:30', 60]]);
  });

  it('看不懂的時間就留空', () => {
    expect(times(['待定', '25:00', '9:75', ''])).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe('interpretSheets：類型、數字與其他欄位', () => {
  it('類型欄：標籤、別名、英文', () => {
    const r = run([
      ['行程', '類型'],
      ['a', '景點'], ['b', '餐廳'], ['c', '吃'], ['d', '飯店'], ['e', '新幹線'], ['f', 'outlet'], ['g', '神社'], ['h', 'food'], ['i', '其他'], ['j', '咖啡'], ['k', 'Check-in'],
    ]);
    expect(r.items.map((i) => i.type)).toEqual(['sight', 'food', 'food', 'stay', 'transport', 'shop', 'sight', 'food', 'other', 'food', 'stay']);
  });

  it('沒有類型欄時從名稱推測', () => {
    const r = run([
      ['日期', '行程'],
      ['11/21', '清水寺'], ['11/21', '京都車站'], ['11/21', '午餐 一蘭拉麵'], ['11/21', '飯店 Check-in'], ['11/21', '心齋橋購物'], ['11/21', '伏見稻荷大社'], ['11/21', '朋友聚會'], ['11/21', '大阪城公園'],
    ]);
    expect(r.items.map((i) => i.type)).toEqual(['sight', 'transport', 'food', 'stay', 'shop', 'sight', 'other', 'sight']);
  });

  it('類型欄空白或看不懂時也從名稱推測', () => {
    const r = run([['行程', '類型'], ['金閣寺', ''], ['錦市場吃早餐', '???']]);
    expect(r.items.map((i) => i.type)).toEqual(['sight', 'food']);
  });

  it('費用去掉千分位與貨幣符號', () => {
    const r = run([['行程', '費用'], ['a', '¥1,200'], ['b', 'NT$300'], ['c', '1.2萬'], ['d', 3500], ['e', '約 800 円'], ['f', '免費']]);
    expect(r.items.map((i) => i.cost)).toEqual([1200, 300, 12000, 3500, 800, undefined]);
  });

  it('停留時間與評分', () => {
    const r = run([
      ['行程', '停留', '評分'],
      ['a', '1.5小時', '★★★★'], ['b', '1h30m', '8/10'], ['c', '45分', 4.5], ['d', '1:15', '9'], ['e', 120, ''],
    ]);
    expect(r.items.map((i) => [i.durationMin, i.rating])).toEqual([[90, 4], [90, 4], [45, 4.5], [75, 5], [120, undefined]]);
  });

  it('地點欄放的是網址時移到連結；www 開頭補上 https', () => {
    const r = run([['行程', '地點', '連結'], ['a', 'https://maps.app.goo.gl/abc', ''], ['b', '祇園', 'www.example.com']]);
    expect(r.items[0]).toMatchObject({ link: 'https://maps.app.goo.gl/abc' });
    expect(r.items[0].address).toBeUndefined();
    expect(r.items[1]).toMatchObject({ address: '祇園', link: 'https://www.example.com' });
  });

  it('沒有名稱的列略過並計數；合計列與範例列不匯入', () => {
    const r = run([['日期', '行程', '費用'], ['11/21', '', '500'], ['11/21', '清水寺', '500'], ['', '合計', '500'], ['11/21', '清水寺（範例）', '0']]);
    expect(r.items.map((i) => i.title)).toEqual(['清水寺']);
    expect(r.warnings).toContain('1 列沒有行程名稱，已略過。');
    expect(r.warnings.some((w) => w.includes('範例'))).toBe(true);
  });
});

describe('interpretSheets：記帳工作表', () => {
  it('依工作表名稱判斷，並正規化幣別、分類、付款人、分攤', () => {
    const r = interpretSheets(
      {
        行程: [['日期', '行程'], ['11/21', '清水寺']],
        記帳: [
          ['日期', '項目', '金額', '幣別', '分類', '付款人', '分攤'],
          ['11/21', '拉麵', '1,200', '', '餐飲', '小明', '全員'],
          ['11/21', '飯店', 'NT$3000', '', '', '小華', '小明、小華'],
          [null, '車票', 800, 'jpy', '交通', '小明', ''],
          ['11/22', '伴手禮', '25', '美金', '', '', ''],
          ['11/22', '門票', '600', '日幣', '', '小明', '小明,小華'],
          ['11/22', '', '300', '', '購物', '', ''],
        ],
      },
      opts,
    );
    expect(r.items).toHaveLength(1);
    expect(r.expenses).toEqual([
      { date: '2026-11-21', title: '拉麵', amount: 1200, currency: 'JPY', category: 'food', payer: '小明', split: [] },
      { date: '2026-11-21', title: '飯店', amount: 3000, currency: 'TWD', category: 'stay', payer: '小華', split: ['小明', '小華'] },
      { date: '2026-11-21', title: '車票', amount: 800, currency: 'JPY', category: 'transport', payer: '小明', split: [] },
      { date: '2026-11-22', title: '伴手禮', amount: 25, currency: 'USD', category: 'shop', payer: '', split: [] },
      { date: '2026-11-22', title: '門票', amount: 600, currency: 'JPY', category: 'ticket', payer: '小明', split: ['小明', '小華'] },
      { date: '2026-11-22', title: '購物', amount: 300, currency: 'JPY', category: 'shop', payer: '', split: [] },
    ]);
  });

  it('合計列不匯入（不論寫在哪一欄）', () => {
    const r = interpretSheets(one([['日期', '項目', '金額'], ['11/21', '拉麵', '1200'], ['合計', '', '1200'], ['', '總計', '1200']], '記帳'), opts);
    expect(r.expenses.map((e) => e.title)).toEqual(['拉麵']);
  });

  it('依內容判斷（有金額＋幣別、沒有時間與地址）', () => {
    const r = interpretSheets(one([['Date', 'Item', 'Amount', 'Currency', 'Category'], ['2026-11-21', 'Taxi', '2400', 'JPY', 'transport']], 'Sheet2'), opts);
    expect(r.items).toEqual([]);
    expect(r.expenses[0]).toMatchObject({ title: 'Taxi', amount: 2400, currency: 'JPY', category: 'transport' });
  });

  it('「旅途手帳」不是記帳工作表', () => {
    const r = interpretSheets(one([['日期', '行程', '費用'], ['11/21', '清水寺', '500']], '旅途手帳'), opts);
    expect(r.items).toHaveLength(1);
    expect(r.expenses).toHaveLength(0);
  });

  it('沒有金額略過；沒有日期記在出發日；預設幣別 JPY', () => {
    const r = interpretSheets(one([['日期', '項目', '金額'], ['', '咖啡', '450'], ['11/23', '沒金額', ''], ['11/23', '計程車', '980']], '支出'), {
      name: 'x', startDate: '2026-11-21',
    });
    expect(r.expenses.map((e) => [e.date, e.title, e.currency, e.category])).toEqual([
      ['2026-11-21', '咖啡', 'JPY', 'food'], ['2026-11-23', '計程車', 'JPY', 'transport'],
    ]);
    expect(r.warnings).toContain('1 列花費沒有金額，已略過。');
    expect(r.warnings.some((w) => w.startsWith('1 筆花費沒有日期，先記在 11/21'))).toBe(true);
  });

  it('預設幣別跟著行程的當地貨幣', () => {
    const r = interpretSheets(one([['日期', '項目', '金額'], ['11/21', '炸雞', '18000']], '記帳'), { ...opts, localCurrency: 'krw' });
    expect(r.expenses[0].currency).toBe('KRW');
  });

  it('記帳的第 N 天也會換算', () => {
    const r = interpretSheets(one([['日期', '項目', '金額'], ['第2天', '早餐', '600']], '記帳'), opts);
    expect(r.expenses[0].date).toBe('2026-11-22');
  });
});

describe('readPastedText', () => {
  it('從 Google 試算表／Excel 複製的 TSV（含換行儲存格）', () => {
    const raw = readPastedText('日期\t時間\t行程\t備註\r\n11/21\t09:30\t清水寺\t"早點去\n人比較少"\r\n\t12:00\t午餐\t\r\n');
    expect(Object.keys(raw)).toEqual(['行程']);
    expect(raw['行程']).toEqual([
      ['日期', '時間', '行程', '備註'],
      ['11/21', '09:30', '清水寺', '早點去\n人比較少'],
      ['', '12:00', '午餐', ''],
    ]);
    const r = interpretSheets(raw, opts);
    expect(r.items.map((i) => [i.date, i.time, i.title, i.note])).toEqual([
      ['2026-11-21', '09:30', '清水寺', '早點去\n人比較少'], ['2026-11-21', '12:00', '午餐', undefined],
    ]);
  });

  it('CSV（含引號、逗號與 BOM）', () => {
    const raw = readPastedText('\uFEFF日期,行程,地址\n2026-11-21,"金閣寺, 鹿苑寺",北區\n\n\n');
    expect(raw['行程']).toEqual([['日期', '行程', '地址'], ['2026-11-21', '金閣寺, 鹿苑寺', '北區']]);
  });

  it('空白文字回傳空工作表', () => {
    expect(readPastedText('   \n')).toEqual({ 行程: [] });
  });
});

describe('readSpreadsheetFile', () => {
  it('.xls 舊格式給出另存新檔的說明', async () => {
    await expect(readSpreadsheetFile(new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])], '行程.xls'))).rejects.toThrow(/另存為.*\.xlsx/);
  });

  it('Numbers 檔給出輸出成 Excel 的說明', async () => {
    await expect(readSpreadsheetFile(new File(['x'], '行程.numbers'))).rejects.toThrow(/Numbers/);
  });

  it('CSV：工作表名稱為檔名', async () => {
    const raw = await readSpreadsheetFile(new File(['日期,行程\n11/21,清水寺\n'], '京都記帳.csv', { type: 'text/csv' }));
    expect(raw).toEqual({ 京都記帳: [['日期', '行程'], ['11/21', '清水寺']] });
  });

  it('TSV 檔', async () => {
    const raw = await readSpreadsheetFile(new File(['日期\t行程\n11/21\t清水寺'], 'a.tsv'));
    expect(raw['a']).toEqual([['日期', '行程'], ['11/21', '清水寺']]);
  });

  it('Windows Excel 存的 Big5 CSV 也能讀', async () => {
    const big5 = new Uint8Array([0xa4, 0xe9, 0xb4, 0xc1, 0x2c, 0xa6, 0xe6, 0xb5, 0x7b, 0x0a, 0x31, 0x31, 0x2f, 0x32, 0x31, 0x2c, 0x41]);
    const raw = await readSpreadsheetFile(new File([big5], 'big5.csv'));
    expect(raw['big5']).toEqual([['日期', '行程'], ['11/21', 'A']]);
  });
});

describe('applyImport', () => {
  const result = (patch: Partial<ImportResult> = {}): ImportResult => ({
    items: [], expenses: [], warnings: [], hasRelativeDays: false, suggestedName: '匯入的行程', ...patch,
  });

  it('new：建立新行程，給新 id 與時間戳，日期涵蓋所有行程點', () => {
    const base = mkTrip({ name: '' });
    const t = applyImport(
      base,
      result({
        items: [
          { date: '2026-11-22', title: 'b', type: 'sight', done: false },
          { date: '2026-11-21', title: 'a', type: 'food', done: false },
        ],
        expenses: [{ date: '2026-11-21', title: '拉麵', amount: 1200, currency: 'JPY', category: 'food', payer: '', split: [] }],
        suggestedName: '京都',
      }),
      'new',
    );
    expect(t.name).toBe('京都');
    expect(t.startDate).toBe('2026-11-21');
    expect(t.endDate).toBe('2026-11-22');
    expect(t.items.map((i) => i.title)).toEqual(['b', 'a']);
    expect(new Set(t.items.map((i) => i.id)).size).toBe(2);
    expect(t.items.every((i) => i.id && i.createdAt > 1 && i.updatedAt > 1)).toBe(true);
    expect(t.expenses[0]).toMatchObject({ payer: '我', amount: 1200 });
    expect(t.expenses[0].id).toBeTruthy();
    expect(base.items).toEqual([]); // 不修改傳入的行程
  });

  it('new：有出發日時換算第 N 天；沒有就保留天數', () => {
    const r = result({ items: [{ date: null, dayOffset: 3, title: 'c', type: 'other', done: false }] });
    const withStart = applyImport(mkTrip({ startDate: '2026-11-21' }), r, 'new');
    expect(withStart.items[0].date).toBe('2026-11-23');
    expect(withStart.items[0].dayOffset).toBeUndefined();
    expect(withStart.endDate).toBe('2026-11-23');
    const noStart = applyImport(mkTrip(), r, 'new');
    expect(noStart.items[0]).toMatchObject({ date: null, dayOffset: 3 });
    expect(noStart.startDate).toBeNull();
  });

  it('new：預設成員「我」換成試算表的付款人', () => {
    const t = applyImport(
      mkTrip(),
      result({
        expenses: [
          { date: '2026-11-21', title: 'a', amount: 1, currency: 'JPY', category: 'food', payer: '小明', split: ['小明', '小華'] },
          { date: '2026-11-21', title: 'b', amount: 2, currency: 'JPY', category: 'food', payer: '', split: [] },
        ],
      }),
      'new',
    );
    expect(t.members).toEqual(['小明', '小華']);
    expect(t.expenses.map((e) => e.payer)).toEqual(['小明', '小明']);
  });

  it('append：保留原本的資料再加上新的，並擴大日期範圍', () => {
    const old = mkItem({ title: '舊', date: '2026-11-21' });
    const base = mkTrip({ startDate: '2026-11-21', endDate: '2026-11-22', members: ['我', '旅伴'], items: [old] });
    const t = applyImport(
      base,
      result({
        items: [{ date: '2026-11-25', title: '新', type: 'sight', done: false }],
        expenses: [{ date: '2026-11-21', title: 'x', amount: 5, currency: 'JPY', category: 'other', payer: '阿姨', split: [] }],
      }),
      'append',
    );
    expect(t.items.map((i) => i.title)).toEqual(['舊', '新']);
    expect(t.items[0]).toEqual(old);
    expect(t.endDate).toBe('2026-11-25');
    expect(t.members).toEqual(['我', '旅伴', '阿姨']);
  });

  it('replace：以試算表為準，保留已完成、座標與 id；清掉 AI 檢查', () => {
    const done = mkItem({ id: 'keep1', title: '清水寺', date: '2026-11-21', done: true, address: '清水', geo: { lat: 1, lng: 2, source: 'geocode' } });
    const moved = mkItem({ id: 'keep2', title: '金閣寺', date: '2026-11-22', done: true, address: '北區', geo: { lat: 3, lng: 4, source: 'geocode' } });
    const undated = mkItem({ id: 'keep3', title: '買伴手禮', date: null, done: true });
    const gone = mkItem({ id: 'gone', title: '被刪掉的', date: '2026-11-21' });
    const relocated = mkItem({ id: 'keep4', title: '晚餐', date: '2026-11-21', geo: { lat: 5, lng: 6, source: 'geocode' }, address: '先斗町' });
    const base = mkTrip({
      startDate: '2026-11-21', endDate: '2026-11-22', items: [done, moved, undated, gone, relocated],
      ai: { dayChecks: { '2026-11-21': { at: 1, itemIds: ['keep1'], segments: [], warnings: [] } } },
    });
    const t = applyImport(
      base,
      result({
        items: [
          { date: '2026-11-21', title: '清水寺', type: 'sight', done: false, time: '09:00' },
          { date: '2026-11-23', title: '金閣寺', type: 'sight', done: false }, // 換了日期 → 視為新的一站
          { date: null, title: '買伴手禮', type: 'shop', done: false },
          { date: '2026-11-21', title: '晚餐', type: 'food', done: false, address: '祇園' }, // 地址改了 → 不沿用座標
        ],
      }),
      'replace',
    );
    expect(t.items.map((i) => i.title)).toEqual(['清水寺', '金閣寺', '買伴手禮', '晚餐']);
    expect(t.items[0]).toMatchObject({ id: 'keep1', done: true, time: '09:00', geo: { lat: 1, lng: 2 } });
    expect(t.items[1].id).not.toBe('keep2');
    expect(t.items[1].done).toBe(false);
    expect(t.items[2]).toMatchObject({ id: 'keep3', done: true, type: 'shop' });
    expect(t.items[3]).toMatchObject({ id: 'keep4', address: '祇園' });
    expect(t.items[3].geo).toBeUndefined();
    expect(t.ai.dayChecks).toEqual({});
    expect(t.endDate).toBe('2026-11-23');
  });

  it('replace：花費只加入還沒有的（同日期＋名稱＋金額）', () => {
    const now = 1;
    const base = mkTrip({
      expenses: [
        { id: 'e1', date: '2026-11-21', title: '拉麵', amount: 1200, currency: 'JPY', category: 'food', payer: '我', split: [], createdAt: now, updatedAt: now },
        { id: 'e2', date: '2026-11-21', title: '咖啡', amount: 500, currency: 'JPY', category: 'food', payer: '我', split: [], createdAt: now, updatedAt: now },
      ],
    });
    const ex = (title: string, amount: number, date = '2026-11-21') => ({ date, title, amount, currency: 'JPY', category: 'food' as const, payer: '我', split: [] });
    const t = applyImport(base, result({ expenses: [ex('拉麵', 1200), ex('咖啡', 500), ex('咖啡', 500), ex('拉麵', 1300), ex('拉麵', 1200, '2026-11-22')] }), 'replace');
    expect(t.expenses.map((e) => `${e.date} ${e.title} ${e.amount}`)).toEqual([
      '2026-11-21 拉麵 1200', '2026-11-21 咖啡 500', '2026-11-21 咖啡 500', '2026-11-21 拉麵 1300', '2026-11-22 拉麵 1200',
    ]);
    expect(t.expenses.slice(0, 2).map((e) => e.id)).toEqual(['e1', 'e2']);
  });
});
