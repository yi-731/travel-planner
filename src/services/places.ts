/**
 * 地點辨識（規則版，免費、離線）：
 *  - 讀懂試算表的日期列（「3/9（二）｜西雅圖 → 波特蘭｜住 Harbor Inn」）→ 當天城市、住宿
 *  - 把「地點」欄分類：地址／地點名稱／路線（A → B）／交通說明（車程 8 分）／泛稱（看台、回程）
 *  - 幫每一站組出含城市背景的導航目的地（Item.place.query），例如「Harbor Inn, Portland, OR, USA」
 * AI 進階版在 services/ai.ts 的 resolvePlaces()。
 *
 * 想調整：
 *  - 城市中英文對照 → weather.ts 的 CITY_ALIAS_TABLE
 *  - 機場代碼 → AIRPORT_CITY；交通說明、泛稱的判斷 → TRANSIT_*／GENERIC_WORDS
 *  - 非中日韓國家把「站」「停車場」等字換成英文 → CJK_WORDS
 *
 * 注意：weather.ts 也 import 這個檔案（dayMetaFor），兩邊都不能在模組最外層呼叫對方的函式。
 */
import { tripDays } from '@/domain/dates';
import { sortDayItems } from '@/domain/schedule';
import type { DayMeta, ISODate, Item, Trip } from '@/domain/types';
import { isAbort } from './net';
import { findCitiesInText, findCityAlias, geocodeTravelCity, HAS_CJK, type CityAlias, type TravelCityGeo } from './weather';

export interface DayBanner {
  /** 去掉日期與星期後的原文 */
  label: string;
  /** 依序出現的城市（已用對照表正規化成顯示名，例如 ['台北','西雅圖']） */
  cities: string[];
  /** 當天白天主要待的城市（天氣以這裡為準）：路線的終點；一日遊的目的地；沒有路線時為唯一城市 */
  city?: string;
  lodging?: string;
  /** 路線的起點（「西雅圖 → 波特蘭」的西雅圖）；沒有路線時沒有 */
  origin?: string;
  /**
   * 一日遊（「奈良一日遊」「購物日｜波特蘭」）：city 是白天去的地方，
   * 晚上回原本的住宿（沒寫「住」時沿用前一天的住宿與過夜城市）
   */
  tour?: boolean;
  /** 一日遊時過夜的城市（日期列有寫才有，例如「奈良一日遊｜住 Hotel Kyoto」的京都） */
  base?: string;
}

/* ------------------------------------------------------------------ */
/* 共用小工具                                                          */
/* ------------------------------------------------------------------ */

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const lc = (s: string) => s.normalize('NFKC').toLowerCase();
/** 去掉表情符號的變體選擇字元（⚠\uFE0F → ⚠） */
const noVS = (s: string) => (s ?? '').replace(/\uFE0F/g, '');
const CJK_G = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]+/g;
const LATIN_LETTER = /[A-Za-zÀ-ɏ]/;
const ARROW = /\s*(?:→|->|⇒|➝|➔|⟶|➡|=>)\s*/;
const BRACKETS = /[（(【〔[]([^（）()【】〔〕[\]]*)[）)】〕\]]/g;
const stripBrackets = (s: string) => squash(s.replace(BRACKETS, ' '));
/** 「Joe's Pizza - Times Square」的連字號是名稱的一部分；全形破折號後面通常是補充說明 */
const beforeDash = (s: string) => squash(s.split(/\s*(?:—|――|─)\s*/)[0] || s);
const trimPunct = (s: string) => s.replace(/^[\s,，、。;；:：·・\-–—/+&]+|[\s,，、。;；:：·・\-–—/+&]+$/g, '');

const NUM = String.raw`\d+(?:\.\d+)?`;
const RANGE = String.raw`${NUM}(?:\s*[–\-~～至]\s*${NUM})?`;
const DUR_UNIT = String.raw`(?:分鐘|分钟|分|mins?|minutes?|小時|小时|hrs?|hours?|h)`;
const DIST_UNIT = String.raw`(?:miles?|mi|km|公里|英里|公尺|m)`;
const DURATION_RE = new RegExp(`${RANGE}\\s*${DUR_UNIT}(?![A-Za-z])`, 'i');
const DISTANCE_RE = new RegExp(`${RANGE}\\s*${DIST_UNIT}(?![A-Za-z])`, 'i');
/** 「約 20–30 分」「（8–10 mile）」這類時間距離補充 */
const TRAILING_DUR = new RegExp(`\\s*(?:約|大約|車程|步行|開車|飛行)?\\s*${RANGE}\\s*(?:${DUR_UNIT}|${DIST_UNIT})(?![A-Za-z]).*$`, 'i');

/* ------------------------------------------------------------------ */
/* 日期列                                                              */
/* ------------------------------------------------------------------ */

const WEEKDAY = String.raw`[（(]\s*(?:週|周|星期|礼拜|禮拜)?\s*[一二三四五六日天月火水木金土]\s*[）)]`;
/** 日期（後面要接星期、分隔符號、中文或結尾，避免把「Round 1/2 & 3」當日期） */
const DATE_IN_TEXT = new RegExp(
  String.raw`(?:\d{4}\s*[/.\-年]\s*)?\d{1,2}\s*[/月.\-]\s*\d{1,2}\s*日?\s*(?:${WEEKDAY}|(?:週|周|星期)[一二三四五六日天]|(?=\s*(?:[｜|・,，、:：]|$))|(?=\s*[\u3400-\u9fff]))`,
);
const LEADING_DAY_NO = /^\s*(?:第\s*\d+\s*天|day\s*\d+|D\d+)\s*[:：]?\s*/i;
const LEADING_WEEKDAY = new RegExp(`^\\s*(?:${WEEKDAY}|(?:週|周|星期)[一二三四五六日天])\\s*`);

function stripLeadingDate(text: string): string {
  let s = text;
  const m = DATE_IN_TEXT.exec(s);
  // 日期前面只有說明文字（試算表第一格常是「★ = 必做 … 日期 3/8（一）｜…」）也一起去掉
  if (m && (m.index === 0 || /日期\s*$|^\D*$/.test(s.slice(0, m.index)))) s = s.slice(m.index + m[0].length);
  s = s.replace(LEADING_DAY_NO, '').replace(LEADING_WEEKDAY, '');
  return s;
}

/** 「住 Harbor Inn」「住宿：Hyatt」「入住 XX」「Hotel: XX」；整段就是飯店名稱（XX 飯店、XX Hotel）也算 */
function lodgingOf(seg: string): string | undefined {
  const m =
    /^(?:住宿|入住|宿泊|住在|夜宿)\s*[:：]?\s*(.+)$/.exec(seg) ??
    /^住(?:[\s:：]+|(?=[A-Za-z0-9]))(.+)$/.exec(seg) ??
    /^(?:hotel|stay|lodging)\s*[:：]\s*(.+)$/i.exec(seg);
  const name = m ? m[1] : /(?:飯店|酒店|旅館|民宿|旅店|hotel|inn|resort|hostel|ryokan)$/i.test(seg) || /^hotel\s+\S/i.test(seg) ? seg : '';
  const clean = trimPunct(stripBrackets(name.replace(/[★☆◇◆⚠※]/g, ' ')));
  return clean || undefined;
}

const CITY_FILLER = /\s*(?:市區|市区|市內|市内|市中心|一帶|一带|周邊|周边|近郊|downtown)$/i;
/** 一日遊的字尾（「奈良一日遊」「Napa day trip」）：去掉後剩下的是目的地 */
const TOUR_SUFFIX = /\s*(?:一日遊|一日游|半日遊|半日游|二日遊|一日|之旅|day\s*trip|day\s*tour|tour|trip)$/i;
/** 「Portland Old Town」＝波特蘭 */
const AREA_SUFFIX = /\s+(?:strip|downtown|old\s*town)$/i;

/** 整段就是一個城市（「西雅圖」「Portland」「京都市區」「Portland Old Town」）→ 顯示名 */
function plainCity(seg: string): string | undefined {
  const s = trimPunct(stripBrackets(seg.replace(/[★☆◇◆]/g, ' ')));
  if (!s) return undefined;
  const a = findCityAlias(s) ?? findCityAlias(s.replace(CITY_FILLER, '')) ?? findCityAlias(s.replace(AREA_SUFFIX, ''));
  return a?.display;
}

/** 「奈良一日遊」→ 奈良：一日遊的目的地 */
function tourCity(seg: string): string | undefined {
  const s = trimPunct(stripBrackets(seg.replace(/[★☆◇◆]/g, ' ')));
  if (!TOUR_SUFFIX.test(s)) return undefined;
  const rest = trimPunct(s.replace(TOUR_SUFFIX, ''));
  return rest ? plainCity(rest) : undefined;
}

/** 路線的一個端點 → 城市顯示名（對照表找不到就用原文，但太長或像活動的不算） */
function routeEnd(part: string, strict: boolean): string | undefined {
  const s = trimPunct(stripBrackets(part.replace(/[★☆◇◆]/g, ' ')));
  if (!s) return undefined;
  const hit = plainCity(s);
  if (hit) return hit;
  const ms = findCitiesInText(s);
  if (ms.length === 1) return ms[0].alias.display;
  if (strict) return undefined;
  return s.length <= 30 && !/\d{1,2}:\d{2}/.test(s) ? s : undefined;
}

