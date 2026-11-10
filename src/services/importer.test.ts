import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { Expense, Item, Trip } from '@/domain/types';
import { applyImport, interpretSheets, readPastedText, readSpreadsheetFile, replaceRemovals, resolveDayKeys, suggestTripCity, type ImportResult, type RawSheets } from './importer';

// 在台灣時區跑：UTC 時區會藏住「16:00Z 剛好是台北午夜」這類問題
const ORIGINAL_TZ = process.env.TZ;
process.env.TZ = 'Asia/Taipei';
afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

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
        cost: 500, link: 'https://kiyomizudera.or.jp', durationMin: 90, rating: 4.5, done: false, seq: 0,
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

  it('沒有名稱欄時「地點」就是行程名稱', () => {
    const a = run([['日期', '時間', '地點', '備註'], ['11/21', '09:00', '清水寺', '早點去'], ['11/21', '12:00', '錦市場', '']]);
    expect(a.items.map((i) => [i.title, i.time, i.note, i.address])).toEqual([['清水寺', '09:00', '早點去', undefined], ['錦市場', '12:00', undefined, undefined]]);
    expect(a.warnings).toEqual([]);
    const b = run([['Date', 'Time', 'Place', 'Notes'], ['2026-11-22', '10:00', 'Fushimi Inari', 'go early']]);
    expect(b.items[0]).toMatchObject({ title: 'Fushimi Inari', time: '10:00', note: 'go early' });
    // 另外還有地址欄：地點是名稱、地址是地址
    const c = run([['日期', '地點', '地址'], ['11/21', '金閣寺', '京都市北區金閣寺町1']]);
    expect(c.items[0]).toMatchObject({ title: '金閣寺', address: '京都市北區金閣寺町1' });
    // 有費用欄也照樣匯入成行程點（不會因為「沒有名稱」整列略過）
    const d = run([['日期', '時間', '地點', '費用'], ['11/21', '09:00', '清水寺', '500'], ['11/21', '13:00', '二年坂', '']]);
    expect(d.items.map((i) => [i.title, i.cost])).toEqual([['清水寺', 500], ['二年坂', undefined]]);
    expect(d.expenses).toEqual([]);
    expect(d.warnings).toEqual([]);
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

  it('台北 16:00、東京 15:00（剛好是當地午夜）的日期時間不會跳到隔天', () => {
    for (const tz of ['Asia/Taipei', 'Asia/Tokyo', 'America/Los_Angeles']) {
      process.env.TZ = tz;
      expect(dates([xlsxDate(2026, 11, 21, 15, 0), xlsxDate(2026, 11, 21, 16, 0), 46347.667])).toEqual(['2026-11-21', '2026-11-21', '2026-11-21']);
      const r = run([['日期時間', '行程'], [xlsxDate(2026, 11, 21, 16, 0), '晚餐'], [xlsxDate(2026, 11, 22, 15, 0), '夜景']]);
      expect(r.items.map((i) => [i.title, i.date, i.time])).toEqual([['晚餐', '2026-11-21', '16:00'], ['夜景', '2026-11-22', '15:00']]);
    }
    process.env.TZ = 'Asia/Taipei';
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

  it('只有時間的 xlsx 儲存格在 15:00、16:00 也正確（各時區）', () => {
    for (const tz of ['Asia/Taipei', 'Asia/Tokyo']) {
      process.env.TZ = tz;
      expect(times([xlsxDate(1899, 12, 30, 16, 0), xlsxDate(1899, 12, 30, 15, 0), xlsxDate(2026, 11, 21, 16, 0)])).toEqual(['16:00', '15:00', '16:00']);
    }
    process.env.TZ = 'Asia/Taipei';
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

  it('幣別常見寫法（NTD、RMB、yen）換成正式代碼；不是幣別的三個字母改用預設幣別', () => {
    const r = interpretSheets(
      one([['日期', '項目', '金額', '幣別'], ['11/21', 'a', 100, 'NTD'], ['11/21', 'b', 100, 'ntd'], ['11/21', 'c', 100, 'RMB'], ['11/21', 'd', 100, 'yen'], ['11/21', 'e', 100, 'Yen'], ['11/21', 'f', 100, 'krw'], ['11/21', 'g', 100, 'abc']], '記帳'),
      opts,
    );
    expect(r.expenses.map((e) => e.currency)).toEqual(['TWD', 'TWD', 'CNY', 'JPY', 'JPY', 'KRW', 'JPY']);
  });

  it('沒用工作表名稱標明時看欄位：有付款人、分攤就是記帳（不需要幣別欄）', () => {
    const r = interpretSheets(
      one([['日期', '項目', '金額', '付款人', '分攤'], ['11/21', '拉麵', '1200', '小明', '小明、小華'], ['11/21', '計程車', '980', '小華', '']], '工作表1'),
      opts,
    );
    expect(r.items).toEqual([]);
    expect(r.expenses.map((e) => [e.title, e.amount, e.payer, e.split])).toEqual([['拉麵', 1200, '小明', ['小明', '小華']], ['計程車', 980, '小華', []]]);
    expect(r.warnings).toEqual([]);
  });

  it('從試算表貼上的記帳（日期 項目 金額 分類 付款人）', () => {
    const r = interpretSheets(readPastedText('日期\t項目\t金額\t分類\t付款人\n11/21\t拉麵\t1200\t餐飲\t小明\n'), opts);
    expect(r.items).toEqual([]);
    expect(r.expenses[0]).toMatchObject({ title: '拉麵', amount: 1200, category: 'food', payer: '小明' });
  });

  it('日期 景點 費用 幣別：有幣別欄也還是行程表', () => {
    const r = interpretSheets(one([['日期', '景點', '費用', '幣別'], ['11/21', '清水寺', '500', 'JPY'], ['11/22', '伏見稻荷', '0', 'JPY']], '京都'), opts);
    expect(r.items.map((i) => [i.title, i.cost])).toEqual([['清水寺', 500], ['伏見稻荷', 0]]);
    expect(r.expenses).toEqual([]);
  });

  it('判斷可能錯的時候提醒（行程表有付款人欄、記帳有「行程」欄）', () => {
    const a = interpretSheets(one([['日期', '時間', '行程', '地址', '費用', '付款人'], ['11/21', '09:00', '清水寺', '東山區', '500', '小明']], '工作表1'), opts);
    expect(a.items).toHaveLength(1);
    expect(a.warnings.some((w) => w.includes('工作表「工作表1」有付款人或分攤欄位') && w.includes('「記帳」'))).toBe(true);
    const b = interpretSheets(one([['日期', '行程', '費用', '付款人', '分攤'], ['11/21', '午餐', '1200', '小明', '']]), opts);
    expect(b.expenses).toHaveLength(1);
    expect(b.warnings.some((w) => w.startsWith('這張表有「行程」欄，像是行程表'))).toBe(true);
    // 工作表名稱寫明是記帳：不提醒
    const c = interpretSheets(one([['日期', '行程', '費用', '付款人'], ['11/21', '午餐', '1200', '小明']], '記帳'), opts);
    expect(c.warnings).toEqual([]);
  });

  it('分攤：有分隔符號時名字裡的空白保留；只用空白分開時拆開（但認得付款人與成員的全名）', () => {
    const r = interpretSheets(
      one(
        [
          ['日期', '項目', '金額', '付款人', '分攤'],
          ['11/21', 'a', 1, 'Amy Chen', 'Amy Chen、Bob Lin'],
          ['11/21', 'b', 1, 'Bob Lin', '小明 小華'],
          ['11/21', 'c', 1, '小明', 'Amy Chen'],
          ['11/21', 'd', 1, '小明', 'Cara Wu'],
        ],
        '記帳',
      ),
      { ...opts, members: ['Cara Wu'] },
    );
    expect(r.expenses.map((e) => e.split)).toEqual([['Amy Chen', 'Bob Lin'], ['小明', '小華'], ['Amy Chen'], ['Cara Wu']]);
    // 匯出再匯入不會多出假的成員
    const t = applyImport(mkTrip({ members: ['Amy Chen', 'Bob Lin', '小明', '小華', 'Cara Wu'] }), r, 'append');
    expect(t.members).toEqual(['Amy Chen', 'Bob Lin', '小明', '小華', 'Cara Wu']);
  });

  it('新行程還沒有出發日：記帳的「第 N 天」與沒寫日期的先空著，建立行程時依出發日換算', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 10, 12));
    const raw = {
      行程: [['日期', '行程'], ['第1天', '清水寺'], ['第2天', '伏見稻荷']],
      記帳: [['日期', '項目', '金額'], ['', '交通卡', '2000'], ['第2天', '午餐', '1200']],
    };
    const r = interpretSheets(raw, { ...opts, startDate: null });
    expect(r.expenses.map((e) => [e.date, e.dayOffset])).toEqual([[null, undefined], [null, 2]]);
    expect(r.warnings).toContain('1 筆花費沒有日期，先記在出發日。');
    const t = applyImport(mkTrip({ startDate: '2027-03-01' }), r, 'new');
    expect(t.items.map((i) => i.date)).toEqual(['2027-03-01', '2027-03-02']);
    expect(t.expenses.map((e) => [e.title, e.date])).toEqual([['交通卡', '2027-03-01'], ['午餐', '2027-03-02']]);
    expect(t.expenses.every((e) => !('dayOffset' in e))).toBe(true);
    // 沒填出發日：沒有日期可依的時候才用今天
    const noStart = applyImport(mkTrip(), r, 'new');
    expect(noStart.expenses.map((e) => e.date)).toEqual(['2026-11-10', '2026-11-11']);
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
    // 原本的行程點不動，只補上規則版的導航目的地
    const { place, ...rest } = t.items[0];
    expect(rest).toEqual(old);
    expect(place).toMatchObject({ query: expect.stringMatching(/^舊/), source: 'rule' });
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

  it('replace：沒有標記的舊花費完全相同時不重複加入（同日期＋名稱＋金額＋幣別）', () => {
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
    expect(t.expenses.every((e) => e.fromSheet)).toBe(true);
  });

  describe('replace：花費以試算表為準', () => {
    const exp = (id: string, title: string, amount: number, patch: Partial<Expense> = {}): Expense => ({
      id, date: '2026-11-21', title, amount, currency: 'JPY', category: 'food', payer: '小明', split: [], createdAt: 1, updatedAt: 1, fromSheet: true, ...patch,
    });
    const sheet = (rows: unknown[][]) =>
      interpretSheets({ 記帳: [['日期', '項目', '金額', '幣別', '付款人'], ...rows] }, opts);
    const base = (expenses: Expense[]) => mkTrip({ startDate: '2026-11-21', members: ['小明', '小華'], expenses });

    it('試算表改了金額：更新原本那筆（保留 id、收據），不會多一筆', () => {
      const t = applyImport(base([exp('e1', '晚餐', 10000, { receiptBlobKey: 'r1' })]), sheet([['11/21', '晚餐', '1000', 'JPY', '小明']]), 'replace');
      expect(t.expenses.map((e) => [e.id, e.title, e.amount, e.receiptBlobKey])).toEqual([['e1', '晚餐', 1000, 'r1']]);
      expect(t.expenses[0].updatedAt).toBeGreaterThan(1);
    });

    it('沒有變的花費原封不動', () => {
      const e1 = exp('e1', '晚餐', 1000);
      const t = applyImport(base([e1]), sheet([['11/21', '晚餐', '1000', 'JPY', '小明']]), 'replace');
      expect(t.expenses).toEqual([e1]);
    });

    it('試算表刪掉的列移除；App 裡記的花費保留', () => {
      const app = exp('app', '咖啡', 450, { fromSheet: undefined });
      const before = base([exp('e1', '晚餐', 1000), exp('e2', '午餐', 800), app]);
      const t = applyImport(before, sheet([['11/21', '晚餐', '1000', 'JPY', '小明']]), 'replace');
      expect(t.expenses.map((e) => e.id)).toEqual(['e1', 'app']);
      expect(t.expenses[1]).toEqual(app);
      // 確認畫面可以事先列出會被移除的
      expect(replaceRemovals(before, t).expenses.map((e) => e.title)).toEqual(['午餐']);
      expect(replaceRemovals(before, t).items).toEqual([]);
    });

    it('同名稱但幣別不同是兩筆，不會合併', () => {
      const r = sheet([['11/21', '午餐', '1000', 'JPY', '小明'], ['11/21', '午餐', '1000', 'TWD', '小明']]);
      const first = applyImport(base([]), r, 'replace');
      expect(first.expenses.map((e) => `${e.amount} ${e.currency}`)).toEqual(['1000 JPY', '1000 TWD']);
      const again = applyImport(first, r, 'replace');
      expect(again.expenses.map((e) => e.id)).toEqual(first.expenses.map((e) => e.id));
      // App 裡記的同名、不同幣別：不當成試算表那筆
      const app = exp('app', '午餐', 1000, { currency: 'TWD', fromSheet: undefined });
      const t = applyImport(base([app]), sheet([['11/21', '午餐', '1000', 'JPY', '小明']]), 'replace');
      expect(t.expenses.map((e) => [e.id === 'app', e.currency])).toEqual([[true, 'TWD'], [false, 'JPY']]);
    });

    it('試算表沒寫付款人、沒有分攤欄：保留 App 裡的付款人與分攤', () => {
      const old = exp('e1', '晚餐', 1000, { payer: '小華', split: ['小華'] });
      const t = applyImport(base([old]), sheet([['11/21', '晚餐', '1200', 'JPY', '']]), 'replace');
      expect(t.expenses[0]).toMatchObject({ id: 'e1', amount: 1200, payer: '小華', split: ['小華'] });
    });

    it('試算表沒有任何花費（只有行程表）時，不移除花費', () => {
      const r = interpretSheets(one([['日期', '行程'], ['11/21', '清水寺']]), opts);
      const t = applyImport(base([exp('e1', '晚餐', 1000)]), r, 'replace');
      expect(t.expenses.map((e) => e.id)).toEqual(['e1']);
    });
  });

  it('replace：試算表沒有的欄位保留 App 裡填的備註、停留、評分、連結、時間、類型', () => {
    const old = mkItem({
      id: 'k', title: '清水寺', date: '2026-11-21', type: 'food', note: '我在 App 裡寫的筆記', durationMin: 90, rating: 4,
      link: 'https://example.com', time: '09:00', cost: 400,
    });
    const keep = applyImport(mkTrip({ items: [old] }), run([['日期', '行程'], ['11/21', '清水寺']]), 'replace');
    expect(keep.items[0]).toMatchObject({ id: 'k', type: 'food', note: '我在 App 裡寫的筆記', durationMin: 90, rating: 4, link: 'https://example.com', time: '09:00', cost: 400 });
    // 試算表有這一欄：照試算表（填了就更新，空白就清掉）
    const sheet = run([['日期', '時間', '行程', '類型', '備註', '評分'], ['11/21', '10:00', '清水寺', '景點', '', '5']]);
    const upd = applyImport(mkTrip({ items: [old] }), sheet, 'replace');
    expect(upd.items[0]).toMatchObject({ id: 'k', time: '10:00', type: 'sight', rating: 5, durationMin: 90 });
    expect(upd.items[0].note).toBeUndefined();
  });
});

// ───────────────────────── 真實格式：手排的多城市行程表 ─────────────────────────
// 合成資料，結構仿照使用者實際的 Google 試算表：標題列第一格是圖例＋第一天的日期列、欄名後面有空白、
// 日期列只寫在 A 欄、行程列的日期欄空白（偶爾是一句旁註）、★ ◇ 標記、「地點 / 交通」欄混著地址／地點／路線／交通說明。
const LEGEND = '★ = 一定要去 ◇ = 有空再去 ⚠ = 要留意 時間都是當地時間 日期 12/10（四）｜台北 → 舊金山｜住 Harbor View Inn';
const HEAD = [LEGEND, '時間 ', '分類 ', '行程內容 ', '地點 / 交通 ', '預估費用 ', '備註 '];
const banner = (text: string) => [text, '', '', '', '', '', ''];
const REAL: unknown[][] = [
  HEAD,
  ['', '19:30', '機場', '★ 桃園機場報到', 'TPE T1', '', '提早到櫃檯'],
  ['', '23:55', '航班', '★ BR018 起飛（夜班機，777）', 'TPE → SFO', '已訂', ''],
  ['', '20:10', '交通', '★ 搭捷運進市區', 'SFO → Powell St', '$11', ''],
  ['', '21:00', '住宿', '★ Harbor View Inn check-in', '500 Market St', '已訂', '⚠ 押金 $100/晚'],
  ['', '21:40', '宵夜', '◇ 街角漢堡', '步行 5 分', '$12–18/人', '開到 22:30'],
  banner('12/11（五）｜舊金山 → 西雅圖｜住 Rainier Suites｜看球賽'),
  ['', '8:00', '早餐', '飯店早餐', 'Harbor View Inn', '', ''],
  ['登機門可能更動', '10:30', '航班', '★ AS123 SFO → SEA（2h05m）', 'SFO → SEA', '已訂', '⚠ 提早到'],
  ['', '14:00', '景點', '★★ 派克市場 Pike Place Market', '85 Pike St', '免費', ''],
  ['', '19:00', '賽事', '★ 主場棒球賽', '看台', '$45+稅', ''],
  ['', '23:20', '夜景', '◇ 太空針塔夜景', 'Space Needle', '$35–40', ''],
  ['', '0:30', '交通', '★ 輕軌回飯店', '回程', '$3 單程', ''],
  banner('12/12（六）｜雷尼爾山一日遊｜國家公園健行'),
  ['', '7:00', '出發', '★ 一日團集合', 'Rainier Suites', '$189/人', ''],
  ['', '12:00', '午餐', '山屋午餐（團體餐）', 'Paradise Inn', '含在團費', ''],
  ['', '16:00', '回程', '★ 回西雅圖', '驅車 90 mile', '', ''],
  banner('12/13（日）｜西雅圖 → 舊金山｜住 Bayside Lodge'),
  ['', '9:00', '租車', '★ 機場取車', '1 Rental Car Dr', '見費用表', ''],
  ['', '11:00', '停車', '★ 停碼頭停車場', "→ Fisherman's Wharf", '消費滿額免費 3hr', ''],
  ['', '13:00', '美術館', '★ 現代美術館', '151 3rd St', '$28/人（成人票）', ''],
  banner('12/14（一）｜舊金山｜金門大橋與回程'),
  ['', '10:00', '拍照', '★ 金門大橋', 'Golden Gate Bridge', '免費', ''],
];

describe('interpretSheets：真實格式（手排多城市行程表）', () => {
  const read = (local = 'JPY') => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 10, 12));
    return interpretSheets(one(REAL), { name: '', startDate: null, localCurrency: local });
  };
  const byTitle = (r: ImportResult, title: string) => r.items.find((i) => i.title.includes(title))!;

  it('標題格是圖例＋第一天的日期列：當作日期欄，標題列下面的行程點就是第一天', () => {
    const r = read();
    expect(r.items).toHaveLength(18);
    expect(r.items.every((i) => i.date)).toBe(true);
    expect(r.items.slice(0, 5).every((i) => i.date === '2026-12-10')).toBe(true);
    expect(r.days?.['2026-12-10']).toMatchObject({ label: '台北 → 舊金山｜住 Harbor View Inn', city: '舊金山', lodging: 'Harbor View Inn' });
    expect(r.warnings).toEqual([]);
    // 欄名有空白、圖例裡的「項目」「時間」不會搶走欄位
    expect(r.columns?.items.sort()).toEqual(['address', 'cost', 'date', 'note', 'time', 'title', 'type']);
  });

  it('日期列 → 每天的城市與住宿（多城市；認不出城市的照樣留原文）', () => {
    const r = read();
    expect(Object.keys(r.days ?? {})).toEqual(['2026-12-10', '2026-12-11', '2026-12-12', '2026-12-13', '2026-12-14']);
    expect(r.days?.['2026-12-11']).toMatchObject({ label: '舊金山 → 西雅圖｜住 Rainier Suites｜看球賽', cities: ['舊金山', '西雅圖'], city: '西雅圖', lodging: 'Rainier Suites' });
    expect(r.days?.['2026-12-12']?.label).toBe('雷尼爾山一日遊｜國家公園健行');
    expect(r.days?.['2026-12-13']).toMatchObject({ city: '舊金山', lodging: 'Bayside Lodge' });
    expect(r.days?.['2026-12-14']).toMatchObject({ city: '舊金山' });
    // 沒有檔名與標題：用依序過夜的城市當行程名稱
    expect(r.suggestedName).toBe('舊金山・西雅圖');
    // 日期列本身不是行程點
    expect(r.items.some((i) => i.title.includes('｜'))).toBe(false);
  });

  it('日期欄的旁註：日期沿用上一列，記進備註「提醒：…」', () => {
    const it = byTitle(read(), 'AS123');
    expect(it.date).toBe('2026-12-11');
    expect(it.note?.split('\n')).toEqual(['提醒：登機門可能更動', '補充：2h05m', '⚠ 提早到', '費用：已訂']);
  });

  it('★ ◇ 標記、類別原文當標籤並對應到類型', () => {
    const r = read();
    expect(byTitle(r, '桃園機場')).toMatchObject({ title: '桃園機場報到', flag: 'must', type: 'transport', tag: '機場' });
    expect(byTitle(r, '派克市場')).toMatchObject({ flag: 'must', type: 'sight' });
    expect(byTitle(r, '派克市場').tag).toBeUndefined(); // 「景點」就是標準類型名稱
    expect(byTitle(r, '街角漢堡')).toMatchObject({ title: '街角漢堡', flag: 'optional', type: 'food', tag: '宵夜' });
    expect(byTitle(r, '飯店早餐').flag).toBeUndefined();
    const types = Object.fromEntries(r.items.map((i) => [i.tag ?? i.type, i.type]));
    expect(types).toMatchObject({ 航班: 'transport', 賽事: 'sight', 夜景: 'sight', 出發: 'transport', 回程: 'transport', 租車: 'transport', 停車: 'transport', 美術館: 'sight', 拍照: 'sight', 午餐: 'food', stay: 'stay' });
    expect(r.items.filter((i) => i.flag === 'must')).toHaveLength(14);
    expect(r.items.filter((i) => i.flag === 'optional')).toHaveLength(2);
  });

  it('名稱清理時拿掉的補充（只有時間的括號、開頭的【二選一】）記進備註，資訊不會不見', () => {
    const r = read();
    expect(byTitle(r, 'AS123').title).toBe('AS123 SFO → SEA');
    expect(byTitle(r, 'AS123').note).toContain('補充：2h05m');
    // 有內容的括號留在名稱裡
    expect(byTitle(r, 'BR018')).toMatchObject({ title: 'BR018 起飛（夜班機，777）', note: '費用：已訂' });
    const x = run([['行程', '備註'], ['◇【二選一】夜間場（加場）（約 45 分鐘）', '看天氣']]);
    expect(x.items[0]).toMatchObject({ title: '夜間場（加場）', flag: 'optional', note: '補充：二選一；約 45 分鐘\n看天氣' });
  });

  it('「地點 / 交通」欄：地址、地點名稱 → 地址；A → B → 路線；交通說明與泛稱 → 交通說明', () => {
    const r = read();
    expect(byTitle(r, 'Harbor View Inn check-in').address).toBe('500 Market St');
    expect(byTitle(r, '飯店早餐').address).toBe('Harbor View Inn');
    expect(byTitle(r, 'BR018')).toMatchObject({ route: { from: 'TPE', to: 'SFO' } });
    expect(byTitle(r, 'BR018').address).toBeUndefined();
    expect(byTitle(r, '停碼頭停車場').route).toEqual({ from: '', to: "Fisherman's Wharf" });
    expect(byTitle(r, '街角漢堡')).toMatchObject({ transit: '步行 5 分' });
    expect(byTitle(r, '街角漢堡').address).toBeUndefined();
    expect(byTitle(r, '回西雅圖')).toMatchObject({ transit: '驅車 90 mile' });
    expect(byTitle(r, '主場棒球賽')).toMatchObject({ transit: '看台' });
    expect(byTitle(r, '主場棒球賽').address).toBeUndefined();
  });

  it('凌晨的時間照寫的留在當天，不重排', () => {
    const r = read();
    const i = r.items.findIndex((x) => x.title.includes('輕軌'));
    expect(r.items[i]).toMatchObject({ date: '2026-12-11', time: '00:30' });
    expect(r.items[i - 1].time).toBe('23:20');
  });

  it('預估花費：金額＋寫明的幣別，不只是金額的原文記進備註', () => {
    const r = read('JPY');
    const cost = (t: string) => [byTitle(r, t).cost, byTitle(r, t).costCurrency, byTitle(r, t).note?.split('\n').find((l) => l.startsWith('費用：'))];
    expect(cost('搭捷運')).toEqual([11, 'USD', undefined]);
    expect(cost('街角漢堡')).toEqual([12, 'USD', '費用：$12–18/人']);
    expect(cost('Harbor View Inn check-in')).toEqual([undefined, undefined, '費用：已訂']);
    expect(cost('派克市場')).toEqual([undefined, undefined, '費用：免費']);
    expect(cost('主場棒球賽')).toEqual([45, 'USD', '費用：$45+稅']);
    expect(cost('太空針塔')).toEqual([35, 'USD', '費用：$35–40']);
    expect(cost('輕軌')).toEqual([3, 'USD', '費用：$3 單程']);
    expect(cost('一日團')).toEqual([189, 'USD', '費用：$189/人']);
    expect(cost('山屋午餐')).toEqual([undefined, undefined, '費用：含在團費']);
    expect(cost('機場取車')).toEqual([undefined, undefined, '費用：見費用表']);
    expect(cost('停碼頭停車場')).toEqual([undefined, undefined, '費用：消費滿額免費 3hr']);
    expect(cost('現代美術館')).toEqual([28, 'USD', '費用：$28/人（成人票）']);
    // 當地貨幣本來就是美金：不另外記幣別
    expect(byTitle(read('USD'), '搭捷運')).toMatchObject({ cost: 11 });
    expect(byTitle(read('USD'), '搭捷運').costCurrency).toBeUndefined();
  });

  it('套用成新行程：當地貨幣跟著花費的幣別、城市用最常過夜的城市，每一站都有導航目的地', () => {
    const r = read();
    const t = applyImport(mkTrip({ name: '', city: '', localCurrency: 'JPY', rate: 0.21, rateUpdatedAt: 5 }), r, 'new');
    expect(t.localCurrency).toBe('USD');
    expect(t.rate).toBe(1);
    expect(t.rateUpdatedAt).toBeUndefined();
    expect(t.city).toBe('SAN FRANCISCO');
    expect(t.startDate).toBe('2026-12-10');
    expect(t.endDate).toBe('2026-12-14');
    expect(t.items.find((i) => i.title.includes('搭捷運'))).toMatchObject({ cost: 11 });
    expect(t.items.every((i) => !('costCurrency' in i))).toBe(true);
    expect(t.days?.['2026-12-11']).toMatchObject({ city: '西雅圖', lodging: 'Rainier Suites', source: 'rule' });
    expect(t.items.every((i) => i.place?.query && i.place.source === 'rule')).toBe(true);
  });
});

