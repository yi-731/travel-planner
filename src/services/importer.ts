/**
 * 試算表匯入：讀檔（xlsx / csv / tsv / 貼上的文字）→ 辨識欄位 → 轉成行程點與花費。
 * 用 read-excel-file（xlsx，動態載入）＋ papaparse（csv）。辨識與套用都是純函式，好測試。
 *
 * 流程：readSpreadsheetFile / readPastedText / fetchGoogleSheet（sheets.ts）→ RawSheets
 *       → interpretSheets → ImportResult（預覽）→ applyImport → Trip（由呼叫端寫入 store）
 *
 * 要支援新的欄位名稱：改 FIELD_ALIASES；新的類型關鍵字：改 ITEM_TYPE_WORDS / EXPENSE_WORDS。
 */
import Papa from 'papaparse';
import { EXPENSE_CATEGORIES, ITEM_TYPES } from '@/domain/constants';
import { addDays, diffDays, fmtMD, fromMinutes, today, toMinutes } from '@/domain/dates';
import { uid } from '@/domain/ids';
import type { Expense, ExpenseCategory, ISODate, Item, ItemType, Trip } from '@/domain/types';

/** 工作表名稱 → 二維陣列（第一列通常是標題） */
export type RawSheets = Record<string, unknown[][]>;

/**
 * 匯入的花費：日期可以先空著（「第 N 天」或沒寫日期、又還不知道出發日），
 * 由 applyImport 依行程的出發日換算（dayOffset 只在匯入過程中使用，不會存進 Expense）。
 */
export type DraftExpense = Omit<Expense, 'id' | 'createdAt' | 'updatedAt' | 'date' | 'fromSheet'> & {
  date: ISODate | null;
  /** 試算表寫的是「第 N 天」，等知道出發日再換算 */
  dayOffset?: number;
};

export interface ImportResult {
  items: Omit<Item, 'id' | 'createdAt' | 'updatedAt'>[];
  expenses: DraftExpense[];
  warnings: string[];
  /** 偵測到「第 N 天」格式（需要出發日才能換算） */
  hasRelativeDays: boolean;
  /** 建議的新行程名稱（通常是檔名） */
  suggestedName: string;
  /**
   * 試算表裡有哪些欄位（行程表／記帳表分開）。「以試算表為準更新」時，
   * 試算表沒有的欄位會保留 App 裡填的值。沒有這項（例如手動組出的結果）時，只在試算表的值是空的時候保留。
   */
  columns?: { items: ImportColumn[]; expenses: ImportColumn[] };
}

export type ImportMode = 'new' | 'append' | 'replace';

type DraftItem = ImportResult['items'][number];

// ───────────────────────────── 讀檔 ─────────────────────────────

const XLS_MESSAGE = '這是舊版 Excel（.xls）檔，無法直接讀取。請用 Excel 或 Numbers 開啟後「另存為」.xlsx，再重新匯入。';
const BAD_XLSX_MESSAGE = '讀不到這個 Excel 檔，可能已損毀或設有密碼。請用 Excel 開啟確認、移除密碼後另存為 .xlsx，再試一次。';
const NUMBERS_MESSAGE = 'Numbers 檔無法直接讀取。請在 Numbers 選「檔案 → 輸出至 → Excel」存成 .xlsx，再重新匯入。';
const UNSUPPORTED_MESSAGE = '不支援這種檔案。請選擇 Excel（.xlsx）或 CSV 檔。';

/** 讀取使用者選的檔案：.xlsx 讀全部工作表；.csv / .tsv / .txt 當作一個工作表（名稱＝檔名） */
export async function readSpreadsheetFile(file: File): Promise<RawSheets> {
  const ext = (/\.([a-z0-9]+)$/i.exec(file.name)?.[1] ?? '').toLowerCase();
  if (ext === 'xls') throw new Error(XLS_MESSAGE);
  if (ext === 'numbers') throw new Error(NUMBERS_MESSAGE);
  if (ext === 'xlsx' || ext === 'xlsm' || file.type.includes('spreadsheetml')) return readXlsx(file);
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt' || file.type.startsWith('text/')) {
    return { [sheetNameOf(file.name)]: parseDelimited(await decodeText(file), ext === 'tsv' ? '\t' : undefined) };
  }
  // 沒有副檔名（少數 App 分享出來的檔案）：看檔頭判斷
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (head[0] === 0x50 && head[1] === 0x4b) return readXlsx(file); // 'PK' = zip = xlsx
  if (head[0] === 0xd0 && head[1] === 0xcf) throw new Error(XLS_MESSAGE); // OLE2 = 舊版 xls
  const text = await decodeText(file);
  if (!text.trim() || text.includes('\u0000')) throw new Error(UNSUPPORTED_MESSAGE);
  return { [sheetNameOf(file.name)]: parseDelimited(text) };
}

async function readXlsx(file: File): Promise<RawSheets> {
  type ReadAll = (input: Blob) => Promise<{ sheet: string; data: unknown[][] }[]>;
  const toRaw = (sheets: { sheet: string; data: unknown[][] }[]): RawSheets =>
    Object.fromEntries(sheets.map((s) => [s.sheet, s.data]));
  try {
    const mod = await import('read-excel-file/browser');
    return toRaw(await (mod.default as unknown as ReadAll)(file));
  } catch (e) {
    const err = e as { name?: string; code?: string };
    if (err?.code === 'XLS_FILE_NOT_SUPPORTED') throw new Error(XLS_MESSAGE);
    if (err?.name === 'InvalidInputError' || err?.name === 'InvalidSpreadsheetError') throw new Error(BAD_XLSX_MESSAGE);
    // 少數環境無法啟動 Web Worker：改用單執行緒版本再試一次
    try {
      const mod = await import('read-excel-file/universal');
      return toRaw(await (mod.default as unknown as ReadAll)(file));
    } catch {
      throw new Error(BAD_XLSX_MESSAGE);
    }
  }
}

/** UTF-8 為主；Windows Excel 存的 CSV 可能是 Big5 或 UTF-16 */
async function decodeText(file: Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  const b = new Uint8Array(buf.slice(0, 2));
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
  const utf8 = new TextDecoder('utf-8').decode(buf);
  if (!utf8.includes('\uFFFD')) return utf8;
  try {
    const big5 = new TextDecoder('big5').decode(buf);
    if (!big5.includes('\uFFFD')) return big5;
  } catch {
    /* 不支援 big5 的環境：用 UTF-8 結果 */
  }
  return utf8;
}

const sheetNameOf = (fileName: string) => fileName.replace(/\.[a-z0-9]+$/i, '').trim() || '行程';

