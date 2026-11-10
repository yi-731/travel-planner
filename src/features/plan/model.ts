/**
 * 行程分頁用的純邏輯：選哪一天、標題列文字、移動資訊的文字與圖示、表單欄位解析。
 * 沒有 React，方便寫測試（model.test.ts）。改行程頁顯示規則時先改這裡。
 */
import { itemType } from '@/domain/constants';
import { fmtDayNo, fmtMD, fromMinutes, toMinutes, weekday } from '@/domain/dates';
import { fmtMoney } from '@/domain/money';
import { canNavigate, placeQuery, type SegmentInfo } from '@/domain/schedule';
import type { DayMeta, ISODate, Item, LatLng } from '@/domain/types';
import { countryName, findCityAlias, HAS_CJK } from '@/services/weather';
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

/**
 * 導航用的地點字串：地點辨識的目的地優先；地址或目的地是貼上的網址時，改用座標或名稱
 * （見 domain/schedule.ts 的 placeQuery）。
 */
export function navQuery(it: Pick<Item, 'address' | 'title' | 'geo' | 'place'>): string {
  return placeQuery(it);
}

/**
 * 「移動」頁的 Google 地圖路線：終點沒有特定地點（休息、整理）回傳 null；
 * 起點沒有特定地點（起床）就從目前位置出發，不把「起床」當地址。
 */
export function segmentRoute(
  from: Pick<Item, 'address' | 'title' | 'geo' | 'place'>,
  to: Pick<Item, 'address' | 'title' | 'geo' | 'place'>,
): { origin: string | null; dest: string } | null {
  if (!canNavigate(to)) return null;
  return { origin: canNavigate(from) ? navQuery(from) : null, dest: navQuery(to) };
}

/* ---------------- 卡片 ---------------- */

/** 'SEA → PDX'；只有一端時 '→ Hilltop Observatory'／'Hotel Zephyr →' */
export function routeText(route: Item['route'] | undefined): string {
  const from = (route?.from ?? '').trim(), to = (route?.to ?? '').trim();
  if (!from && !to) return '';
  if (!from) return `→ ${to}`;
  if (!to) return `${from} →`;
  return `${from} → ${to}`;
}

const squashLower = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
/** 標題裡已經寫了（「Alaska SEA → PDX」的路線、「步行 10 分」的交通）就不再重複 */
const inTitle = (title: string, text: string) => !!text && squashLower(title).includes(squashLower(text));

export interface CardInfo {
  /** 類型旁邊的文字：使用者自己的分類（演唱會、早餐），沒有就用標準類型名稱 */
  tag: string;
  flag?: 'must' | 'optional';
  /** 第二行小字：路線與交通說明（「SEA → PDX · Uber 30 分」）；沒有就是空字串 */
  line: string;
}

/** 分類文字太長時截短（卡片上只放得下幾個字） */
export const MAX_TAG_CHARS = 8;

/** 行程卡片的分類、必做／可省略、路線與交通 */
export function cardInfo(it: Pick<Item, 'type' | 'tag' | 'flag' | 'route' | 'transit' | 'title'>): CardInfo {
  const raw = (it.tag ?? '').trim().replace(/\s+/g, ' ');
  const chars = [...raw];
  const tag = !raw ? itemType(it.type).label : chars.length > MAX_TAG_CHARS ? `${chars.slice(0, MAX_TAG_CHARS - 1).join('')}…` : raw;
  const route = routeText(it.route);
  const r = route && !(inTitle(it.title, (it.route?.from ?? '').trim()) && inTitle(it.title, (it.route?.to ?? '').trim())) ? route : '';
  const tr = (it.transit ?? '').trim().replace(/\s+/g, ' ');
  const transit = tr && tr !== r && !inTitle(it.title, tr) ? tr : '';
  return { tag, ...(it.flag ? { flag: it.flag } : {}), line: [r, transit].filter(Boolean).join(' · ') };
}

/* ---------------- 當天背景（城市、住宿） ---------------- */

export interface DayHeader {
  /** 當天城市（顯示用）；不知道時是空字串 */
  city: string;
  /** 住宿名稱（「住 Harbor Inn」的 Harbor Inn） */
  lodging: string;
}

export function dayHeader(meta: Pick<DayMeta, 'city' | 'lodging'> | undefined): DayHeader {
  return { city: (meta?.city ?? '').trim(), lodging: (meta?.lodging ?? '').trim() };
}