describe('interpretSheets：日期列的其他寫法', () => {
  it('「第 N 天｜城市」：沒有出發日時用 __D1 記下，套用時依出發日換算', () => {
    const rows = [['日期', '時間', '行程'], ['第1天｜東京', '', ''], ['', '09:00', '淺草寺'], ['Day 2 - 京都', '10:00', '清水寺']];
    const r = interpretSheets(one(rows), { ...opts, startDate: null });
    expect(Object.keys(r.days ?? {})).toEqual(['__D1', '__D2']);
    expect(r.days?.__D1?.label).toBe('東京');
    expect(r.days?.__D2?.label).toBe('京都');
    expect(r.items.map((i) => [i.title, i.dayOffset])).toEqual([['淺草寺', 1], ['清水寺', 2]]);
    const t = applyImport(mkTrip({ startDate: '2027-04-01' }), r, 'new');
    expect(Object.keys(t.days ?? {}).filter((k) => !k.startsWith('2027-04-0')).length).toBe(0);
    expect(t.days?.['2027-04-01']?.label).toBe('東京');
    expect(t.days?.['2027-04-02']?.label).toBe('京都');
    const noStart = applyImport(mkTrip(), r, 'new');
    expect(noStart.days?.__D1?.label).toBe('東京');
  });

  it('有出發日時直接換算成日期', () => {
    const r = interpretSheets(one([['日期', '行程'], ['第2天｜大阪', ''], ['', '道頓堀']]), opts);
    expect(Object.keys(r.days ?? {})).toEqual(['2026-11-22']);
  });

  it('只有日期（或日期＋星期、時間）的列不算日期列', () => {
    const r = run([['日期', '時間', '行程'], ['11/21（六）', '', ''], ['', '09:00', '清水寺'], ['2026/11/22 08:00', '', ''], ['', '', '伏見稻荷']]);
    expect(r.days).toBeUndefined();
    expect(r.items.map((i) => i.date)).toEqual(['2026-11-21', '2026-11-22']);
  });

  it('日期格寫著城市、同一列也有行程：照樣記成那天的日期列', () => {
    const r = run([['日期', '時間', '行程'], ['11/21 京都', '09:00', '清水寺'], ['11/21 京都', '12:00', '錦市場']]);
    expect(r.days?.['2026-11-21']?.label).toBe('京都');
    expect(r.items).toHaveLength(2);
  });

  it('同一天有兩個日期列：以第一個為準', () => {
    const r = run([['日期', '行程'], ['11/21｜京都', ''], ['', '清水寺'], ['11/21｜大阪', ''], ['', '道頓堀']]);
    expect(r.days?.['2026-11-21']?.label).toBe('京都');
  });

  it('標題格開頭就是日期、後面接日期列文字時也認得（沒寫「日期」兩個字）', () => {
    const r = interpretSheets(one([['11/21（六）｜京都｜住 鴨川旅館', '時間', '行程'], ['', '09:00', '清水寺']]), opts);
    expect(r.items[0]).toMatchObject({ date: '2026-11-21', title: '清水寺', time: '09:00' });
    expect(r.days?.['2026-11-21']?.label).toBe('京都｜住 鴨川旅館');
  });

  it('另外有「日期」欄時，圖例裡的日期不搶日期欄', () => {
    const r = interpretSheets(one([['說明：日期 11/30 前要訂房', '日期', '行程'], ['', '11/21', '清水寺']]), opts);
    expect(r.items[0]).toMatchObject({ date: '2026-11-21', title: '清水寺' });
    expect(r.days).toBeUndefined();
  });

  it('看起來是日期但不存在、或寫「未定」：沒有日期（不當旁註、不沿用上一列）', () => {
    const r = run([['日期', '行程'], ['11/21', 'a'], ['未定', 'b'], ['11/31', 'c'], ['TBD', 'd'], ['記得帶護照', 'e']]);
    expect(r.items.map((i) => [i.title, i.date, i.note])).toEqual([
      ['a', '2026-11-21', undefined], ['b', null, undefined], ['c', null, undefined], ['d', null, undefined], ['e', '2026-11-21', '提醒：記得帶護照'],
    ]);
    // 只寫星期：和空白一樣沿用上一列
    const w = run([['日期', '行程'], ['11/21', 'a'], ['週六', 'b'], ['(Sat)', 'c']]);
    expect(w.items.map((i) => [i.date, i.note])).toEqual([['2026-11-21', undefined], ['2026-11-21', undefined], ['2026-11-21', undefined]]);
  });
});