/** CSV / TSV 文字 → 二維字串陣列（去掉 BOM 與結尾空白列）。sheets.ts 也用這個。 */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!clean.trim()) return [];
  const firstLine = clean.split('\n').find((l) => l.trim()) ?? '';
  const delim = delimiter ?? (firstLine.includes('\t') ? '\t' : '');
  const res = Papa.parse<string[]>(clean, { delimiter: delim, skipEmptyLines: false });
  const rows = (res.data as unknown[]).filter(Array.isArray).map((r) => (r as unknown[]).map((c) => (c == null ? '' : String(c))));
  while (rows.length && rows[rows.length - 1].every((c) => !c.trim())) rows.pop();
  return rows;
}

/** 從試算表複製貼上的文字（TSV）或 CSV 文字 */
export function readPastedText(text: string): RawSheets {
  return { 行程: parseDelimited(text ?? '') };
}

// ───────────────────────────── 欄位辨識 ─────────────────────────────

type Field =
  | 'date' | 'time' | 'title' | 'type' | 'address' | 'note' | 'cost'
  | 'link' | 'currency' | 'payer' | 'split' | 'duration' | 'rating';
/** 試算表的欄位種類（ImportResult.columns 用） */
export type ImportColumn = Field;

/** 欄位別名。先比對完全相同，再比對「包含」（單字別名與標 exact 的只做完全比對） */
const FIELD_ALIASES: [Field, string[]][] = [
  ['date', ['日期', 'date', 'day', '天', '日', '日程', '日期時間', 'datetime', '第幾天']],
  ['time', ['時間', 'time', '開始', '時刻', '出發', '開始時間']],
  ['title', ['行程', '景點', '名稱', '標題', '項目', '活動', 'title', 'name', '地點名稱', '品項', '內容', '店名', 'item', 'activity', 'spot']],
  ['type', ['類型', '分類', 'type', 'category', '類別', '種類']],
  ['address', ['地址', '地點', '位置', 'address', 'location', 'place']],
  ['note', ['備註', '說明', 'note', 'notes', 'memo', '描述', 'description', 'remark', 'remarks']],
  ['cost', ['費用', '預算', '金額', 'cost', 'price', 'amount', '花費', '價格', 'fee', 'budget']],
  ['link', ['連結', '網址', 'url', 'link', '網站']],
  ['currency', ['幣別', '貨幣', 'currency']],
  ['payer', ['付款人', '誰付', 'payer', '支付者', '付款']],
  ['split', ['分攤', '分攤者', '分攤人', 'split']],
  ['duration', ['停留', '分鐘', 'duration', '時長', '停留時間']],
  ['rating', ['評分', '星等', 'rating', '分數']],
];
/** 只做完全比對的別名（太短或容易誤判，例如「出發地」不是時間） */
const EXACT_ONLY = new Set(['出發', '開始', '日', '天']);

const isLatin = (s: string) => /^[a-z0-9 _-]+$/i.test(s);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 標題儲存格正規化：小寫、去括號內容（「停留(分)」→「停留」）、去冒號星號 */
function normHeader(v: unknown): string {
  if (typeof v !== 'string') return '';
  return toHalfWidth(v)
    .toLowerCase()
    .replace(/[(（[【〔<].*?[)）\]】〕>]/g, '')
    .replace(/[:：*＊]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 回傳別名在字串中「結束」的位置（找不到為 -1）。中文複合詞的重點在後面：「行程類型」是類型。 */
function aliasEnd(header: string, alias: string): number {
  if (isLatin(alias)) {
    const m = new RegExp(`(?:^|[^a-z])(${escapeRe(alias)})(?=[^a-z]|$)`).exec(header);
    return m ? m.index + m[0].length : -1;
  }
  const k = header.lastIndexOf(alias);
  return k < 0 ? -1 : k + alias.length;
}

type HeaderMap = Partial<Record<Field, number>>;

/** 把還沒用到的欄位比對到別名：1) 完全相同 2) 包含（取結束位置最後、別名最長者） */
function matchAliases(headers: string[], map: HeaderMap, taken: Set<number>, table: [Field, string[]][]) {
  // 1) 完全相同
  headers.forEach((h, col) => {
    if (!h || taken.has(col)) return;
    const compact = h.replace(/\s/g, '');
    for (const [field, aliases] of table) {
      if (map[field] !== undefined) continue;
      if (aliases.some((a) => a === h || a.replace(/\s/g, '') === compact)) {
        map[field] = col;
        taken.add(col);
        return;
      }
    }
  });
  // 2) 包含
  headers.forEach((h, col) => {
    if (!h || taken.has(col)) return;
    let best: { field: Field; end: number; len: number } | null = null;
    for (const [field, aliases] of table) {
      if (map[field] !== undefined) continue;
      for (const a of aliases) {
        if (EXACT_ONLY.has(a) || a.length < 2) continue;
        const end = aliasEnd(h, a);
        if (end < 0) continue;
        if (!best || end > best.end || (end === best.end && a.length > best.len)) best = { field, end, len: a.length };
      }
    }
    if (best) {
      map[best.field] = col;
      taken.add(col);
    }
  });
}

/** 一列標題 → 欄位對應（欄位 → 欄號） */
function mapHeaderRow(row: unknown[]): HeaderMap {
  const map: HeaderMap = {};
  const headers = row.map(normHeader);
  const taken = new Set<number>();
  matchAliases(headers, map, taken, FIELD_ALIASES);
  // 沒有名稱欄、只有「地點」欄（「日期｜時間｜地點｜備註」很常見）：地點就是行程名稱，
  // 再從剩下的欄位找地址（「日期｜地點｜地址」→ 地點是名稱、地址是地址）
  if (map.title === undefined && map.address !== undefined) {
    map.title = map.address;
    delete map.address;
    matchAliases(headers, map, taken, FIELD_ALIASES.filter(([f]) => f === 'address'));
  }
  return map;
}

interface HeaderRow {
  index: number;
  map: HeaderMap;
  /** 標題列的原始文字（給提醒訊息用） */
  labels: string[];
}

function findHeader(rows: unknown[][]): HeaderRow | null {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const map = mapHeaderRow(row);
    const n = Object.keys(map).length;
    if (n >= 2 && (map.title !== undefined || map.cost !== undefined)) return { index: i, map, labels: row.map(cellText) };
  }
  return null;
}

/** 名稱欄寫「項目」「品項」：比較像記帳 */
const EXPENSE_TITLE_WORDS = ['項目', '品項', 'item'];
/** 名稱欄寫「行程」「景點」「活動」…：比較像行程表 */
const ITEM_TITLE_WORDS = ['行程', '景點', '活動', 'spot', 'activity', 'name', '店名'];

/**
 * 沒有用工作表名稱標明時，依欄位判斷是不是記帳：
 * 付款人、分攤各 2 分，幣別、名稱欄叫「項目」各 1 分；
 * 時間、地址、停留、評分、連結、名稱欄叫「行程／景點」各 1 分。記帳分數較高才算記帳（同分算行程）。
 */
function sheetKind(map: HeaderMap, titleHeader: string): { expense: number; item: number } {
  const has = (f: Field) => map[f] !== undefined;
  const titleIs = (words: string[]) => !!titleHeader && words.some((w) => hasWord(titleHeader, w));
  const expense = (has('payer') ? 2 : 0) + (has('split') ? 2 : 0) + (has('currency') ? 1 : 0) + (titleIs(EXPENSE_TITLE_WORDS) ? 1 : 0);
  const item =
    (['time', 'address', 'duration', 'rating', 'link'] as const).filter(has).length + (titleIs(ITEM_TITLE_WORDS) ? 1 : 0);
  return { expense, item };
}

/** 工作表名稱看起來是記帳（「手帳」不算） */
const EXPENSE_SHEET_RE = /記帳|花費|支出|開銷|帳|expense|spending/i;
const isExpenseSheetName = (name: string) => EXPENSE_SHEET_RE.test(name.replace(/手帳/g, ''));

// ───────────────────────────── 儲存格解析 ─────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');

/** 全形英數符號 → 半形 */
function toHalfWidth(s: string): string {
  return s.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, ' ');
}

