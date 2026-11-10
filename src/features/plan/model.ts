/**
 * 行程分頁用的純邏輯：選哪一天、標題列文字、移動資訊的文字與圖示、表單欄位解析。
 * 沒有 React，方便寫測試（model.test.ts）。改行程頁顯示規則時先改這裡。
 */
import { fmtDayNo, fmtMD, fromMinutes, toMinutes, weekday } from '@/domain/dates';
import { fmtMoney } from '@/domain/money';
import { placeQuery, type SegmentInfo } from '@/domain/schedule';
import type { ISODate, Item, LatLng } from '@/domain/types';
import type { IconName } from '@/ui/Icon';

/* ---------------- 日期 ---------------- */

/** 行程頁要顯示哪一天：已選的（還在行程內）→ 今天（在行程內）→ 第一天 */
export function resolveDate(days: ISODate[], selected: ISODate | null, now: ISODate): ISODate | null {
  if (selected && days.includes(selected)) return selected;
  if (days.includes(now)) return now;
  return days[0] ?? null;
}

/** 前一天／後一天（超出範圍回傳 null） */
export function neighborDay(days: ISODate[], date: ISODate | null, dir: -1 | 1): ISODate | null {
  if (!date) return null;
  const k = days.indexOf(date);
  if (k < 0) return null;
  return days[k + dir] ?? null;
}

/** 11/21（週六） */
export const fmtMDWeek = (d: ISODate) => `${fmtMD(d)}（週${weekday(d)}）`;

/** '第 2 天 · 11/21（週六）'（表單日期選單用） */
export const dayOptionLabel = (days: ISODate[], d: ISODate) => `${fmtDayNo(days.indexOf(d) + 1)} · ${fmtMDWeek(d)}`;

/* ---------------- 金額 ---------------- */

const SYMBOLS: Record<string, string> = {
  JPY: '¥',
  CNY: 'CN¥',
  KRW: '₩',
  USD: 'US$',
  EUR: '€',
  GBP: '£',
  TWD: 'NT$',
  HKD: 'HK$',
  THB: '฿',
  SGD: 'S$',
  VND: '₫',
  AUD: 'A$',
  CAD: 'C$',
  PHP: '₱',
  MYR: 'RM',
  IDR: 'Rp',
  CHF: 'CHF ',
};

/** ¥12,800；沒有對應符號時寫「12,800 XXX」 */
export function fmtLocal(amount: number, currency: string): string {
  const sym = SYMBOLS[currency];
  return sym ? `${sym}${fmtMoney(amount)}` : `${fmtMoney(amount)} ${currency}`;
}

/** 一天行程點的預估費用總和（都沒填回傳 null） */
export function dayCost(items: Pick<Item, 'cost'>[]): number | null {
  const xs = items.map((i) => i.cost).filter((c): c is number => typeof c === 'number' && Number.isFinite(c));
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0);
}

/** 標題列小字：'第 2 天 · 11/21（週六）· 預估 ¥12,800' */
export function planEyebrow(days: ISODate[], date: ISODate | null, items: Pick<Item, 'cost'>[], currency: string): string {
  if (!date) return '尚未設定日期';
  const head = `${fmtDayNo(days.indexOf(date) + 1)} · ${fmtMDWeek(date)}`;
  const cost = dayCost(items);
  // 全形括號後面本身有留白，「·」前不再加空格
  return cost != null && cost > 0 ? `${head}· 預估 ${fmtLocal(cost, currency)}` : head;
}

/* ---------------- 移動 ---------------- */

/** AI 寫的交通方式文字 → 圖示 */
export function modeIcon(mode: string | undefined | null, distanceKm?: number | null): IconName {
  const m = (mode ?? '').toLowerCase();
  if (m) {
    if (/步行|走路|徒步|散步|walk/.test(m)) return 'walk';
    if (/單車|腳踏車|自行車|bike|bicycl|cycl/.test(m)) return 'bike';
    if (/計程|taxi|開車|自駕|租車|包車|drive|driving|car|uber/.test(m)) return 'car';
    return 'train';
  }
  if (distanceKm != null && Number.isFinite(distanceKm)) return distanceKm <= 1.2 ? 'walk' : 'train';
  return 'navigate';
}

