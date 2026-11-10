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
  /**
   * 導航目的地（地點辨識產生，含城市／州／國家背景，例如「Harbor Inn, Portland, OR, USA」）。
   * 有值時導航、地圖定位都優先用它；source = manual 的不會被自動辨識覆蓋。
   */
  place?: { query: string; name?: string; source: 'rule' | 'ai' | 'manual'; navigable?: boolean };
  /** 交通類行程的起訖（試算表寫「A → B」） */
  route?: { from: string; to: string };
  /** 試算表的「★ 必做」「◇ 可省略」標記 */
  flag?: 'must' | 'optional';
  /** 使用者原本的分類文字（例如「演唱會」「美術館」「早餐」），顯示用；type 是對應到的標準類型 */
  tag?: string;
  /** 交通說明（例如「步行 12 分 / 0.6 mile」「Uber 10 分」），顯示用，不拿去導航 */
  transit?: string;
  /**
   * 匯入時在試算表裡的順序（整份試算表的列序）。同一天照這個順序排，不只看時間：
   * 跨換日線的航班（台北 23:55 起飛、西雅圖 18:40 抵達）、晚上行程後面的「0:45」都照試算表。
   * 在 App 裡改了時間或日期就拿掉，改依時間排。
   */
  seq?: number;
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
  /** 這天天氣所屬的城市（多城市行程每天可能不同），例如「波特蘭」 */
  place?: string;
}

export interface WeatherCache {
  fetchedAt: number;
  lat: number;
  lng: number;
  days: DailyWeather[];
  /** 抓天氣時每天使用的座標摘要（多城市行程換城市或改日期時判斷過期用） */
  locKey?: string;
}

/** 一天的背景資訊（多城市行程的關鍵：天氣、導航都依當天城市） */
export interface DayMeta {
  /** 試算表日期列去掉日期後的原文，例如「西雅圖 → 波特蘭｜住 Harbor Inn｜演唱會」 */
  label?: string;
  /** 白天主要待的城市（天氣以這裡為準；一日遊是去的地方，移動日是抵達的城市；中英文皆可），例如「波特蘭」 */
  city?: string;
  /** 當天住宿 */
  lodging?: string;
  /** 城市定位（天氣、導航背景、地圖中心） */
  geo?: LatLng & { label?: string; en?: string; admin1?: string; timezone?: string; countryCode?: string };
  /** rule＝規則／城市對照表；ai＝AI 判斷；manual＝使用者手動（不會被自動覆蓋） */
  source?: 'rule' | 'ai' | 'manual';
}

/** 本趟 AI 累計用量（依 Anthropic 回傳的實際 token 數與官方單價估算） */
export interface AIUsage {
  /** 累計費用（新台幣） */
  costTwd: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** 依功能累計的費用（新台幣），key 例如 dayCheck、recommend、packing、receipt、places */
  byFeature: Record<string, number>;
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
    /** 本趟 AI 用量與費用 */
    usage?: AIUsage;
    /** 上次 AI 地點辨識的時間 */
    placesResolvedAt?: number;
  };
  /** 每天的城市／住宿等背景（key：日期） */
  days?: Record<ISODate, DayMeta>;
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
  /** 每趟行程 AI 花費上限（新台幣）；0 = 不限制 */
  aiTripBudgetTwd: number;
  /** 匯入行程後自動用 AI 辨識地點（有金鑰且未超過預算時） */
  aiAutoResolvePlaces: boolean;
}