/** 儲存格 → 文字（數字轉字串、日期轉 YYYY-MM-DD） */
function cellText(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) {
    const p = dateObjParts(v);
    return p?.date ?? '';
  }
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v).replace(/\u00A0/g, ' ').trim();
}

function ymd(y: number, m: number, d: number): ISODate | null {
  if (!(y >= 1901 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null; // 2/30 之類
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Date 物件 → 日期＋時刻（分鐘）。
 * 會遇到的 Date 都來自 read-excel-file（或 serialParts），一律以 UTC 為準：
 * 儲存格「2026/11/21 16:00」就是 2026-11-21T16:00Z。所以只用 UTC 欄位取值，不受手機時區影響
 * （不能用「當地午夜」判斷：台北的 16:00Z 剛好是當地午夜，會被誤認成隔天）。
 * 1899/1900 年代表「只有時間」的儲存格（Excel 時間序號 < 1）。
 */
function dateObjParts(d: Date): { date: ISODate | null; minutes: number } | null {
  if (Number.isNaN(d.getTime())) return null;
  const u = new Date(d.getTime() + 30_000); // 套件取整時會少幾毫秒（09:29:59.97），四捨五入到分鐘
  return {
    date: ymd(u.getUTCFullYear(), u.getUTCMonth() + 1, u.getUTCDate()),
    minutes: u.getUTCHours() * 60 + u.getUTCMinutes(),
  };
}

/** Excel 日期序號（1900 系統）→ 日期＋時刻 */
function serialParts(n: number): { date: ISODate | null; minutes: number } {
  return dateObjParts(new Date(Math.round((n - 25569) * 86_400_000)))!;
}

const CN_DIGITS: Record<string, number> = { 零: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
/** 「十二」「二十一」「3」→ 數字 */
function parseSmallNumber(s: string): number | null {
  if (/^\d+$/.test(s)) return +s;
  if (!/^[零一二兩三四五六七八九十]+$/.test(s)) return null;
  if (!s.includes('十')) return s.length === 1 ? CN_DIGITS[s] : null;
  const [a, b] = s.split('十');
  const tens = a ? CN_DIGITS[a] : 1;
  const ones = b ? CN_DIGITS[b] : 0;
  return tens === undefined || ones === undefined ? null : tens * 10 + ones;
}

interface DateCtx {
  startDate: ISODate | null;
  /** 上一個解析到的實際日期（推算沒寫年份的日期用） */
  anchor: ISODate | null;
}

type DateParse =
  | { kind: 'abs'; date: ISODate; minutes: number | null }
  | { kind: 'rel'; day: number; minutes: number | null };

/** 沒寫年份的 M/D：取最接近參考日（上一列日期或出發日）的年份，可處理跨年；都沒有時用今年（已過 4 個月以上視為明年） */
function monthDay(m: number, d: number, ctx: DateCtx): ISODate | null {
  const ref = ctx.anchor ?? ctx.startDate;
  if (ref) {
    const ry = +ref.slice(0, 4);
    let best: ISODate | null = null;
    let bestDiff = Infinity;
    for (const y of [ry, ry + 1, ry - 1]) {
      const c = ymd(y, m, d);
      if (!c) continue;
      const diff = Math.abs(diffDays(ref, c));
      if (diff < bestDiff) [best, bestDiff] = [c, diff];
    }
    return best;
  }
  const t = today();
  const cy = +t.slice(0, 4);
  const c = ymd(cy, m, d);
  if (!c) return ymd(cy + 1, m, d);
  return diffDays(c, t) > 120 ? (ymd(cy + 1, m, d) ?? c) : c;
}

/** 日期儲存格 → 實際日期或「第 N 天」；可附帶時間（「2026/11/21 09:30」） */
function parseDateCell(v: unknown, ctx: DateCtx): DateParse | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    const p = dateObjParts(v);
    if (!p?.date) return null;
    return { kind: 'abs', date: p.date, minutes: p.minutes || null };
  }
  if (typeof v === 'number') {
    if (Number.isInteger(v) && v >= 1 && v <= 99) return { kind: 'rel', day: v, minutes: null };
    if (v > 20000 && v < 80000) {
      const p = serialParts(v);
      return p.date ? { kind: 'abs', date: p.date, minutes: p.minutes || null } : null;
    }
    return null;
  }
  const s = toHalfWidth(cellText(v));
  if (!s) return null;
  const timeAfter = (rest: string) => {
    const t = /(?:^|[T\s])([0-2]?\d:[0-5]\d)/.exec(rest);
    return t ? parseTimeString(t[1])?.start ?? null : null;
  };
  let m: RegExpExecArray | null;
  // 2026-11-21、2026/11/21、2026.11.21、2026年11月21日
  if ((m = /^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/.exec(s))) {
    const date = ymd(+m[1], +m[2], +m[3]);
    return date ? { kind: 'abs', date, minutes: timeAfter(s.slice(m[0].length)) } : null;
  }
  // 11/21/2026（美式）或 21/11/2026（日在前，第一個數字 > 12 時）
  if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s))) {
    const a = +m[1], b = +m[2];
    const date = a > 12 ? ymd(+m[3], b, a) : ymd(+m[3], a, b);
    return date ? { kind: 'abs', date, minutes: timeAfter(s.slice(m[0].length)) } : null;
  }
  // 11/21、11-21、11.21、11月21日（後面可接星期）
  if ((m = /^(\d{1,2})\s*[/.\-月]\s*(\d{1,2})\s*日?(?![\d/.])/.exec(s))) {
    const date = monthDay(+m[1], +m[2], ctx);
    return date ? { kind: 'abs', date, minutes: timeAfter(s.slice(m[0].length)) } : null;
  }
  // 第1天、第一天、第 2 日
  if ((m = /^第\s*([0-9零一二兩三四五六七八九十]+)\s*[天日]/.exec(s))) {
    const n = parseSmallNumber(m[1]);
    return n && n >= 1 && n <= 99 ? { kind: 'rel', day: n, minutes: null } : null;
  }
  // Day 1、Day1、D1
  if ((m = /^(?:day\s*|d)(\d{1,2})(?![\d/.:])/i.exec(s))) return +m[1] >= 1 ? { kind: 'rel', day: +m[1], minutes: null } : null;
  // 1天、1日目
  if ((m = /^(\d{1,2})\s*(?:天|日目)/.exec(s))) return +m[1] >= 1 ? { kind: 'rel', day: +m[1], minutes: null } : null;
  // 純數字：1～99 視為第幾天；5 位數視為 Excel 日期序號
  if (/^\d{1,2}$/.test(s) && +s >= 1) return { kind: 'rel', day: +s, minutes: null };
  if (/^\d{5}(\.\d+)?$/.test(s)) return parseDateCell(+s, ctx);
  return null;
}

