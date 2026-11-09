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

/**
 * 常見旅遊城市的中文寫法 → 英文查詢名。Open-Meteo 的中文地名不齊全（例如「首爾」「大阪」「台北」查不到，
 * 「台南」「高雄」會查到同名的中國村莊），所以熱門城市先用英文名查，國家代碼用來排除同名地點。
 * 格式：顯示名|英文查詢名|國家代碼|其他寫法（逗號分隔，可省略）。新增城市：加一行即可。
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
仙台|Sendai|JP
金澤|Kanazawa|JP|金沢
高山|Takayama|JP
輕井澤|Karuizawa|JP|軽井沢
河口湖|Fujikawaguchiko|JP|富士河口湖
日光|Nikko|JP
姬路|Himeji|JP|姫路
廣島|Hiroshima|JP|広島
岡山|Okayama|JP
高松|Takamatsu|JP
福岡|Fukuoka|JP|福岡市
熊本|Kumamoto|JP
長崎|Nagasaki|JP
鹿兒島|Kagoshima|JP|鹿児島
別府|Beppu|JP
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
台北|Taipei|TW|臺北,台北市,臺北市
新北|New Taipei|TW|新北市
基隆|Keelung|TW
桃園|Taoyuan|TW
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
香港|Hong Kong|HK
澳門|Macau|MO|澳门
上海|Shanghai|CN
北京|Beijing|CN
廣州|Guangzhou|CN|广州
深圳|Shenzhen|CN
廈門|Xiamen|CN|厦门
成都|Chengdu|CN
杭州|Hangzhou|CN
曼谷|Bangkok|TH
清邁|Chiang Mai|TH|清迈
普吉島|Phuket|TH|普吉
芭達雅|Pattaya|TH|芭堤雅
新加坡|Singapore|SG
吉隆坡|Kuala Lumpur|MY
檳城|George Town|MY|檳榔嶼
亞庇|Kota Kinabalu|MY|沙巴
峇里島|Denpasar|ID|巴厘島,峇里,巴里島
雅加達|Jakarta|ID
河內|Hanoi|VN|河内
胡志明市|Ho Chi Minh City|VN|胡志明,西貢
峴港|Da Nang|VN|岘港
芽莊|Nha Trang|VN
富國島|Phu Quoc|VN
馬尼拉|Manila|PH
宿霧|Cebu City|PH
長灘島|Boracay|PH
金邊|Phnom Penh|KH
暹粒|Siem Reap|KH|吳哥窟
杜拜|Dubai|AE|迪拜
伊斯坦堡|Istanbul|TR|伊斯坦布爾
倫敦|London|GB
巴黎|Paris|FR
羅馬|Rome|IT|Roma
米蘭|Milan|IT|Milano
威尼斯|Venice|IT|Venezia
佛羅倫斯|Florence|IT|翡冷翠,Firenze
巴塞隆納|Barcelona|ES|巴塞羅那
馬德里|Madrid|ES
里斯本|Lisbon|PT|Lisboa
阿姆斯特丹|Amsterdam|NL
柏林|Berlin|DE
慕尼黑|Munich|DE|München,Muenchen
維也納|Vienna|AT|Wien
布拉格|Prague|CZ|Praha
布達佩斯|Budapest|HU
蘇黎世|Zurich|CH|Zürich
紐約|New York|US|紐約市
洛杉磯|Los Angeles|US
舊金山|San Francisco|US
西雅圖|Seattle|US
拉斯維加斯|Las Vegas|US
檀香山|Honolulu|US|夏威夷
關島|Hagatna|GU
溫哥華|Vancouver|CA
多倫多|Toronto|CA
雪梨|Sydney|AU|悉尼
墨爾本|Melbourne|AU
布里斯本|Brisbane|AU
黃金海岸|Gold Coast|AU
奧克蘭|Auckland|NZ
`;

interface CityAlias {
  display: string;
  en: string;
  cc?: string;
}

const norm = (s: string) => s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

const ALIASES: Map<string, CityAlias> = (() => {
  const m = new Map<string, CityAlias>();
  for (const line of CITY_ALIAS_TABLE.split('\n')) {
    const [display, en, cc, others] = line.split('|').map((s) => s?.trim());
    if (!display || !en) continue;
    const a: CityAlias = { display, en, cc: cc || undefined };
    for (const k of [display, ...(others ? others.split(',') : [])]) if (!m.has(norm(k))) m.set(norm(k), a);
    // 英文輸入（例如 KYOTO）也能反查中文顯示名；同一個英文名只取第一行
    if (!m.has(norm(en))) m.set(norm(en), a);
  }
  return m;
})();

/** 查別名表（中英文、大小寫、全半形皆可）；測試與城市設定頁可用 */
export function findCityAlias(name: string): CityAlias | undefined {
  return ALIASES.get(norm(name));
}

