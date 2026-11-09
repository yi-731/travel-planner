/**
 * 匯出：Excel（行程＋記帳兩個工作表）、空白範本、Google 我的地圖 CSV。
 * 用 write-excel-file（動態載入，只有按下匯出才下載）。
 * 欄位名稱和 importer.ts 的別名一致，匯出的檔案可以直接再匯入。
 */
import { expenseCategory, itemType } from '@/domain/constants';
import { addDays, parseISODate, today } from '@/domain/dates';
import { allItemsSorted } from '@/domain/schedule';
import type { Expense, Item, Trip } from '@/domain/types';
import type { Cell, CellObject, Row, Sheet } from 'write-excel-file/browser';

export const ITEM_HEADERS = ['日期', '時間', '行程', '類型', '地址', '停留(分)', '費用', '評分', '備註', '連結'];
export const EXPENSE_HEADERS = ['日期', '項目', '金額', '幣別', '分類', '付款人', '分攤'];

/** 沒有日期的行程點在「日期」欄寫的字 */
const UNDATED = '未定';

const ITEM_WIDTHS = [12, 8, 26, 8, 30, 9, 10, 6, 30, 30];
const EXPENSE_WIDTHS = [12, 26, 12, 7, 8, 10, 16];

// Excel 檔內的樣式（不是 App 介面，所以用固定色碼）
const HEADER_STYLE: CellObject = {
  fontWeight: 'bold', backgroundColor: '#F1EEE9', bottomBorderStyle: 'thin', bottomBorderColor: '#C9C4BC', alignVertical: 'center', height: 22,
};

const header = (names: string[]): Row => names.map((value) => ({ value, ...HEADER_STYLE }));
const str = (v: string | undefined | null): Cell => (v ? { value: v, type: String } : null);
const num = (v: number | undefined | null, format?: string): Cell =>
  v == null || !Number.isFinite(v) ? null : { value: v, type: Number, ...(format ? { format } : {}) };
/** ISO 日期 → Excel 日期（以 UTC 午夜表示，不受手機時區影響） */
const dateCell = (iso: string | null | undefined): Cell => {
  const d = parseISODate(iso);
  return d ? { value: new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())), type: Date, format: 'yyyy/mm/dd' } : null;
};
const moneyFormat = (n: number) => (Number.isInteger(n) ? '#,##0' : '#,##0.00');

function itemRow(it: Item): Row {
  return [
    // 沒日期要寫「未定」：空白格在匯入時會沿用上一列的日期（合併儲存格的慣例）
    it.date ? dateCell(it.date) : str(it.dayOffset ? `第${it.dayOffset}天` : UNDATED),
    str(it.time),
    str(it.title),
    str(itemType(it.type).label),
    str(it.address),
    num(it.durationMin),
    it.cost != null ? num(it.cost, moneyFormat(it.cost)) : null,
    num(it.rating),
    str(it.note),
    str(it.link),
  ];
}

function expenseRow(e: Expense): Row {
  return [
    dateCell(e.date),
    str(e.title),
    num(e.amount, moneyFormat(e.amount)),
    str(e.currency),
    str(expenseCategory(e.category).label),
    str(e.payer),
    str(e.split.length ? e.split.join('、') : '全員'),
  ];
}

async function buildWorkbook(items: Row[], expenses: Row[]): Promise<Blob> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const sheets: Sheet<never>[] = [
    { sheet: '行程', data: [header(ITEM_HEADERS), ...items], columns: ITEM_WIDTHS.map((width) => ({ width })), stickyRowsCount: 1 },
    { sheet: '記帳', data: [header(EXPENSE_HEADERS), ...expenses], columns: EXPENSE_WIDTHS.map((width) => ({ width })), stickyRowsCount: 1 },
  ];
  return writeXlsxFile(sheets, { fontSize: 12 }).toBlob();
}

/** 整個行程輸出成 Excel：「行程」與「記帳」兩個工作表 */
export async function tripToXlsx(trip: Trip): Promise<Blob> {
  const expenses = [...trip.expenses].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  return buildWorkbook(allItemsSorted(trip).map(itemRow), expenses.map(expenseRow));
}

/** 空白範本：欄位名稱＋兩列標示（範例）的示範資料（匯入時會自動略過範例列） */
export async function templateXlsx(): Promise<Blob> {
  const d = addDays(today(), 30);
  const items: Row[] = [
    [dateCell(d), str('09:00'), str('清水寺（範例）'), str('景點'), str('京都市東山區清水 1-294'), num(90), num(500, '#,##0'), num(4.5), str('日期也可以寫「11/20」或「第1天」'), str('https://www.kiyomizudera.or.jp/')],
    [dateCell(d), str('12:30'), str('湯豆腐午餐（範例）'), str('餐廳'), str('南禪寺 順正'), num(60), num(3000, '#,##0'), null, str('類型可填：景點、餐廳、交通、住宿、購物、其他'), null],
  ];
  const expenses: Row[] = [
    [dateCell(d), str('地鐵一日券（範例）'), num(1100, '#,##0'), str('JPY'), str('交通'), str('我'), str('全員')],
    [dateCell(d), str('湯豆腐午餐（範例）'), num(6000, '#,##0'), str('JPY'), str('餐飲'), str('旅伴'), str('我、旅伴')],
  ];
  return buildWorkbook(items, expenses);
}

/** CSV 欄位跳脫：含逗號、引號、換行或前後空白時加引號 */
function csvField(v: string | undefined | null): string {
  const s = v ?? '';
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Google 我的地圖可匯入的 CSV（UTF-8 BOM） */
export function tripToMyMapsCsv(trip: Trip): string {
  const city = (trip.cityGeo?.label || trip.city || '').trim();
  const lines = [['名稱', '地址', '日期', '時間', '類型', '備註']];
  for (const it of allItemsSorted(trip)) {
    lines.push([
      it.title,
      it.address?.trim() || [it.title.trim(), city].filter(Boolean).join(' '),
      it.date ?? (it.dayOffset ? `第${it.dayOffset}天` : ''),
      it.time ?? '',
      itemType(it.type).label,
      it.note ?? '',
    ]);
  }
  return '\uFEFF' + lines.map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}