/** 解析日期列文字（已去掉日期部分），例如「西雅圖 → 波特蘭｜住 Harbor Inn｜演唱會」 */
export function parseDayBanner(text: string): DayBanner {
  const s = stripLeadingDate(squash(noVS(text ?? '').replace(/\r?\n/g, ' ')));
  const label = s.replace(/^[\s｜|/・·,，、:：\-–—]+/, '').trim();
  const segs = label
    .split(/\s*[｜|/／・]\s*/)
    .map((x) => x.trim())
    .filter(Boolean);

  let route: string[] | undefined;
  let lodging: string | undefined;
  const plain: string[] = [];
  const tours: string[] = [];
  /** 不是住宿、路線、城市的段落（活動說明）：最後再從裡面找城市 */
  const rest: string[] = [];
  for (const seg of segs) {
    const lod = lodgingOf(seg);
    if (lod) {
      lodging ??= lod;
      continue;
    }
    const tc = tourCity(seg);
    if (tc) {
      tours.push(tc);
      continue;
    }
    if (!route) {
      if (ARROW.test(seg)) {
        const ends = seg.split(ARROW).map((p) => routeEnd(p, false));
        if (ends.length >= 2 && ends[ends.length - 1]) {
          route = ends.filter((x): x is string => !!x);
          continue;
        }
      } else if (/[～~]|到/.test(seg)) {
        // 「台北～東京」「京都到大阪」：兩端都要是認得的城市（避免「睡到中午」）
        const ends = seg.split(/\s*(?:[～~]|到)\s*/).map((p) => routeEnd(p, true));
        if (ends.length >= 2 && ends.every(Boolean)) {
          route = ends as string[];
          continue;
        }
      }
    }
    const c = plainCity(seg);
    if (c) plain.push(c);
    else rest.push(seg);
    // 其他（「演唱會」「雷尼爾山一日遊」）是活動說明，不當城市
  }

  // 沒有路線、也沒有整段是城市：從活動說明裡找城市（「Waikiki 日出 + 鑽石頭山」→ 檀香山），
  // 寫了一日遊的段落優先，同一段取最後提到的
  let found: string | undefined;
  if (!route && !plain.length && !tours.length) {
    const tourish = rest.filter((x) => /一日|半日|day\s*trip|tour/i.test(x));
    for (const group of [tourish, rest]) {
      for (const seg of group) {
        const m = lastMention(seg);
        if (m) found = m.display;
      }
      if (found) break;
    }
  }

  const lodgingCity = lodging ? lastMention(lodging)?.display : undefined;
  const tourTarget = tours[tours.length - 1] ?? found;
  /** 一日遊時晚上回去的城市（住宿名稱或另一段寫的城市；都沒寫＝沿用前一天） */
  const base = lodgingCity ?? plain[0];
  const tour = !route && !!tourTarget && !(base && lc(base) === lc(tourTarget));
  const city = route?.[route.length - 1] ?? (tour ? tourTarget : base);
  const cities = [...new Set([...(route ?? []), ...plain, ...tours, ...(found ? [found] : []), ...(lodgingCity ? [lodgingCity] : [])])];
  const out: DayBanner = { label, cities, city, lodging };
  if (route && route.length >= 2) out.origin = route[0];
  if (tour) {
    out.tour = true;
    if (base) out.base = base;
  }
  return out;
}

/** 文字中最後提到的城市（飯店名稱通常是「品牌＋城市」，例如 Harbor Inn Portland） */
function lastMention(text: string): CityAlias | undefined {
  const ms = findCitiesInText(text);
  return ms.length ? ms[ms.length - 1].alias : undefined;
}

/* ------------------------------------------------------------------ */
/* 「地點 / 交通」欄                                                     */
/* ------------------------------------------------------------------ */

export type LocationKind = 'address' | 'place' | 'route' | 'transit' | 'generic' | 'empty';
export interface LocationCell {
  kind: LocationKind;
  /** address / place：清理後的文字；route：終點；transit／generic：原文 */
  value: string;
  from?: string;
  to?: string;
}

const STREET = String.raw`(?:St|Ave|Av|Blvd|Rd|Dr|Hwy|Way|Pl|Ln|Ct|Pkwy|Sq|Ter|Street|Avenue|Boulevard|Road|Drive|Highway|Lane|Place|Court|Parkway|Square|Terrace|Broadway|Plaza|Circle|Cir|Trail|Row)`;
/** 門牌＋路名（數字和路名之間不能有中文：「2 樓 Food Court」不是地址） */
const ADDR_NUM_STREET = new RegExp(String.raw`^\d+[A-Za-z-]*\s+[^\u3400-\u9fff]*?\b${STREET}\b\.?`, 'i');
/** 嚴格版：門牌後面直接是方位或首字大寫的路名（「1500 S Main St」）；後面接交通說明也還是地址 */
const ADDR_STRICT = new RegExp(String.raw`^\d+[A-Za-z-]?\s+(?:(?:N|S|E|W|NE|NW|SE|SW|North|South|East|West)\.?\s+)?(?:(?:[A-Z0-9][\w'.-]*|of|de|la|del)\s+){0,4}${STREET}\b`);
const ADDR_NUM_DIR = /^\d+[A-Za-z-]*\s+(?:N|S|E|W|NE|NW|SE|SW|North|South|East|West)\.?\s+[A-Za-z0-9]/;
const ADDR_INTERSECTION = new RegExp(String.raw`\b${STREET}\b\.?\s*(?:×|x|&|＆|and|/|與|和)\s*.*\b${STREET}\b`, 'i');
const ADDR_EU = /^(?:Rue|Via|Viale|Calle|Carrer|Rua|Avenida|Piazza|Plaza|Platz)\s+\S.*\d|\S+(?:straße|strasse|gasse|weg|platz)\s+\d+/i;
/** 中日韓地址；「3 號看台」「5 號出口」「2 樓」這種場館內的位置不算 */
const ADDR_CJK =
  /\d+\s*(?:丁目|番地?|号|號|巷|弄)(?!\s*(?:看台|出口|入口|門|閘|月台|站台|線|區|区|廳|館|樓|楼|車廂|攤|櫃|座|球場|場))|[都道府県].{0,8}[市区町村郡].{0,12}\d|[\u3400-\u9fff]\S*\d+-\d+(?:-\d+)?$|[\uac00-\ud7af]+(?:로|길)\s*\d+/;
/** 交通方式的字（「10 min walk via Main St」「15 分鐘 Uber 經 Sunset Blvd」是交通說明，不是地址） */
const TRANSIT_VERB = /步行|走路|走到|走去|^走|\d\s*分(?:鐘|钟)?走|車程|开车|開車|驅車|騎車|搭|轉乘|經|经|\b(?:walk|walking|drive|driving|ride|via|uber|lyft|grab|taxi|cab|bus|train|subway|metro|shuttle|monorail|tram)\b/i;
const LEADING_DUR = new RegExp(`^(?:約|大約|車程|步行|開車|驅車|飛行)?\\s*${RANGE}\\s*(?:${DUR_UNIT}|${DIST_UNIT})(?![A-Za-z])`, 'i');
/** 地址欄貼的網址（Google 地圖連結）：不是地點文字 */
const URL_TEXT = /^(?:https?:\/\/|www\.)/i;

function isAddress(s: string): boolean {
  return ADDR_NUM_STREET.test(s) || ADDR_NUM_DIR.test(s) || ADDR_INTERSECTION.test(s) || ADDR_EU.test(s);
}

/** 只說怎麼移動、不是地點的詞（單獨出現時） */
const TRANSIT_MODES = /^(?:monorail|uber|lyft|grab|taxi|bus|metro|subway|train|tram|shuttle|dash|bart|mrt|計程車|地鐵|捷運|公車|巴士|電車|火車|高鐵|新幹線|輕軌|纜車|接駁車?|渡輪|步行|走路|開車|自駕|租車|騎車)$/i;
/** 不具體、拿來導航沒意義的詞 */
const GENERIC_WORDS = new Set(
  [
    '看台', '回程', '去程', '返程', '飯店', '酒店', '旅館', '住宿', '民宿', '機場', '車站', '市區', '市中心', '附近', '周邊', '現場',
    '會場', '場內', '賽道', '賽道周邊', '賽場', '待定', '未定', '自由活動', '同上', '如上', '各自', '車上', '路上', '途中', '家',
    'hotel', 'airport', 'station', 'home', 'tbd', 'tba', 'n/a', '-', '–', '—',
  ].map((w) => w.toLowerCase()),
);
const GENERIC_AROUND = /^(?:賽道|會場|飯店|酒店|機場|車站|場館|園區|市區|這|那)?(?:周邊|周边|附近|一帶|一带|旁邊|旁边|內|内|裡|里)$/;

/** 分類「地點 / 交通」欄的內容 */
export function classifyLocation(cell: string): LocationCell {
  const raw = squash(noVS(cell ?? '').replace(/[★☆◇◆⚠※]/g, ' '));
  if (!raw || URL_TEXT.test(raw)) return { kind: 'empty', value: '' };
  // 「Hood River｜PST」：第一段才是地點，後面是時區或備註
  const first = raw.split(/\s*｜\s*|\s+\|\s+/)[0]?.trim() || raw;

  if (ARROW.test(first)) {
    const parts = first.split(ARROW).map((p) => trimPunct(p));
    const from = parts[0] ?? '';
    const to = trimPunct((parts[parts.length - 1] ?? '').replace(TRAILING_DUR, ''));
    if (!from && !to) return { kind: 'generic', value: raw };
    return { kind: 'route', value: to || from, from, to };
  }

  const s = trimPunct(first);
  const plainS = stripBrackets(s);
  const timed = DURATION_RE.test(plainS) || DISTANCE_RE.test(plainS);
  if (ADDR_CJK.test(s) && !DURATION_RE.test(s)) return { kind: 'address', value: s };
  // 「對街 120 S Main St」：去掉前面的中文說明
  const latinAddr = s.replace(/^[\u3400-\u9fff\s、，,：:]+(?=\d)/, '');
  const addrValue = () => stripBrackets(latinAddr).replace(/\s*[×＆]\s*/g, ' & ');
  if (ADDR_STRICT.test(latinAddr)) return { kind: 'address', value: addrValue() };
  // 先看是不是交通說明（「10 min walk via Main St」「20 分鐘走 Pine St」），再看寬鬆的地址格式
  if (timed && (LEADING_DUR.test(plainS) || TRANSIT_VERB.test(plainS))) return { kind: 'transit', value: raw };
  if (isAddress(latinAddr)) return { kind: 'address', value: addrValue() };

  if (DURATION_RE.test(s) || DISTANCE_RE.test(s)) return { kind: 'transit', value: raw };
  const bare = stripBrackets(s);
  const low = bare.toLowerCase();
  if (!bare || GENERIC_WORDS.has(low) || GENERIC_AROUND.test(bare) || TRANSIT_MODES.test(bare) || SEAT_AREA.test(bare)) return { kind: 'generic', value: raw };
  return { kind: 'place', value: bare };
}