/** 含中日韓文字（平假名／片假名、漢字、相容漢字、韓文） */
const HAS_CJK = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/;
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

function scoreCity(r: OMGeoResult, names: string[]): number {
  const fc = r.feature_code ?? '';
  const bonus = fc in FEATURE_BONUS ? FEATURE_BONUS[fc] : -3; // 機場、山、湖等不是城市
  const match = names.some((n) => n && sameName(r.name, n)) ? 1.5 : 0;
  return bonus + Math.log10((r.population ?? 0) + 1) + match;
}

/** 有一定人口或是首都／行政中心，才算可信的城市結果 */
const strongCity = (r: OMGeoResult) =>
  !(r.feature_code ?? '').startsWith('PCL') && ((r.population ?? 0) >= 20_000 || ['PPLC', 'PPLA', 'PPLA2'].includes(r.feature_code ?? ''));

/** names：用來比對結果名稱的寫法（查詢字＋顯示名） */
async function searchOpenMeteo(q: string, cc: string | undefined, names: string[]): Promise<OMGeoResult | null> {
  const p = new URLSearchParams({ name: q, count: '10', language: 'zh', format: 'json' });
  if (cc) p.set('countryCode', cc);
  const data = await fetchJson<{ results?: OMGeoResult[] }>(`https://geocoding-api.open-meteo.com/v1/search?${p}`, {
    service: CITY_SERVICE,
  });
  const list = (data.results ?? []).filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude));
  if (!list.length) return null;
  return list.reduce((best, r) => (scoreCity(r, names) > scoreCity(best, names) ? r : best));
}

interface PhotonPlace {
  geometry?: { coordinates?: [number, number] };
  properties?: { name?: string; osm_value?: string; countrycode?: string; country?: string };
}
const PHOTON_CITY_TYPES = ['city', 'town', 'municipality', 'island', 'archipelago', 'county', 'state', 'province', 'region'];

