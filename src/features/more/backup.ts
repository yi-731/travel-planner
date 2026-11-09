/**
 * 備份與還原（純邏輯，有測試 backup.test.ts）。
 *
 * 備份檔格式（JSON）：
 *   { app: 'travel-planner', kind: 'backup', schema, exportedAt, trips: Trip[], settings }
 * - 不含 API 金鑰（安全）、不含照片（照片存在 IndexedDB，檔案會太大）、不含天氣快取（會自動重抓）。
 * - 還原時：版本較舊 → 先跑 store/migrations；版本較新 → 請使用者先更新 App。
 * - 每個行程都會補齊缺少的欄位、丟掉壞掉的行程點／花費，避免讀到奇怪的檔案讓 App 壞掉。
 */
import type { Expense, ExpenseCategory, Item, ItemType, Settings, Trip } from '@/domain/types';
import { uid } from '@/domain/ids';
import { migrate, SCHEMA_VERSION } from '@/store/migrations';

export const BACKUP_APP = 'travel-planner';

export interface BackupFile {
  app: typeof BACKUP_APP;
  kind: 'backup';
  schema: number;
  /** ISO 時間字串 */
  exportedAt: string;
  trips: Trip[];
  settings: Omit<Settings, 'anthropicApiKey'>;
}

export function buildBackup(trips: Record<string, Trip>, settings: Settings, now: Date = new Date()): BackupFile {
  const safeSettings: Omit<Settings, 'anthropicApiKey'> & { anthropicApiKey?: string } = { ...settings };
  delete safeSettings.anthropicApiKey;
  return {
    app: BACKUP_APP,
    kind: 'backup',
    schema: SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    trips: Object.values(trips)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((t) => {
        const copy = { ...t };
        delete copy.weather;
        return copy;
      }),
    settings: safeSettings,
  };
}

export const backupJson = (b: BackupFile) => JSON.stringify(b, null, 2);

export interface ParsedBackup {
  trips: Trip[];
  /** 備份建立時間（ms），讀不到時為 null */
  exportedAt: number | null;
  /** 讀檔時略過的壞資料筆數 */
  skipped: number;
}

export class BackupError extends Error {}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const optStr = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const isoDate = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const code3 = (v: unknown, fallback: string) => (typeof v === 'string' && /^[A-Z]{3}$/.test(v.trim().toUpperCase()) ? v.trim().toUpperCase() : fallback);

const ITEM_TYPES: ItemType[] = ['sight', 'food', 'transport', 'stay', 'shop', 'other'];
const CATEGORIES: ExpenseCategory[] = ['food', 'transport', 'stay', 'ticket', 'shop', 'other'];

function normalizeItem(raw: unknown, now: number): Item | null {
  if (!isObj(raw) || typeof raw.title !== 'string' || !raw.title.trim()) return null;
  const date = isoDate(raw.date);
  const item = {
    ...(raw as unknown as Item),
    id: optStr(raw.id) ?? uid(),
    title: raw.title,
    date,
    type: ITEM_TYPES.includes(raw.type as ItemType) ? (raw.type as ItemType) : 'other',
    done: raw.done === true,
    createdAt: num(raw.createdAt) ?? now,
    updatedAt: num(raw.updatedAt) ?? now,
  };
  const off = num(raw.dayOffset);
  if (off == null || date) delete item.dayOffset;
  else item.dayOffset = off;
  return item;
}

function normalizeExpense(raw: unknown, localCurrency: string, members: string[], now: number): Expense | null {
  if (!isObj(raw)) return null;
  const amount = num(raw.amount);
  if (amount == null) return null;
  return {
    ...(raw as unknown as Expense),
    id: optStr(raw.id) ?? uid(),
    date: isoDate(raw.date) ?? new Date(now).toISOString().slice(0, 10),
    title: str(raw.title),
    amount,
    currency: code3(raw.currency, localCurrency),
    category: CATEGORIES.includes(raw.category as ExpenseCategory) ? (raw.category as ExpenseCategory) : 'other',
    payer: optStr(raw.payer) ?? members[0],
    split: Array.isArray(raw.split) ? raw.split.filter((m): m is string => typeof m === 'string') : [],
    createdAt: num(raw.createdAt) ?? now,
    updatedAt: num(raw.updatedAt) ?? now,
  };
}