/* ------------------------------------------------------------------ */
/* 標題                                                                */
/* ------------------------------------------------------------------ */

const MUST_MARK = /[★☆⭐✭✮✯]/u;
const OPT_MARK = /[◇◆◊]/;
const MARKS = /[★☆⭐✭✮✯◇◆◊⚠※✓✔✅●○◎▲△■□♦❗❕‼]+/gu;
/** 括號裡只有時間或距離（「（建議 1.5 小時）」「（30–40 分鐘）」「（1h25m）」「（8–10 mile）」） */
const DUR_PAREN = new RegExp(
  String.raw`^\s*(?:建議|建议|約|大約|停留|飛行|車程|步行|走路|開車|預計|預留|留)?\s*(?:${RANGE}\s*(?:${DUR_UNIT}|${DIST_UNIT})(?![A-Za-z])\s*(?:${NUM}\s*(?:m|min|分))?\s*(?:左右|以上)?|\d+h\d+m)\s*$`,
  'i',
);

/** 去掉 ★ ◇ ⚠ 等標記與括號補充說明，回傳乾淨名稱與標記 */
export function cleanTitle(title: string): { title: string; flag?: 'must' | 'optional' } {
  const t0 = noVS(title ?? '');
  const mi = t0.search(MUST_MARK), oi = t0.search(OPT_MARK);
  const flag = mi >= 0 && (oi < 0 || mi < oi) ? 'must' : oi >= 0 ? 'optional' : undefined;
  let t = squash(t0.replace(MARKS, ' '));
  // 開頭的【二選一】這類標籤
  t = t.replace(/^(?:[【〔][^】〕]*[】〕]\s*)+/, '');
  // 結尾只有時間／距離的括號
  for (let i = 0; i < 3; i++) {
    const m = /\s*[（(]([^（）()]*)[）)]\s*$/.exec(t);
    if (!m || !DUR_PAREN.test(m[1])) break;
    t = t.slice(0, m.index);
  }
  t = trimPunct(squash(t));
  return { title: t || squash(t0.replace(MARKS, ' ')), ...(flag ? { flag } : {}) };
}

/* ------------------------------------------------------------------ */
/* 城市背景                                                            */
/* ------------------------------------------------------------------ */

interface CityRef {
  alias?: CityAlias;
  display: string;
  en?: string;
  admin1?: string;
  cc?: string;
}

const US_STATES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE',
  'district of columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
  pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};
const US_STATE_CODES = new Set(Object.values(US_STATES));
/** 中日韓港澳台：當地 Google 地圖認得中文／漢字地名，不必換成英文 */
const CJK_COUNTRIES = new Set(['JP', 'KR', 'TW', 'CN', 'HK', 'MO']);

let enRegions: Intl.DisplayNames | null | undefined;
function countryEn(cc: string | undefined): string | undefined {
  if (!cc) return undefined;
  const c = cc.toUpperCase();
  if (c === 'US') return 'USA';
  if (c === 'GB') return 'UK';
  if (enRegions === undefined) {
    try {
      enRegions = new Intl.DisplayNames(['en'], { type: 'region', style: 'short' });
    } catch {
      enRegions = null;
    }
  }
  try {
    const n = enRegions?.of(c);
    return n && n !== c ? n : undefined;
  } catch {
    return undefined;
  }
}

function refFromAlias(a: CityAlias, geo?: DayMeta['geo']): CityRef {
  return { alias: a, display: a.display, en: geo?.en ?? a.en, admin1: geo?.admin1 ?? a.admin1, cc: geo?.countryCode ?? a.cc };
}

function refFromMeta(meta: DayMeta | undefined): CityRef | undefined {
  const city = meta?.city?.trim();
  if (!city) {
    if (!meta?.geo) return undefined;
    const label = meta.geo.label?.split(/[，,]/)[0]?.trim() || meta.geo.en || '';
    return label ? { display: label, en: meta.geo.en, admin1: meta.geo.admin1, cc: meta.geo.countryCode } : undefined;
  }
  const a = findCityAlias(city) ?? findCityAlias(city.replace(CITY_FILLER, ''));
  if (a) return refFromAlias(a, meta?.geo);
  const g = meta?.geo;
  return { display: city, en: g?.en ?? (HAS_CJK.test(city) ? undefined : city), admin1: g?.admin1, cc: g?.countryCode };
}

const sameRef = (a: CityRef | undefined, b: CityRef | undefined) =>
  !!a && !!b && ((!!a.alias && a.alias === b.alias) || lc(a.display) === lc(b.display) || (!!a.en && !!b.en && lc(a.en) === lc(b.en)));

const STREET_AFTER = new RegExp(String.raw`^\s+${STREET}\b`, 'i');

/** 文字裡有沒有這個詞（英文要整個字；streetOk = false 時「Portland Ave」這種路名不算） */
const containsWord = (text: string, word: string, streetOk = true) => {
  if (!word) return false;
  const t = lc(text), w = lc(word);
  const ok = (ch: string | undefined) => !ch || !/[a-z0-9à-ɏ]/.test(ch);
  for (let i = t.indexOf(w); i >= 0; i = t.indexOf(w, i + 1)) {
    const j = i + w.length;
    if (!HAS_CJK.test(w) && !(ok(t[i - 1]) && ok(t[j]))) continue;
    if (!streetOk && STREET_AFTER.test(text.normalize('NFKC').slice(j))) continue;
    return true;
  }
  return false;
};

/** 導航文字後面加上「城市, 州, 國家」；文字裡已經有的部分不重複 */
function withContext(core: string, ref: CityRef | undefined): string {
  const text = squash(core);
  if (!ref) return text;
  const parts: string[] = [];
  const cityName = ref.en ?? ref.display;
  const hasCity = [ref.en, ref.display, ref.alias?.en, ref.alias?.display].some((n) => !!n && containsWord(text, n, false));
  if (cityName && !hasCity) parts.push(cityName);
  const cc = ref.cc?.toUpperCase();
  const ownState = /,\s*([A-Z]{2})\b/.exec(text);
  if (cc === 'US') {
    const st = ref.admin1 ? (US_STATES[ref.admin1.toLowerCase()] ?? ref.admin1) : undefined;
    if (st && !(ownState && US_STATE_CODES.has(ownState[1])) && !containsWord(text, st)) parts.push(st);
  } else if ((cc === 'CA' || cc === 'AU') && ref.admin1 && !containsWord(text, ref.admin1) && lc(ref.admin1) !== lc(cityName)) {
    parts.push(ref.admin1);
  }
  const country = countryEn(cc);
  if (country && lc(country) !== lc(cityName) && !containsWord(text, country) && !(cc === 'US' && /\b(?:USA|United States)\b/i.test(text))) {
    parts.push(country);
  }
  return [text, ...parts].filter(Boolean).join(', ');
}

/* ------------------------------------------------------------------ */
/* 機場、站名、英文化                                                   */
/* ------------------------------------------------------------------ */

