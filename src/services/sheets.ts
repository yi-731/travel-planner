/**
 * Google 試算表同步：試算表需設為「知道連結的任何人都可以檢視」。
 * 透過 gviz CSV 端點讀取（支援 CORS）：
 *   https://docs.google.com/spreadsheets/d/{ID}/gviz/tq?tqx=out:csv&sheet={工作表名稱}
 * TODO（資料代理）：實作
 */
import type { RawSheets } from './importer';

export function parseSheetId(_url: string): string | null {
  throw new Error('TODO');
}

/** 讀第一個工作表＋名為「記帳」「花費」「支出」的工作表（若存在） */
export async function fetchGoogleSheet(_url: string): Promise<RawSheets> {
  throw new Error('TODO');
}
