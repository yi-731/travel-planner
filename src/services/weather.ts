/**
 * 天氣服務（Open-Meteo，免費、免金鑰）
 * - 今天起 16 天內：即時預報 https://api.open-meteo.com/v1/forecast
 * - 更遠（或已過去）的日期：歷年同期平均 https://archive-api.open-meteo.com/v1/archive（近 3 年，每年一個小請求）
 * - 城市定位：https://geocoding-api.open-meteo.com/v1/search，查不到再用 Photon（OpenStreetMap）
 *
 * 想調整：
 * - 預報／氣候快取多久過期 → FORECAST_TTL_MS / CLIMATE_TTL_MS
 * - 中文城市名查不到 → 在 CITY_ALIAS_TABLE 加一行
 * - 天氣代碼的中文說法 → WMO 對照表 WMO
 */
import { addDays, parseISODate, today, tripDays } from '@/domain/dates';
import type { DailyWeather, ISODate, LatLng, Trip, WeatherCache } from '@/domain/types';
import { dayMetaFor } from './places';
import type { IconName } from '@/ui/Icon';
import { fetchJson, HttpError } from './net';

export interface CityGeo extends LatLng {
  label: string;
  timezone?: string;
  countryCode?: string;
}

const SERVICE = '天氣服務';
const CITY_SERVICE = '城市定位服務';
/** 預報可查到今天 + 15 天（共 16 天） */
export const FORECAST_LAST_OFFSET = 15;
export const FORECAST_TTL_MS = 3 * 60 * 60 * 1000;
export const CLIMATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** 歷年平均取幾年 */
export const CLIMATE_YEARS = 3;
/** 歷史資料約有 5 天延遲；只用一週前（含）以前的資料 */
const ARCHIVE_DELAY_DAYS = 7;

/* ------------------------------------------------------------------ */
/* 城市定位                                                            */
/* ------------------------------------------------------------------ */

/** 含中日韓文字（平假名／片假名、漢字、相容漢字、韓文） */
export const HAS_CJK = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/;

/**
 * 常見旅遊城市的中文寫法 → 英文查詢名。Open-Meteo 的中文地名不齊全（例如「首爾」「大阪」「台北」查不到，
 * 「台南」「高雄」會查到同名的中國村莊），所以熱門城市先用英文名查，國家代碼用來排除同名地點。
 * 格式：顯示名|英文查詢名|國家代碼|其他寫法（逗號分隔，可省略）|州／省（英文，可省略；同名城市很多時用來挑對的，
 * 例如 Portland 有奧勒岡州和緬因州兩個）。新增城市：加一行即可。
 * 其他寫法也會用來在行程文字裡認城市（「住 Harbor Inn Portland」→ 波特蘭）：
 * 4 個字母以內的英文寫法（SF、NYC、Kobe）要大小寫完全相同才算。
 */