/** 時間字串 → 開始分鐘（與結束分鐘，若是「09:30-11:00」） */
function parseTimeString(raw: string): { start: number; end: number | null } | null {
  let s = toHalfWidth(raw).trim().toLowerCase();
  // 「2026-11-21 09:30」→ 只取時間部分
  const dt = /^\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?[t\s]+(.+)$/.exec(s);
  if (dt) s = dt[1];
  const one = (str: string): { min: number; rest: string } | null => {
    let rest = str.trim();
    let ampm: 'am' | 'pm' | 'noon' | 'night' | null = null;
    const pre = /^(上午|早上|清晨|凌晨|中午|下午|傍晚|晚上|夜晚|夜間|am|a\.m\.|pm|p\.m\.)\s*/.exec(rest);
    if (pre) {
      const w = pre[1];
      ampm = /上午|早上|清晨|凌晨|^a/.test(w) ? 'am' : w === '中午' ? 'noon' : /晚上|夜/.test(w) ? 'night' : 'pm';
      rest = rest.slice(pre[0].length);
    }
    let h: number, mi: number;
    let m: RegExpExecArray | null;
    if ((m = /^(\d{1,2})[:.](\d{2})(?::\d{2}(?:\.\d+)?)?/.exec(rest))) [h, mi] = [+m[1], +m[2]];
    else if ((m = /^(\d{1,2})\s*[時点點]\s*(?:(半)|(\d{1,2})\s*分?)?/.exec(rest))) [h, mi] = [+m[1], m[2] ? 30 : m[3] ? +m[3] : 0];
    else if ((m = /^(\d{1,2})(\d{2})(?=$|\s|[-~～–—至到])/.exec(rest))) [h, mi] = [+m[1], +m[2]];
    else if ((m = /^(\d{1,2})(?=\s*(?:am|pm|a\.m\.|p\.m\.)|$)/.exec(rest))) [h, mi] = [+m[1], 0];
    else return null;
    rest = rest.slice(m[0].length);
    const suf = /^\s*(am|a\.m\.|pm|p\.m\.)/.exec(rest);
    if (suf) {
      ampm = suf[1].startsWith('a') ? 'am' : 'pm';
      rest = rest.slice(suf[0].length);
    }
    if (ampm === 'am' && h === 12) h = 0;
    else if ((ampm === 'pm' || ampm === 'night') && h < 12) h += 12;
    else if (ampm === 'night' && h === 12) h = 0;
    else if (ampm === 'noon' && h >= 1 && h <= 5) h += 12;
    if (h === 24 && mi === 0) h = 0;
    if (h > 23 || mi > 59) return null;
    return { min: h * 60 + mi, rest };
  };
  const a = one(s);
  if (!a) return null;
  const sep = /^\s*[-~～–—至到]\s*/.exec(a.rest);
  const b = sep ? one(a.rest.slice(sep[0].length)) : null;
  return { start: a.min, end: b ? b.min : null };
}

/** 時間儲存格 → 'HH:mm'（與時間範圍的結束） */
function parseTimeCell(v: unknown): { time: string; end: number | null } | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    const p = dateObjParts(v);
    if (!p) return null;
    if (p.minutes === 0 && p.date) return null; // 只有日期、沒有時間
    return { time: fromMinutes(p.minutes), end: null };
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 0) return null;
    if (v < 1) return { time: fromMinutes(Math.min(1439, Math.round(v * 1440))), end: null }; // 0.395833 → 09:30
    if (Number.isInteger(v)) {
      if (v <= 23) return { time: fromMinutes(v * 60), end: null }; // 9 → 09:00
      if (v >= 100 && v <= 2359 && v % 100 < 60) return { time: fromMinutes(Math.floor(v / 100) * 60 + (v % 100)), end: null }; // 930 → 09:30
      return null;
    }
    if (v > 20000 && v < 80000) return { time: fromMinutes(Math.min(1439, Math.round((v % 1) * 1440))), end: null }; // 日期時間序號
    return null;
  }
  const t = parseTimeString(cellText(v));
  return t ? { time: fromMinutes(t.start), end: t.end } : null;
}

/** 數字：去千分位、貨幣符號（'¥1,200'、'NT$300'、'1.2萬'） */
function parseNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = toHalfWidth(cellText(v)).replace(/[,，\s]/g, '');
  const m = /-?\d+(?:\.\d+)?/.exec(s);
  if (!m) return null;
  let n = parseFloat(m[0]);
  const after = s.slice(m.index + m[0].length);
  if (/^萬/.test(after)) n *= 10_000;
  else if (/^千/.test(after) || /^k(?![a-z])/i.test(after)) n *= 1_000;
  return Number.isFinite(n) ? n : null;
}

/** 停留時間 → 分鐘（90、'90分'、'1.5小時'、'1h30m'、'1:30'） */
function parseDuration(v: unknown): number | null {
  if (typeof v === 'number') return v > 0 && v < 4320 ? Math.round(v) : null;
  const s = toHalfWidth(cellText(v)).toLowerCase().replace(/\s/g, '');
  if (!s) return null;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{1,2}):(\d{2})$/.exec(s))) return +m[1] * 60 + +m[2] || null;
  const h = /(\d+(?:\.\d+)?)(?:個?小時|小时|hours?|hrs?|h)/.exec(s);
  const mi = /(\d+)(?:分鐘|分|minutes?|mins?|m)(?![a-z])/.exec(s);
  if (h || mi) {
    const total = Math.round((h ? parseFloat(h[1]) * 60 : 0) + (mi ? +mi[1] : 0));
    return total > 0 ? total : null;
  }
  const n = parseNumber(s);
  return n != null && n > 0 && n < 4320 ? Math.round(n) : null;
}

