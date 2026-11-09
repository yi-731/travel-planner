/**
 * 旅程清單與新增行程用的純函式（無 React），測試在 model.test.ts。
 */
import { COMMON_CURRENCIES } from '@/domain/constants';
import { fmtMD } from '@/domain/dates';
import type { ISODate, Trip } from '@/domain/types';

/** 含中日韓文字：城市大字改用系統粗體（襯線字沒有中文字形） */
const HAS_CJK = /[぀-ヿ㐀-鿿豈-﫿가-힯]/;
export const isCjk = (s: string) => HAS_CJK.test(s);

type TripLike = Pick<Trip, 'name' | 'city' | 'cityGeo' | 'startDate' | 'endDate' | 'items' | 'createdAt'>;

/** 大字顯示的城市名：城市 → 定位結果 → 行程名稱 */
export function tripCity(t: Pick<Trip, 'name' | 'city' | 'cityGeo'>): { text: string; fromName: boolean } {
  const city = t.city.trim() || t.cityGeo?.label?.split('，')[0]?.trim() || '';
  if (city) return { text: city, fromName: false };
  return { text: t.name.trim() || '未命名行程', fromName: true };
}

/** 11/20–11/24；只有出發日時顯示一天；沒有日期回傳空字串 */
export function dateRange(start: ISODate | null | undefined, end: ISODate | null | undefined): string {
  if (!start) return end ? fmtMD(end) : '';
  if (!end || end <= start) return fmtMD(start);
  return `${fmtMD(start)}–${fmtMD(end)}`;
}

/** 選擇旅程頁的副標：「京阪奈五日 · 11/20–11/24 · 18 站」（大字已經是行程名稱時省略名稱） */
export function tripSubtitle(t: TripLike): string {
  const parts: string[] = [];
  if (!tripCity(t).fromName) parts.push(t.name.trim() || '未命名行程');
  parts.push(dateRange(t.startDate, t.endDate) || '日期未定');
  parts.push(`${t.items.length} 站`);
  return parts.join(' · ');
}

/** 依出發日排序；沒有日期的排最後（再依建立時間） */
export function sortTrips<T extends Pick<Trip, 'startDate' | 'createdAt'>>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    if (a.startDate && b.startDate && a.startDate !== b.startDate) return a.startDate < b.startDate ? -1 : 1;
    if (a.startDate && !b.startDate) return -1;
    if (!a.startDate && b.startDate) return 1;
    return a.createdAt - b.createdAt;
  });
}

/* ---------- 貨幣 ---------- */

const CURRENCY_NAMES: Record<string, string> = {
  TWD: '新台幣', JPY: '日圓', KRW: '韓元', USD: '美元', EUR: '歐元', GBP: '英鎊', HKD: '港幣', CNY: '人民幣',
  THB: '泰銖', SGD: '新加坡幣', VND: '越南盾', AUD: '澳幣', CAD: '加幣', CHF: '瑞士法郎', MYR: '馬幣',
  PHP: '菲律賓披索', IDR: '印尼盾', NZD: '紐幣', MOP: '澳門幣',
};

/** 選單文字：「JPY 日圓」 */
export const currencyLabel = (code: string) => (CURRENCY_NAMES[code] ? `${code} ${CURRENCY_NAMES[code]}` : code);

/** 常用幣別＋目前選到但不在清單裡的幣別（例如設定裡的本國貨幣是 NZD） */
export function currencyList(extra: (string | undefined)[] = []): string[] {
  const out = [...COMMON_CURRENCIES];
  for (const c of extra) if (c && !out.includes(c)) out.push(c);
  return out;
}

const EURO = ['AT', 'BE', 'HR', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES'];
const COUNTRY_CURRENCY: Record<string, string> = {
  TW: 'TWD', JP: 'JPY', KR: 'KRW', US: 'USD', GB: 'GBP', HK: 'HKD', MO: 'MOP', CN: 'CNY', TH: 'THB', SG: 'SGD',
  VN: 'VND', AU: 'AUD', NZ: 'NZD', CA: 'CAD', CH: 'CHF', MY: 'MYR', PH: 'PHP', ID: 'IDR',
  ...Object.fromEntries(EURO.map((cc) => [cc, 'EUR'])),
};

/** 國碼 → 當地貨幣；不認識回傳 null */
export const currencyForCountry = (cc: string | undefined | null): string | null =>
  (cc && COUNTRY_CURRENCY[cc.toUpperCase()]) || null;
