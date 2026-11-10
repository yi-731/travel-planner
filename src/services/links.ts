/**
 * 外部連結產生器（Google 地圖、Apple 地圖、Google 日曆、社群口碑…）。純函式，好測試。
 */
import { addDays, fromMinutes, toMinutes } from '@/domain/dates';
import type { Item, Trip } from '@/domain/types';
import { itemMinutes, placeQuery } from '@/domain/schedule';
import { dayMetaFor } from './places';
import { findCitiesInText, findCityAlias } from './weather';

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

/** 比較用：大小寫、全半形、空白不同的視為同一個地點 */
const sameQuery = (a: string, b: string) => a.normalize('NFKC').toLowerCase().replace(/\s+/g, '') === b.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

/**
 * 一整天依序串成 Google 地圖路線（Google 限制：起點＋終點＋最多 9 個中途點）。
 * 連續好幾站在同一個地方（回到飯店 → 在飯店打包）只算一次，不浪費中途點。
 */
export function gmapsDayRoute(items: (Pick<Item, 'address' | 'title'> & Partial<Pick<Item, 'place' | 'geo'>>)[], mode: TravelMode = 'transit'): string | null {
  const q: string[] = [];
  for (const it of items) {
    const s = placeQuery(it);
    if (s && !(q.length && sameQuery(q[q.length - 1], s))) q.push(s);
  }
  if (q.length < 2) return null;
  const wp = q.slice(1, -1).slice(0, 9);
  return `https://www.google.com/maps/dir/?api=1&origin=${enc(q[0])}&destination=${enc(q[q.length - 1])}${
    wp.length ? `&waypoints=${enc(wp.join('|'))}` : ''
  }&travelmode=${mode}`;
}

type CalendarTrip = Pick<Trip, 'name'> & Partial<Pick<Trip, 'cityGeo' | 'city' | 'days' | 'items'>>;

/**
 * 這一站的時區：當天城市的時區（多城市行程每天不同），沒有就用行程城市的。
 * 這站的目的地在別的城市（一日遊早上還在住宿的城市）、而那個城市在其他天定位過，用那天的時區；
 * 目的地在別的國家（抵達西雅圖那天的「桃園機場報到」）又不知道時區：不帶時區（不要猜錯）。
 */
export function stopTimezone(trip: CalendarTrip, it: Pick<Item, 'date' | 'title' | 'address'> & { place?: Item['place'] }): string | undefined {
  const tripTz = trip.cityGeo?.timezone?.trim() || undefined;
  if (!trip.days || !Object.keys(trip.days).length) return tripTz;
  const day = dayMetaFor({ days: trip.days, city: trip.city ?? '', cityGeo: trip.cityGeo }, it.date);
  const dayTz = day?.geo?.timezone?.trim() || tripTz;
  const dayAlias = day?.city ? findCityAlias(day.city) : undefined;
  const dayCc = (day?.geo?.countryCode ?? dayAlias?.cc ?? trip.cityGeo?.countryCode)?.toUpperCase();
  const q = it.place?.query?.trim() || it.address?.trim() || '';
  const mentions = q ? findCitiesInText(q).map((m) => m.alias) : [];
  const other = mentions.length ? mentions[mentions.length - 1] : undefined;
  if (!other || other === dayAlias) return dayTz;
  // 其他天去過的同一個城市：用那天的時區
  for (const m of Object.values(trip.days)) {
    if (m?.geo?.timezone && m.city && findCityAlias(m.city) === other) return m.geo.timezone;
  }
  if (dayCc && other.cc && other.cc.toUpperCase() !== dayCc) return undefined;
  return dayTz;
}

/**
 * Google 日曆「新增活動」連結。
 * 有時間的行程點帶上那一站所在城市的時區（ctz，見 stopTimezone），否則 Google 會用使用者日曆的時區（通常是台北）解讀，
 * 東京 12:30 會變成台北 12:30（東京 13:30）。整天的活動與時區無關；不知道時區時維持原本的寫法。
 * 晚上行程後面的「0:45」是過了午夜：日期算隔天。
 */
export function googleCalendar(
  trip: CalendarTrip,
  it: Pick<Item, 'title' | 'date' | 'time' | 'durationMin' | 'address' | 'note'> & Partial<Pick<Item, 'id' | 'place'>>,
): string | null {
  if (!it.date) return null;
  const st0 = toMinutes(it.time);
  const st = st0 != null && it.id && trip.items ? itemMinutes({ items: trip.items }, { id: it.id, date: it.date, time: it.time }) ?? st0 : st0;
  let dates: string;
  let ctz = '';
  if (st == null) dates = `${it.date.replace(/-/g, '')}/${addDays(it.date, 1).replace(/-/g, '')}`;
  else {
    const date = st >= 1440 ? addDays(it.date, Math.floor(st / 1440)) : it.date;
    const d = date.replace(/-/g, '');
    const start = st % 1440;
    const en = Math.min(start + (it.durationMin || 60), 23 * 60 + 59);
    dates = `${d}T${fromMinutes(start).replace(':', '')}00/${d}T${fromMinutes(en).replace(':', '')}00`;
    const tz = stopTimezone(trip, it);
    if (tz) ctz = `&ctz=${enc(tz)}`;
  }
  const details = [it.note, trip.name].filter(Boolean).join('\n');
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${enc(it.title)}&dates=${dates}${ctz}&location=${enc(placeQuery(it))}&details=${enc(details)}`;
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