async function searchPhotonCity(q: string): Promise<{ lat: number; lng: number; cc?: string; country?: string } | null> {
  const p = new URLSearchParams({ q, limit: '5', osm_tag: 'place' });
  const data = await fetchJson<{ features?: PhotonPlace[] }>(`https://photon.komoot.io/api/?${p}`, { service: CITY_SERVICE });
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
    const r = await searchOpenMeteo(a.q, a.cc, [a.q, display]);
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

async function fetchForecast(geo: LatLng, start: ISODate, end: ISODate, retried = false): Promise<DailyWeather[]> {
  const p = new URLSearchParams({
    latitude: coord(geo.lat),
    longitude: coord(geo.lng),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
    timezone: 'auto',
    start_date: start,
    end_date: end,
  });
  try {
    const data = await fetchJson<{ daily?: ForecastDaily }>(`https://api.open-meteo.com/v1/forecast?${p}`, { service: SERVICE });
    return data.daily ? parseForecast(data.daily) : [];
  } catch (e) {
    // 手機日期和伺服器（UTC）差一天時，最後一天可能超出範圍：照伺服器給的範圍縮小重試一次
    // 例："Parameter 'end_date' is out of allowed range from 2026-08-08 to 2026-11-24"
    const m = e instanceof HttpError && e.status === 400 ? /from (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/.exec(e.reason) : null;
    if (m && !retried) {
      const s = start < m[1] ? m[1] : start, t = end > m[2] ? m[2] : end;
      if (s <= t) return fetchForecast(geo, s, t, true);
      return [];
    }
    throw e;
  }
}

async function fetchClimate(geo: LatLng, dates: ISODate[], now: ISODate): Promise<DailyWeather[]> {
  if (!dates.length) return [];
  const sorted = [...dates].sort();
  const first = sorted[0], last = sorted[sorted.length - 1];
  const years = climateYearsBack(last, now);
  if (!years.length) return [];
  // 每年一個小請求（只含旅程那幾天），比一次查好幾年省很多額度
  const settled = await Promise.allSettled(
    years.map(async (k): Promise<ClimateSample> => {
      const p = new URLSearchParams({
        latitude: coord(geo.lat),
        longitude: coord(geo.lng),
        daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum',
        timezone: 'auto',
        start_date: shiftYears(first, -k),
        end_date: shiftYears(last, -k),
      });
      const data = await fetchJson<{ daily?: ArchiveDaily }>(`https://archive-api.open-meteo.com/v1/archive?${p}`, { service: SERVICE });
      if (!data.daily?.time) throw new Error(`${SERVICE}回傳的資料無法讀取，請稍後再試一次。`);
      return { yearsBack: k, daily: data.daily };
    }),
  );
  const samples = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  if (!samples.length) {
    const failed = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    throw failed?.reason instanceof Error ? failed.reason : new Error(`${SERVICE}暫時無法使用，請稍後再試一次。`);
  }
  return averageClimate(sorted, samples);
}

/**
 * 取得行程期間每天的天氣（預報或歷年平均），結果可存進 trip.weather。
 * - 預報失敗：丟出中文錯誤（呼叫端保留舊快取並顯示可重試的訊息）
 * - 只有歷年平均失敗：回傳有資料的日子（缺的日子之後自動再補）
 * - 已存在快取中、同地點的歷年平均會直接沿用（不會變），不重複查詢
 * sunrise / sunset 存成 'HH:mm'（當地時間）。
 */
export async function fetchTripWeather(trip: Trip): Promise<WeatherCache> {
  const geo = trip.cityGeo;
  if (!geo) throw new Error('還不知道這趟旅程在哪個城市，請先到「行程設定」填寫城市名稱。');
  const days = tripDays(trip);
  const fetchedAt = Date.now();
  const base = { fetchedAt, lat: geo.lat, lng: geo.lng };
  if (!days.length) return { ...base, days: [] };

  const now = today();
  const { start, end } = forecastWindow(now);
  const out = new Map<ISODate, DailyWeather>();

  const inWindow = days.filter((d) => d >= start && d <= end);
  if (inWindow.length) {
    for (const w of await fetchForecast(geo, inWindow[0], inWindow[inWindow.length - 1])) {
      if (days.includes(w.date)) out.set(w.date, w);
    }
  }

  const prev = trip.weather && samePlace(trip.weather, geo) ? trip.weather.days : [];
  const need: ISODate[] = [];
  for (const d of days) {
    if (out.has(d)) continue;
    const old = prev.find((x) => x.date === d);
    // 已過去的日子保留當時的預報（比平均值更接近實際）；其他日子只沿用歷年平均
    if (old && (old.kind === 'climate' || d < now)) out.set(d, old);
    else need.push(d);
  }

  if (need.length) {
    try {
      for (const w of await fetchClimate(geo, need, now)) out.set(w.date, w);
    } catch (e) {
      if (!out.size) throw e;
    }
  }
  return { ...base, days: days.flatMap((d) => out.get(d) ?? []) };
}

/**
 * 快取是否需要重抓：
 * 沒有快取、城市座標換了、行程日期沒有全部涵蓋、該有預報的日子還是歷年平均、
 * 預報超過 3 小時、只有歷年平均超過 7 天。旅程已結束且資料齊全時不再更新。
 */
export function weatherStale(cache: WeatherCache | undefined, trip: Trip): boolean {
  if (!cache) return true;
  const geo = trip.cityGeo;
  if (!geo || !samePlace(cache, geo)) return true;
  const days = tripDays(trip);
  if (!days.length) return false;
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