const CITY_ALIAS_TABLE = `
東京|Tokyo|JP|東京都
大阪|Osaka|JP|大阪市
京都|Kyoto|JP|京都市
奈良|Nara|JP|奈良市
神戶|Kobe|JP|神户,神戸
名古屋|Nagoya|JP
橫濱|Yokohama|JP|横濱,横浜
鎌倉|Kamakura|JP
箱根|Hakone|JP
札幌|Sapporo|JP|札幌市
函館|Hakodate|JP
小樽|Otaru|JP
旭川|Asahikawa|JP
富良野|Furano|JP
仙台|Sendai|JP
金澤|Kanazawa|JP|金沢
高山|Takayama|JP||Gifu
白川鄉|Shirakawa-go|JP|白川郷,白川村|Gifu
輕井澤|Karuizawa|JP|軽井沢
河口湖|Fujikawaguchiko|JP|富士河口湖
日光|Nikko|JP
宇治|Uji|JP
熱海|Atami|JP
姬路|Himeji|JP|姫路
廣島|Hiroshima|JP|広島
宮島|Hatsukaichi|JP|嚴島,厳島,宮島口
岡山|Okayama|JP
倉敷|Kurashiki|JP
高松|Takamatsu|JP
福岡|Fukuoka|JP|福岡市,博多
熊本|Kumamoto|JP
長崎|Nagasaki|JP
鹿兒島|Kagoshima|JP|鹿児島
別府|Beppu|JP
由布院|Yufu|JP|湯布院
那霸|Naha|JP|那覇
沖繩|Naha|JP|沖縄,冲绳
石垣島|Ishigaki|JP|石垣
宮古島|Miyakojima|JP
首爾|Seoul|KR|首尔,漢城
釜山|Busan|KR
濟州|Jeju City|KR|濟州島,济州
大邱|Daegu|KR
仁川|Incheon|KR
慶州|Gyeongju|KR
江陵|Gangneung|KR
台北|Taipei|TW|臺北,台北市,臺北市
新北|New Taipei|TW|新北市
基隆|Keelung|TW
桃園|Taoyuan|TW|桃園市
新竹|Hsinchu|TW
台中|Taichung|TW|臺中,台中市,臺中市
彰化|Changhua|TW
南投|Nantou|TW
嘉義|Chiayi|TW
台南|Tainan|TW|臺南,台南市,臺南市
高雄|Kaohsiung|TW|高雄市
屏東|Pingtung|TW
墾丁|Hengchun|TW|恆春
宜蘭|Yilan|TW
花蓮|Hualien|TW
台東|Taitung|TW|臺東
澎湖|Magong|TW|馬公
金門|Kinmen|TW
香港|Hong Kong|HK|HK
澳門|Macau|MO|澳门,Macao
上海|Shanghai|CN
北京|Beijing|CN
廣州|Guangzhou|CN|广州
深圳|Shenzhen|CN
廈門|Xiamen|CN|厦门
成都|Chengdu|CN
杭州|Hangzhou|CN
西安|Xi'an|CN
重慶|Chongqing|CN|重庆
南京|Nanjing|CN
蘇州|Suzhou|CN|苏州
桂林|Guilin|CN
青島|Qingdao|CN|青岛
曼谷|Bangkok|TH
清邁|Chiang Mai|TH|清迈
清萊|Chiang Rai|TH
普吉島|Phuket|TH|普吉
芭達雅|Pattaya|TH|芭堤雅
華欣|Hua Hin|TH
甲米|Krabi|TH
蘇美島|Ko Samui|TH|蘇梅島,Koh Samui
新加坡|Singapore|SG
吉隆坡|Kuala Lumpur|MY|KL
檳城|George Town|MY|檳榔嶼,Penang
馬六甲|Malacca|MY|麻六甲,Melaka
亞庇|Kota Kinabalu|MY|沙巴
峇里島|Denpasar|ID|巴厘島,峇里,巴里島,Bali
雅加達|Jakarta|ID
河內|Hanoi|VN|河内
胡志明市|Ho Chi Minh City|VN|胡志明,西貢,Saigon
峴港|Da Nang|VN|岘港
會安|Hoi An|VN
下龍灣|Ha Long|VN|下龍,Halong
大叻|Da Lat|VN|Dalat
芽莊|Nha Trang|VN
富國島|Phu Quoc|VN
馬尼拉|Manila|PH
宿霧|Cebu City|PH|Cebu
薄荷島|Tagbilaran|PH|Bohol
長灘島|Boracay|PH
金邊|Phnom Penh|KH
暹粒|Siem Reap|KH|吳哥窟
琅勃拉邦|Luang Prabang|LA|龍坡邦
馬爾地夫|Male|MV|馬列,Malé
杜拜|Dubai|AE|迪拜
伊斯坦堡|Istanbul|TR|伊斯坦布爾
倫敦|London|GB
愛丁堡|Edinburgh|GB
都柏林|Dublin|IE
巴黎|Paris|FR
尼斯|Nice|FR
里昂|Lyon|FR
羅馬|Rome|IT|Roma
米蘭|Milan|IT|Milano
威尼斯|Venice|IT|Venezia
佛羅倫斯|Florence|IT|翡冷翠,Firenze
拿坡里|Naples|IT|那不勒斯,Napoli
巴塞隆納|Barcelona|ES|巴塞羅那
馬德里|Madrid|ES
塞維亞|Seville|ES|塞維利亞,Sevilla
格拉納達|Granada|ES
里斯本|Lisbon|PT|Lisboa
波多|Porto|PT|波爾圖
阿姆斯特丹|Amsterdam|NL
布魯塞爾|Brussels|BE
柏林|Berlin|DE
慕尼黑|Munich|DE|München,Muenchen
法蘭克福|Frankfurt|DE|Frankfurt am Main
維也納|Vienna|AT|Wien
薩爾斯堡|Salzburg|AT
布拉格|Prague|CZ|Praha
布達佩斯|Budapest|HU
蘇黎世|Zurich|CH|Zürich
因特拉肯|Interlaken|CH
雷克雅維克|Reykjavik|IS|Reykjavík
紐約|New York|US|紐約市,NYC,NY,纽约,New York City,Manhattan,曼哈頓|New York
波士頓|Boston|US|波士顿|Massachusetts
華盛頓|Washington|US|華盛頓特區,華府,Washington DC,Washington D.C.,DC|District of Columbia
費城|Philadelphia|US|费城|Pennsylvania
芝加哥|Chicago|US||Illinois
邁阿密|Miami|US|迈阿密|Florida
奧蘭多|Orlando|US|奥兰多|Florida
紐奧良|New Orleans|US|新奧爾良|Louisiana
亞特蘭大|Atlanta|US||Georgia
休士頓|Houston|US|休斯頓|Texas
達拉斯|Dallas|US||Texas
奧斯汀|Austin|US||Texas
丹佛|Denver|US||Colorado
鹽湖城|Salt Lake City|US|盐湖城|Utah
洛杉磯|Los Angeles|US|LA,L.A.,洛城,洛杉矶|California
聖塔莫尼卡|Santa Monica|US|聖塔莫妮卡,聖莫尼卡,圣莫尼卡|California
艾爾塞貢多|El Segundo|US|艾爾塞岡多|California
比佛利山莊|Beverly Hills|US|比佛利山,比華利山|California
好萊塢|Hollywood|US|荷里活,好莱坞|California
西好萊塢|West Hollywood|US|WeHo|California
帕沙迪納|Pasadena|US|帕薩迪納|California
長灘|Long Beach|US||California
安納翰|Anaheim|US|安那罕,阿納海姆|California
聖地牙哥|San Diego|US|聖地亞哥,圣地亚哥|California
舊金山|San Francisco|US|SF,三藩市,旧金山|California
聖荷西|San Jose|US|聖何塞|California
西雅圖|Seattle|US|西雅图|Washington
波特蘭|Portland|US||Oregon
拉斯維加斯|Las Vegas|US|拉斯維加斯市,賭城,拉斯维加斯,維加斯,Vegas|Nevada
佩吉|Page|US|佩奇,羚羊谷,下羚羊谷,上羚羊谷,馬蹄灣,Antelope Canyon,Horseshoe Bend|Arizona
大峽谷|Grand Canyon Village|US|大峡谷,Grand Canyon,大峽谷國家公園|Arizona
塞多納|Sedona|US|聖多納|Arizona
鳳凰城|Phoenix|US|凤凰城|Arizona
檀香山|Honolulu|US|夏威夷,火奴魯魯,Waikiki,威基基|Hawaii
茂宜島|Kahului|US|茂宜,Maui|Hawaii
安克拉治|Anchorage|US||Alaska
關島|Hagatna|GU
溫哥華|Vancouver|CA||British Columbia
多倫多|Toronto|CA||Ontario
尼加拉瀑布|Niagara Falls|CA|尼加拉|Ontario
蒙特婁|Montreal|CA|蒙特利爾,Montréal|Quebec
魁北克市|Quebec|CA|魁北克,Quebec City|Quebec
班夫|Banff|CA||Alberta
墨西哥城|Mexico City|MX
雪梨|Sydney|AU|悉尼
墨爾本|Melbourne|AU
布里斯本|Brisbane|AU
黃金海岸|Gold Coast|AU
伯斯|Perth|AU|珀斯
凱恩斯|Cairns|AU
奧克蘭|Auckland|NZ
皇后鎮|Queenstown|NZ
`;

export interface CityAlias {
  display: string;
  en: string;
  cc?: string;
  /** 州／省（英文），例如 Arizona */
  admin1?: string;
}