/** 評分 0～5（'4.5'、'★★★★'、'8/10'） */
function parseRating(v: unknown): number | null {
  const s = cellText(v);
  if (!s) return null;
  const stars = (s.match(/[★⭐]/g) ?? []).length;
  if (stars) return Math.min(5, stars + (s.includes('½') ? 0.5 : 0));
  const out = /^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/.exec(toHalfWidth(s));
  const n = out ? (+out[1] / +out[2]) * 5 : parseNumber(v);
  if (n == null || !Number.isFinite(n) || n < 0) return null;
  return Math.round(Math.min(5, n) * 10) / 10;
}

const CURRENCY_WORDS: [RegExp, string][] = [
  [/NT\$|NTD|TWD|新?臺幣|新?台幣/i, 'TWD'],
  [/JPY|YEN|日[幣圓元]|円/i, 'JPY'],
  [/US\$|USD|美金|美元/i, 'USD'],
  [/KRW|韓[元幣圜]|₩/i, 'KRW'],
  [/HK\$|HKD|港[幣元]/i, 'HKD'],
  [/CNY|RMB|人民幣/i, 'CNY'],
  [/EUR|歐元|€/i, 'EUR'],
  [/GBP|英鎊|£/i, 'GBP'],
  [/THB|泰[銖幣]|฿/i, 'THB'],
  [/SGD|S\$|新加坡幣|新幣/i, 'SGD'],
  [/VND|越南盾|₫/i, 'VND'],
];

let isoCodes: Set<string> | null | undefined;
/** 真的 ISO 4217 幣別代碼（瀏覽器不支援查詢時一律接受） */
function isIsoCurrency(code: string): boolean {
  if (isoCodes === undefined) {
    try {
      const list = Intl.supportedValuesOf?.('currency');
      isoCodes = list?.length ? new Set(list) : null;
    } catch {
      isoCodes = null;
    }
  }
  return isoCodes ? isoCodes.has(code) : true;
}

/** 幣別文字 → ISO 三碼；認不出來回傳 null。常見寫法（NTD、RMB、YEN、日幣…）先換成正式代碼 */
function parseCurrency(v: unknown, local: string): string | null {
  const s = toHalfWidth(cellText(v)).trim();
  if (!s) return null;
  for (const [re, code] of CURRENCY_WORDS) if (re.test(s)) return code;
  if (/^[a-z]{3}$/i.test(s)) {
    const code = s.toUpperCase();
    return isIsoCurrency(code) ? code : null;
  }
  if (/[¥￥]/.test(s)) return local === 'CNY' ? 'CNY' : 'JPY';
  return null;
}

/** 別名比對：中文用「包含」，英文用整字 */
const hasWord = (text: string, w: string) =>
  isLatin(w) ? new RegExp(`(?:^|[^a-z])${escapeRe(w)}(?:[^a-z]|$)`).test(text) : text.includes(w);

/** 行程點類型關鍵字（順序即優先序：「清水寺參道逛街」算購物） */
const ITEM_TYPE_WORDS: [ItemType, string[]][] = [
  ['stay', ['住宿', '飯店', '旅館', '酒店', '民宿', '旅店', '青旅', '入住', '退房', 'check-in', 'checkin', 'check in', 'check-out', 'hotel', 'hostel', 'airbnb', 'stay']],
  ['food', ['餐廳', '美食', '餐飲', '吃', '餐', '食', '飲', '咖啡', '早餐', '午餐', '晚餐', '宵夜', '甜點', '拉麵', '壽司', '居酒屋', 'cafe', 'restaurant', 'food', 'lunch', 'dinner', 'breakfast']],
  ['transport', ['交通', '車', '機', '鐵', '船', '巴士', '電車', '新幹線', '航班', '移動', '捷運', '地鐵', '計程車', 'taxi', 'bus', 'train', 'flight', 'transport']],
  ['shop', ['購物', '買', '逛', '商店', 'outlet', '百貨', '商場', '藥妝', 'shopping', 'shop', 'mall']],
  ['sight', ['景點', '景', '寺', '神社', '神宮', '大社', '公園', '博物館', '美術館', '城', '塔', '參觀', '玩', '觀光', 'sight', 'sightseeing', 'museum', 'temple', 'attraction']],
];

function matchItemType(text: string): ItemType | null {
  const s = text.toLowerCase();
  for (const [key, words] of ITEM_TYPE_WORDS) if (words.some((w) => hasWord(s, w))) return key;
  return null;
}

/** 類型儲存格 → 類型（景點／餐廳／交通…、英文 key、或關鍵字） */
function parseItemType(v: unknown): ItemType | null {
  const s = cellText(v).toLowerCase();
  if (!s) return null;
  const exact = ITEM_TYPES.find((t) => t.key === s || t.label === s);
  if (exact) return exact.key;
  if (s === '其他' || s === 'other') return 'other';
  return matchItemType(s);
}

/** 花費分類關鍵字（「車票」「機票」算交通，「門票」算門票） */
const EXPENSE_WORDS: [ExpenseCategory, string[]][] = [
  ['stay', ['住宿', '飯店', '旅館', '酒店', '民宿', '旅店', 'hotel', 'hostel', 'airbnb']],
  ['food', ['餐飲', '飲食', '美食', '吃', '餐', '食', '飲', '咖啡', '早餐', '午餐', '晚餐', '宵夜', '甜點', '零食', '拉麵', '壽司', '居酒屋', 'food', 'meal', 'cafe', 'restaurant', 'lunch', 'dinner']],
  ['transport', ['交通', '車', '機', '鐵', '船', '巴士', '電車', '新幹線', '地鐵', '捷運', '計程車', '航班', '加油', '停車', 'ic卡', 'icoca', 'suica', '西瓜卡', 'taxi', 'bus', 'train', 'flight', 'transport']],
  ['ticket', ['門票', '票', '入場', '參觀', '景點', '體驗', '導覽', 'ticket', 'admission']],
  ['shop', ['購物', '買', '伴手禮', '紀念品', '藥妝', '商店', '百貨', 'outlet', 'shopping', 'shop', 'souvenir']],
];

function matchExpenseCategory(text: string): ExpenseCategory | null {
  const s = text.toLowerCase();
  for (const [key, words] of EXPENSE_WORDS) if (words.some((w) => hasWord(s, w))) return key;
  return null;
}

function parseExpenseCategory(v: unknown): ExpenseCategory | null {
  const s = cellText(v).toLowerCase();
  if (!s) return null;
  const exact = EXPENSE_CATEGORIES.find((c) => c.key === s || c.label === s);
  if (exact) return exact.key;
  if (/^(其他|雜支|雜項|other|misc)$/.test(s)) return 'other';
  return matchExpenseCategory(s);
}