/** 任意物件 → 可安全使用的 Trip；缺 id 或名稱時回傳 null */
export function normalizeTrip(raw: unknown, now: number = Date.now()): Trip | null {
  if (!isObj(raw)) return null;
  const id = optStr(raw.id);
  const name = optStr(raw.name);
  if (!id || !name) return null;

  const members = Array.isArray(raw.members) ? [...new Set(raw.members.filter((m): m is string => typeof m === 'string' && !!m.trim()))] : [];
  const safeMembers = members.length ? members : ['我'];
  const localCurrency = code3(raw.localCurrency, 'JPY');
  const homeCurrency = code3(raw.homeCurrency, 'TWD');
  const rate = num(raw.rate);
  const cover = isObj(raw.cover) && raw.cover.kind === 'image' && typeof raw.cover.blobKey === 'string'
    ? { kind: 'image' as const, blobKey: raw.cover.blobKey }
    : { kind: 'orb' as const, hue: isObj(raw.cover) ? (num(raw.cover.hue) ?? 0) : 0 };
  const ai = isObj(raw.ai) ? raw.ai : {};

  const items = (Array.isArray(raw.items) ? raw.items : []).map((i) => normalizeItem(i, now)).filter((i): i is Item => !!i);
  const expenses = (Array.isArray(raw.expenses) ? raw.expenses : [])
    .map((e) => normalizeExpense(e, localCurrency, safeMembers, now))
    .filter((e): e is Expense => !!e);

  const trip: Trip = {
    ...(raw as unknown as Trip),
    id,
    name,
    city: str(raw.city),
    startDate: isoDate(raw.startDate),
    endDate: isoDate(raw.endDate),
    localCurrency,
    homeCurrency,
    rate: rate && rate > 0 ? rate : 1,
    members: safeMembers,
    items,
    expenses,
    cover,
    ai: { ...(ai as Trip['ai']), dayChecks: isObj(ai.dayChecks) ? (ai.dayChecks as Trip['ai']['dayChecks']) : {} },
    createdAt: num(raw.createdAt) ?? now,
    updatedAt: num(raw.updatedAt) ?? now,
  };
  if (!isObj(raw.cityGeo) || num(raw.cityGeo.lat) == null || num(raw.cityGeo.lng) == null) delete trip.cityGeo;
  delete trip.weather;
  return trip;
}

/**
 * 讀備份檔文字。接受本 App 的備份格式，也接受 App 內部儲存格式（{ state: { trips }, version }）。
 * 失敗丟出 BackupError（中文訊息，說明怎麼解決）。
 */
export function parseBackup(text: string, now: number = Date.now()): ParsedBackup {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new BackupError('這個檔案不是有效的備份檔。請選擇用「備份全部資料」匯出的 .json 檔。');
  }
  if (!isObj(data)) throw new BackupError('這個檔案不是有效的備份檔。請選擇用「備份全部資料」匯出的 .json 檔。');

  // App 內部儲存格式（zustand persist）
  const inner = isObj(data.state) ? data.state : null;
  const schema = num(data.schema) ?? num(data.version) ?? (inner ? 0 : SCHEMA_VERSION);
  if (schema > SCHEMA_VERSION) throw new BackupError('這份備份來自較新版本的旅途手帳，請先把 App 更新到最新版再還原。');

  let tripsRaw: unknown = inner ? inner.trips : data.trips;
  if (tripsRaw == null) throw new BackupError('檔案裡找不到行程資料。請選擇用「備份全部資料」匯出的 .json 檔。');
  if (schema < SCHEMA_VERSION) {
    const asRecord = Array.isArray(tripsRaw) ? Object.fromEntries(tripsRaw.filter(isObj).map((t, i) => [str(t.id, String(i)), t])) : tripsRaw;
    const migrated = migrate({ trips: asRecord }, schema) as { trips?: unknown };
    tripsRaw = migrated?.trips ?? asRecord;
  }
  const list = Array.isArray(tripsRaw) ? tripsRaw : isObj(tripsRaw) ? Object.values(tripsRaw) : [];
  const trips: Trip[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const raw of list) {
    const t = normalizeTrip(raw, now);
    if (!t || seen.has(t.id)) {
      skipped++;
      continue;
    }
    seen.add(t.id);
    trips.push(t);
  }
  if (!trips.length) throw new BackupError('備份檔裡沒有可以還原的行程。');
  const at = typeof data.exportedAt === 'string' ? Date.parse(data.exportedAt) : NaN;
  return { trips, exportedAt: Number.isFinite(at) ? at : null, skipped };
}

/** 還原前的摘要：幾個是新的、幾個會取代手機上同一個行程 */
export function restorePlan(existing: Record<string, Trip>, incoming: Trip[]): { added: number; replaced: number } {
  let replaced = 0;
  for (const t of incoming) if (existing[t.id]) replaced++;
  return { added: incoming.length - replaced, replaced };
}