/** 機場代碼 → 城市（別名表的顯示名） */
const AIRPORT_CITY: Record<string, string> = {
  TPE: '桃園', TSA: '台北', KHH: '高雄', RMQ: '台中', TNN: '台南', HUN: '花蓮', TTT: '台東', MZG: '澎湖', KNH: '金門',
  NRT: '東京', HND: '東京', KIX: '大阪', ITM: '大阪', UKB: '神戶', NGO: '名古屋', CTS: '札幌', HKD: '函館', AKJ: '旭川',
  SDJ: '仙台', KMQ: '金澤', HIJ: '廣島', OKJ: '岡山', TAK: '高松', FUK: '福岡', KMJ: '熊本', NGS: '長崎', KOJ: '鹿兒島',
  OIT: '別府', OKA: '那霸', ISG: '石垣島', MMY: '宮古島', SHI: '宮古島',
  ICN: '仁川', GMP: '首爾', PUS: '釜山', CJU: '濟州', TAE: '大邱',
  HKG: '香港', MFM: '澳門', PVG: '上海', SHA: '上海', PEK: '北京', PKX: '北京', CAN: '廣州', SZX: '深圳', XMN: '廈門',
  CTU: '成都', TFU: '成都', HGH: '杭州', XIY: '西安', CKG: '重慶', NKG: '南京', KWL: '桂林', TAO: '青島',
  BKK: '曼谷', DMK: '曼谷', CNX: '清邁', CEI: '清萊', HKT: '普吉島', USM: '蘇美島', KBV: '甲米',
  SIN: '新加坡', KUL: '吉隆坡', PEN: '檳城', BKI: '亞庇', DPS: '峇里島', CGK: '雅加達',
  HAN: '河內', SGN: '胡志明市', DAD: '峴港', CXR: '芽莊', PQC: '富國島', DLI: '大叻',
  MNL: '馬尼拉', CEB: '宿霧', MPH: '長灘島', PNH: '金邊', REP: '暹粒', SAI: '暹粒', LPQ: '琅勃拉邦', MLE: '馬爾地夫',
  DXB: '杜拜', IST: '伊斯坦堡', LHR: '倫敦', LGW: '倫敦', STN: '倫敦', EDI: '愛丁堡', DUB: '都柏林',
  CDG: '巴黎', ORY: '巴黎', NCE: '尼斯', LYS: '里昂', FCO: '羅馬', MXP: '米蘭', LIN: '米蘭', VCE: '威尼斯', FLR: '佛羅倫斯',
  NAP: '拿坡里', BCN: '巴塞隆納', MAD: '馬德里', SVQ: '塞維亞', LIS: '里斯本', OPO: '波多', AMS: '阿姆斯特丹', BRU: '布魯塞爾',
  BER: '柏林', MUC: '慕尼黑', FRA: '法蘭克福', VIE: '維也納', SZG: '薩爾斯堡', PRG: '布拉格', BUD: '布達佩斯', ZRH: '蘇黎世',
  KEF: '雷克雅維克',
  JFK: '紐約', EWR: '紐約', LGA: '紐約', BOS: '波士頓', IAD: '華盛頓', DCA: '華盛頓', PHL: '費城', ORD: '芝加哥', MDW: '芝加哥',
  MIA: '邁阿密', MCO: '奧蘭多', MSY: '紐奧良', ATL: '亞特蘭大', IAH: '休士頓', HOU: '休士頓', DFW: '達拉斯', AUS: '奧斯汀',
  DEN: '丹佛', SLC: '鹽湖城', LAX: '洛杉磯', BUR: '洛杉磯', LGB: '長灘', SNA: '安納翰', SAN: '聖地牙哥', SFO: '舊金山',
  OAK: '舊金山', SJC: '聖荷西', SEA: '西雅圖', PDX: '波特蘭', LAS: '拉斯維加斯', PGA: '佩吉', PHX: '鳳凰城', HNL: '檀香山',
  OGG: '茂宜島', ANC: '安克拉治', GUM: '關島', YVR: '溫哥華', YYZ: '多倫多', YUL: '蒙特婁', YQB: '魁北克市', YYC: '班夫',
  MEX: '墨西哥城', SYD: '雪梨', MEL: '墨爾本', BNE: '布里斯本', OOL: '黃金海岸', PER: '伯斯', CNS: '凱恩斯', AKL: '奧克蘭',
  ZQN: '皇后鎮',
};
const AIRPORT_RE = /^([A-Z]{3})(?![A-Za-z0-9])\s*(.*)$/;
const AIRPORT_ANY = /(?<![A-Za-z0-9])([A-Z]{3})(?![A-Za-z0-9])/g;
const TERMINAL_WORDS: [RegExp, string][] = [
  [/^INTL$/, 'International Terminal'],
  // 洛杉磯機場國際航廈的通用簡稱（公開資訊）
  [/^TBIT$/, 'Tom Bradley International Terminal'],
  [/^T\s?(\d)(?:\s*\/\s*T?\d)*$/i, 'Terminal $1'],
  [/^Terminal\s*(\d)/i, 'Terminal $1'],
  [/^(?:國際)?(?:機場|航廈|航站|空港)$/, ''],
];

/** 代碼後面接的是全大寫英文字（「SEA LIFE」「SAN DIEGO」）：不是機場 */
const notAirportAfter = (rest: string) => /^[A-Z]{2,}\b/.test(rest) && !TERMINAL_WORDS.some(([re]) => re.test(rest));

function airportOf(text: string): { code: string; city?: CityAlias; query: string } | undefined {
  const m = AIRPORT_RE.exec(text.trim());
  if (!m || !(m[1] in AIRPORT_CITY)) return undefined;
  const rest = squash(m[2].replace(BRACKETS, ' '));
  if (notAirportAfter(rest)) return undefined;
  const city = findCityAlias(AIRPORT_CITY[m[1]]);
  if (!rest) return { code: m[1], city, query: `${m[1]} airport` };
  for (const [re, out] of TERMINAL_WORDS) {
    const t = re.exec(rest);
    if (t) {
      const term = out.replace('$1', t[1] ?? '');
      return { code: m[1], city, query: squash(`${m[1]} ${term ? (term.startsWith('Terminal') ? `airport ${term}` : term) : 'airport'}`) };
    }
  }
  // 「SFO AirTrain」這類機場內的設施：照原文
  return { code: m[1], city, query: `${m[1]} ${latinize(rest) || rest}` };
}