/**
 * 分攤者儲存格 → 名字清單（空陣列＝全員）。
 * 有逗號、頓號、斜線等分隔符號時，每一段保持完整（「Amy Chen、Bob Lin」→ 兩個人）；
 * 沒有分隔符號時才用空白分開（「小明 小華」），但整格剛好是已知的名字（付款人或成員）就不拆。
 */
function parseNames(v: unknown, known: ReadonlySet<string>): string[] {
  const s = cellText(v).replace(/\s+/g, ' ').trim();
  if (!s || /^(全員|全部|所有人|大家|全體|all|everyone)$/i.test(s)) return [];
  const parts = s.split(/[,，、/／;；]+/).map((x) => x.trim()).filter(Boolean);
  if (parts.length > 1) return [...new Set(parts)];
  if (known.has(s)) return [s];
  return [...new Set(s.split(' ').filter(Boolean))];
}

const looksLikeUrl = (s: string) => /^(https?:\/\/|www\.)\S+$/i.test(s);
const normUrl = (s: string) => (/^www\./i.test(s) ? `https://${s}` : s);
/** 合計列（避免重複計算） */
const TOTAL_ROW_RE = /^(合計|總計|小計|總和|總額|total|subtotal|sum)$/i;
/** 範本裡的示範列 */
const EXAMPLE_RE = /（範例）|\(範例\)/;

// ───────────────────────────── 辨識 ─────────────────────────────

/** 辨識欄位、正規化日期／時間／類型 */
export function interpretSheets(
  raw: RawSheets,
  opts: {
    name: string;
    startDate?: string | null;
    localCurrency?: string;
    /** 行程成員：分攤欄裡有空白的名字（「Amy Chen」）認得出是一個人 */
    members?: readonly string[];
  },
): ImportResult {
  const startDate = opts.startDate || null;
  const local = (opts.localCurrency || 'JPY').toUpperCase();
  const items: DraftItem[] = [];
  const expenses: DraftExpense[] = [];
  /** 每筆花費的分攤儲存格（全部讀完、知道有哪些付款人後再拆名字） */
  const splitCells: unknown[] = [];
  const itemColumns = new Set<Field>();
  const expenseColumns = new Set<Field>();
  const skippedSheets: string[] = [];
  const kindWarnings: string[] = [];
  let skippedNoTitle = 0;
  let skippedNoAmount = 0;
  let skippedExamples = 0;
  let relUnresolved = false;
  let relResolved = false;
  let expenseNoDate = 0;
  let titleAbove = '';

  for (const [sheetName, rowsIn] of Object.entries(raw ?? {})) {
    const rows = (Array.isArray(rowsIn) ? rowsIn : []).map((r) => (Array.isArray(r) ? r : []));
    const nonEmpty = rows.some((r) => r.some((c) => cellText(c) !== ''));
    if (!nonEmpty) continue;
    const header = findHeader(rows);
    if (!header) {
      skippedSheets.push(sheetName);
      continue;
    }
    const { map } = header;
    if (!titleAbove) {
      // 標題列上方單獨一格的文字，常是行程名稱（例如 A1「京都五日遊」）
      for (const r of rows.slice(0, header.index)) {
        const cells = r.map(cellText).filter(Boolean);
        if (cells.length === 1 && cells[0].length <= 40) {
          titleAbove = cells[0];
          break;
        }
      }
    }
    // 記帳或行程：工作表名稱寫明的為準，否則看欄位
    const titleLabel = map.title === undefined ? '' : (header.labels[map.title] ?? '');
    const byName = isExpenseSheetName(sheetName);
    const score = sheetKind(map, normHeader(titleLabel));
    const isExpense = byName || (map.cost !== undefined && score.expense > score.item);
    if (!byName) {
      // 判斷可能錯的時候說一聲，不要默默匯入成另一種
      const where = sheetName === '行程' ? '這張表' : `工作表「${sheetName}」`;
      if (!isExpense && (map.payer !== undefined || map.split !== undefined)) {
        kindWarnings.push(`${where}有付款人或分攤欄位，但看起來是行程表，已匯入成行程點。如果這是記帳，請放在名為「記帳」的工作表再匯入。`);
      } else if (isExpense && titleLabel && sheetKind({}, normHeader(titleLabel)).item > 0) {
        kindWarnings.push(`${where}有「${titleLabel}」欄，像是行程表，但因為有付款人、分攤或幣別欄位，已匯入成記帳。如果這是行程表，請拿掉這些欄位再匯入。`);
      }
    }
    for (const f of Object.keys(map) as Field[]) (isExpense ? expenseColumns : itemColumns).add(f);
    const get = (row: unknown[], f: Field): unknown => (map[f] === undefined ? null : row[map[f]!]);
    const ctx: DateCtx = { startDate, anchor: null };
    let prev: DateParse | null = null;

    for (const row of rows.slice(header.index + 1)) {
      if (!row.some((c) => cellText(c) !== '')) continue;
      // 日期：空白沿用上一列（合併儲存格常見）
      const dateRaw = get(row, 'date');
      let dp = cellText(dateRaw) ? parseDateCell(dateRaw, ctx) : null;
      if (dp?.kind === 'abs') ctx.anchor = dp.date;
      if (dp) prev = dp;
      else if (!cellText(dateRaw)) dp = prev ? { ...prev, minutes: null } : null;

      const title = cellText(get(row, 'title'));
      const otherCells = row.some((c, k) => k !== map.date && cellText(c) !== '');

      if (TOTAL_ROW_RE.test(title) || TOTAL_ROW_RE.test(cellText(dateRaw))) continue;
      if (EXAMPLE_RE.test(title)) {
        skippedExamples++;
        continue;
      }

      let date: ISODate | null = null;
      let dayOffset: number | undefined;
      if (dp?.kind === 'abs') date = dp.date;
      else if (dp?.kind === 'rel') {
        if (startDate) {
          date = addDays(startDate, dp.day - 1);
          relResolved = true;
        } else {
          dayOffset = dp.day;
          relUnresolved = true;
        }
      }

      if (isExpense) {
        const amountRaw = get(row, 'cost');
        const amount = parseNumber(amountRaw);
        if (amount == null) {
          if (otherCells) skippedNoAmount++;
          continue;
        }
        const category =
          parseExpenseCategory(get(row, 'type')) ?? matchExpenseCategory(title) ?? 'other';
        // 沒寫日期：記在出發日；還不知道出發日就先空著，由 applyImport 依行程的出發日決定
        if (!date && !dayOffset) {
          expenseNoDate++;
          date = startDate;
        }
        const e: DraftExpense = {
          date,
          title: title || EXPENSE_CATEGORIES.find((c) => c.key === category)!.label,
          amount,
          currency: parseCurrency(get(row, 'currency'), local) ?? parseCurrency(amountRaw, local) ?? local,
          category,
          payer: cellText(get(row, 'payer')),
          split: [],
        };
        if (dayOffset) e.dayOffset = dayOffset;
        expenses.push(e);
        splitCells.push(get(row, 'split'));
        continue;
      }

      if (!title) {
        if (otherCells) skippedNoTitle++;
        continue;
      }
      const it: DraftItem = {
        date,
        title,
        type: parseItemType(get(row, 'type')) ?? matchItemType(title) ?? 'other',
        done: false,
      };
      if (dayOffset) it.dayOffset = dayOffset;
      const t = parseTimeCell(get(row, 'time'));
      if (t) it.time = t.time;
      else if (dp?.minutes) it.time = fromMinutes(dp.minutes);
      let address = cellText(get(row, 'address'));
      let link = cellText(get(row, 'link'));
      if (looksLikeUrl(address)) {
        if (!link) link = address;
        address = '';
      }
      if (address) it.address = address;
      if (link) it.link = normUrl(link);
      const note = cellText(get(row, 'note'));
      if (note) it.note = note;
      const cost = parseNumber(get(row, 'cost'));
      if (cost != null) it.cost = cost;
      const dur = parseDuration(get(row, 'duration'));
      if (dur) it.durationMin = dur;
      else if (t?.end != null) {
        const span = (t.end - (toMinutes(t.time) ?? 0) + 1440) % 1440;
        if (span > 0) it.durationMin = span;
      }
      const rating = parseRating(get(row, 'rating'));
      if (rating != null) it.rating = rating;
      items.push(it);
    }
  }

  // 分攤：付款人與成員的名字整格比對（名字裡可能有空白）
  const known = new Set<string>([...(opts.members ?? []), ...expenses.map((e) => e.payer)].map((n) => n.replace(/\s+/g, ' ').trim()).filter(Boolean));
  expenses.forEach((e, i) => {
    e.split = parseNames(splitCells[i], known);
  });

  const warnings: string[] = [];
  for (const s of skippedSheets) {
    warnings.push(`工作表「${s}」找不到欄位名稱列，已略過。第一列請寫上「日期」「行程」或「金額」等欄位名稱。`);
  }
  warnings.push(...kindWarnings);
  if (relUnresolved) warnings.push('試算表用「第幾天」標示日期，設定出發日後就會換算成實際日期。');
  else if (relResolved && startDate) warnings.push(`已依出發日 ${fmtMD(startDate)} 把「第幾天」換算成日期。`);
  const noDate = items.filter((i) => !i.date && !i.dayOffset).length;
  if (noDate) warnings.push(`${noDate} 個行程點沒有日期，匯入後可以再幫它們排進某一天。`);
  if (expenseNoDate) warnings.push(`${expenseNoDate} 筆花費沒有日期，先記在${startDate ? ` ${fmtMD(startDate)}` : '出發日'}。`);
  if (skippedNoTitle) warnings.push(`${skippedNoTitle} 列沒有行程名稱，已略過。`);
  if (skippedNoAmount) warnings.push(`${skippedNoAmount} 列花費沒有金額，已略過。`);
  if (skippedExamples) warnings.push(`已略過 ${skippedExamples} 列範本的範例資料。`);
  if (!items.length && !expenses.length && !skippedSheets.length && !skippedNoTitle && !skippedNoAmount && !skippedExamples) {
    warnings.push('找不到可以匯入的資料。請確認試算表第一列是欄位名稱，例如「日期」「時間」「行程」「地址」。');
  }

  const fileName = (opts.name ?? '').replace(/\.(xlsx|xlsm|xls|csv|tsv|txt)$/i, '').trim();
  return {
    items,
    expenses,
    warnings,
    hasRelativeDays: relUnresolved,
    suggestedName: fileName || titleAbove || '匯入的行程',
    columns: { items: [...itemColumns], expenses: [...expenseColumns] },
  };
}

