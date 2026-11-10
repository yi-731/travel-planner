/**
 * 備份與還原（純邏輯，有測試 backup.test.ts）。
 *
 * 備份檔格式（JSON）：
 *   { app: 'travel-planner', kind: 'backup', schema, exportedAt, trips: Trip[], settings }
 * - 不含 API 金鑰（安全）、不含照片（照片存在 IndexedDB，檔案會太大）、不含天氣快取（會自動重抓）。
 * - 還原時：版本較舊 → 先跑 store/migrations；版本較新 → 請使用者先更新 App。
 * - 每個行程都會補齊缺少的欄位、丟掉壞掉的行程點／花費，避免讀到奇怪的檔案讓 App 壞掉。
 *   只留認得的欄位、逐一檢查型別（不會把檔案內容整個展開進來）；照片 key 只接受 'blob:…'。
 * - healTrips：同一套整理，啟動時用在手機裡已存的資料上（壞資料自動恢復）。
 */
import { parseISODate, toISODate } from '@/domain/dates';
import { uid } from '@/domain/ids';
import { sanitizeRates } from '@/domain/money';
import type {
  DailyWeather,
  DayCheck,
  Expense,
  ExpenseCategory,
  Item,
  ItemType,
  LatLng,
  SegmentEstimate,
  Settings,
  Trip,
  TripCover,
  WeatherCache,
} from '@/domain/types';
import { migrate, SCHEMA_VERSION } from '@/store/migrations';
import { isBlobKey } from './model';

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
/** 選填文字：只要是字串就保留（空字串也算，跟 App 自己存的一樣） */
const anyStr = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const nonNeg = (v: unknown): number | undefined => (num(v) != null && (v as number) >= 0 ? (v as number) : undefined);
const positive = (v: unknown): number | undefined => (num(v) != null && (v as number) > 0 ? (v as number) : undefined);
/** 'YYYY-MM-DD' 而且是真的日期（'2026-13-45' 不算） */
const isoDate = (v: unknown): string | null => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = parseISODate(v);
  return d && toISODate(d) === v ? v : null;
};
const hhmm = (v: unknown): string | undefined => (typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v) ? v : undefined);
const code3 = (v: unknown, fallback: string) => (typeof v === 'string' && /^[A-Z]{3}$/.test(v.trim().toUpperCase()) ? v.trim().toUpperCase() : fallback);
/** 陣列裡的字串（其他型別略過）；不是陣列回傳 undefined */
const strList = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined);
/** 整個陣列都是字串才算數 */
const strictStrList = (v: unknown): string[] | undefined => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : undefined);
const latLng = (v: unknown): LatLng | undefined => {
  if (!isObj(v)) return undefined;
  const lat = num(v.lat), lng = num(v.lng);
  return lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : undefined;
};
/** 照片 key 只接受 App 自己產生的格式（'blob:…'），其他一律丟掉，見 model.ts 的 isBlobKey */
const blobKey = (v: unknown): string | undefined => (isBlobKey(v) ? v : undefined);

const ITEM_TYPES: ItemType[] = ['sight', 'food', 'transport', 'stay', 'shop', 'other'];
const CATEGORIES: ExpenseCategory[] = ['food', 'transport', 'stay', 'ticket', 'shop', 'other'];
const GEO_SOURCES = ['geocode', 'link', 'manual'] as const;
type GeoSource = (typeof GEO_SOURCES)[number];

/**
 * 每個欄位一個整理函式：型別不對就丟掉（選填）或補預設值（必填），不會把原始物件整個展開進來。
 * 型別要求列出 T 的「所有」欄位：domain/types.ts 新增欄位卻沒在這裡處理時會編譯失敗，
 * 避免新欄位在還原或啟動整理時被悄悄丟掉。
 */
