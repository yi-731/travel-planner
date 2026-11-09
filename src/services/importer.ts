/**
 * 試算表匯入：讀檔（xlsx / csv / tsv / 貼上的文字）→ 辨識欄位 → 轉成行程點與花費。
 * 用 read-excel-file（xlsx）＋ papaparse（csv）。全部是純函式，好測試。
 * TODO（資料代理）：實作
 */
import type { Expense, Item, Trip } from '@/domain/types';

/** 工作表名稱 → 二維陣列（第一列通常是標題） */
export type RawSheets = Record<string, unknown[][]>;

export interface ImportResult {
  items: Omit<Item, 'id' | 'createdAt' | 'updatedAt'>[];
  expenses: Omit<Expense, 'id' | 'createdAt' | 'updatedAt'>[];
  warnings: string[];
  /** 偵測到「第 N 天」格式（需要出發日才能換算） */
  hasRelativeDays: boolean;
  /** 建議的新行程名稱（通常是檔名） */
  suggestedName: string;
}

export type ImportMode = 'new' | 'append' | 'replace';

export async function readSpreadsheetFile(_file: File): Promise<RawSheets> {
  throw new Error('TODO');
}

/** 從試算表複製貼上的文字（TSV）或 CSV 文字 */
export function readPastedText(_text: string): RawSheets {
  throw new Error('TODO');
}

/** 辨識欄位、正規化日期／時間／類型 */
export function interpretSheets(_raw: RawSheets, _opts: { name: string; startDate?: string | null; localCurrency?: string }): ImportResult {
  throw new Error('TODO');
}

/**
 * 套用匯入結果：
 *  - new：建立新行程（回傳的 Trip 尚未寫入 store）
 *  - append：附加到 trip
 *  - replace：以試算表為準更新 trip 的行程點（保留已完成狀態與座標；花費只新增不重複的）
 */
export function applyImport(_base: Trip, _result: ImportResult, _mode: ImportMode): Trip {
  throw new Error('TODO');
}