const norm = (s: string) => s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

/** 不拿來在行程文字裡找城市的寫法（「高山症」「日光浴」不是日本的高山、日光） */
const NO_TEXT_MATCH = new Set(['高山', '日光', '石垣', '宮島口', 'Male', 'Nice']);

interface CityKey {
  key: string;
  alias: CityAlias;
  latin: boolean;
  /** 4 個字母以內的英文寫法：大小寫要完全相同 */
  exactCase: boolean;
}

const ALIAS_INDEX = (() => {
  const m = new Map<string, CityAlias>();
  const keys: CityKey[] = [];
  const seen = new Set<string>();
  const addKey = (raw: string, a: CityAlias) => {
    const k = raw.normalize('NFKC').trim();
    if (!k || seen.has(k) || NO_TEXT_MATCH.has(k)) return;
    seen.add(k);
    const latin = !HAS_CJK.test(k);
    keys.push({ key: k, alias: a, latin, exactCase: latin && k.replace(/[^A-Za-z]/g, '').length <= 4 });
  };
  for (const line of CITY_ALIAS_TABLE.split('\n')) {
    const [display, en, cc, others, admin1] = line.split('|').map((s) => s?.trim());
    if (!display || !en) continue;
    const a: CityAlias = { display, en, cc: cc || undefined, admin1: admin1 || undefined };
    const names = [display, ...(others ? others.split(',').map((x) => x.trim()) : [])].filter(Boolean);
    for (const k of names) if (!m.has(norm(k))) m.set(norm(k), a);
    // 英文輸入（例如 KYOTO）也能反查中文顯示名；同一個英文名只取第一行
    if (!m.has(norm(en))) m.set(norm(en), a);
    for (const k of [...names, en]) addKey(k, a);
  }
  return { map: m, keys };
})();

/** 查別名表（中英文、大小寫、全半形皆可）；測試與城市設定頁可用 */
export function findCityAlias(name: string): CityAlias | undefined {
  return ALIAS_INDEX.map.get(norm(name));
}

export interface CityMention {
  alias: CityAlias;
  /** 在 NFKC 正規化後的文字中的位置 */
  start: number;
  end: number;
}

const isWordChar = (ch: string | undefined) => !!ch && /[A-Za-z0-9À-ɏ]/.test(ch);
/** 「Portland Ave」「Seattle Blvd」是路名，不代表在那個城市 */
const STREET_AFTER = /^\s+(?:Blvd|Boulevard|Ave|Avenue|St|Street|Rd|Road|Dr|Drive|Way|Fwy|Freeway|Hwy|Highway|Pkwy|Parkway|Ln|Lane|Pl|Place|Ct|Court)\b/i;
/** 「北京烤鴨」「大阪燒」「台式」是菜名或風格，不代表在那個城市 */
const FOOD_AFTER = /^(?:燒|焼|烤|拉麵|拉面|麵|面|湯|式|料理|菜|風味|小吃|美食|飯|丼|鍋|餅|點心|蛋糕|擔|米粉|肉|雞|牛|豬|魚|蟹|蝦|甜|冰|茶|咖哩|包|粉|糕|味)/;

/**
 * 找出文字裡提到的城市（依出現位置排序；被較長寫法包含的不算，例如「東京都」裡的「京都」）。
 * 例：「住 Harbor Inn Portland」→ 波特蘭；「Kobe｜當地時間」→ 神戶。
 */
export function findCitiesInText(text: string): CityMention[] {
  const s = (text ?? '').normalize('NFKC');
  if (!s.trim()) return [];
  const lower = s.toLowerCase();
  const found: CityMention[] = [];
  for (const k of ALIAS_INDEX.keys) {
    const hay = k.exactCase ? s : lower;
    const needle = k.exactCase ? k.key : k.key.toLowerCase();
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
      const j = i + needle.length;
      const ok = k.latin ? !isWordChar(s[i - 1]) && !isWordChar(s[j]) && !STREET_AFTER.test(s.slice(j)) : !FOOD_AFTER.test(s.slice(j));
      if (ok) found.push({ alias: k.alias, start: i, end: j });
    }
  }
  const len = (m: CityMention) => m.end - m.start;
  return found
    .filter((m) => !found.some((o) => o !== m && o.start <= m.start && o.end >= m.end && len(o) > len(m)))
    .filter((m, i, arr) => arr.findIndex((o) => o.alias === m.alias && o.start === m.start) === i)
    .sort((a, b) => a.start - b.start || len(b) - len(a));
}

const ADMIN_SUFFIX = /(特別市|特別行政區|自治區|市|縣|県|府|區|区|省)$/u;

/** 同一個城市名的幾種寫法（臺／台、加「市」、去掉行政區字尾），依序嘗試 */
export function cityNameVariants(name: string): string[] {
  const s = name.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!s) return [];
  const out = [s];
  if (HAS_CJK.test(s)) {
    if (s.includes('臺')) out.push(s.replace(/臺/g, '台'));
    const stripped = s.replace(ADMIN_SUFFIX, '');
    if (stripped !== s) {
      if (stripped.length >= 2) out.push(stripped);
    } else {
      out.push(`${s}市`);
      if (s.includes('臺')) out.push(`${s.replace(/臺/g, '台')}市`);
    }
  }
  return [...new Set(out)].slice(0, 4);
}

interface OMGeoResult {
  name: string;
  latitude: number;
  longitude: number;
  feature_code?: string;
  country_code?: string;
  country?: string;
  admin1?: string;
  timezone?: string;
  population?: number;
}

const FEATURE_BONUS: Record<string, number> = {
  // 國家（PCLI 等）不是城市：新加坡、香港另有首都（PPLC）的結果
  PPLC: 2, PPLA: 1.5, PPLA2: 1, PCLI: -1, PCLS: -1, PCLD: -1, PPLA3: 0.5, PPLA4: 0.2, PPL: 0, PPLX: -0.5, ISL: -0.2, ADM1: 0, ADM2: 0,
};