type Fields<T, C> = { [K in keyof T]-?: (v: unknown, c: C) => T[K] | undefined };
function build<T, C>(raw: Obj, fields: Fields<T, C>, c: C): T {
  const out: Partial<Record<keyof T, unknown>> = {};
  for (const k of Object.keys(fields) as (keyof T & string)[]) {
    const v = fields[k](Object.hasOwn(raw, k) ? raw[k] : undefined, c);
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

interface Ctx {
  now: number;
  /** true = 整理手機裡已存的資料（不丟行程、保留天氣快取）；false = 讀備份檔 */
  heal: boolean;
}
interface ItemCtx extends Ctx {
  raw: Obj;
  title: string;
}
interface ExpenseCtx extends Ctx {
  localCurrency: string;
  members: string[];
  amount: number;
}

const ITEM_FIELDS: Fields<Item, ItemCtx> = {
  id: (v) => optStr(v) ?? uid(),
  date: (v) => isoDate(v),
  dayOffset: (v, c) => (isoDate(c.raw.date) ? undefined : num(v) != null && Math.abs(v as number) <= 366 ? (v as number) : undefined),
  time: hhmm,
  title: (_, c) => c.title,
  type: (v) => (ITEM_TYPES.includes(v as ItemType) ? (v as ItemType) : 'other'),
  address: anyStr,
  geo: (v) => {
    const p = latLng(v);
    if (!p) return undefined;
    const src = (v as Obj).source;
    return { ...p, source: GEO_SOURCES.includes(src as GeoSource) ? (src as GeoSource) : 'geocode' };
  },
  durationMin: nonNeg,
  cost: nonNeg,
  rating: num,
  note: anyStr,
  link: anyStr,
  done: (v) => v === true,
  createdAt: (v, c) => num(v) ?? c.now,
  updatedAt: (v, c) => num(v) ?? c.now,
};

function normalizeItem(raw: unknown, ctx: Ctx): Item | null {
  if (!isObj(raw)) return null;
  // 備份檔：沒有名稱的行程點略過；手機裡已存的：保留（名稱是數字就轉成文字）
  const title = typeof raw.title === 'string' ? raw.title : ctx.heal && typeof raw.title === 'number' ? String(raw.title) : null;
  if (title == null || (!ctx.heal && !title.trim())) return null;
  return build(raw, ITEM_FIELDS, { ...ctx, raw, title });
}

const EXPENSE_FIELDS: Fields<Expense, ExpenseCtx> = {
  id: (v) => optStr(v) ?? uid(),
  date: (v, c) => isoDate(v) ?? new Date(c.now).toISOString().slice(0, 10),
  title: (v) => str(v),
  amount: (_, c) => c.amount,
  currency: (v, c) => code3(v, c.localCurrency),
  category: (v) => (CATEGORIES.includes(v as ExpenseCategory) ? (v as ExpenseCategory) : 'other'),
  payer: (v, c) => optStr(v) ?? c.members[0],
  split: (v) => strList(v) ?? [],
  receiptBlobKey: blobKey,
  fromSheet: (v) => (v === true ? true : undefined),
  createdAt: (v, c) => num(v) ?? c.now,
  updatedAt: (v, c) => num(v) ?? c.now,
};

function normalizeExpense(raw: unknown, localCurrency: string, members: string[], ctx: Ctx): Expense | null {
  if (!isObj(raw)) return null;
  const amount = num(raw.amount);
  if (amount == null) return null;
  return build(raw, EXPENSE_FIELDS, { ...ctx, localCurrency, members, amount });
}

const SEGMENT_FIELDS: Fields<SegmentEstimate, Ctx> = {
  minutes: num,
  mode: anyStr,
  tip: anyStr,
};

const DAY_CHECK_FIELDS: Fields<DayCheck, Ctx> = {
  at: (v, c) => num(v) ?? c.now,
  itemIds: strictStrList,
  segments: (v, c) => (v as unknown[]).map((sg) => build(sg as Obj, SEGMENT_FIELDS, c)),
  warnings: strictStrList,
  summary: anyStr,
};

/** AI 排程檢查：結構不完整的整筆丟掉（之後重新檢查就好） */
function normalizeDayCheck(raw: unknown, ctx: Ctx): DayCheck | null {
  if (!isObj(raw) || !strictStrList(raw.itemIds) || !strictStrList(raw.warnings) || !Array.isArray(raw.segments)) return null;
  if (!raw.segments.every((sg) => isObj(sg) && num(sg.minutes) != null && typeof sg.mode === 'string')) return null;
  return build(raw, DAY_CHECK_FIELDS, ctx);
}

type Packing = NonNullable<Trip['ai']['packing']>;
const PACKING_FIELDS: Fields<Packing, Ctx> = {
  at: (v, c) => num(v) ?? c.now,
  text: anyStr,
  tips: strList,
};

const AI_FIELDS: Fields<Trip['ai'], Ctx> = {
  dayChecks: (v, c) => {
    const out: Trip['ai']['dayChecks'] = {};
    if (!isObj(v)) return out;
    for (const [date, check] of Object.entries(v)) {
      const ok = isoDate(date) ? normalizeDayCheck(check, c) : null;
      if (ok) out[date] = ok;
    }
    return out;
  },
  packing: (v, c) => (isObj(v) && typeof v.text === 'string' && Array.isArray(v.tips) ? build(v, PACKING_FIELDS, c) : undefined),
};

const DAILY_FIELDS: Fields<DailyWeather, Ctx> = {
  date: (v) => isoDate(v) ?? undefined,
  code: num,
  tMax: num,
  tMin: num,
  rainProb: num,
  rainMm: num,
  sunrise: hhmm,
  sunset: hhmm,
  kind: (v) => (v === 'forecast' || v === 'climate' ? v : undefined),
};

/** 天氣快取（只有整理手機裡的資料時保留；備份檔不含天氣） */
function normalizeWeather(raw: unknown, ctx: Ctx): WeatherCache | undefined {
  const p = latLng(raw);
  if (!p || !isObj(raw) || num(raw.fetchedAt) == null || !Array.isArray(raw.days)) return undefined;
  const days = raw.days
    .filter((d): d is Obj => isObj(d))
    .map((d) => build(d, DAILY_FIELDS, ctx))
    .filter((d) => d.date && d.code != null && d.tMax != null && d.tMin != null && d.kind);
  return { fetchedAt: raw.fetchedAt as number, ...p, days };
}

type CityGeo = NonNullable<Trip['cityGeo']>;
const CITY_GEO_FIELDS: Fields<CityGeo, Ctx> = {
  lat: num,
  lng: num,
  label: anyStr,
  timezone: anyStr,
  countryCode: anyStr,
};

const COVER_FIELDS: Fields<TripCover, Ctx> = {
  kind: (v) => (v === 'image' ? 'image' : 'orb'),
  hue: num,
  blobKey,
};

/** 封面：照片 key 有效才用照片，否則改回日落光球（保留色相） */
function normalizeCover(raw: unknown, ctx: Ctx): TripCover {
  if (!isObj(raw)) return { kind: 'orb', hue: 0 };
  const c = build(raw, COVER_FIELDS, ctx);
  if (c.kind === 'image' && c.blobKey) return c;
  return { kind: 'orb', hue: c.hue ?? 0 };
}

interface TripCtx extends Ctx {
  id: string;
  name: string;
  members: string[];
  localCurrency: string;
}

const TRIP_FIELDS: Fields<Trip, TripCtx> = {
  id: (_, c) => c.id,
  name: (_, c) => c.name,
  city: (v) => str(v),
  cityGeo: (v, c) => (latLng(v) ? build(v as Obj, CITY_GEO_FIELDS, c) : undefined),
  routeCode: anyStr,
  startDate: isoDate,
  endDate: isoDate,
  localCurrency: (_, c) => c.localCurrency,
  homeCurrency: (v) => code3(v, 'TWD'),
  rate: (v) => positive(v) ?? 1,
  rateUpdatedAt: num,
  rates: (v) => (isObj(v) ? sanitizeRates(v) : undefined),
  budget: positive,
  members: (_, c) => c.members,
  items: (v, c) => (Array.isArray(v) ? v : []).map((i) => normalizeItem(i, c)).filter((i): i is Item => !!i),
  expenses: (v, c) =>
    (Array.isArray(v) ? v : []).map((e) => normalizeExpense(e, c.localCurrency, c.members, c)).filter((e): e is Expense => !!e),
  sheetUrl: anyStr,
  sheetSyncedAt: num,
  cover: (v, c) => normalizeCover(v, c),
  ai: (v, c) => build(isObj(v) ? v : {}, AI_FIELDS, c),
  weather: (v, c) => (c.heal ? normalizeWeather(v, c) : undefined),
  isExample: (v) => (v === true ? true : undefined),
  createdAt: (v, c) => num(v) ?? c.now,
  updatedAt: (v, c) => num(v) ?? c.now,
};

export interface NormalizeOptions {
  /**
   * 整理手機裡已存的資料（啟動時）：缺 id 用 key、缺名稱補「未命名行程」（不丟行程），
   * 沒有名稱的行程點保留，天氣快取保留。預設 false = 讀備份檔。
   */
  heal?: boolean;
  /** heal 時行程在 trips 裡的 key（id 以它為準） */
  key?: string;
}

/** 任意物件 → 可安全使用的 Trip（只留認得的欄位，型別不對的丟掉或補預設值）；讀備份檔時缺 id 或名稱回傳 null */
export function normalizeTrip(raw: unknown, now: number = Date.now(), opts: NormalizeOptions = {}): Trip | null {
  if (!isObj(raw)) return null;
  const heal = !!opts.heal;
  const id = heal ? (opts.key ?? optStr(raw.id)) : optStr(raw.id);
  const name = optStr(raw.name) ?? (heal ? '未命名行程' : undefined);
  if (!id || !name) return null;

  const members = Array.isArray(raw.members) ? [...new Set(raw.members.filter((m): m is string => typeof m === 'string' && !!m.trim()))] : [];
  return build(raw, TRIP_FIELDS, {
    now,
    heal,
    id,
    name,
    members: members.length ? members : ['我'],
    localCurrency: code3(raw.localCurrency, 'JPY'),
  });
}

/**
 * 啟動時整理手機裡存的所有行程（給 store/data.ts 的 persist merge 用）。
 * 之前還原過壞掉的備份、讓畫面一打開就空白的 App，下次啟動會自己恢復：
 * 型別不對的欄位丟掉或補預設值，無效的照片 key 改回光球，但不會刪掉任何一個行程。
 * 單一行程整理失敗時保留原樣（不讓整理本身造成資料遺失）。
 */
export function healTrips(raw: unknown, now: number = Date.now()): Record<string, Trip> {
  if (!isObj(raw)) return {};
  const out: Record<string, Trip> = {};
  for (const [key, t] of Object.entries(raw)) {
    try {
      const healed = normalizeTrip(t, now, { heal: true, key });
      if (healed) out[key] = healed;
    } catch {
      if (isObj(t)) out[key] = t as unknown as Trip;
    }
  }
  return out;
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