// ───────────────────────────── 套用 ─────────────────────────────

const normKey = (s: string | undefined | null) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** 行程日期涵蓋所有行程點（與 store 的邏輯相同） */
function widenDates(t: Trip) {
  const ds = t.items.map((i) => i.date).filter((d): d is string => !!d).sort();
  if (!ds.length) return;
  if (!t.startDate || ds[0] < t.startDate) t.startDate = ds[0];
  if (!t.endDate || ds[ds.length - 1] > t.endDate) t.endDate = ds[ds.length - 1];
}

type KeepKey = 'time' | 'address' | 'link' | 'note' | 'cost' | 'durationMin' | 'rating';
/** 行程點欄位 ↔ 試算表欄位：試算表沒有這一欄時，以試算表為準更新也保留 App 裡填的值 */
const ITEM_KEEP: [KeepKey, Field][] = [
  ['time', 'time'], ['address', 'address'], ['link', 'link'], ['note', 'note'],
  ['cost', 'cost'], ['durationMin', 'duration'], ['rating', 'rating'],
];

/**
 * 同一站：試算表的內容為準，但保留 id、完成狀態、座標（地址沒改時），
 * 以及試算表沒有那一欄的資料（例如在 App 裡寫的備註、評分）。
 * cols 是試算表有的欄位；不知道（null）時，只在試算表的值是空的時候保留。
 */
function mergeItem(old: Item, it: Item, cols: ReadonlySet<Field> | null): Item {
  const merged: Item = { ...it, id: old.id, createdAt: old.createdAt, done: old.done || it.done };
  const keep = <K extends KeepKey>(k: K) => {
    merged[k] = old[k];
  };
  for (const [key, col] of ITEM_KEEP) {
    // 試算表有這一欄、但格子是空的：照試算表（使用者在試算表清掉了）
    if (merged[key] == null && old[key] != null && !cols?.has(col)) keep(key);
  }
  // 沒有類型欄時，類型是從名稱推測的：保留 App 裡改過的
  if (cols && !cols.has('type')) merged.type = old.type;
  const addressChanged = !!merged.address && normKey(merged.address) !== normKey(old.address);
  if (!merged.geo && old.geo && !addressChanged) merged.geo = old.geo;
  return merged;
}

/**
 * 試算表的花費更新到原本那筆：保留 id、建立時間、收據照片；
 * 試算表沒寫付款人、或沒有分攤／分類欄時，保留 App 裡的。
 */
