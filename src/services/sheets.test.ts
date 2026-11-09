import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchGoogleSheet, parseSheetId } from './sheets';

const ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';

describe('parseSheetId', () => {
  it('一般的編輯網址', () => {
    expect(parseSheetId(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`)).toBe(ID);
    expect(parseSheetId(`https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing`)).toBe(ID);
    expect(parseSheetId(`https://docs.google.com/spreadsheets/d/${ID}`)).toBe(ID);
    expect(parseSheetId(`  docs.google.com/spreadsheets/d/${ID}/htmlview  `)).toBe(ID);
  });

  it('多帳號登入的 /u/0/ 網址', () => {
    expect(parseSheetId(`https://docs.google.com/spreadsheets/u/1/d/${ID}/edit`)).toBe(ID);
  });

  it('舊格式 key= 與 open?id=', () => {
    expect(parseSheetId(`https://docs.google.com/spreadsheet/ccc?key=${ID}&usp=sharing`)).toBe(ID);
    expect(parseSheetId(`https://drive.google.com/open?id=${ID}`)).toBe(ID);
  });

  it('直接貼 ID', () => {
    expect(parseSheetId(ID)).toBe(ID);
  });

  it('「發布到網路」的 /d/e/ 連結不支援', () => {
    expect(parseSheetId('https://docs.google.com/spreadsheets/d/e/2PACX-1vQabcdefghijklmnopqrstuvwxyz0123456789/pubhtml')).toBeNull();
  });

  it('不是試算表網址', () => {
    expect(parseSheetId('')).toBeNull();
    expect(parseSheetId('https://www.google.com/maps/place/Kyoto')).toBeNull();
    expect(parseSheetId('京都行程')).toBeNull();
    expect(parseSheetId('https://docs.google.com/document/d/short/edit')).toBeNull();
  });
});

describe('fetchGoogleSheet', () => {
  afterEach(() => vi.unstubAllGlobals());

  const csv = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8' } });

  it('讀第一個工作表，並加入確實存在的記帳工作表', async () => {
    const first = '"日期","行程"\n"2026/11/21","清水寺"\n';
    const expense = '"日期","項目","金額"\n"2026/11/21","拉麵","1200"\n';
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      const sheet = new URL(url).searchParams.get('sheet');
      if (sheet === '記帳') return csv(expense);
      if (sheet === '支出') throw new TypeError('Failed to fetch');
      return csv(first); // 不存在的工作表：gviz 回傳第一個工作表
    }));
    const raw = await fetchGoogleSheet(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`);
    expect(raw).toEqual({
      行程: [['日期', '行程'], ['2026/11/21', '清水寺']],
      記帳: [['日期', '項目', '金額'], ['2026/11/21', '拉麵', '1200']],
    });
    expect(calls[0]).toBe(`https://docs.google.com/spreadsheets/d/${ID}/gviz/tq?tqx=out:csv`);
    expect(calls).toContain(`https://docs.google.com/spreadsheets/d/${ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent('記帳')}`);
    expect(calls).toHaveLength(4);
  });

  it('兩個記帳名稱回傳相同內容時只留一個', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const sheet = new URL(url).searchParams.get('sheet');
      return csv(sheet === '花費' || sheet === '支出' ? 'a,b\n1,2' : 'x,y\n3,4');
    }));
    const raw = await fetchGoogleSheet(ID);
    expect(Object.keys(raw)).toEqual(['行程', '花費']);
  });

  it('404 時提示開啟「知道連結的任何人」共用', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html></html>', { status: 404, headers: { 'content-type': 'text/html' } })));
    await expect(fetchGoogleSheet(ID)).rejects.toThrow(/知道連結的任何人.*檢視者/);
  });

  it('回傳登入頁（HTML）時同樣提示共用設定', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!DOCTYPE html><html>Sign in</html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })));
    await expect(fetchGoogleSheet(ID)).rejects.toThrow(/共用/);
  });

  it('網路錯誤（未共用時的 CORS 失敗也是這樣）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(fetchGoogleSheet(ID)).rejects.toThrow(/連不上這份試算表/);
  });

  it('伺服器錯誤顯示狀態碼', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    await expect(fetchGoogleSheet(ID)).rejects.toThrow(/錯誤 500/);
  });

  it('網址錯誤時不發出請求', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    await expect(fetchGoogleSheet('https://example.com')).rejects.toThrow(/不是 Google 試算表的網址/);
    await expect(fetchGoogleSheet('https://docs.google.com/spreadsheets/d/e/2PACX-1vQabcdefghijklmnopqrstuvwxyz/pubhtml')).rejects.toThrow(/發布到網路/);
    expect(f).not.toHaveBeenCalled();
  });

  it.skipIf(!process.env.LIVE_SHEETS)('（連網）讀取 Google 公開範例試算表', async () => {
    const raw = await fetchGoogleSheet(`https://docs.google.com/spreadsheets/d/${ID}/edit`);
    expect(raw['行程'][0][0]).toBe('Student Name');
    expect(Object.keys(raw)).toEqual(['行程']);
  });
});