const PLACE_SUFFIX = /(市|町|村|縣|県|區|区|郡| city| shi)$/u;
/** 名稱相同（可差一個「市／町」字尾）：避免人口較多的鄰近地名勝出（箱根 → 箱根ケ崎、溫哥華 → 溫哥華島） */
const sameName = (a: string, b: string) => {
  const x = norm(a), y = norm(b);
  return x === y || x.replace(PLACE_SUFFIX, '') === y.replace(PLACE_SUFFIX, '');
};

function scoreCity(r: OMGeoResult, names: string[], admin1?: string): number {
  const fc = r.feature_code ?? '';
  const bonus = fc in FEATURE_BONUS ? FEATURE_BONUS[fc] : -3; // 機場、山、湖等不是城市
  const match = names.some((n) => n && sameName(r.name, n)) ? 1.5 : 0;
  // 別名表指定了州／省：同名城市（Portland, OR 與 Portland, ME）選對的那個
  const state = admin1 && r.admin1 && norm(r.admin1) === norm(admin1) ? 4 : 0;
  return bonus + Math.log10((r.population ?? 0) + 1) + match + state;
}

/** 有一定人口或是首都／行政中心，才算可信的城市結果 */
const strongCity = (r: OMGeoResult) =>
  !(r.feature_code ?? '').startsWith('PCL') && ((r.population ?? 0) >= 20_000 || ['PPLC', 'PPLA', 'PPLA2'].includes(r.feature_code ?? ''));

interface SearchOpts {
  /** 結果名稱的語言（zh：顯示用；en：組導航地址用） */
  language?: 'zh' | 'en';
  admin1?: string;
  signal?: AbortSignal;
}

/** names：用來比對結果名稱的寫法（查詢字＋顯示名） */
async function searchOpenMeteo(q: string, cc: string | undefined, names: string[], opts: SearchOpts = {}): Promise<OMGeoResult | null> {
  const p = new URLSearchParams({ name: q, count: '10', language: opts.language ?? 'zh', format: 'json' });
  if (cc) p.set('countryCode', cc);
  const data = await fetchJson<{ results?: OMGeoResult[] }>(`https://geocoding-api.open-meteo.com/v1/search?${p}`, {
    service: CITY_SERVICE,
    signal: opts.signal,
  });
  const list = (data.results ?? []).filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude));
  if (!list.length) return null;
  const score = (r: OMGeoResult) => scoreCity(r, names, opts.admin1);
  return list.reduce((best, r) => (score(r) > score(best) ? r : best));
}

interface PhotonPlace {
  geometry?: { coordinates?: [number, number] };
  properties?: { name?: string; osm_value?: string; countrycode?: string; country?: string };
}
const PHOTON_CITY_TYPES = ['city', 'town', 'municipality', 'island', 'archipelago', 'county', 'state', 'province', 'region'];

async function searchPhotonCity(q: string, signal?: AbortSignal): Promise<{ lat: number; lng: number; cc?: string; country?: string } | null> {
  const p = new URLSearchParams({ q, limit: '5', osm_tag: 'place' });
  const data = await fetchJson<{ features?: PhotonPlace[] }>(`https://photon.komoot.io/api/?${p}`, { service: CITY_SERVICE, signal });
  const f = (data.features ?? []).find((x) => PHOTON_CITY_TYPES.includes(x.properties?.osm_value ?? ''));
  const c = f?.geometry?.coordinates;
  if (!f || !c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
  return { lat: c[1], lng: c[0], cc: f.properties?.countrycode, country: f.properties?.country };
}

let regionNames: Intl.DisplayNames | null | undefined;
/** 國家代碼 → 台灣用語國名（日本、南韓、美國…） */
export function countryName(cc: string | undefined, fallback?: string): string | undefined {
  if (!cc) return fallback;
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(['zh-Hant-TW', 'zh-TW'], { type: 'region', style: 'short' });
    } catch {
      regionNames = null;
    }
  }
  try {
    const n = regionNames?.of(cc.toUpperCase());
    if (n && n.toUpperCase() !== cc.toUpperCase()) return n;
  } catch {
    /* 不合法的代碼 */
  }
  return fallback;
}

/** 「京都，日本」；城市就是國家（香港、新加坡）時只顯示一次 */
export function cityLabel(display: string, cc?: string, countryFallback?: string): string {
  const country = countryName(cc, countryFallback);
  if (!country || display === country || display.startsWith(country) || country.startsWith(display)) return display;
  return `${display}，${country}`;
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** 城市名（中英日皆可）→ 座標；找不到回傳 null；連線失敗丟出中文錯誤 */
export async function geocodeCity(name: string): Promise<CityGeo | null> {
  const raw = name.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!raw) return null;
  const alias = findCityAlias(raw) ?? findCityAlias(raw.replace(ADMIN_SUFFIX, ''));
  // 使用者打中文：照他的寫法（臺南就是臺南）；打英文：換成中文名（KYOTO → 京都）
  const display = HAS_CJK.test(raw) ? raw : (alias?.display ?? raw);

  const build = (r: OMGeoResult): CityGeo => {
    // 使用者打的是英文、又不在別名表：用 Open-Meteo 的中文名（KYOTO → 京都）
    const shown = alias || HAS_CJK.test(raw) ? display : r.name || raw;
    return {
      lat: round4(r.latitude),
      lng: round4(r.longitude),
      label: cityLabel(shown, r.country_code, r.country),
      timezone: r.timezone,
      countryCode: r.country_code,
    };
  };

  const attempts: { q: string; cc?: string }[] = [];
  if (alias) attempts.push({ q: alias.en, cc: alias.cc });
  for (const v of cityNameVariants(raw)) attempts.push({ q: v });

  let weak: OMGeoResult | null = null;
  for (const a of attempts) {
    const r = await searchOpenMeteo(a.q, a.cc, [a.q, display], { admin1: a.cc ? alias?.admin1 : undefined });
    if (!r) continue;
    if (a.cc || strongCity(r)) return build(r);
    weak ??= r;
  }

  // Open-Meteo 沒有可信結果：改用 OpenStreetMap 找城市等級的地點
  const p = await searchPhotonCity(raw).catch(() => null);
  if (p) {
    return { lat: round4(p.lat), lng: round4(p.lng), label: cityLabel(display, p.cc, p.country), countryCode: p.cc?.toUpperCase() };
  }
  return weak ? build(weak) : null;
}