function mergeExpense(old: Expense, e: Expense, src: DraftExpense, cols: ReadonlySet<Field> | null, now: number): Expense {
  // App 裡記的（或舊版匯入、還沒有標記的）完全相同的花費：只加上標記，內容不動
  if (!old.fromSheet) return { ...old, fromSheet: true };
  const keepSplit = cols ? !cols.has('split') : !src.split.length;
  const next: Expense = {
    ...old,
    date: e.date,
    title: e.title,
    amount: e.amount,
    currency: e.currency,
    category: cols && !cols.has('type') ? old.category : e.category,
    payer: src.payer || old.payer,
    split: keepSplit ? old.split : e.split,
    fromSheet: true,
  };
  const changed =
    (['date', 'title', 'amount', 'currency', 'category', 'payer'] as const).some((k) => next[k] !== old[k]) ||
    next.split.join('\u0001') !== old.split.join('\u0001');
  return changed ? { ...next, updatedAt: now } : old;
}

const exactKey = (e: Pick<Expense, 'date' | 'title' | 'amount' | 'currency'>) => `${e.date}|${normKey(e.title)}|${e.currency}|${e.amount}`;
const looseKey = (e: Pick<Expense, 'date' | 'title'>) => `${e.date}|${normKey(e.title)}`;

/**
 * 以試算表為準更新花費：
 *  1. 之前從試算表匯入的（fromSheet）：同日期＋名稱＋幣別＋金額是同一筆；
 *     再來同日期＋名稱也算同一筆（試算表改了金額或幣別 → 更新原本那筆，不會多一筆）。
 *  2. App 裡記的花費：完全相同的視為同一筆（舊版匯入的資料沒有標記），只加上標記、不重複加入。
 *  3. 其他是新的花費。試算表裡已經沒有的「試算表花費」會移除；App 裡記的一律保留。
 *     試算表完全沒有花費時（例如只有行程表）不移除任何花費，避免誤刪別處匯入的記帳。
 */
function replaceExpenses(t: Trip, incoming: Expense[], result: ImportResult, now: number): Expense[] {
  const cols = result.columns ? new Set(result.columns.expenses) : null;
  const sheetOld = t.expenses.filter((e) => e.fromSheet);
  const appOld = t.expenses.filter((e) => !e.fromSheet);
  const match: (Expense | undefined)[] = [];
  const used = new Set<string>();
  const pass = (pool: Expense[], key: (e: Expense) => string) =>
    incoming.forEach((e, i) => {
      if (match[i]) return;
      const k = key(e);
      const old = pool.find((o) => !used.has(o.id) && key(o) === k);
      if (!old) return;
      used.add(old.id);
      match[i] = old;
    });
  pass(sheetOld, exactKey);
  pass(sheetOld, looseKey);
  pass(appOld, exactKey);

  const updated = new Map<string, Expense>();
  const added: Expense[] = [];
  incoming.forEach((e, i) => {
    const old = match[i];
    if (old) updated.set(old.id, mergeExpense(old, e, result.expenses[i], cols, now));
    else added.push(e);
  });
  const dropMissing = incoming.length > 0;
  const kept = t.expenses.flatMap((o) => {
    const u = updated.get(o.id);
    if (u) return [u];
    return o.fromSheet && dropMissing ? [] : [o];
  });
  return [...kept, ...added];
}

/**
 * 以試算表為準更新後，原本的行程點與花費有哪些會被移除（給確認畫面、同步結果用；
 * 例如「試算表裡沒有其中 3 個行程點（例如「二年坂」）、2 筆記帳，同步後會移除」）。
 */
export function replaceRemovals(
  before: Pick<Trip, 'items' | 'expenses'>,
  after: Pick<Trip, 'items' | 'expenses'>,
): { items: Item[]; expenses: Expense[] } {
  const items = new Set(after.items.map((i) => i.id));
  const expenses = new Set(after.expenses.map((e) => e.id));
  return { items: before.items.filter((i) => !items.has(i.id)), expenses: before.expenses.filter((e) => !expenses.has(e.id)) };
}

/**
 * 套用匯入結果：
 *  - new：建立新行程（回傳的 Trip 尚未寫入 store）
 *  - append：附加到 trip
 *  - replace：以試算表為準更新 trip（行程點：保留已完成狀態、座標與試算表沒有的欄位，試算表沒有的行程點移除；
 *    花費：見 replaceExpenses）
 * 花費沒有日期或寫「第 N 天」時，依行程的出發日換算（沒有出發日就用最早的行程點日期，再沒有才用今天）。
 */
export function applyImport(base: Trip, result: ImportResult, mode: ImportMode): Trip {
  const now = Date.now();
  const t = structuredClone(base);
  const start = t.startDate;

  const items: Item[] = result.items.map((src) => {
    const it: Item = { ...structuredClone(src), id: uid(), createdAt: now, updatedAt: now };
    if (!it.date && it.dayOffset && start) {
      it.date = addDays(start, it.dayOffset - 1);
      delete it.dayOffset;
    }
    return it;
  });

  // 成員：付款人／分攤者若不在名單中就加入（新行程且名單是預設的「我」時，直接用試算表的名單）
  const names: string[] = [];
  for (const e of result.expenses) for (const n of [e.payer, ...e.split]) if (n && !names.includes(n)) names.push(n);
  if (names.length) {
    if (mode === 'new' && t.members.length <= 1 && (t.members[0] ?? '我') === '我' && !names.includes('我')) t.members = names;
    else for (const n of names) if (!t.members.includes(n)) t.members.push(n);
  }
  const defaultPayer = t.members[0] ?? '我';
  const anchor = start ?? items.map((i) => i.date).filter((d): d is ISODate => !!d).sort()[0] ?? today();
  const expenses: Expense[] = result.expenses.map((src) => {
    const { dayOffset, ...e } = structuredClone(src);
    return {
      ...e,
      date: e.date ?? addDays(anchor, (dayOffset ?? 1) - 1),
      payer: e.payer || defaultPayer,
      fromSheet: true,
      id: uid(),
      createdAt: now,
      updatedAt: now,
    };
  });

  if (mode === 'new') {
    t.items = items;
    t.expenses = expenses;
    if (!t.name.trim()) t.name = result.suggestedName;
  } else if (mode === 'append') {
    t.items = [...t.items, ...items];
    t.expenses = [...t.expenses, ...expenses];
  } else {
    // replace：同日期＋同名稱（沒日期時只比名稱）視為同一站
    const cols = result.columns ? new Set(result.columns.items) : null;
    const used = new Set<string>();
    t.items = items.map((it) => {
      const old = t.items.find(
        (o) => !used.has(o.id) && normKey(o.title) === normKey(it.title) && (it.date == null || o.date === it.date),
      );
      if (!old) return it;
      used.add(old.id);
      return mergeItem(old, it, cols);
    });
    t.ai = { ...t.ai, dayChecks: {} };
    t.expenses = replaceExpenses(t, expenses, result, now);
  }

  widenDates(t);
  t.updatedAt = now;
  return t;
}