describe('interpretSheets：預估花費與幣別', () => {
  const costs = (cells: unknown[], local = 'JPY') =>
    run([['行程', '費用'], ...cells.map((c, k) => [`站${k}`, c])], { localCurrency: local }).items.map((i) => [i.cost, i.costCurrency]);

  it('「$」：當地貨幣是其他元（台幣、港幣、新幣…）就是當地貨幣，否則是美金', () => {
    expect(costs(['$300'], 'TWD')).toEqual([[300, undefined]]);
    expect(costs(['$300'], 'HKD')).toEqual([[300, undefined]]);
    expect(costs(['$25'], 'JPY')).toEqual([[25, 'USD']]);
    expect(costs(['US$25', 'NT$300', 'HK$80', 'S$12', 'A$40', 'C$30', 'NZ$20'], 'JPY')).toEqual([
      [25, 'USD'], [300, 'TWD'], [80, 'HKD'], [12, 'SGD'], [40, 'AUD'], [30, 'CAD'], [20, 'NZD'],
    ]);
  });

  it('¥、€、£、₩ 與中文幣名', () => {
    expect(costs(['¥1,200', '€15', '£9.5', '₩18,000', '300 日幣', '20 美金'], 'TWD')).toEqual([
      [1200, 'JPY'], [15, 'EUR'], [9.5, 'GBP'], [18000, 'KRW'], [300, 'JPY'], [20, 'USD'],
    ]);
    expect(costs(['¥88'], 'CNY')).toEqual([[88, undefined]]);
  });

  it('金額取幣別符號後面的數字；時間、人數、距離不是金額', () => {
    expect(costs(['$4.50/60 分', '2 人 $50', '消費滿額免費 3hr', '90 分鐘', '門票 500'], 'USD')).toEqual([
      [4.5, undefined], [50, undefined], [undefined, undefined], [undefined, undefined], [500, undefined],
    ]);
  });

  it('記帳的金額只寫「$」也認得幣別', () => {
    const r = interpretSheets(one([['日期', '項目', '金額'], ['11/21', '計程車', '$32']], '記帳'), opts);
    expect(r.expenses[0]).toMatchObject({ amount: 32, currency: 'USD' });
    const tw = interpretSheets(one([['日期', '項目', '金額'], ['11/21', '便當', '$120']], '記帳'), { ...opts, localCurrency: 'TWD' });
    expect(tw.expenses[0]).toMatchObject({ amount: 120, currency: 'TWD' });
  });
});

