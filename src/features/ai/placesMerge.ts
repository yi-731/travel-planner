/**
 * AI 地點辨識的結果併進行程（純函式，有測試 placesMerge.test.ts）。
 * 呼叫流程見 ./useResolvePlaces.ts：每批結果 → dayGeocodeRequests（別名表沒有的新城市先定位）→ applyResolvedPlaces（mutateTrip 裡）。
 */
import type { DayMeta, ISODate, Trip } from '@/domain/types';
import type { ResolvedPlaces } from '@/services/ai';
import { cityLabel, findCityAlias, type CityAlias, type TravelCityGeo } from '@/services/weather';

type DayGeo = NonNullable<DayMeta['geo']>;
type ResolvedDay = ResolvedPlaces['days'][string];

const lc = (s: string) => s.normalize('NFKC').trim().toLowerCase();

/** AI 給的城市在城市對照表裡的那一行（中文名或英文名任一對得上） */
function aliasOf(r: ResolvedDay): CityAlias | undefined {
  return findCityAlias(r.city) ?? (r.cityEn ? findCityAlias(r.cityEn) : undefined);
}

/** 要存進 DayMeta.city 的文字：對照表有就用表上的顯示名（之後定位、天氣都認得），否則用 AI 的繁體中文名 */
export function resolvedCityText(r: ResolvedDay): string {
  return aliasOf(r)?.display ?? (r.city || r.cityEn);
}

/** 原本這天的城市和 AI 判斷的是不是同一個（中英文、對照表別名、已定位的英文名都算） */
export function sameCity(cur: DayMeta | undefined, r: ResolvedDay): boolean {
  const a = cur?.city?.trim();
  if (!a) return false;
  const b = resolvedCityText(r);
  if (lc(a) === lc(b) || lc(a) === lc(r.city) || (!!r.cityEn && lc(a) === lc(r.cityEn))) return true;
  const x = findCityAlias(a);
  if (x && (x === findCityAlias(b) || x === aliasOf(r))) return true;
  return !!(cur?.geo?.en && r.cityEn && lc(cur.geo.en) === lc(r.cityEn));
}

export interface DayGeocodeRequest {
  date: ISODate;
  /** 要存的城市文字（繁體中文） */
  city: string;
  /** 定位用的查詢字（英文城市名＋州／省，例如「Moab, Utah」） */
  query: string;
  en?: string;
  admin1?: string;
  countryCode?: string;
}

/**
 * 換了城市、而且城市對照表沒有的日子：要另外用英文名定位。
 * （對照表有的城市清掉座標就好，天氣 hook 的 geocodeDays 會用對照表的英文名重新定位；
 *  對照表沒有的中文城市名 Open-Meteo 查不到，所以這裡先用 AI 給的英文名＋州查好。）
 */
export function dayGeocodeRequests(trip: Pick<Trip, 'days'>, res: ResolvedPlaces): DayGeocodeRequest[] {
  const out: DayGeocodeRequest[] = [];
  for (const [date, r] of Object.entries(res.days)) {
    const cur = trip.days?.[date];
    if (cur?.source === 'manual' || sameCity(cur, r) || aliasOf(r) || !r.cityEn.trim()) continue;
    out.push({
      date,
      city: resolvedCityText(r),
      query: [r.cityEn.trim(), r.region?.trim()].filter(Boolean).join(', '),
      en: r.cityEn.trim(),
      ...(r.region ? { admin1: r.region } : {}),
      ...(r.countryCode ? { countryCode: r.countryCode } : {}),
    });
  }
  return out;
}

/** 定位結果 → DayMeta.geo（標籤用中文城市名＋國家；英文名、州用 AI 給的）。國碼和 AI 判斷的不同時不採用（回傳 null） */
export function dayGeoFrom(req: DayGeocodeRequest, g: TravelCityGeo): DayGeo | null {
  const found = g.countryCode?.toUpperCase();
  if (req.countryCode && found && found !== req.countryCode.toUpperCase()) return null;
  const cc = found || req.countryCode?.toUpperCase();
  const en = req.en || g.en;
  const admin1 = req.admin1 || g.admin1;
  return {
    lat: g.lat,
    lng: g.lng,
    label: cityLabel(req.city, cc),
    ...(en ? { en } : {}),
    ...(admin1 ? { admin1 } : {}),
    ...(g.timezone ? { timezone: g.timezone } : {}),
    ...(cc ? { countryCode: cc } : {}),
  };
}

export interface MergeStats {
  /** 寫入導航目的地的行程點數 */
  items: number;
  /** 寫入城市的日子數 */
  days: number;
  /** 換了城市的日期（座標已清掉或換成新的） */
  changedDays: ISODate[];
}

/**
 * 把 AI 結果寫進行程（直接修改 draft，在 mutateTrip 裡用）：
 *  - 行程點：place = { query, name, source: 'ai', navigable }；使用者手動設定的（place.source = manual）不動。
 *    導航目的地變了的，清掉自動定位的座標（從連結或手動定位的保留），讓地圖用新的目的地重新定位。
 *  - 每天：手動設定的不動。城市和原本相同 → 只補座標的英文名、州、國碼；換了城市 → 改城市並清掉座標
 *    （geos 有這天的定位結果就直接用），天氣會依新城市重抓。寫過的日子 source 設為 ai：
 *    之後同步試算表時日期列沒變就保留，日期列改了才換回規則版。
 */
export function applyResolvedPlaces(draft: Trip, res: ResolvedPlaces, geos: ReadonlyMap<ISODate, DayGeo> = new Map()): MergeStats {
  let items = 0;
  for (const it of draft.items) {
    const r = res.items[it.id];
    if (!r || it.place?.source === 'manual') continue;
    const changed = (it.place?.query ?? '').trim() !== r.query;
    it.place = { query: r.query, ...(r.name ? { name: r.name } : {}), source: 'ai', navigable: r.navigable };
    if (changed && it.geo && it.geo.source !== 'manual' && it.geo.source !== 'link') delete it.geo;
    items++;
  }

  let days = 0;
  const changedDays: ISODate[] = [];
  for (const [date, r] of Object.entries(res.days)) {
    const cur = draft.days?.[date];
    if (cur?.source === 'manual') continue;
    const alias = aliasOf(r);
    const next: DayMeta = { ...(cur ?? {}), source: 'ai' };
    if (cur && sameCity(cur, r)) {
      if (cur.geo) {
        const en = cur.geo.en || alias?.en || r.cityEn || undefined;
        const admin1 = cur.geo.admin1 || alias?.admin1 || r.region;
        const countryCode = cur.geo.countryCode || alias?.cc || r.countryCode;
        next.geo = { ...cur.geo, ...(en ? { en } : {}), ...(admin1 ? { admin1 } : {}), ...(countryCode ? { countryCode } : {}) };
      }
    } else {
      next.city = resolvedCityText(r);
      const g = geos.get(date);
      if (g) next.geo = { ...g };
      else delete next.geo;
      changedDays.push(date);
    }
    draft.days = { ...(draft.days ?? {}), [date]: next };
    days++;
  }
  return { items, days, changedDays };
}

/** 還沒被 AI 或使用者確認過導航目的地的行程點 id（同步試算表後新增或改過的） */
export const pendingPlaceIds = (trip: Pick<Trip, 'items'>): string[] =>
  trip.items.filter((it) => it.place?.source !== 'ai' && it.place?.source !== 'manual').map((it) => it.id);