/** 行程某天所在城市的定位結果（DayMeta.geo）：多了英文城市名與州／省，用來組導航地址 */
export type TravelCityGeo = CityGeo & { en?: string; admin1?: string };

/**
 * 行程城市（日期列上的「波特蘭」「Seattle」）→ 座標＋英文名＋州／省。
 * 和 geocodeCity 的差別：結果用英文（Portland、Oregon），別名表有州／省時優先選那一州。
 * 中文名一律先換成別名表的英文名再查（Open-Meteo 用中文查「台南」會查到中國的同名村莊）。
 * 找不到回傳 null；連線失敗丟出中文錯誤。
 */
export async function geocodeTravelCity(name: string, signal?: AbortSignal): Promise<TravelCityGeo | null> {
  const raw = name.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!raw) return null;
  const alias = findCityAlias(raw) ?? findCityAlias(raw.replace(ADMIN_SUFFIX, ''));
  const display = alias?.display ?? raw;
  const build = (r: OMGeoResult): TravelCityGeo => ({
    lat: round4(r.latitude),
    lng: round4(r.longitude),
    label: cityLabel(display, r.country_code, r.country),
    en: alias?.en ?? (HAS_CJK.test(r.name) ? undefined : r.name),
    admin1: r.admin1 || alias?.admin1,
    timezone: r.timezone,
    countryCode: r.country_code,
  });

  const attempts: { q: string; cc?: string }[] = [];
  if (alias) attempts.push({ q: alias.en, cc: alias.cc });
  for (const v of cityNameVariants(raw)) if (!alias || v !== alias.en) attempts.push({ q: v });

  let weak: OMGeoResult | null = null;
  for (const a of attempts) {
    const r = await searchOpenMeteo(a.q, a.cc, [a.q, display, alias?.en ?? ''], { language: 'en', admin1: alias?.admin1, signal });
    if (!r) continue;
    if (a.cc || strongCity(r)) return build(r);
    weak ??= r;
  }
  const p = await searchPhotonCity(alias?.en ?? raw, signal).catch(() => null);
  if (p) {
    return {
      lat: round4(p.lat),
      lng: round4(p.lng),
      label: cityLabel(display, p.cc, p.country),
      en: alias?.en ?? (HAS_CJK.test(raw) ? undefined : raw),
      admin1: alias?.admin1,
      countryCode: p.cc?.toUpperCase(),
    };
  }
  return weak ? build(weak) : null;
}

/* ------------------------------------------------------------------ */
/* 天氣                                                                */
/* ------------------------------------------------------------------ */

/** 兩個座標是否算同一個地點（約 1 公里內） */
export const samePlace = (a: LatLng, b: LatLng) => Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lng - b.lng) < 0.01;

/** 今天起可以查預報的日期範圍 */
export function forecastWindow(now: ISODate = today()): { start: ISODate; end: ISODate } {
  return { start: now, end: addDays(now, FORECAST_LAST_OFFSET) };
}

/** 'YYYY-MM-DD' 往前／後 n 年（2/29 遇到平年改 2/28） */
export function shiftYears(d: ISODate, n: number): ISODate {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (!m) return d;
  const y = +m[1] + n;
  let day = +m[3];
  if (m[2] === '02' && day === 29 && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0))) day = 28;
  return `${String(y).padStart(4, '0')}-${m[2]}-${String(day).padStart(2, '0')}`;
}

/** 要用哪幾年的歷史資料（往前幾年）：要完整落在一週前以前，取最近的 CLIMATE_YEARS 年 */
export function climateYearsBack(lastDate: ISODate, now: ISODate = today(), years = CLIMATE_YEARS): number[] {
  const limit = addDays(now, -ARCHIVE_DELAY_DAYS);
  const out: number[] = [];
  for (let k = 1; k <= years + 12 && out.length < years; k++) if (shiftYears(lastDate, -k) <= limit) out.push(k);
  return out;
}

type Num = number | null | undefined;

/** Open-Meteo archive 的 daily 欄位 */
export interface ArchiveDaily {
  time: string[];
  weather_code: Num[];
  temperature_2m_max: Num[];
  temperature_2m_min: Num[];
  precipitation_sum?: Num[];
}
export interface ClimateSample {
  /** 這份資料是往前幾年 */
  yearsBack: number;
  daily: ArchiveDaily;
}

const isNum = (v: Num): v is number => typeof v === 'number' && Number.isFinite(v);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** 最常出現的天氣代碼；平手時取這幾個代碼的中位數（代碼越大通常越惡劣），避免永遠偏好晴或雨 */
export function modeWeatherCode(codes: number[]): number {
  const count = new Map<number, number>();
  for (const c of codes) count.set(c, (count.get(c) ?? 0) + 1);
  const top = Math.max(...count.values());
  const tied = [...count.entries()].filter(([, n]) => n === top).map(([c]) => c).sort((a, b) => a - b);
  return tied[Math.floor((tied.length - 1) / 2)];
}

/**
 * 歷年同期平均（純函式）：每個日期取各年同月同日的資料，
 * 天氣代碼取最常見的、氣溫取平均（四捨五入到整數）、雨量取平均（小數一位）。
 * 沒有任何資料的日期不會出現在結果中。
 */
export function averageClimate(dates: ISODate[], samples: ClimateSample[]): DailyWeather[] {
  const indexed = samples.map((s) => ({ k: s.yearsBack, d: s.daily, idx: new Map(s.daily.time.map((t, i) => [t.slice(0, 10), i])) }));
  const out: DailyWeather[] = [];
  for (const date of dates) {
    const codes: number[] = [], maxs: number[] = [], mins: number[] = [], rains: number[] = [];
    for (const s of indexed) {
      const i = s.idx.get(shiftYears(date, -s.k));
      if (i === undefined) continue;
      const code = s.d.weather_code[i], hi = s.d.temperature_2m_max[i], lo = s.d.temperature_2m_min[i];
      const rain = s.d.precipitation_sum?.[i];
      if (isNum(code)) codes.push(code);
      if (isNum(hi)) maxs.push(hi);
      if (isNum(lo)) mins.push(lo);
      if (isNum(rain)) rains.push(rain);
    }
    if (!codes.length || !maxs.length || !mins.length) continue;
    out.push({
      date,
      code: modeWeatherCode(codes),
      tMax: Math.round(mean(maxs)),
      tMin: Math.round(mean(mins)),
      rainMm: rains.length ? Math.round(mean(rains) * 10) / 10 : undefined,
      kind: 'climate',
    });
  }
  return out;
}

