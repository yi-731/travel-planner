/**
 * 「更多」分頁的動作：匯出、備份／還原、封面照片、刪除行程。
 * 畫面（MoreView）只負責 busy 狀態與提示訊息；資料一律透過 store 修改。
 */
import type { Trip } from '@/domain/types';
import { exportFile, pickFile, pickImage } from '@/platform';
import { tripToMyMapsCsv, tripToXlsx } from '@/services/exporter';
import { useData } from '@/store/data';
import { blobStore } from '@/store/persist';
import { backupJson, buildBackup, parseBackup, type ParsedBackup } from './backup';
import { backupFileName, orphanBlobKeys, safeFileName } from './model';

export type ExportResult = Awaited<ReturnType<typeof exportFile>>;

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 錯誤 → 中文說明（本 App 丟出的中文訊息直接用） */
export function errorText(e: unknown, fallback: string): string {
  if (e instanceof Error && /[㐀-鿿]/.test(e.message)) return e.message;
  return fallback;
}

export async function exportExcel(trip: Trip): Promise<ExportResult> {
  let blob: Blob;
  try {
    blob = await tripToXlsx(trip);
  } catch (e) {
    throw new Error(errorText(e, 'Excel 檔沒有產生成功。請確認網路連線（第一次匯出需要下載元件）後再試一次。'));
  }
  return exportFile({ name: `${safeFileName(trip.name)}.xlsx`, mime: XLSX_MIME, data: blob });
}

export function exportMyMaps(trip: Trip): Promise<ExportResult> {
  return exportFile({ name: `${safeFileName(trip.name)}-我的地圖.csv`, mime: 'text/csv;charset=utf-8', data: tripToMyMapsCsv(trip) });
}

/** 備份全部行程與設定（不含 API 金鑰），回傳行程數 */
export async function exportBackup(): Promise<{ result: ExportResult; count: number }> {
  const { trips, settings } = useData.getState();
  const backup = buildBackup(trips, settings);
  const result = await exportFile({ name: backupFileName(), mime: 'application/json', data: backupJson(backup) });
  return { result, count: backup.trips.length };
}

/** 選備份檔並讀取；取消回傳 null，檔案有問題丟出中文錯誤 */
export async function pickBackup(): Promise<ParsedBackup | null> {
  const file = await pickFile('.json,application/json');
  if (!file) return null;
  if (file.size > 50 * 1024 * 1024) throw new Error('檔案太大（超過 50 MB），不像是旅途手帳的備份檔。');
  const text = await file.text();
  return parseBackup(text);
}

/** 依 id 合併：相同 id 的行程以備份版本取代，其餘新增。回傳還原的行程數 */
export function applyRestore(trips: Trip[]): number {
  const st = useData.getState();
  for (const t of trips) st.replaceTrip(t);
  const now = useData.getState();
  if (!now.activeTripId || !now.trips[now.activeTripId]) now.setActiveTrip(trips[0]?.id ?? null);
  return trips.length;
}

/** 選一張照片當封面；取消回傳 false */
export async function chooseCover(tripId: string): Promise<boolean> {
  const blob = await pickImage({ maxSide: 1600 });
  if (!blob) return false;
  const key = await blobStore.put(blob);
  const old = useData.getState().trips[tripId]?.cover;
  useData.getState().mutateTrip(tripId, (d) => {
    d.cover = { kind: 'image', blobKey: key, hue: d.cover.hue };
  });
  if (old?.kind === 'image' && old.blobKey && old.blobKey !== key) void blobStore.remove(old.blobKey).catch(() => undefined);
  return true;
}

export async function removeCover(tripId: string): Promise<void> {
  const old = useData.getState().trips[tripId]?.cover;
  useData.getState().mutateTrip(tripId, (d) => {
    d.cover = { kind: 'orb', hue: d.cover.hue ?? 0 };
  });
  if (old?.kind === 'image' && old.blobKey) await blobStore.remove(old.blobKey).catch(() => undefined);
}

/** 刪除行程，並清掉只有這趟行程用到的照片 */
export function deleteTripWithPhotos(tripId: string): string | null {
  const st = useData.getState();
  const trip = st.trips[tripId];
  if (!trip) return null;
  const keys = orphanBlobKeys(trip, Object.values(st.trips));
  st.deleteTrip(tripId);
  for (const k of keys) void blobStore.remove(k).catch(() => undefined);
  return trip.name;
}
