/**
 * 地點頁的純邏輯（不含 React）：時間、停留、費用、連結的顯示文字。
 */
import { fromMinutes, toMinutes } from '@/domain/dates';
import type { Item, ItemType } from '@/domain/types';

/** 90 → '1 小時 30 分'；45 → '45 分鐘'；120 → '2 小時' */
export function fmtDuration(min: number | undefined | null): string {
  const m = Math.round(Number(min) || 0);
  if (m <= 0) return '';
  const h = Math.floor(m / 60), r = m % 60;
  if (!h) return `${r} 分鐘`;
  return r ? `${h} 小時 ${r} 分` : `${h} 小時`;
}

/** '16:30 – 18:00'（有停留時間才顯示結束時間）；沒時間回傳空字串 */
export function timeRange(it: Pick<Item, 'time' | 'durationMin'>): string {
  const st = toMinutes(it.time);
  if (st == null) return '';
  const d = Math.round(Number(it.durationMin) || 0);
  if (d <= 0) return fromMinutes(st);
  const en = st + d;
  // 跨過午夜時只顯示開始時間＋停留，避免看起來像倒退
  if (en >= 24 * 60) return fromMinutes(st);
  return `${fromMinutes(st)} – ${fromMinutes(en)}`;
}

/** 沒寫 http(s):// 的連結補上 https://；不是網址回傳 null */
export function normalizeUrl(raw: string | undefined | null): string | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/** 連結顯示用的網域（去掉 www.） */
export function linkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** 評分限制在 0–5，回傳星星填滿比例（0–100） */
export function ratingPct(rating: number): number {
  if (!Number.isFinite(rating)) return 0;
  return Math.max(0, Math.min(100, (rating / 5) * 100));
}

/** 4 → '4.0'；4.25 → '4.3' */
export const fmtRating = (rating: number) => (Number.isFinite(rating) ? rating.toFixed(1) : '');

/** 標題卡的說明列：'Day 1 · 11/21（週六）· 16:30'；沒排日期時 '還沒排日期 · 16:30' */
export function placeMeta(dayNo: number, md: string, wd: string, time?: string): string {
  let out = dayNo > 0 ? `Day ${dayNo} · ` : '';
  out += md ? `${md}${wd ? `（週${wd}）` : ''}` : '還沒排日期';
  // 全形括號本身有留白，後面的分隔點不再加前置空格
  if (time) out += `${md && wd ? '· ' : ' · '}${time}`;
  return out;
}

/** 住宿只留查飯店時真的會看的來源（順序沿用 socialLinks） */
const STAY_SOCIALS = new Set(['Google 評價', 'Instagram', 'Tripadvisor', 'Google 搜尋心得']);

/**
 * 地點頁「口碑與評價」依類型精簡：交通（航班、車次）不用查口碑 → 空陣列，整區不顯示；
 * 住宿只留評價類；景點、美食、購物、其他維持完整清單。
 * 只過濾、不改 socialLinks 本身，因為 AI 推薦頁也用同一份清單。
 */
export function placeSocials<T extends { label: string }>(type: ItemType, links: T[]): T[] {
  if (type === 'transport') return [];
  if (type === 'stay') return links.filter((l) => STAY_SOCIALS.has(l.label));
  return links;
}

/** 沒有任何資訊時的提示；已經排了時間就不要再叫使用者「補上時間」 */
export function factsHint(it: Pick<Item, 'time'>): string {
  return toMinutes(it.time) != null ? '補上地址或停留時間，導航和行程檢查會更準確。' : '補上地址、時間或費用，導航和行程檢查會更準確。';
}
