/**
 * 匯出：Excel（行程＋記帳兩個工作表）、空白範本、Google 我的地圖 CSV。
 * 用 write-excel-file（動態載入，只有按下匯出才下載）。
 * 欄位名稱和 importer.ts 的別名一致，匯出的檔案可以直接再匯入：
 *  - 每天的城市／住宿寫成日期列（A 欄「2026/12/04（五）｜西雅圖 → 波特蘭｜住 Harbor Inn」，其他格空白）
 *  - ★ 必做／◇ 可省略寫在名稱前面；自己的分類（tag）寫在「類型」；路線、交通說明在沒有地址時寫在「地址」
 */
import { expenseCategory, itemType } from '@/domain/constants';
import { addDays, parseISODate, today, weekday } from '@/domain/dates';
import { allItemsSorted, placeQuery } from '@/domain/schedule';
import type { DayMeta, Expense, Item, Trip } from '@/domain/types';
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

/** 名稱前面加上 ★ 必做／◇ 可省略（匯入時會再讀回 flag） */
const flaggedTitle = (it: Pick<Item, 'title' | 'flag'>) => {
  const t = it.title.trim();
  if (it.flag === 'must') return /^[★☆]/.test(t) ? t : `★ ${t}`;
  if (it.flag === 'optional') return /^[◇◆]/.test(t) ? t : `◇ ${t}`;
  return t;
};

/** 「地址」欄：地址；沒有地址時寫路線（「SEA → PDX」）或交通說明（「步行 10 分」） */
function locationText(it: Pick<Item, 'address' | 'route' | 'transit'>): string {
  const addr = it.address?.trim();
  if (addr) return addr;
  const from = it.route?.from?.trim() ?? '', to = it.route?.to?.trim() ?? '';
  if (from || to) return from && to ? `${from} → ${to}` : from ? `${from} →` : `→ ${to}`;
  return it.transit?.trim() ?? '';
}

function itemRow(it: Item): Row {
  return [
    // 沒日期要寫「未定」：空白格在匯入時會沿用上一列的日期（合併儲存格的慣例）
    it.date ? dateCell(it.date) : str(it.dayOffset ? `第${it.dayOffset}天` : UNDATED),
    str(it.time),
    str(flaggedTitle(it)),
    str(it.tag?.trim() || itemType(it.type).label),
    str(locationText(it)),
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

/** 日期列的文字（日期後面那段）：原本的日期列文字；沒有時用城市與住宿（AI、手動設定的日子） */
function bannerLabel(m: DayMeta | undefined): string {
  if (!m) return '';
  const label = m.label?.trim();
  if (label) return label;
  return [m.city?.trim(), m.lodging?.trim() ? `住 ${m.lodging.trim()}` : ''].filter(Boolean).join('｜');
}

const REL_DAY = /^__D(\d{1,3})$/;

/** 日期列：A 欄「2026/12/04（五）｜舊金山 → 西雅圖｜住 …」，其他格空白（匯入時會讀回每天的城市與住宿） */
function bannerRow(key: string, label: string): Row {
  const rel = REL_DAY.exec(key);
  const head = rel ? `第${+rel[1]}天` : `${key.replace(/-/g, '/')}（${weekday(key)}）`;
  return [str(`${head}｜${label}`), ...ITEM_HEADERS.slice(1).map(() => null)];
}

/** 行程工作表的資料列：每天先一列日期列（有城市或住宿時），再接那天的行程點 */
export function itemRows(trip: Pick<Trip, 'items' | 'days'>): Row[] {
  const days = trip.days ?? {};
  const banners = new Map<string, string>();
  for (const [k, m] of Object.entries(days)) {
    const label = bannerLabel(m);
    if (label && (/^\d{4}-\d{2}-\d{2}$/.test(k) || REL_DAY.test(k))) banners.set(k, label);
  }
  const rows: Row[] = [];
  const emit = (key: string) => {
    const label = banners.get(key);
    if (label == null) return;
    rows.push(bannerRow(key, label));
    banners.delete(key);
  };
  const isoBanners = () => [...banners.keys()].filter((k) => !REL_DAY.test(k)).sort();
  for (const it of allItemsSorted(trip)) {
    // 這個日期以前（含沒有行程點的日子）的日期列先寫
    if (it.date) for (const k of isoBanners()) if (k <= it.date) emit(k);
    else {
      for (const k of isoBanners()) emit(k);
      if (it.dayOffset) emit(`__D${it.dayOffset}`);
    }
    rows.push(itemRow(it));
  }
  for (const k of isoBanners()) emit(k);
  for (const k of [...banners.keys()].sort((a, b) => +a.slice(3) - +b.slice(3))) emit(k);
  return rows;
}

/** 整個行程輸出成 Excel：「行程」與「記帳」兩個工作表 */
export async function tripToXlsx(trip: Trip): Promise<Blob> {
  const expenses = [...trip.expenses].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  return buildWorkbook(itemRows(trip), expenses.map(expenseRow));
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

/**
 * Google 我的地圖可匯入的 CSV（UTF-8 BOM）。地址用導航目的地（含當天城市，多城市行程才不會全部加上行程城市）；
 * 起床、打包這類沒有特定地點的不放進地圖。
 */
export function tripToMyMapsCsv(trip: Trip): string {
  const city = (trip.cityGeo?.label || trip.city || '').trim();
  const lines = [['名稱', '地址', '日期', '時間', '類型', '備註']];
  for (const it of allItemsSorted(trip)) {
    if (it.place?.navigable === false) continue;
    const q = placeQuery(it);
    lines.push([
      it.title,
      q && q !== it.title.trim() ? q : [it.title.trim(), city].filter(Boolean).join(' '),
      it.date ?? (it.dayOffset ? `第${it.dayOffset}天` : ''),
      it.time ?? '',
      itemType(it.type).label,
      it.note ?? '',
    ]);
  }
  return '\uFEFF' + lines.map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}