interface ForecastDaily {
  time: string[];
  weather_code: Num[];
  temperature_2m_max: Num[];
  temperature_2m_min: Num[];
  precipitation_probability_max?: Num[];
  sunrise?: (string | null)[];
  sunset?: (string | null)[];
}

/** '2026-11-20T06:35' → '06:35' */
const hhmm = (s: string | null | undefined) => (s && /T\d{2}:\d{2}/.test(s) ? s.slice(s.indexOf('T') + 1, s.indexOf('T') + 6) : undefined);

/** 預報 daily → DailyWeather（純函式）。缺代碼或氣溫的日子略過，改用歷年平均補 */
export function parseForecast(d: ForecastDaily): DailyWeather[] {
  const out: DailyWeather[] = [];
  d.time.forEach((date, i) => {
    const code = d.weather_code[i], hi = d.temperature_2m_max[i], lo = d.temperature_2m_min[i];
    if (!isNum(code) || !isNum(hi) || !isNum(lo)) return;
    const p = d.precipitation_probability_max?.[i];
    out.push({
      date: date.slice(0, 10),
      code,
      tMax: Math.round(hi),
      tMin: Math.round(lo),
      rainProb: isNum(p) ? Math.round(p) : undefined,
      sunrise: hhmm(d.sunrise?.[i]),
      sunset: hhmm(d.sunset?.[i]),
      kind: 'forecast',
    });
  });
  return out;
}

const coord = (n: number) => String(round4(n));

/* ------------------------------------------------------------------ */
/* 每天的天氣地點（多城市行程）                                          */
/* ------------------------------------------------------------------ */

/** 某天天氣用的地點；place 是顯示用的城市名（例如「波特蘭」） */
export interface DayLocation extends LatLng {
  place?: string;
}

/** 城市名 → 顯示名（別名表的中文名；不在表裡就照原文） */
const cityDisplay = (city: string) => findCityAlias(city)?.display ?? city.trim();
const sameCity = (a: string | undefined, b: string | undefined) =>
  !!a && !!b && (norm(a) === norm(b) || (!!findCityAlias(a) && findCityAlias(a) === findCityAlias(b)));
/** 「京都，日本」→「京都」 */
const labelCity = (label: string | undefined) => label?.split(/[，,]/)[0]?.trim() || undefined;

function tripCityPlace(trip: Pick<Trip, 'city' | 'cityGeo'>): string | undefined {
  const c = trip.city.trim();
  return c ? cityDisplay(c) : labelCity(trip.cityGeo?.label);
}

/**
 * 某天天氣要用的地點：當天城市（沒有就往前找最近一天的城市）的座標；
 * 那個城市還沒定位時，用其他天同一個城市的座標；都沒有就用行程城市。
 */
export function dayWeatherLocation(trip: Pick<Trip, 'days' | 'city' | 'cityGeo'>, date: ISODate): DayLocation | null {
  const meta = dayMetaFor(trip, date);
  const city = meta?.city?.trim() || undefined;
  let geo: LatLng | undefined = meta?.geo;
  if (!geo && city) geo = Object.values(trip.days ?? {}).find((m) => m.geo && sameCity(m.city, city))?.geo;
  if (!geo && city && trip.cityGeo && sameCity(trip.city, city)) geo = trip.cityGeo;
  if (geo) return { lat: round4(geo.lat), lng: round4(geo.lng), place: city ? cityDisplay(city) : labelCity(meta?.geo?.label) };
  if (trip.cityGeo) return { lat: round4(trip.cityGeo.lat), lng: round4(trip.cityGeo.lng), place: tripCityPlace(trip) };
  return null;
}

/** 行程每天的天氣地點（沒有任何地點的日子不在結果裡） */
export function weatherLocations(trip: Pick<Trip, 'days' | 'city' | 'cityGeo' | 'startDate' | 'endDate' | 'items'>): Map<ISODate, DayLocation> {
  const out = new Map<ISODate, DayLocation>();
  for (const d of tripDays(trip)) {
    const l = dayWeatherLocation(trip, d);
    if (l) out.set(d, l);
  }
  return out;
}

/** 天氣快取的主要座標：行程城市；沒有就用第一個有地點的日子 */
export function primaryWeatherGeo(trip: Pick<Trip, 'days' | 'city' | 'cityGeo' | 'startDate' | 'endDate' | 'items'>): LatLng | null {
  if (trip.cityGeo) return trip.cityGeo;
  const first = weatherLocations(trip).values().next();
  return first.done ? null : first.value;
}

const fixed2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

/** 每天座標的摘要字串，例如 "2027-03-09:47.61,-122.33|2027-03-10:45.52,-122.68" */
export function weatherLocKey(locs: Map<ISODate, LatLng>): string {
  return [...locs.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([d, g]) => `${d}:${fixed2(g.lat)},${fixed2(g.lng)}`)
    .join('|');
}

/** 快取裡每天用的座標（舊版快取沒有 locKey：全部都是快取的主要座標） */
function cacheLocation(cache: WeatherCache): (d: ISODate) => LatLng | undefined {
  if (cache.locKey === undefined) return () => cache;
  const m = new Map<ISODate, LatLng>();
  for (const part of cache.locKey.split('|')) {
    const hit = /^(\d{4}-\d{2}-\d{2}):(-?[\d.]+),(-?[\d.]+)$/.exec(part);
    if (hit) m.set(hit[1], { lat: +hit[2], lng: +hit[3] });
  }
  return (d) => m.get(d);
}

/** 用 locKey 的精度（小數兩位）比較 */
const sameLoc = (a: LatLng, b: LatLng) => fixed2(a.lat) === fixed2(b.lat) && fixed2(a.lng) === fixed2(b.lng);

/** 快取中這天的天氣是不是在現在這天的城市抓的 */
function dayMatches(cacheLoc: (d: ISODate) => LatLng | undefined, legacy: boolean, d: ISODate, cur: LatLng): boolean {
  const p = cacheLoc(d);
  return !!p && (legacy ? samePlace(p, cur) : sameLoc(p, cur));
}