/** 0.85 → '850 m'；3.24 → '3.2 km' */
export function fmtKm(km: number): string {
  if (km < 1) return `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

export interface SegmentLine {
  icon: IconName;
  /** '約 25 分 · 電車'／'直線 1.2 km'／'查路線' */
  text: string;
  /** true = 沒有估計也沒有距離，text 只是「點這裡查」的提示，不是實際數字 */
  hint: boolean;
  /** 太趕時顯示「時間可能不夠」 */
  warn: string | null;
  /** '建議 12:05 出發' */
  leave: string | null;
}

/** 行程卡片之間那一行小字 */
export function segmentLine(seg: Pick<SegmentInfo, 'estimate' | 'distanceKm' | 'tight' | 'leaveBy'>): SegmentLine {
  const est = seg.estimate && Number.isFinite(seg.estimate.minutes) ? seg.estimate : null;
  let text: string;
  if (est) text = [`約 ${Math.round(est.minutes)} 分`, est.mode.trim()].filter(Boolean).join(' · ');
  else if (seg.distanceKm != null && Number.isFinite(seg.distanceKm)) text = `直線 ${fmtKm(seg.distanceKm)}`;
  else text = '查路線';
  return {
    icon: modeIcon(est?.mode, seg.distanceKm),
    text,
    hint: !est && (seg.distanceKm == null || !Number.isFinite(seg.distanceKm)),
    warn: seg.tight ? '時間可能不夠' : null,
    leave: seg.leaveBy != null && seg.leaveBy >= 0 ? `建議 ${fromMinutes(seg.leaveBy)} 出發` : null,
  };
}

/** 移動所需分鐘：AI 估計 → 直線距離粗估（與 daySegments 相同算法）→ null */
export function travelMinutes(seg: Pick<SegmentInfo, 'estimate' | 'distanceKm'>): number | null {
  if (seg.estimate && Number.isFinite(seg.estimate.minutes)) return Math.round(seg.estimate.minutes);
  if (seg.distanceKm != null && Number.isFinite(seg.distanceKm)) return Math.round(((seg.distanceKm * 1.3) / 25) * 60);
  return null;
}

/** 太趕時的說明：離開上一站的時間、預計抵達時間、晚到幾分鐘 */
export function tightDetail(
  seg: Pick<SegmentInfo, 'from' | 'to' | 'estimate' | 'distanceKm'>,
): { leaveAt: string; arriveAt: string; lateMin: number } | null {
  const s = toMinutes(seg.from.time),
    e = toMinutes(seg.to.time);
  const travel = travelMinutes(seg) ?? 0;
  if (s == null || e == null) return null;
  const leave = s + (seg.from.durationMin ?? 0);
  const arrive = leave + travel;
  if (arrive <= e) return null;
  return { leaveAt: fromMinutes(leave), arriveAt: fromMinutes(arrive), lateMin: arrive - e };
}

/** 導航用的地點字串：地址若是貼上的網址，改用座標或名稱 */
export function navQuery(it: Pick<Item, 'address' | 'title' | 'geo'>): string {
  const addr = (it.address ?? '').trim();
  if (/^https?:\/\//i.test(addr)) return it.geo ? `${it.geo.lat},${it.geo.lng}` : it.title.trim();
  return placeQuery(it);
}

/* ---------------- 表單 ---------------- */

/** 使用者輸入的數字（可含全形、千分位）；空白回傳 undefined、不是數字回傳 NaN */
export function parseNum(raw: string): number | undefined {
  const s = raw
    .normalize('NFKC')
    .replace(/[,\s]/g, '')
    .replace(/^[¥$€£₩]/, '');
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

export interface ItemDraft {
  title: string;
  type: Item['type'];
  /** '' = 還沒有日期 */
  date: string;
  time: string;
  address: string;
  durationMin: string;
  cost: string;
  rating: string;
  link: string;
  note: string;
}

export type DraftErrors = Partial<Record<keyof ItemDraft, string>>;

export const emptyDraft = (date: ISODate | null): ItemDraft => ({
  title: '',
  type: 'sight',
  date: date ?? '',
  time: '',
  address: '',
  durationMin: '',
  cost: '',
  rating: '',
  link: '',
  note: '',
});

export const draftFromItem = (it: Item): ItemDraft => ({
  title: it.title,
  type: it.type,
  date: it.date ?? '',
  time: it.time ?? '',
  address: it.address ?? '',
  durationMin: it.durationMin != null ? String(it.durationMin) : '',
  cost: it.cost != null ? String(it.cost) : '',
  rating: it.rating != null ? String(it.rating) : '',
  link: it.link ?? '',
  note: it.note ?? '',
});

export function validateDraft(d: ItemDraft): DraftErrors {
  const err: DraftErrors = {};
  if (!d.title.trim()) err.title = '請輸入名稱，例如「清水寺」';
  if (d.date && !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) err.date = '日期格式不對，請重新選擇';
  if (d.time && toMinutes(d.time) == null) err.time = '時間格式不對，請用 24 小時制，例如 14:30';
  const dur = parseNum(d.durationMin);
  if (dur !== undefined && (Number.isNaN(dur) || dur < 0 || dur > 24 * 60)) err.durationMin = '請填 0～1440 的分鐘數';
  const cost = parseNum(d.cost);
  if (cost !== undefined && (Number.isNaN(cost) || cost < 0)) err.cost = '請填數字，例如 1500';
  const rating = parseNum(d.rating);
  if (rating !== undefined && (Number.isNaN(rating) || rating < 0 || rating > 5)) err.rating = '請填 0～5，例如 4.5';
  return err;
}

/**
 * 表單 → upsertItem 的欄位。geo：地址（或連結）是 Google 地圖分享連結就直接定位；
 * 連結欄改成新的地圖連結會移動圖釘；地址改了又解析不出座標，就清掉舊座標讓地圖重新定位。
 */
export function draftToPatch(d: ItemDraft, original: Item | null, parseLink: (s: string) => LatLng | null): Partial<Item> & Pick<Item, 'title'> {
  const opt = (s: string) => (s.trim() ? s.trim() : undefined);
  const num = (s: string) => {
    const n = parseNum(s);
    return n === undefined || Number.isNaN(n) ? undefined : n;
  };
  const address = opt(d.address);
  const link = opt(d.link);
  const safeParse = (s: string | undefined) => {
    if (!s) return null;
    try {
      return parseLink(s);
    } catch {
      return null;
    }
  };
  const fromAddr = safeParse(address);
  const fromLink = safeParse(link);
  const addrChanged = (original?.address ?? '') !== (address ?? '');
  const titleChanged = (original?.title ?? '') !== d.title.trim();
  const linkChanged = (original?.link ?? '') !== (link ?? '');
  // 舊座標是從（已改掉的）連結來的：連結換了就不再可信
  const geoFromOldLink = !!original?.geo && original.geo.source === 'link' && !safeParse(original.address);
  let geo: Item['geo'];
  // 1. 地址欄貼的地圖連結最優先 2. 連結欄剛換成地圖連結 3. 沿用舊座標 4. 連結（沒有就清掉，讓地圖重新定位）
  if (fromAddr) geo = { ...fromAddr, source: 'link' };
  else if (linkChanged && fromLink) geo = { ...fromLink, source: 'link' };
  else if (original?.geo && !addrChanged && !(titleChanged && !address) && !(linkChanged && geoFromOldLink)) geo = original.geo;
  else geo = fromLink ? { ...fromLink, source: 'link' } : undefined;
  const dur = num(d.durationMin);
  return {
    ...(original ? { id: original.id } : {}),
    title: d.title.trim(),
    type: d.type,
    date: d.date || null,
    // 自己改了日期就不再是「第 N 天」待換算
    ...(original?.dayOffset != null && d.date && d.date !== original.date ? { dayOffset: undefined } : {}),
    time: opt(d.time),
    address,
    geo,
    durationMin: dur === undefined ? undefined : Math.round(dur),
    cost: num(d.cost),
    rating: num(d.rating),
    link,
    note: opt(d.note),
  };
}
