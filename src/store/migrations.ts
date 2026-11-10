/**
 * 資料版本遷移。改了 src/domain/types.ts 的結構時：
 *  1. 把 SCHEMA_VERSION 加 1
 *  2. 在 migrate() 補一段 `step(新版本, version, () => { ...把舊資料轉成新格式... })`
 * 這樣使用者手機裡的舊資料更新 App 後不會壞掉。
 *
 * 只新增「選填」欄位、舊資料不用轉換時不必加版本（例如 Trip.rates、Settings.lastBackupAt）。
 *
 * 遷移出錯時會丟出錯誤（訊息標明哪一版），App 會顯示「資料讀取失敗」並且不寫入，
 * 手機裡的舊資料不會被蓋掉。不要在這裡吞掉錯誤改用空資料。
 */
export const SCHEMA_VERSION = 1;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function migrate(persisted: any, version: number): any {
  const state = persisted ?? {};
  step(1, version, () => {
    // v0 → v1：第一版，無需轉換
  });
  return state;
}

/** 從 from 版升到 to 版（已經是 to 版以上就略過）；失敗時標明是哪一版 */
function step(to: number, from: number, fn: () => void) {
  if (from >= to) return;
  try {
    fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`資料從第 ${from} 版轉換到第 ${to} 版時失敗：${msg}`, { cause: e });
  }
}