/**
 * 快取中仍然適用的天氣（日期在行程內、而且是在那天的城市抓的）。
 * 多城市行程改了某天的城市時，只有那天的天氣不顯示，其他天照常。
 */
export function validWeatherDays(cache: WeatherCache | undefined, trip: Trip): DailyWeather[] {
  if (!cache) return [];
  const locs = weatherLocations(trip);
  const primary = primaryWeatherGeo(trip);
  if (!primary) return [];
  const loc = cacheLocation(cache);
  const legacy = cache.locKey === undefined;
  return cache.days.filter((w) => dayMatches(loc, legacy, w.date, locs.get(w.date) ?? primary));
}

/* ------------------------------------------------------------------ */
/* 抓天氣（一次請求可帶多個座標；多城市行程不會多花請求次數）            */
/* ------------------------------------------------------------------ */

/** Open-Meteo 多個座標時回傳陣列，單一座標時回傳物件 */
const asList = <T,>(data: T | T[]): T[] => (Array.isArray(data) ? data : [data]);

function coordParams(geos: LatLng[]): Record<string, string> {
  return { latitude: geos.map((g) => coord(g.lat)).join(','), longitude: geos.map((g) => coord(g.lng)).join(',') };
}

/** 每個座標一份預報（順序同 geos） */
async function fetchForecast(geos: LatLng[], start: ISODate, end: ISODate, retried = false): Promise<DailyWeather[][]> {
  const p = new URLSearchParams({
    ...coordParams(geos),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
    timezone: 'auto',
    start_date: start,
    end_date: end,
  });
  try {
    const data = await fetchJson<{ daily?: ForecastDaily } | { daily?: ForecastDaily }[]>(`https://api.open-meteo.com/v1/forecast?${p}`, {
      service: SERVICE,
    });
    const list = asList(data);
    return geos.map((_, i) => (list[i]?.daily ? parseForecast(list[i].daily!) : []));
  } catch (e) {
    // 手機日期和伺服器（UTC）差一天時，最後一天可能超出範圍：照伺服器給的範圍縮小重試一次
    // 例："Parameter 'end_date' is out of allowed range from 2026-08-08 to 2026-11-24"
    const m = e instanceof HttpError && e.status === 400 ? /from (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/.exec(e.reason) : null;
    if (m && !retried) {
      const s = start < m[1] ? m[1] : start, t = end > m[2] ? m[2] : end;
      if (s <= t) return fetchForecast(geos, s, t, true);
      return geos.map(() => []);
    }
    throw e;
  }
}

/** 每個座標各自要補的日期 → 各自的歷年平均（順序同 groups） */
async function fetchClimate(groups: { geo: LatLng; dates: ISODate[] }[], now: ISODate): Promise<DailyWeather[][]> {
  const all = groups.flatMap((g) => g.dates).sort();
  if (!all.length) return groups.map(() => []);
  const first = all[0], last = all[all.length - 1];
  const years = climateYearsBack(last, now);
  if (!years.length) return groups.map(() => []);
  const geos = groups.map((g) => g.geo);
  // 每年一個小請求（只含旅程那幾天、所有城市一起查），比一次查好幾年省很多額度
  const settled = await Promise.allSettled(
    years.map(async (k): Promise<ClimateSample[]> => {
      const p = new URLSearchParams({
        ...coordParams(geos),
        daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum',
        timezone: 'auto',
        start_date: shiftYears(first, -k),
        end_date: shiftYears(last, -k),
      });
      const data = await fetchJson<{ daily?: ArchiveDaily } | { daily?: ArchiveDaily }[]>(`https://archive-api.open-meteo.com/v1/archive?${p}`, {
        service: SERVICE,
      });
      const list = asList(data);
      if (!list.some((x) => x?.daily?.time)) throw new Error(`${SERVICE}回傳的資料無法讀取，請稍後再試一次。`);
      return geos.map((_, i) => ({ yearsBack: k, daily: list[i]?.daily?.time ? list[i].daily! : { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [] } }));
    }),
  );
  const samples = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  if (!samples.length) {
    const failed = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    throw failed?.reason instanceof Error ? failed.reason : new Error(`${SERVICE}暫時無法使用，請稍後再試一次。`);
  }
  return groups.map((g, i) => averageClimate([...g.dates].sort(), samples.map((perYear) => perYear[i])));
}

const NO_CITY_MESSAGE = '還不知道這趟旅程在哪個城市，請先到「行程設定」填寫城市名稱。';

/**
 * 取得行程期間每天的天氣（預報或歷年平均），結果可存進 trip.weather。
 * - 多城市行程：每天用當天城市的座標（trip.days，見 dayWeatherLocation），DailyWeather.place 是那天的城市名
 * - 預報失敗：丟出中文錯誤（呼叫端保留舊快取並顯示可重試的訊息）
 * - 只有歷年平均失敗：回傳有資料的日子（缺的日子之後自動再補）
 * - 已存在快取中、同地點的歷年平均會直接沿用（不會變），不重複查詢
 * sunrise / sunset 存成 'HH:mm'（當地時間）。
 */
export async function fetchTripWeather(trip: Trip): Promise<WeatherCache> {
  const primary = primaryWeatherGeo(trip);
  if (!primary) throw new Error(NO_CITY_MESSAGE);
  const days = tripDays(trip);
  const locs = weatherLocations(trip);
  const fetchedAt = Date.now();
  const base = { fetchedAt, lat: primary.lat, lng: primary.lng, locKey: weatherLocKey(locs) };
  if (!days.length) return { ...base, days: [] };

  // 依地點分組（同一個城市的日子一起查）
  const groups: { geo: LatLng; place?: string; dates: ISODate[] }[] = [];
  const groupOf = new Map<ISODate, number>();
  for (const d of days) {
    const l = locs.get(d) ?? { lat: primary.lat, lng: primary.lng, place: tripCityPlace(trip) };
    let gi = groups.findIndex((g) => sameLoc(g.geo, l));
    if (gi < 0) gi = groups.push({ geo: { lat: l.lat, lng: l.lng }, place: l.place, dates: [] }) - 1;
    groups[gi].dates.push(d);
    groupOf.set(d, gi);
  }
  const placeOf = (d: ISODate) => groups[groupOf.get(d)!]?.place;
  const withPlace = (w: DailyWeather): DailyWeather => {
    const place = placeOf(w.date);
    return place ? { ...w, place } : w;
  };

  const now = today();
  const { start, end } = forecastWindow(now);
  const out = new Map<ISODate, DailyWeather>();

  const inWindow = days.filter((d) => d >= start && d <= end);
  if (inWindow.length) {
    const used = groups.map((g, i) => ({ g, i })).filter(({ g }) => g.dates.some((d) => d >= start && d <= end));
    const res = await fetchForecast(used.map(({ g }) => g.geo), inWindow[0], inWindow[inWindow.length - 1]);
    used.forEach(({ g }, k) => {
      for (const w of res[k] ?? []) if (g.dates.includes(w.date)) out.set(w.date, withPlace(w));
    });
  }

  const prev = trip.weather;
  const prevLoc = prev ? cacheLocation(prev) : () => undefined;
  const legacy = prev?.locKey === undefined;
  const need: ISODate[] = [];
  for (const d of days) {
    if (out.has(d)) continue;
    const g = groups[groupOf.get(d)!];
    const old = prev && dayMatches(prevLoc, legacy, d, g.geo) ? prev.days.find((x) => x.date === d) : undefined;
    // 已過去的日子保留當時的預報（比平均值更接近實際）；其他日子只沿用歷年平均
    if (old && (old.kind === 'climate' || d < now)) out.set(d, withPlace(old));
    else need.push(d);
  }

  if (need.length) {
    const needGroups = groups.map((g) => ({ geo: g.geo, dates: g.dates.filter((d) => need.includes(d)) })).filter((g) => g.dates.length);
    try {
      const res = await fetchClimate(needGroups, now);
      res.forEach((list) => list.forEach((w) => out.set(w.date, withPlace(w))));
    } catch (e) {
      if (!out.size) throw e;
    }
  }
  return { ...base, days: days.flatMap((d) => out.get(d) ?? []) };
}

/**
 * 快取是否需要重抓：
 * 沒有快取、城市座標換了、某天的城市換了（locKey）、行程日期沒有全部涵蓋、該有預報的日子還是歷年平均、
 * 預報超過 3 小時、只有歷年平均超過 7 天。旅程已結束且資料齊全時不再更新。
 */
export function weatherStale(cache: WeatherCache | undefined, trip: Trip): boolean {
  if (!cache) return true;
  const geo = primaryWeatherGeo(trip);
  if (!geo || !samePlace(cache, geo)) return true;
  const days = tripDays(trip);
  if (!days.length) return false;
  const locs = weatherLocations(trip);
  if (cache.locKey !== weatherLocKey(locs)) {
    const loc = cacheLocation(cache);
    const legacy = cache.locKey === undefined;
    if (days.some((d) => !dayMatches(loc, legacy, d, locs.get(d) ?? geo))) return true;
  }
  const byDate = new Map(cache.days.map((d) => [d.date, d]));
  if (days.some((d) => !byDate.has(d))) return true;

  const now = today();
  // 少看最後一天：手機與伺服器日期差一天時，第 16 天可能還查不到預報，不要因此一直重抓
  const { start } = forecastWindow(now);
  const end = addDays(now, FORECAST_LAST_OFFSET - 1);
  const inWindow = days.filter((d) => d >= start && d <= end);
  if (inWindow.some((d) => byDate.get(d)?.kind === 'climate')) return true;

  const age = Date.now() - cache.fetchedAt;
  if (inWindow.length) return age > FORECAST_TTL_MS;
  if (days[days.length - 1] < now) return false;
  return age > CLIMATE_TTL_MS;
}

/* ------------------------------------------------------------------ */
/* WMO 天氣代碼                                                        */
/* ------------------------------------------------------------------ */

const WMO: Record<number, [string, IconName]> = {
  0: ['晴', 'sun'],
  1: ['大致晴朗', 'sun'],
  2: ['多雲', 'cloud'],
  3: ['陰天', 'cloud'],
  45: ['霧', 'fog'],
  48: ['霧', 'fog'],
  51: ['毛毛雨', 'rain'],
  53: ['毛毛雨', 'rain'],
  55: ['毛毛雨', 'rain'],
  56: ['凍雨', 'rain'],
  57: ['凍雨', 'rain'],
  61: ['小雨', 'rain'],
  63: ['雨', 'rain'],
  65: ['大雨', 'rain'],
  66: ['凍雨', 'rain'],
  67: ['凍雨', 'rain'],
  71: ['小雪', 'snow'],
  73: ['雪', 'snow'],
  75: ['大雪', 'snow'],
  77: ['小雪', 'snow'],
  80: ['陣雨', 'rain'],
  81: ['陣雨', 'rain'],
  82: ['強陣雨', 'rain'],
  85: ['陣雪', 'snow'],
  86: ['大陣雪', 'snow'],
  95: ['雷雨', 'storm'],
  96: ['雷雨夾冰雹', 'storm'],
  99: ['雷雨夾冰雹', 'storm'],
};

/** WMO 天氣代碼 → 中文與圖示；表外的代碼依區段歸類 */
export function weatherInfo(code: number): { label: string; icon: IconName } {
  const hit = WMO[code];
  if (hit) return { label: hit[0], icon: hit[1] };
  if (!Number.isFinite(code) || code < 0) return { label: '天氣不明', icon: 'cloud' };
  if (code < 45) return { label: '多雲', icon: 'cloud' };
  if (code < 50) return { label: '霧', icon: 'fog' };
  if (code < 70) return { label: '雨', icon: 'rain' };
  if (code < 80) return { label: '雪', icon: 'snow' };
  if (code < 85) return { label: '陣雨', icon: 'rain' };
  if (code < 90) return { label: '陣雪', icon: 'snow' };
  return { label: '雷雨', icon: 'storm' };
}

/** 日期是否落在預報範圍（今天～第 16 天） */
export function isForecastDate(d: ISODate, now: ISODate = today()): boolean {
  const { start, end } = forecastWindow(now);
  return !!parseISODate(d) && d >= start && d <= end;
}

export type { DailyWeather };