describe('applyImport：地點與每天的城市', () => {
  const result = (patch: Partial<ImportResult> = {}): ImportResult => ({
    items: [], expenses: [], warnings: [], hasRelativeDays: false, suggestedName: '匯入的行程', ...patch,
  });

  it('附加到其他幣別的行程：不同幣別的金額不記成當地貨幣，改寫在備註', () => {
    const t = applyImport(
      mkTrip({ localCurrency: 'JPY' }),
      result({
        items: [
          { date: '2026-11-21', title: 'a', type: 'food', done: false, cost: 25, costCurrency: 'USD' },
          { date: '2026-11-21', title: 'b', type: 'food', done: false, cost: 18, costCurrency: 'USD', note: '費用：$18–24/人' },
          { date: '2026-11-21', title: 'c', type: 'food', done: false, cost: 800 },
        ],
      }),
      'append',
    );
    expect(t.localCurrency).toBe('JPY');
    expect(t.items.map((i) => [i.cost, i.note])).toEqual([[undefined, '費用：25 USD'], [undefined, '費用：$18–24/人'], [800, undefined]]);
  });

  it('新行程：有記帳在用目前的當地貨幣時不改當地貨幣', () => {
    const t = applyImport(
      mkTrip({ localCurrency: 'JPY' }),
      result({
        items: [{ date: '2026-11-21', title: 'a', type: 'food', done: false, cost: 25, costCurrency: 'USD' }],
        expenses: [{ date: '2026-11-21', title: '拉麵', amount: 1200, currency: 'JPY', category: 'food', payer: '', split: [] }],
      }),
      'new',
    );
    expect(t.localCurrency).toBe('JPY');
    expect(t.items[0].cost).toBeUndefined();
  });

  it('新行程：已填城市就不改；沒有日期列不建 days', () => {
    const t = applyImport(mkTrip({ city: 'KYOTO' }), result({ days: { '2026-11-21': { label: '大阪', city: '大阪' } } }), 'new');
    expect(t.city).toBe('KYOTO');
    expect(Object.keys(applyImport(mkTrip(), result(), 'new').days ?? {})).toEqual([]);
  });

  it('以試算表為準更新 days：手動的不動、日期列沒變的保留原本結果、城市沒變的保留座標、規則產生的舊日子移除', () => {
    const geo = { lat: 34.69, lng: 135.5, en: 'Osaka', label: '大阪' };
    const base = mkTrip({
      days: {
        '2026-11-20': { label: '京都', city: '京都', source: 'manual' },
        '2026-11-21': { label: '京都｜住 A', city: 'Kyoto', geo, source: 'ai' },
        '2026-11-22': { label: '大阪｜住 B', city: '大阪', geo, source: 'rule' },
        '2026-11-23': { label: '奈良', city: '奈良', source: 'rule' },
        '2026-11-24': { city: '神戶', source: 'ai' },
      },
    });
    const t = applyImport(
      base,
      result({
        days: {
          '2026-11-20': { label: '大阪', city: '大阪' },
          '2026-11-21': { label: '京都｜住 A', city: '京都' },
          '2026-11-22': { label: '大阪｜住 C', city: '大阪', lodging: 'C' },
        },
      }),
      'replace',
    );
    expect(t.days?.['2026-11-20']).toEqual({ label: '京都', city: '京都', source: 'manual' });
    expect(t.days?.['2026-11-21']).toEqual({ label: '京都｜住 A', city: 'Kyoto', geo, source: 'ai' });
    expect(t.days?.['2026-11-22']).toMatchObject({ label: '大阪｜住 C', city: '大阪', lodging: 'C', geo, source: 'rule' });
    expect(t.days?.['2026-11-24']).toMatchObject({ city: '神戶', source: 'ai' });
    // 規則產生、這次試算表沒有的日子：移除後由規則版辨識重新補上（不會留著舊的「奈良」）
    expect(t.days?.['2026-11-23']?.label).toBeUndefined();
    // 試算表沒有日期列：原本的日子都留著（規則版辨識只補齊欄位）
    const kept = applyImport(base, result(), 'replace').days ?? {};
    const brief = (days: NonNullable<Trip['days']>) => Object.fromEntries(Object.entries(days).map(([k, d]) => [k, [d.label, d.source]]));
    expect(brief(kept)).toEqual(brief(base.days!));
  });

  it('附加：原本沒有的日子才加，原本有的只補空著的欄位', () => {
    const base = mkTrip({ days: { '2026-11-21': { city: '京都', source: 'ai' }, '2026-11-22': { label: 'x', source: 'manual' } } });
    const t = applyImport(
      base,
      result({ days: { '2026-11-21': { label: '京都｜住 A', city: '大阪', lodging: 'A' }, '2026-11-22': { label: 'y', city: '奈良' }, '2026-11-23': { label: '神戶', city: '神戶' } } }),
      'append',
    );
    expect(t.days?.['2026-11-21']).toMatchObject({ label: '京都｜住 A', city: '京都', lodging: 'A', source: 'ai' });
    expect(t.days?.['2026-11-22']).toEqual({ label: 'x', source: 'manual' });
    expect(t.days?.['2026-11-23']).toMatchObject({ label: '神戶', source: 'rule' });
  });

  it('以試算表為準更新行程點：保留手動與 AI 的導航目的地（地點沒改時）；舊版匯入帶 ★ 的名稱也對得上', () => {
    const ai = { query: 'Fushimi Inari Taisha, Kyoto, Japan', source: 'ai' as const };
    const manual = { query: '我自己選的', source: 'manual' as const };
    const base = mkTrip({
      items: [
        mkItem({ id: 'a', title: '伏見稻荷', date: '2026-11-21', address: '伏見', place: ai, done: true }),
        mkItem({ id: 'b', title: '錦市場', date: '2026-11-21', address: '中京區', place: ai }),
        mkItem({ id: 'c', title: '晚餐', date: '2026-11-21', place: manual }),
        mkItem({ id: 'd', title: '★ 金閣寺', date: '2026-11-22', done: true }),
      ],
    });
    const t = applyImport(
      base,
      result({
        items: [
          { date: '2026-11-21', title: '伏見稻荷', type: 'sight', done: false, address: '伏見' },
          { date: '2026-11-21', title: '錦市場', type: 'food', done: false, address: '錦小路通' },
          { date: '2026-11-21', title: '晚餐', type: 'food', done: false, address: '祇園' },
          { date: '2026-11-22', title: '金閣寺', type: 'sight', done: false, flag: 'must' },
        ],
        columns: { items: ['date', 'title', 'type', 'address'], expenses: [] },
      }),
      'replace',
    );
    const get = (id: string) => t.items.find((i) => i.id === id);
    expect(get('a')?.place).toEqual(ai);
    expect(get('b')?.place?.source).not.toBe('ai'); // 地址改了：重新辨識
    expect(get('c')?.place).toEqual(manual);
    expect(get('d')).toMatchObject({ title: '金閣寺', flag: 'must', done: true });
    expect(t.items).toHaveLength(4);
  });

  it('沒有地點欄時，以試算表為準更新也保留 App 裡的路線、交通說明與標籤', () => {
    const old = mkItem({ id: 'k', title: '搭車', date: '2026-11-21', route: { from: 'A', to: 'B' }, transit: '步行 5 分', tag: '接駁' });
    const t = applyImport(mkTrip({ items: [old] }), run([['日期', '行程'], ['11/21', '搭車']]), 'replace');
    expect(t.items[0]).toMatchObject({ id: 'k', route: { from: 'A', to: 'B' }, transit: '步行 5 分', tag: '接駁' });
  });
});

describe('resolveDayKeys / suggestTripCity', () => {
  it('「第 N 天」的 key 依出發日換成日期，原本就是日期的優先', () => {
    expect(resolveDayKeys({ __D1: 'a', __D3: 'c', '2026-11-23': 'x' }, '2026-11-21')).toEqual({ '2026-11-21': 'a', '2026-11-23': 'x' });
    expect(resolveDayKeys({ __D1: 'a' }, null)).toEqual({ __D1: 'a' });
  });

  it('最常過夜的城市（沒寫的沿用前一天），認得的用英文大寫', () => {
    expect(suggestTripCity({ '2027-03-08': { city: '西雅圖' }, '2027-03-09': { city: '波特蘭' }, '2027-03-10': {}, '2027-03-11': {}, '2027-03-12': { city: '西雅圖' } })).toBe('PORTLAND');
    // 同樣多天：先出現的
    expect(suggestTripCity({ '2027-03-08': { city: '京都' }, '2027-03-09': { city: '大阪' } })).toBe('KYOTO');
    expect(suggestTripCity({ '2027-03-08': { city: '火星基地' } })).toBe('火星基地');
    expect(suggestTripCity({})).toBe('');
    expect(suggestTripCity(undefined)).toBe('');
  });
});