const normCity = (s: string | undefined) => (s ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * 「這一天」彈出頁儲存：使用者填的城市／住宿 → 這天新的 DayMeta（source = manual，不會再被自動辨識覆蓋）。
 * own：trip.days[date] 本身（可能沒有）；shown：畫面上顯示的（沒有自己的城市時是沿用前一天的）。
 * 城市沒改就沿用原本的座標；改了就清掉座標，讓天氣、導航重新定位。都沒改回傳 null。
 */
export function editDayMeta(
  own: DayMeta | undefined,
  shown: DayMeta | undefined,
  input: { city: string; lodging: string },
): DayMeta | null {
  const city = input.city.trim().replace(/\s+/g, ' ');
  const lodging = input.lodging.trim().replace(/\s+/g, ' ');
  const shownCity = (shown?.city ?? '').trim();
  const shownLodging = (shown?.lodging ?? '').trim();
  if (city === shownCity && lodging === shownLodging) return null;
  const next: DayMeta = { ...(own ?? {}), source: 'manual' };
  if (city) next.city = city;
  else delete next.city;
  if (lodging) next.lodging = lodging;
  else delete next.lodging;
  const geo = city && normCity(city) === normCity(shownCity) ? (own?.geo ?? shown?.geo) : undefined;
  if (geo) next.geo = geo;
  else delete next.geo;
  return next;
}

/**
 * 重新辨識地點後：導航目的地變了的行程點，原本用舊目的地查到的座標（geocode）不再可信 → 清掉讓地圖重新定位。
 * 來自地圖連結、手動的座標保留。回傳新的陣列（沒變的行程點維持同一個物件）。
 */
export function dropStaleGeo(before: Item[], after: Item[]): Item[] {
  const old = new Map(before.map((it) => [it.id, it]));
  return after.map((it) => {
    const prev = old.get(it.id);
    if (!prev || !it.geo || it.geo.source !== 'geocode') return it;
    if ((prev.place?.query ?? '') === (it.place?.query ?? '')) return it;
    const next = { ...it };
    delete next.geo;
    return next;
  });
}

export interface CityFeedback {
  tone: 'ok' | 'warn' | 'info';
  text: string;
}

/** 'Portland · Oregon · 美國' */
export function geoLine(geo: DayMeta['geo'] | undefined): string {
  if (!geo) return '';
  const name = geo.en?.trim() || geo.label?.split(/[，,]/)[0]?.trim() || '';
  const country = countryName(geo.countryCode);
  const admin = geo.admin1?.trim();
  return [name, admin && admin !== name ? admin : '', country && country !== name ? country : ''].filter(Boolean).join(' · ');
}

/**
 * 城市欄下方的即時說明：認得這個城市嗎？會定位到哪裡？
 * 中文城市名不在對照表時，Open-Meteo 常查不到（或查到同名的湖），提醒改用英文。
 */
export function cityFeedback(input: string, shown: Pick<DayMeta, 'city' | 'geo'> | undefined): CityFeedback {
  const city = input.trim();
  if (!city) return { tone: 'info', text: '留空＝沿用前一天（或行程設定）的城市。' };
  if (normCity(city) === normCity(shown?.city)) {
    const line = geoLine(shown?.geo);
    if (line) return { tone: 'ok', text: `已定位：${line}` };
  }
  const a = findCityAlias(city);
  if (a) {
    const country = countryName(a.cc);
    const where = [a.en, a.admin1, country].filter(Boolean).join(' · ');
    return { tone: 'ok', text: normCity(city) === normCity(shown?.city) ? `認得：${where}，連上網路後會自動定位。` : `認得：${where}。儲存後會重新定位。` };
  }
  if (HAS_CJK.test(city)) return { tone: 'warn', text: '城市對照表裡沒有這個中文名稱，可能查不到天氣。建議改用英文，例如 Kyoto。' };
  return { tone: 'info', text: '儲存後會用這個名稱查詢城市位置。' };
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
  /** 手動指定的導航目的地；空白＝自動辨識 */
  placeQuery: string;
  /** 自己的分類文字（演唱會、早餐） */
  tag: string;
  /** 交通說明（步行 15 分） */
  transit: string;
  /** '' = 一般 */
  flag: '' | 'must' | 'optional';
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
  placeQuery: '',
  tag: '',
  transit: '',
  flag: '',
});

