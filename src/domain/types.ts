/**
 * 資料模型 — 全 App 唯一的資料定義。
 * 改欄位時：1) 改這裡 2) 在 src/store/migrations.ts 加一個版本遷移 3) 跑 npm run typecheck。
 */

/** 'YYYY-MM-DD'（當地日期，不含時區） */
export type ISODate = string;
/** 'HH:mm'（24 小時制） */
export type HHmm = string;

export type ItemType = 'sight' | 'food' | 'transport' | 'stay' | 'shop' | 'other';
export type ExpenseCategory = 'food' | 'transport' | 'stay' | 'ticket' | 'shop' | 'other';

export interface LatLng {
  lat: number;
  lng: number;
}

/** 行程中的一站 */
export interface Item {
  id: string;
  /** 所屬日期；匯入「第 N 天」但尚未設出發日時為 null */
  date: ISODate | null;
  /** 匯入時是「第 N 天」格式，等出發日設定後換算 */
  dayOffset?: number;
  time?: HHmm;
  title: string;
  type: ItemType;
  address?: string;
  /** 地圖定位結果（自動地理編碼或從 Google 地圖連結解析） */
  geo?: LatLng & { source: 'geocode' | 'link' | 'manual' };
  /** 預計停留分鐘數 */
  durationMin?: number;
  /** 預估費用（以行程的當地貨幣計） */
  cost?: number;
  /** 使用者自己記的評分，例如 4.5 */
  rating?: number;
  note?: string;
  link?: string;
  done: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Expense {
  id: string;
  date: ISODate;
  title: string;
  amount: number;
  /** ISO 4217 三碼幣別，例如 JPY、TWD */
  currency: string;
  category: ExpenseCategory;
  /** 付款人（members 之一） */
  payer: string;
  /** 分攤者；空陣列代表全員 */
  split: string[];
  /** 收據照片（存在 IndexedDB 的 blob key） */
  receiptBlobKey?: string;
  /** 從試算表匯入的（以試算表為準更新時，試算表刪掉的列會一起移除；App 裡記的不會） */
  fromSheet?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** AI 排程檢查的一段移動 */
export interface SegmentEstimate {
  minutes: number;
  mode: string;
  tip?: string;
}

export interface DayCheck {
  at: number;
  /** 檢查時的行程點 id 順序；順序變了就視為過期 */
  itemIds: string[];
  segments: SegmentEstimate[];
  warnings: string[];
  summary?: string;
}

export interface DailyWeather {
  date: ISODate;
  code: number;
  tMax: number;
  tMin: number;
  /** 降雨機率 % （預報才有） */
  rainProb?: number;
  /** 雨量 mm（歷史氣候平均才有） */
  rainMm?: number;
  sunrise?: string;
  sunset?: string;
  /** forecast = 即時預報；climate = 歷年同期平均（超過 16 天的日期） */
  kind: 'forecast' | 'climate';
}

export interface WeatherCache {
  fetchedAt: number;
  lat: number;
  lng: number;
  days: DailyWeather[];
}

export interface TripCover {
  kind: 'orb' | 'image';
  /** orb 色相偏移（度） */
  hue?: number;
  /** kind = image 時，IndexedDB blob key */
  blobKey?: string;
}

export interface Trip {
  id: string;
  name: string;
  /** 首頁大字顯示的城市名，例如 KYOTO */
  city: string;
  /** 城市座標（天氣、地圖預設中心）；由 geocode 自動填 */
  cityGeo?: LatLng & { label?: string; timezone?: string; countryCode?: string };
  /** 航段代碼，例如 TPE → KIX */
  routeCode?: string;
  startDate: ISODate | null;
  endDate: ISODate | null;
  localCurrency: string;
  homeCurrency: string;
  /** 1 單位當地貨幣 = rate 單位本國貨幣 */
  rate: number;
  rateUpdatedAt?: number;
  /**
   * 其他幣別的匯率：1 單位該幣別 = N 單位本國貨幣（本國貨幣本身固定是 1，當地貨幣用上面的 rate）。
   * 沒有匯率的幣別「尚未換算」，不算進總額與分帳（見 domain/money.ts）。
   */
  rates?: Record<string, number>;
  budget?: number;
  members: string[];
  items: Item[];
  expenses: Expense[];
  /** Google 試算表網址（需設為「知道連結的人都能檢視」才能同步） */
  sheetUrl?: string;
  sheetSyncedAt?: number;
  cover: TripCover;
  ai: {
    dayChecks: Record<ISODate, DayCheck>;
    /** AI 依天氣給的穿搭建議 */
    packing?: { at: number; text: string; tips: string[] };
  };
  weather?: WeatherCache;
  /** 範例行程（首次開啟時建立），使用者改過設定後移除 */
  isExample?: boolean;
  createdAt: number;
  updatedAt: number;
}

export type ThemePref = 'system' | 'light' | 'dark';

export interface Settings {
  theme: ThemePref;
  /** Anthropic API 金鑰（只存在這台裝置） */
  anthropicApiKey: string;
  /** AI 使用的模型 */
  aiModel: string;
  haptics: boolean;
  /** 出發提醒（原生 App 才有） */
  reminders: boolean;
  reminderLeadMin: number;
  defaultHomeCurrency: string;
  /** 上次「備份全部資料」成功的時間（ms）；沒備份過則沒有 */
  lastBackupAt?: number;
}
