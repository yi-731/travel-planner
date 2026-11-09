/**
 * 資料版本遷移。改了 src/domain/types.ts 的結構時：
 *  1. 把 SCHEMA_VERSION 加 1
 *  2. 在 migrate() 補一段 `if (version < 新版本) { ...把舊資料轉成新格式... }`
 * 這樣使用者手機裡的舊資料更新 App 後不會壞掉。
 */
export const SCHEMA_VERSION = 1;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function migrate(persisted: any, version: number): any {
  const state = persisted ?? {};
  if (version < 1) {
    // v0 → v1：第一版，無需轉換
  }
  return state;
}