export const draftFromItem = (it: Item): ItemDraft => ({
  title: it.title,
  type: it.type,
  date: it.date ?? '',
  time: it.time ?? '',
  // 匯入的路線（地址欄是空的）顯示成「A → B」，改掉就以新的地址為準
  address: it.address ?? routeText(it.route),
  durationMin: it.durationMin != null ? String(it.durationMin) : '',
  cost: it.cost != null ? String(it.cost) : '',
  rating: it.rating != null ? String(it.rating) : '',
  link: it.link ?? '',
  note: it.note ?? '',
  placeQuery: it.place?.source === 'manual' ? it.place.query : '',
  tag: it.tag ?? '',
  transit: it.transit ?? '',
  flag: it.flag ?? '',
});

/** 表單「進階」欄位有沒有填（收合時顯示摘要、決定要不要預設展開） */
export function advancedSummary(d: Pick<ItemDraft, 'placeQuery' | 'tag' | 'transit' | 'flag'>): string {
  return [
    d.flag === 'must' ? '必做' : d.flag === 'optional' ? '可省略' : '',
    d.tag.trim(),
    d.transit.trim(),
    d.placeQuery.trim() ? '自訂導航目的地' : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

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
  const typed = opt(d.address);
  // 地址欄還是原本路線的「A → B」：沒有改（路線照舊存在 route）
  const routeUnchanged = !!original?.route && !original.address?.trim() && !!typed && typed === routeText(original.route);
  const address = routeUnchanged ? undefined : typed;
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
  const dateChanged = !!original && (original.date ?? '') !== d.date;

  // 導航目的地：手動填的優先；清空手動的＝改回自動辨識；
  // 地址、名稱或日期（城市可能不同）改了，原本自動辨識／AI 的目的地不再適用，清掉後由呼叫端重新辨識
  const manualQ = opt(d.placeQuery);
  const wasManual = original?.place?.source === 'manual';
  let place: Item['place'];
  if (manualQ) place = wasManual && original?.place?.query === manualQ ? original.place : { query: manualQ, source: 'manual', navigable: true };
  else if (wasManual) place = undefined;
  else if (original?.place && !addrChanged && !titleChanged && !dateChanged) place = original.place;
  else place = undefined;
  const placeChanged = (original?.place?.query ?? '') !== (place?.query ?? '');

  // 舊座標是從（已改掉的）連結來的：連結換了就不再可信
  const geoFromOldLink = !!original?.geo && original.geo.source === 'link' && !safeParse(original.address);
  // 舊座標是用舊的導航目的地查到的：目的地換了就重新定位
  const geoFromOldPlace = !!original?.geo && original.geo.source === 'geocode' && placeChanged;
  let geo: Item['geo'];
  // 1. 地址欄貼的地圖連結最優先 2. 連結欄剛換成地圖連結 3. 沿用舊座標 4. 連結（沒有就清掉，讓地圖重新定位）
  if (fromAddr) geo = { ...fromAddr, source: 'link' };
  else if (linkChanged && fromLink) geo = { ...fromLink, source: 'link' };
  else if (original?.geo && !addrChanged && !(titleChanged && !address) && !(linkChanged && geoFromOldLink) && !geoFromOldPlace) geo = original.geo;
  else geo = fromLink ? { ...fromLink, source: 'link' } : undefined;
  const dur = num(d.durationMin);
  // 匯入的「A → B」路線存在 route（地址欄是空的）：自己填了不同的地址，就以填的地址為準
  const dropRoute = !!original?.route && !routeUnchanged && (addrChanged || !typed);
  // 改了時間或日期：不再照試算表的順序排，改依時間
  const timeChanged = !!original && (original.time ?? '') !== (opt(d.time) ?? '');
  const dropSeq = original?.seq != null && (timeChanged || dateChanged);
  return {
    ...(original ? { id: original.id } : {}),
    title: d.title.trim(),
    type: d.type,
    date: d.date || null,
    // 自己改了日期就不再是「第 N 天」待換算
    ...(original?.dayOffset != null && d.date && d.date !== original.date ? { dayOffset: undefined } : {}),
    ...(dropRoute ? { route: undefined } : {}),
    ...(dropSeq ? { seq: undefined } : {}),
    time: opt(d.time),
    address,
    geo,
    durationMin: dur === undefined ? undefined : Math.round(dur),
    cost: num(d.cost),
    rating: num(d.rating),
    link,
    note: opt(d.note),
    place,
    tag: opt(d.tag),
    transit: opt(d.transit),
    flag: d.flag || undefined,
  };
}