/** 航空公司或航班號（「Alaska」「UA 100」「BR12」「CI 8」）：機場代碼前面的這些字可以略過 */
const AIRLINE_TOKEN = /^(?:[A-Za-z][A-Za-z.'&-]*|[A-Z0-9]{2}\d{1,4}[A-Z]?|\d{1,4}[A-Z]?)$/;

/**
 * 機場：開頭就是代碼（「SFO T2」），或前面只有航空公司／航班號（「Alaska SEA」「UA 100 SFO」「BR12 TPE」）。
 * 標題寫「Alaska SEA → PDX」時路線起點是「Alaska SEA」。
 */
function airportIn(text: string): ReturnType<typeof airportOf> {
  const direct = airportOf(text);
  if (direct) return direct;
  const toks = squash(text).split(' ');
  for (let i = 1; i < toks.length && i <= 3; i++) {
    if (!AIRLINE_TOKEN.test(toks[i - 1])) return undefined;
    if (toks[i] in AIRPORT_CITY) return airportOf(toks.slice(i).join(' '));
  }
  return undefined;
}

/** 文字裡提到的機場代碼 → 城市 */
function airportCityIn(text: string): CityAlias | undefined {
  for (const m of text.matchAll(AIRPORT_ANY)) {
    if (!(m[1] in AIRPORT_CITY)) continue;
    if (notAirportAfter(text.slice((m.index ?? 0) + 3).trimStart())) continue;
    return findCityAlias(AIRPORT_CITY[m[1]]);
  }
  return undefined;
}

/** 非中日韓國家：英文名稱後面的中文字換成英文（Central 站 → Central station） */
const CJK_WORDS: [RegExp, string][] = [
  [/^(?:國際機場|機場|空港)/, 'airport'],
  [/^(?:停車場|停車塔)/, 'parking'],
  [/^(?:車站|站)/, 'station'],
  [/^(?:大廳|大堂)/, 'lobby'],
  [/^(?:正門口|正門|門口|入口)/, 'entrance'],
  [/^(?:中庭)/, 'courtyard'],
  [/^(?:廣場)/, 'plaza'],
  [/^(?:出口)/, 'exit'],
  [/^(?:碼頭)/, 'pier'],
  [/^(?:海灘)/, 'beach'],
  [/^(?:公園)/, 'park'],
  [/^(?:美術館|博物館)/, 'museum'],
  [/^(?:市場)/, 'market'],
];
/** 單獨出現時不是地點名稱的英文詞 */
const LATIN_NOISE = /^(?:monorail|uber|lyft|grab|taxi|bus|metro|subway|train|tram|shuttle|dash|app|check[\s-]?(?:in|out)|wifi|wi-fi|ok|vip|diy|mrt|bart|or|and|the|to)$/i;

/** 取英文名稱：中文字換成英文或去掉，挑最像專有名詞的一段（首字大寫的字最多，同分取前面的） */
function latinize(text: string): string {
  const t = text.replace(BRACKETS, ' ').replace(/\bcheck[\s-]?(?:in|out)\b/gi, ' ');
  let out = '';
  let last = 0;
  for (const m of t.matchAll(CJK_G)) {
    const idx = m.index ?? 0;
    out += t.slice(last, idx);
    const before = t.slice(0, idx).trimEnd();
    const word = LATIN_LETTER.test(before.slice(-1)) || /\d$/.test(before) ? CJK_WORDS.find(([re]) => re.test(m[0])) : undefined;
    // 整段就是那個字（「Narita 機場 Terminal 2」）：前後接在一起；後面還有別的中文（「Central 站搭 Tram」）：斷開
    const exact = !!word && word[0].exec(m[0])?.[0] === m[0];
    out += word ? ` ${word[1]}${exact ? ' ' : '\u0000'}` : '\u0000';
    last = idx + m[0].length;
  }
  out += t.slice(last);
  const runs = out
    .split('\u0000')
    .map((r) => trimPunct(squash(r.replace(/[，、。；：「」『』]/g, ' '))))
    .filter((r) => (r.match(/[A-Za-zÀ-ɏ]/g) ?? []).length >= 3 && !LATIN_NOISE.test(r));
  if (!runs.length) return '';
  const caps = (r: string) => r.split(/\s+/).filter((w) => /^[A-ZÀ-Ö0-9]/.test(w)).length;
  return runs.reduce((best, r) => (caps(r) > caps(best) ? r : best));
}

const LEADING_VERBS = /^(?:抵達|到達|前往|出發去|出發|搭乘|搭|步行到|步行去|走到|走去|開往|開車到|開車去|開車前往|回到|去|逛|參觀|拜訪|入住|午餐[:：]?|晚餐[:：]?|早餐[:：]?)\s*/;

/** 標題裡的地點名稱（導航用：去掉括號、破折號後的說明、check-in 等字；非中日韓國家取英文部分） */
function titleTarget(title: string, latin: boolean, bracketHint = true): string {
  const disp = cleanTitle(title).title;
  const core = beforeDash(stripBrackets(disp));
  if (latin) {
    const l = latinize(core);
    if (l) return l;
    // 括號裡才有英文（「湖邊晚餐（Food Court）」）
    const inBr = bracketHint ? [...disp.matchAll(BRACKETS)].map((m) => latinize(m[1])).find(Boolean) : undefined;
    if (inBr) return inBr;
  }
  const s = squash(core.replace(/\bcheck[\s-]?(?:in|out)\b/gi, ' '));
  const v = s.replace(LEADING_VERBS, '');
  return trimPunct(v.length >= 2 ? v : s);
}

/** 只是動作、沒有地點的標題（起床、整理、休息…） */
const ACTION_TITLE = /^(?:起床|整理|休息|睡午覺|午睡|小睡|補眠|睡覺|就寢|打包|收行李|洗澡|盥洗|梳洗|退房|寄放行李|集合|出發|自由活動|準備|換衣服|充電|發呆)/;
const BACK_TO_HOTEL = /回(?:到)?\s*(?:飯店|酒店|旅館|住處|民宿|住宿|房間|hotel)/i;
const HOTEL_WORD = /^(?:飯店|酒店|旅館|住宿|民宿|hotel)$/i;
const DEPART_WORDS = /起飛|起飞|報到|报到|搭機|登機|登机|check[\s-]?in/i;
const ARRIVE_WORDS = /抵達|到達|抵达|到达|降落|入境|arriv|landing/i;
const FLIGHT_TAG = /航班|班機|飛機|flight|機場|airport/i;

/**
 * 只有活動、沒有場館名稱的標題（「彩排 Rehearsal」「開幕演唱會」「閉幕典禮」「早餐 → 出發」）：
 * 拿去導航會找到同名的診所、貸款公司，所以不當作地點（AI 辨識可以依前後行程補上場館）。
 */
const EVENT_LATIN =
  /\b(?:free\s+practice|practice|fp\s?\d|q[1-3]|qualifying|quali|sprint(?:\s+(?:qualifying|shootout|race))?|shootout|race(?:\s+day)?|grand\s+prix|gp|session|warm[\s-]?up|parade|ceremony|podium|after[\s-]?party|concert|show|rehearsal|sound\s*check|encore|game|match|final|semi[\s-]?final|f1|formula\s*1|motogp|nascar|nba|mlb|nfl|nhl|day|night|plan\s*[a-c])\b/gi;
const EVENT_CJK =
  /看台|頒獎|賽後|賽前|開幕式|閉幕式|開幕|閉幕|排位賽|排位|正賽|練習賽|自由練習|衝刺賽|準決賽|決賽|比賽|球賽|賽事|[\u3400-\u9fff]{1,3}賽|演唱會|音樂會|彩排|加場|安可|典禮|氣氛|觀賽|看比賽|觀看|欣賞|觀賞|看|早餐|午餐|晚餐|宵夜|早午餐|下午茶|用餐|吃飯|集合|出發|抵達|到達|回程|移動/g;
const VENUE_SPLIT = /[\s、,，+＋&＆/／・·:：;；→⇒➝➔⟶➡~～\-–—]+|->|=>/;

function noVenue(text: string): boolean {
  const whole = trimPunct(stripBrackets(noVS(text)));
  // 整段是城市（「馬賽」）：是地點
  if (whole && findCityAlias(whole)) return false;
  const s = whole.normalize('NFKC').replace(EVENT_LATIN, ' ').replace(EVENT_CJK, ' ');
  return s
    .split(VENUE_SPLIT)
    .map((t) => t.trim())
    .filter(Boolean)
    .every((t) => /^[\d.]+$/.test(t) || GENERIC_WORDS.has(t.toLowerCase()) || TRANSIT_MODES.test(t) || ACTION_TITLE.test(t) || !!findCityAlias(t));
}

/**
 * 場館裡的某一區（「North Zone」「中庭」「大廳」「正門口」「3 號看台」）：本身不是地點，要接在同一天前面提到的場館後面
 * （「Sunrise Park 停車場」之後的「North Zone」→「Sunrise Park North Zone」）。
 */
const SUB_AREA_EN =
  /^(?:(?:upper|lower|north|south|east|west|main|back|front|inner|outer|middle|center|centre)\s+)?(?:lot|lobby|entrance|exit|gate|plaza|courtyard|concourse|level|floor|deck|zone|area|wing|atrium|hall|terrace|parking(?:\s+(?:lot|garage))?)(?:\s+[A-Z0-9]{1,3})?$/i;
const SUB_AREA_CJK =
  /^(?:\d{1,3}\s*[A-Za-z]?|[A-Za-z]\d{0,2})?\s*(?:號|号|區|区|樓|楼|F)?\s*(?:出口|入口|閘門|門口|大門|正門口?|側門|後門|中庭|大廳|大堂|廣場|停車場|停車塔|內|内|裡|樓上|樓下|頂樓|屋頂)$/;
/** 「Sunrise Park 停車場」「Ferry Building 大廳」「City Museum 正門口」的場館部分 */
const SUB_AREA_TAIL =
  /\s*(?:停車場|停車塔|大廳|大堂|中庭|正門口|正門|門口|入口|出口|內|内|裡|廣場|看台|parking(?:\s+(?:lot|garage))?|lobby|entrance|main\s+gate)$/i;

/** 看台、座位、月台（「3 號看台」「E 區看台」「Section 104」）：只說坐哪裡，不接場館，當泛稱 */
const SEAT_AREA =
  /^(?:\d{1,3}\s*[A-Za-z]?|[A-Za-z]\d{0,2})?\s*(?:號|号|區|区)?\s*(?:看台|觀眾席|座位區?|月台)$|^(?:(?:upper|lower|north|south|east|west|main)\s+)?(?:grandstands?|stands?|section|bleachers)(?:\s+[A-Z0-9]{1,4})?$/i;

const isSubArea = (text: string) => {
  const t = trimPunct(stripBrackets(noVS(text)));
  return !!t && (SUB_AREA_EN.test(t) || SUB_AREA_CJK.test(t));
};

/** 「出發（Union Square → Ferry Building 約 15 分）」：標題裡的路線（有好幾個箭頭時終點取下一段） */
function routeInText(text: string): { from: string; to: string } | undefined {
  const m = /([^（(【[｜|,，、。;；:：]*?)\s*(?:→|->|⇒|➝|➔|⟶|➡)\s*([^）)】\]｜|,，、。;；]*)/.exec(noVS(text));
  if (!m) return undefined;
  const from = trimPunct(m[1]);
  const to = trimPunct((m[2].split(ARROW)[0] ?? '').replace(TRAILING_DUR, ''));
  const letters = (s: string) => (s.replace(/[\d/:：（）()]/g, '').match(/[A-Za-zÀ-ɏ\u3400-\u9fff]/g) ?? []).length;
  return letters(to) >= 2 ? { from, to } : undefined;
}

/* ------------------------------------------------------------------ */
/* 一站的導航目的地                                                     */
/* ------------------------------------------------------------------ */

interface Lodging {
  name: string;
  ref?: CityRef;
}
interface Ctx {
  /** 目前所在的城市（多城市的日子會隨著路線改變） */
  current?: CityRef;
  /** 當天的城市 */
  dayRef?: CityRef;
  /** 今天的住宿、前一晚的住宿 */
  lodging?: Lodging;
  prevLodging?: Lodging;
  /** 同一天出現過的完整地點名稱（「Pike Place」→「Pike Place Market」） */
  names: string[];
  /** 這趟行程的城市（日期列出現過的）：文字提到這些城市一定採用 */
  tripCities: Set<CityAlias>;
  /** 同一天最近提到的場館（「Sunrise Park 停車場」的 Sunrise Park）：之後的「North Zone」接在它後面 */
  venue?: string;
}
interface Plan {
  place: NonNullable<Item['place']>;
  /** 這站之後所在的城市（路線終點、抵達某城市） */
  next?: CityRef;
}

/** 這段文字提到的城市（只採用這趟行程的城市，或和當天同一個國家的城市；菜名、路名不算） */
function mentionIn(texts: (string | undefined)[], ctx: Ctx): CityRef | undefined {
  const cc = (ctx.current?.cc ?? ctx.dayRef?.cc)?.toUpperCase();
  for (const text of texts) {
    if (!text) continue;
    const ap = airportCityIn(text);
    const ms = findCitiesInText(text).map((m) => m.alias);
    if (ap) ms.unshift(ap);
    if (!ms.length) continue;
    // 同時提到目前城市（「Tokyo Ramen Seattle」）：就是目前城市
    const cur = ms.find((a) => sameRef(refFromAlias(a), ctx.current));
    if (cur) return ctx.current;
    const ok = ms.filter((a) => ctx.tripCities.has(a) || (!!cc && a.cc === cc) || (!cc && !ctx.current));
    if (ok.length) return refFromAlias(ok[ok.length - 1]);
  }
  return undefined;
}

/** 「Harbor Inn」→ 前一晚的住宿「Harbor Inn Portland」 */
function matchLodging(text: string, ctx: Ctx): Lodging | undefined {
  const t = lc(stripBrackets(text)).trim();
  if (t.replace(/[^a-z\u3400-\u9fff]/g, '').length < 3) return undefined;
  for (const l of [ctx.lodging, ctx.prevLodging]) {
    if (!l) continue;
    const n = lc(l.name);
    if (n === t || containsWord(n, t) || containsWord(t, n)) return l;
  }
  return undefined;
}

/** 回飯店：今天的住宿；人還在前一晚住宿的城市時（退房前）用前一晚的 */
function pickLodging(ctx: Ctx): Lodging | undefined {
  const { lodging, prevLodging, current } = ctx;
  if (lodging && prevLodging && current && sameRef(current, prevLodging.ref) && !sameRef(current, lodging.ref)) return prevLodging;
  return lodging ?? prevLodging;
}

/** 「Pike Place」→ 同一天出現過的「Pike Place Market」（只有一個候選時） */
function expandName(text: string, ctx: Ctx): string {
  const t = text.trim();
  if (HAS_CJK.test(t) || t.replace(/[^A-Za-z]/g, '').length < 4) return t;
  const c = [...new Set(ctx.names.filter((n) => n.length > t.length && lc(n).startsWith(`${lc(t)} `)))];
  return c.length === 1 ? c[0] : t;
}

const SEPARATORS = /\s\+\s|、|\s\/\s|或|\bor\b/;

interface Target {
  core: string;
  name: string;
  ref?: CityRef;
  lodging?: Lodging;
  city?: boolean;
  airport?: boolean;
}

/**
 * 一段地點文字（地點欄、路線端點）→ 導航目標。
 * expand：用同一天的完整名稱補全（「Pike Place」→「Pike Place Market」）；標題裡的路線不補（「Disney」不該變成「Disney Springs」）。
 */
function resolveTarget(text: string, ctx: Ctx, extraMention: (string | undefined)[] = [], expand = true): Target {
  const name = trimPunct(text);
  const lod = matchLodging(name, ctx);
  if (lod) return { core: lod.name, name: lod.name, ref: lod.ref ?? ctx.current, lodging: lod };
  const ap = airportIn(name);
  if (ap) return { core: ap.query, name, ref: ap.city ? refFromAlias(ap.city) : ctx.current, airport: true };
  const cityAlias = findCityAlias(name) ?? findCityAlias(name.replace(CITY_FILLER, ''));
  if (cityAlias) {
    const ref = sameRef(refFromAlias(cityAlias), ctx.current) ? ctx.current : refFromAlias(cityAlias);
    return { core: ref?.en ?? cityAlias.en, name, ref, city: true };
  }
  const ref = mentionIn([name, ...extraMention], ctx) ?? ctx.current;
  const latin = !!ref?.cc && !CJK_COUNTRIES.has(ref.cc.toUpperCase());
  const base = expand ? expandName(name, ctx) : name;
  const core = latin ? latinize(base) || base : base;
  return { core: expand ? expandName(core, ctx) : core, name: base, ref };
}

/** 標題像不像店名／景點名（不是「午餐」「寄放行李」這類動作） */
function venueFromTitle(title: string, latin: boolean): string {
  const t = titleTarget(title, latin, false);
  if (!t || ACTION_TITLE.test(t)) return '';
  if (latin) return LATIN_LETTER.test(t) ? t : '';
  return GENERIC_WORDS.has(t.toLowerCase()) ? '' : t;
}

function isFlight(item: Item, route: { from: string; to: string } | undefined): boolean {
  if (FLIGHT_TAG.test(item.tag ?? '')) return true;
  if (/起飛|起飞|航班|班機|登機/.test(item.title)) return true;
  return !!route && !!airportIn(route.from) && !!airportIn(route.to);
}

/** 讀取一站的地點資訊（匯入時可能放在 route／address／transit） */
function locationOf(item: Item): LocationCell {
  if (item.route && (item.route.from || item.route.to)) {
    const to = item.route.to?.trim() ?? '', from = item.route.from?.trim() ?? '';
    return { kind: 'route', value: to || from, from, to };
  }
  const addr = item.address?.trim();
  if (addr) {
    const c = classifyLocation(addr);
    if (c.kind !== 'empty') return c;
  }
  // 匯入時交通說明和泛稱（「看台」「飯店」）都放在 transit：再分一次
  const tr = item.transit?.trim();
  if (tr) {
    const c = classifyLocation(tr);
    return c.kind === 'generic' ? c : { kind: 'transit', value: tr };
  }
  return { kind: 'empty', value: '' };
}

function finish(query: string, name: string, navigable = true): NonNullable<Item['place']> {
  return { query: squash(query), name: squash(name) || squash(query), source: 'rule', navigable };
}

/** 標題裡的路線能不能用：終點是動作、泛稱、活動（「早餐 → 出發」「演唱會 → 看台」），或在英文地區卻只有中文（「→ 必看」）都不算 */
function titleRouteOk(end: string, ctx: Ctx): boolean {
  const t = trimPunct(stripBrackets(end));
  if (!t) return false;
  if (airportIn(t) || findCityAlias(t) || findCityAlias(t.replace(CITY_FILLER, '')) || matchLodging(t, ctx)) return true;
  if (ACTION_TITLE.test(t) || GENERIC_WORDS.has(t.toLowerCase()) || GENERIC_AROUND.test(t) || TRANSIT_MODES.test(t) || noVenue(t)) return false;
  const cc = ctx.current?.cc?.toUpperCase();
  const latin = !!cc && !CJK_COUNTRIES.has(cc);
  return !latin || !!latinize(t) || findCitiesInText(t).length > 0;
}

/** 「Sunrise Park 停車場」→「Sunrise Park」：之後的「North Zone」「中庭」接在這個場館後面 */
function venueCore(text: string, latin: boolean): string | undefined {
  const v = trimPunct(stripBrackets(text).replace(SUB_AREA_TAIL, ''));
  if (!v || isSubArea(v) || GENERIC_WORDS.has(v.toLowerCase())) return undefined;
  const out = latin ? latinize(v) : v;
  return out || undefined;
}

function planItem(item: Item, ctx: Ctx): Plan {
  const title = noVS(item.title ?? '');
  const disp = cleanTitle(title).title;
  let loc = locationOf(item);
  const allText = [loc.value, loc.from, loc.to, item.address, item.transit].filter(Boolean).join(' ');
  const latinOf = (ref: CityRef | undefined) => !!ref?.cc && !CJK_COUNTRIES.has(ref.cc.toUpperCase());

  // 1) 回飯店
  if (BACK_TO_HOTEL.test(title) || (loc.kind === 'generic' && HOTEL_WORD.test(stripBrackets(loc.value)))) {
    const lod = pickLodging(ctx);
    if (lod) {
      const ref = lod.ref ?? ctx.current;
      ctx.venue = lod.name;
      return { place: finish(withContext(lod.name, ref), lod.name), next: ref };
    }
  }

  // 地址欄貼的是 Google 地圖連結：用連結解析出的座標導航（網址本身不能當地點文字）
  const g = item.geo;
  if (loc.kind !== 'route' && URL_TEXT.test((item.address ?? '').trim()) && g && g.source !== 'geocode') {
    return { place: finish(`${g.lat},${g.lng}`, disp || title) };
  }

  // 場館裡的某一區（「North Zone」）：接在同一天前面的場館後面；前面沒有場館就當泛稱（用標題）
  let subArea: string | undefined;
  if (loc.kind === 'place' && isSubArea(loc.value)) {
    subArea = trimPunct(stripBrackets(loc.value));
    loc = ctx.venue ? { kind: 'place', value: `${ctx.venue} ${subArea}` } : { kind: 'generic', value: loc.value };
    if (!ctx.venue) subArea = undefined;
  }

  // 2) 路線：起飛、報到用起點，其他用終點
  let route = loc.kind === 'route' ? { from: loc.from ?? '', to: loc.to ?? '' } : undefined;
  const fromTitle = !route && loc.kind !== 'address' && loc.kind !== 'place';
  /** 標題裡有箭頭、但終點不是地點（「早餐 → 出發」）：改看箭頭前面那段 */
  let rejected: { from: string } | undefined;
  if (fromTitle) {
    route = routeInText(squash(title.replace(MARKS, ' ')));
    if (route && !titleRouteOk(route.to, ctx)) {
      rejected = { from: route.from };
      route = undefined;
    }
  }
  if (route && (route.from || route.to)) {
    const flight = isFlight(item, route);
    // 「BR011 起飛 → 隔天清晨抵達桃園」：寫了起飛就是出發
    const depart = DEPART_WORDS.test(title) || (flight && !ARRIVE_WORDS.test(title));
    const text = depart && route.from ? route.from : route.to || route.from;
    const toTarget = route.to ? resolveTarget(route.to, ctx, [], !fromTitle) : undefined;
    let t = text === route.to && toTarget ? toTarget : resolveTarget(text, ctx, [], !fromTitle);
    // 往住宿所在的城市（「SEA → Portland」「散場後回 Portland」）＝回飯店
    if (!depart && t.city && ctx.lodging && sameRef(t.ref, ctx.lodging.ref ?? ctx.dayRef)) {
      const ref = ctx.lodging.ref ?? t.ref;
      t = { core: ctx.lodging.name, name: ctx.lodging.name, ref, lodging: ctx.lodging };
    }
    const next = toTarget?.ref && (toTarget.city || toTarget.airport || toTarget.lodging || !sameRef(toTarget.ref, ctx.current)) ? toTarget.ref : undefined;
    return { place: finish(withContext(t.core, t.ref), t.name), next };
  }

  const arrival = ARRIVE_WORDS.test(title);

  // 3) 地址：「店名, 地址, 城市…」
  if (loc.kind === 'address') {
    const ref = mentionIn([loc.value, title], ctx) ?? ctx.current;
    const venue = venueFromTitle(title, latinOf(ref));
    if (venue) ctx.venue = venue;
    const core = venue && !containsWord(loc.value, venue) ? `${venue}, ${loc.value}` : loc.value;
    return { place: finish(withContext(core, ref), venue || disp), next: movesTo(ref, arrival, ctx) };
  }

  // 4) 地點名稱
  if (loc.kind === 'place') {
    const t = resolveTarget(loc.value, ctx, [title]);
    if (t.lodging || t.airport) {
      ctx.venue = t.lodging ? t.lodging.name : undefined;
      // 在住宿「起床」「打包」「睡午覺」：人已經在那裡，不用導航（目的地仍是住宿）
      const stay = !!t.lodging && ACTION_TITLE.test(trimPunct(stripBrackets(disp))) && !/寄放行李/.test(disp);
      return { place: finish(withContext(t.core, t.ref), t.name, !stay), next: arrival ? t.ref : undefined };
    }
    if (!subArea) ctx.venue = t.city ? undefined : (venueCore(loc.value, latinOf(t.ref)) ?? ctx.venue);
    const venue = venueFromTitle(title, latinOf(t.ref));
    let core = t.core;
    if (venue && !/出發|集合|報到/.test(title)) {
      const v = lc(venue), p = lc(t.core);
      const shared = v.split(/\s+/).some((w) => w.length >= 4 && p.split(/\s+/).includes(w));
      const cjk = !latinOf(t.ref);
      // 「South Zone：雲霄飛車、水上設施」＋「South Zone」：標題只是在說那一區有什麼，用「Sunrise Park South Zone」
      if (subArea) core = v.includes(lc(subArea)) || shared ? t.core : `${venue}, ${t.core}`;
      else if (t.city) core = SEPARATORS.test(venue) || findCityAlias(venue) ? t.core : venue;
      // 標題包含地點：中日韓的標題通常是更精確的地名（嵐山竹林 ⊃ 嵐山）；英文常是活動名稱（Bay Bridge Light Show ⊃ Bay Bridge）
      else if (cjk && v.includes(p) && !SEPARATORS.test(venue)) core = venue;
      else if (v === p || v.includes(p) || p.includes(v) || SEPARATORS.test(venue)) core = t.core;
      else if (shared) core = venue;
      else core = `${venue}, ${t.core}`;
    }
    const next = t.city && t.ref && !sameRef(t.ref, ctx.current) ? t.ref : movesTo(t.ref, arrival, ctx);
    return { place: finish(withContext(core, t.ref), core === t.core ? t.name : venue || t.name), next };
  }

  // 5) 交通說明／泛稱／空白：用標題（只有活動、動作，沒有場館名稱的不能導航）
  const ref = mentionIn([allText, title], ctx) ?? ctx.current;
  const latin = latinOf(ref);
  const source = rejected ? rejected.from : title;
  const target = source ? titleTarget(source, latin) : '';
  const core = beforeDash(stripBrackets(cleanTitle(source).title));
  const action =
    !target ||
    ACTION_TITLE.test(trimPunct(stripBrackets(disp))) ||
    noVenue(core) ||
    noVenue(target) ||
    (!!rejected && latin && !LATIN_LETTER.test(target));
  if (action) {
    const plain = stripBrackets(disp) || disp;
    return { place: finish(withContext(plain, ref), plain, false) };
  }
  return { place: finish(withContext(target, ref), target), next: movesTo(ref, arrival, ctx) };
}

/**
 * 這一站之後人在哪個城市：寫了「抵達」就是那個城市；
 * 一日遊、移動日第一次出現當天的城市（「Maple Avenue（Portland）」）也算已經到了。
 */
function movesTo(ref: CityRef | undefined, arrival: boolean, ctx: Ctx): CityRef | undefined {
  if (!ref || sameRef(ref, ctx.current)) return undefined;
  return arrival || sameRef(ref, ctx.dayRef) ? ref : undefined;
}

function tripRef(trip: Pick<Trip, 'city' | 'cityGeo'>): CityRef | undefined {
  return refFromMeta(syntheticDay(trip));
}

function lodgingRef(name: string | undefined, fallback: CityRef | undefined): Lodging | undefined {
  if (!name?.trim()) return undefined;
  const a = lastMention(name);
  return { name: name.trim(), ref: a ? (sameRef(refFromAlias(a), fallback) ? fallback : refFromAlias(a)) : fallback };
}

/** 一站的導航目的地（規則版）。已有 source = manual / ai 的 place 不會被覆蓋（回傳原值）。 */
export function buildPlace(item: Item, day: DayMeta | undefined, trip: Pick<Trip, 'city' | 'cityGeo'>): Item['place'] {
  if (item.place && item.place.source !== 'rule') return item.place;
  const dayRef = refFromMeta(day) ?? tripRef(trip);
  const ctx: Ctx = {
    current: dayRef,
    dayRef,
    lodging: lodgingRef(day?.lodging, dayRef),
    names: dayNames([item], day ? [day.lodging] : []),
    tripCities: new Set([dayRef?.alias].filter((a): a is CityAlias => !!a)),
  };
  return planItem(item, ctx).place;
}

/** 同一天地點欄出現過的英文完整名稱（給 expandName 用） */
function dayNames(items: Item[], lodgings: (string | undefined)[]): string[] {
  const out: string[] = [];
  const push = (s: string | undefined) => {
    const t = s ? trimPunct(stripBrackets(s)) : '';
    if (t && !HAS_CJK.test(t) && t.includes(' ') && LATIN_LETTER.test(t)) out.push(t);
  };
  for (const it of items) {
    const c = locationOf(it);
    if (c.kind === 'place') push(c.value);
    if (c.kind === 'route') {
      push(c.from);
      push(c.to);
    }
  }
  for (const l of lodgings) if (l && !HAS_CJK.test(l)) out.push(l.trim());
  return out;
}

/* ------------------------------------------------------------------ */
/* 整趟套用                                                            */
/* ------------------------------------------------------------------ */

function syntheticDay(trip: Pick<Trip, 'city' | 'cityGeo'>): DayMeta | undefined {
  const city = trip.city?.trim() || trip.cityGeo?.label?.split(/[，,]/)[0]?.trim() || '';
  if (!city && !trip.cityGeo) return undefined;
  const a = city ? findCityAlias(city) : undefined;
  const geo = trip.cityGeo ? { ...trip.cityGeo, ...(a ? { en: a.en, admin1: a.admin1 } : {}) } : undefined;
  return { city: city || undefined, ...(geo ? { geo } : {}), source: 'rule' };
}

const geoMatchesCity = (geo: DayMeta['geo'], city: string | undefined) => {
  if (!geo || !city) return false;
  const a = findCityAlias(city);
  if (a && geo.en) return lc(geo.en) === lc(a.en);
  const label = geo.label?.split(/[，,]/)[0]?.trim();
  return !!label && (lc(label) === lc(city) || (!!a && findCityAlias(label) === a));
};

const samePlaceValue = (a: Item['place'], b: Item['place']) =>
  !!a && !!b && a.query === b.query && a.name === b.name && a.source === b.source && a.navigable === b.navigable;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** 同一個城市（中英文、對照表別名都算） */
const sameCityName = (a: string | undefined, b: string | undefined) => {
  if (!a?.trim() || !b?.trim()) return false;
  if (lc(a).trim() === lc(b).trim()) return true;
  const x = findCityAlias(a);
  return !!x && x === findCityAlias(b);
};

/** applyRulePlaces 每天的判斷結果 */
interface DayPlan {
  /** 這天的背景（不一定會存進 days：沒有日期列、和前一天一樣的不存） */
  meta: DayMeta;
  /** 這天晚上過夜的城市（一日遊時是住宿所在的城市，不是白天去的地方） */
  base?: DayMeta;
  /** 一日遊：早上從過夜的城市出發，白天在 meta.city */
  tour: boolean;
}

/**
 * 整趟套用規則版辨識（純函式）：每天的城市與住宿、每站 place、trip.city/cityGeo 建議。
 *  - 有日期列的日子：依日期列（沒寫城市＝沿用前一天過夜的城市；一日遊＝白天的城市是目的地，住宿沿用前一天）
 *  - 沒有日期列的日子不存（dayMetaFor 會往前找；之後改行程城市、改前一天的城市都會跟著變），
 *    只有前一天是一日遊時才存（不然往前找會找到一日遊的城市）
 *  - AI、手動設定的日子不動；還沒換算的「第 N 天」（__D3）原樣保留
 * 回傳新的 Trip，不修改傳入物件。
 */
export function applyRulePlaces(trip: Trip): Trip {
  const src = trip.days ?? {};
  const dates = [...new Set([...tripDays(trip), ...Object.keys(src)])].filter((d) => ISO_DAY.test(d)).sort();
  const days: Record<string, DayMeta> = {};
  for (const [k, v] of Object.entries(src)) if (!ISO_DAY.test(k) && v) days[k] = v;
  const fallback = syntheticDay(trip);
  const plans = new Map<ISODate, DayPlan>();
  /** 前一個有城市的日子（一日遊的日子也算） */
  let prev: DayMeta | undefined;
  /** 前一晚過夜的城市 */
  let prevBase: DayMeta | undefined;
  /** 最近一個存下來、有城市的日子（dayMetaFor 往前找會找到它） */
  let lastStored: DayMeta | undefined;
  /** 第一個日期列路線的起點（通常是出發地，例如台北）：不當作行程主要城市 */
  let home: string | undefined;

  /** 這個城市已知的座標：當天存的（城市沒變時）、前一天或前一晚過夜城市的 */
  const geoFor = (city: string | undefined, own?: DayMeta['geo']): DayMeta['geo'] => {
    if (!city) return undefined;
    if (own && geoMatchesCity(own, city)) return own;
    for (const m of [prev, prevBase]) if (m?.geo && sameCityName(m.city, city)) return m.geo;
    return undefined;
  };
  /** 一日遊晚上回去的城市（日期列寫了就用，否則前一晚的） */
  const baseNamed = (city: string | undefined): DayMeta | undefined => {
    if (!city) return prevBase ?? fallback;
    if (prevBase && sameCityName(prevBase.city, city)) return prevBase;
    const geo = geoFor(city);
    return { city, ...(geo ? { geo } : {}), source: 'rule' };
  };

  for (const date of dates) {
    const own = src[date];
    let meta: DayMeta;
    let base: DayMeta | undefined;
    let tour = false;
    let store = true;
    const explicit =
      !!own && (own.source === 'ai' || own.source === 'manual' || (!own.source && !own.label?.trim() && !!(own.city?.trim() || own.geo || own.lodging)));
    if (own && explicit) {
      // AI、手動（或沒有來源標記的舊資料）：照存的。住宿在別的城市、或住宿沒換但城市換了＝一日遊
      meta = { ...own };
      const lodgingCity = own.lodging ? lastMention(own.lodging)?.display : undefined;
      const sameLodging = !!own.lodging && !!prev?.lodging && lc(own.lodging).trim() === lc(prev.lodging).trim();
      if (meta.city && lodgingCity && !sameCityName(lodgingCity, meta.city)) {
        tour = true;
        base = baseNamed(lodgingCity);
      } else if (meta.city && !lodgingCity && sameLodging && prevBase?.city && !sameCityName(prevBase.city, meta.city)) {
        tour = true;
        base = prevBase;
      } else base = meta.city ? meta : prevBase;
    } else if (own?.label?.trim()) {
      const banner = parseDayBanner(own.label);
      if (home === undefined && !prev) home = banner.origin ?? (banner.cities.length > 1 && !banner.tour ? banner.cities[0] : undefined);
      if (banner.city) {
        const city = banner.city;
        tour = !!banner.tour;
        // 沒寫住宿：一日遊、或和前一晚同一個城市 → 沿用前一天的住宿
        const keep = !banner.lodging && !!prev?.lodging && (tour || sameCityName(prevBase?.city, city) || sameCityName(prev.city, city));
        meta = { ...own, city, source: 'rule' };
        const lodging = banner.lodging ?? (keep ? prev?.lodging : undefined);
        if (lodging) meta.lodging = lodging;
        else delete meta.lodging;
        const geo = geoFor(city, own.geo);
        if (geo) meta.geo = geo;
        else delete meta.geo;
        base = tour ? baseNamed(banner.base) : meta;
      } else {
        // 日期列沒寫城市：沿用前一晚過夜的城市（前一天是一日遊時，不是一日遊去的地方）
        const b = prevBase ?? fallback;
        meta = { label: own.label, source: 'rule' };
        if (b?.city) meta.city = b.city;
        const lod = banner.lodging ?? prev?.lodging ?? b?.lodging;
        if (lod) meta.lodging = lod;
        const geo = b?.geo ?? geoFor(b?.city, own.geo);
        if (geo) meta.geo = geo;
        base = meta.city ? meta : b;
      }
    } else {
      // 沒有日期列：跟著前一晚過夜的城市（第一天以前用行程城市），算出來但不存
      const b = prevBase ?? fallback;
      meta = { source: 'rule' };
      if (b?.city) meta.city = b.city;
      const lod = prev?.lodging ?? b?.lodging;
      if (lod) meta.lodging = lod;
      const geo = b?.geo ?? geoFor(b?.city, own?.geo);
      if (geo) meta.geo = geo;
      base = meta.city ? meta : b;
      store = !!lastStored?.city && !!meta.city && !sameCityName(lastStored.city, meta.city);
    }
    if (store && (meta.city || meta.label || meta.lodging || meta.geo)) {
      days[date] = meta;
      if (meta.city?.trim() || meta.geo) lastStored = meta;
    }
    plans.set(date, { meta, base, tour });
    if (meta.city) prev = meta;
    if (base?.city) prevBase = base;
  }

  // 行程主要城市：過夜最多天的城市（出發地除外）
  let city = trip.city;
  if (!city.trim()) {
    const count = new Map<string, number>();
    for (const d of dates) {
      const p = plans.get(d);
      const c = p?.base?.city ?? p?.meta.city;
      if (c && (!home || !sameCityName(c, home))) count.set(c, (count.get(c) ?? 0) + 1);
    }
    let best = '';
    for (const [c, n] of count) if (n > (count.get(best) ?? 0)) best = c;
    city = best;
  }
  let cityGeo = trip.cityGeo;
  if (!cityGeo && city.trim()) {
    const g = [...plans.values()].map((p) => p.meta).find((m) => m.geo && sameCityName(m.city, city))?.geo;
    if (g) cityGeo = { lat: g.lat, lng: g.lng, label: g.label, timezone: g.timezone, countryCode: g.countryCode };
  }

  const base: Trip = { ...trip, city, ...(cityGeo ? { cityGeo } : {}), days };
  const tripCities = new Set<CityAlias>();
  for (const p of plans.values()) {
    for (const c of [p.meta.city, p.base?.city, ...(p.meta.label ? parseDayBanner(p.meta.label).cities : [])]) {
      const a = c ? findCityAlias(c) : undefined;
      if (a) tripCities.add(a);
    }
  }

  const planned = new Map<string, Item['place']>();
  const byDate = new Map<string, Item[]>();
  for (const it of trip.items) {
    const k = it.date ?? '';
    byDate.set(k, [...(byDate.get(k) ?? []), it]);
  }
  for (const [date, raw] of byDate) {
    // 依一天的實際順序（試算表順序、過午夜的排最後）走，城市才會跟著路線改變
    const list = date ? sortDayItems(raw) : raw;
    const plan = date ? plans.get(date) : undefined;
    const meta = plan?.meta ?? (date ? dayMetaFor(base, date) : syntheticDay(base));
    const prevDate = date ? dates.filter((d) => d < date && plans.get(d)?.meta.city).pop() : undefined;
    const prevPlan = prevDate ? plans.get(prevDate) : undefined;
    const prevMeta = prevPlan?.meta;
    const dayRef = refFromMeta(meta) ?? tripRef(base);
    /** 晚上過夜的城市（一日遊時和 dayRef 不同）：住宿用這個城市 */
    const baseRef = plan?.tour ? (refFromMeta(plan.base) ?? tripRef(base)) : dayRef;
    const prevRef = prevPlan?.tour ? refFromMeta(prevPlan.base) : refFromMeta(prevMeta);
    const banner = meta?.label ? parseDayBanner(meta.label) : undefined;
    const origin = banner?.city && !banner.tour ? (banner.origin ?? (banner.cities.length > 1 ? banner.cities[0] : undefined)) : undefined;
    const originAlias = origin ? findCityAlias(origin) : undefined;
    const originRef = originAlias
      ? refFromAlias(originAlias, prevMeta && geoMatchesCity(prevMeta.geo, origin) ? prevMeta.geo : undefined)
      : plan?.tour
        ? baseRef
        : undefined;
    const lodging = lodgingRef(meta?.lodging, baseRef);
    const prevLodging = prevMeta?.lodging && prevMeta.lodging !== meta?.lodging ? lodgingRef(prevMeta.lodging, prevRef) : undefined;
    const names = dayNames(list, [meta?.lodging, prevMeta?.lodging]);

    const run = (start: CityRef | undefined) => {
      const ctx: Ctx = { current: start, dayRef, lodging, prevLodging, names, tripCities };
      let moved = false;
      const out = list.map((it) => {
        if (it.place && it.place.source !== 'rule') return it.place;
        const p = planItem(it, ctx);
        if (p.next) {
          moved = true;
          ctx.current = p.next;
        }
        return p.place;
      });
      return { out, moved };
    };
    // 移動日（A → B）、一日遊：從起點開始，看到路線、抵達才換城市；整天都沒看到就全部用當天城市
    let res = run(originRef && !sameRef(originRef, dayRef) ? originRef : dayRef);
    if (originRef && !sameRef(originRef, dayRef) && !res.moved) res = run(dayRef);
    list.forEach((it, i) => planned.set(it.id, res.out[i]));
  }

  const items = trip.items.map((it) => {
    const p = planned.get(it.id);
    if (!p || samePlaceValue(p, it.place)) return it;
    return { ...it, place: p };
  });
  return { ...base, items };
}

/** 某天的背景（沒有就往前找最近一天的城市） */
export function dayMetaFor(trip: Pick<Trip, 'days' | 'city' | 'cityGeo'>, date: ISODate | null): DayMeta | undefined {
  const days = trip.days ?? {};
  if (date) {
    const own = days[date];
    if (own && (own.city?.trim() || own.geo)) return own;
    let prevKey: string | undefined;
    for (const k of Object.keys(days)) if (k < date && (days[k]?.city?.trim() || days[k]?.geo) && (!prevKey || k > prevKey)) prevKey = k;
    if (prevKey) {
      const p = days[prevKey];
      return own?.label ? { ...p, label: own.label } : p;
    }
    const synth = syntheticDay(trip);
    return synth && own?.label ? { ...synth, label: own.label } : synth;
  }
  return syntheticDay(trip);
}

const cityKey = (city: string) => {
  const a = findCityAlias(city) ?? findCityAlias(city.replace(CITY_FILLER, ''));
  return a ? `alias:${a.en.toLowerCase()}|${a.cc ?? ''}` : lc(city).trim();
};

/** 某天的城市定位不到的原因：notfound＝查過、沒有這個城市；error＝連線失敗（之後可以再試） */
export type DayGeoMiss = 'notfound' | 'error';

/**
 * 幫還沒有座標的日期城市定位（城市對照表 → Open-Meteo），每找到一天就 onDay(date, geo)。
 * 同一個城市只查一次；某天查詢失敗、後面同城市的日子查到了，前面那天也會補上。
 * 找不到的日子呼叫 onMiss(date, 'notfound' | 'error')。一天都沒找到又有連線錯誤時丟出錯誤。
 */
export async function geocodeDays(
  trip: Trip,
  onDay: (date: ISODate, geo: NonNullable<DayMeta['geo']>) => void,
  signal?: AbortSignal,
  onMiss?: (date: ISODate, reason: DayGeoMiss) => void,
): Promise<number> {
  const days = trip.days ?? {};
  const cache = new Map<string, TravelCityGeo | null>();
  // 其他天已定位的同一個城市直接沿用
  for (const m of Object.values(days)) if (m?.city?.trim() && m.geo) cache.set(cityKey(m.city), { label: m.city, ...m.geo });
  const todo = Object.keys(days)
    .sort()
    .flatMap((date) => {
      const m = days[date];
      const city = m?.city?.trim();
      return city && !m.geo ? [{ date, key: cityKey(city), city }] : [];
    });
  let error: unknown = null;
  let aborted = false;
  /** 連線失敗的城市：同一次最多再試一次（後面的日子） */
  const failures = new Map<string, number>();
  for (const { key, city } of todo) {
    if (signal?.aborted) {
      aborted = true;
      break;
    }
    if (cache.has(key) || (failures.get(key) ?? 0) >= 2) continue;
    try {
      cache.set(key, await geocodeTravelCity(city, signal));
    } catch (e) {
      if (isAbort(e) || signal?.aborted) {
        aborted = true;
        break;
      }
      error = e;
      failures.set(key, (failures.get(key) ?? 0) + 1);
    }
  }
  let n = 0;
  for (const { date, key } of todo) {
    const g = cache.get(key);
    if (g) {
      onDay(date, { ...g });
      n++;
    } else if (!aborted || cache.has(key)) onMiss?.(date, cache.has(key) ? 'notfound' : 'error');
  }
  if (!n && error) throw error;
  return n;
}
