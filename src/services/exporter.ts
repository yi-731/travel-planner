/**
 * 匯出：Excel（行程＋記帳兩個工作表）、空白範本、Google 我的地圖 CSV。
 * 用 write-excel-file。
 * TODO（資料代理）：實作
 */
import type { Trip } from '@/domain/types';

export async function tripToXlsx(_trip: Trip): Promise<Blob> {
  throw new Error('TODO');
}
export async function templateXlsx(): Promise<Blob> {
  throw new Error('TODO');
}
/** Google 我的地圖可匯入的 CSV（UTF-8 BOM） */
export function tripToMyMapsCsv(_trip: Trip): string {
  throw new Error('TODO');
}
