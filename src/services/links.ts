/**
 * 外部連結產生器（Google 地圖、Apple 地圖、Google 日曆、社群口碑…）。純函式，好測試。
 */
import { addDays, fromMinutes, toMinutes } from '@/domain/dates';
import type { Item, Trip } from '@/domain/types';
import { placeQuery } from '@/domain/schedule';

const enc = encodeURIComponent;
export type TravelMode = 'transit' | 'driving' | 'walking' | 'bicycling';

export const gmapsNavigate = (q: string, mode: TravelMode = 'transit') =>
  `https://www.google.com/maps/dir/?api=1&destination=${enc(q)}&travelmode=${mode}`;
export const gmapsDirections = (origin: string, dest: string, mode: TravelMode = 'transit') =>
  `https://www.google.com/maps/dir/?api=1&origin=${enc(origin)}&destination=${enc(dest)}&travelmode=${mode}`;
export const gmapsSearch = (q: string) => `https://www.google.com/maps/search/?api=1&query=${enc(q)}`;
/** 即時路況圖層（以使用者目前位置為中心） */
export const gmapsTraffic = 'https://www.google.com/maps/@?api=1&map_action=map&layer=traffic';
export const appleMapsNavigate = (q: string, mode: 'r' | 'd' | 'w' = 'r') => `https://maps.apple.com/?daddr=${enc(q)}&dirflg=${mode}`;
export const googleSearch = (q: string) => `https://www.google.com/search?q=${enc(q)}`;

/** 一整天依序串成 Google 地圖路線（Google 限制：起點＋終點＋最多 9 個中途點） */
export function gmapsDayRoute(items: Pick<Item, 'address' | 'title'>[], mode: TravelMode = 'transit'): string | null {
  const q = items.map(placeQuery).filter(Boolean);
  if (q.length < 2) return null;
  const wp = q.slice(1, -1).slice(0, 9);
  return `https://www.google.com/maps/dir/?api=1&origin=${enc(q[0])}&destination=${enc(q[q.length - 1])}${
    wp.length ? `&waypoints=${enc(wp.join('|'))}` : ''
  }&travelmode=${mode}`;
}

/**
 * Google 日曆「新增活動」連結。
 * 有時間的行程點帶上旅程城市的時區（ctz），否則 Google 會用使用者日曆的時區（通常是台北）解讀，
 * 東京 12:30 會變成台北 12:30（東京 13:30）。整天的活動與時區無關；不知道時區時維持原本的寫法。
 */
export function googleCalendar(
  trip: Pick<Trip, 'name'> & Partial<Pick<Trip, 'cityGeo'>>,
  it: Pick<Item, 'title' | 'date' | 'time' | 'durationMin' | 'address' | 'note'>,
): string | null {
  if (!it.date) return null;
  const d = it.date.replace(/-/g, '');
  const st = toMinutes(it.time);
  let dates: string;
  let ctz = '';
  if (st == null) dates = `${d}/${addDays(it.date, 1).replace(/-/g, '')}`;
  else {
    const en = Math.min(st + (it.durationMin || 60), 23 * 60 + 59);
    dates = `${d}T${fromMinutes(st).replace(':', '')}00/${d}T${fromMinutes(en).replace(':', '')}00`;
    const tz = trip.cityGeo?.timezone?.trim();
    if (tz) ctz = `&ctz=${enc(tz)}`;
  }
  const details = [it.note, trip.name].filter(Boolean).join('\n');
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${enc(it.title)}&dates=${dates}${ctz}&location=${enc(
    it.address || it.title,
  )}&details=${enc(details)}`;
}

export interface SocialLink {
  label: string;
  url: string;
  /** 品牌色點 */
  color: string;
}

/** 社群口碑與評價連結 */
export function socialLinks(city: string, it: Pick<Item, 'title' | 'type'>): SocialLink[] {
  const q = `${it.title} ${city}`.trim();
  const tag = it.title.replace(/[\s\-–—·・()（）'’"&,.!?/]/g, '');
  const links: SocialLink[] = [
    { label: 'Google 評價', url: gmapsSearch(q), color: '#4285F4' },
    { label: 'Instagram', url: `https://www.instagram.com/explore/tags/${enc(tag)}/`, color: '#E1306C' },
    { label: 'TikTok', url: `https://www.tiktok.com/search?q=${enc(q)}`, color: '#25F4EE' },
    { label: 'YouTube', url: `https://www.youtube.com/results?search_query=${enc(q)}`, color: '#FF0000' },
    { label: '小紅書', url: `https://www.xiaohongshu.com/search_result?keyword=${enc(q)}`, color: '#FF2442' },
    { label: 'Threads', url: `https://www.threads.net/search?q=${enc(q)}`, color: '#8A8A8A' },
    { label: 'Tripadvisor', url: `https://www.tripadvisor.com.tw/Search?q=${enc(q)}`, color: '#34E0A1' },
  ];
  if (it.type === 'food') links.splice(1, 0, { label: 'Tabelog 食べログ', url: `https://tabelog.com/rstLst/?sw=${enc(it.title)}`, color: '#F7A400' });
  links.push({ label: 'Google 搜尋心得', url: googleSearch(`${q} 評價 心得`), color: '#9AA0A6' });
  return links;
}

export const weatherLinks = (city: string) => [
  { label: 'Google 天氣', url: googleSearch(`${city} 天氣`) },
  { label: 'AccuWeather', url: `https://www.accuweather.com/zh/search-locations?query=${enc(city)}` },
  { label: 'Windy 風雨雷達', url: 'https://www.windy.com/' },
  { label: '中央氣象署 國際城市', url: 'https://www.cwa.gov.tw/V8/C/W/world.html' },
];

export const fxSearch = (from: string, to: string) => googleSearch(`1 ${from} to ${to}`);
