import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DayMeta, Item, Trip } from '@/domain/types';
import { applyRulePlaces, buildPlace, classifyLocation, cleanTitle, dayMetaFor, geocodeDays, parseDayBanner } from './places';

afterEach(() => vi.unstubAllGlobals());

/* ---------------- 合成測試資料（結構仿照真實的多城市試算表，內容是虛構的） ---------------- */

let seq = 0;
function item(date: string | null, title: string, address?: string, over: Partial<Item> = {}): Item {
  return { id: `i${++seq}`, date, title, address, type: 'other', done: false, createdAt: 0, updatedAt: 0, ...over };
}
function trip(over: Partial<Trip> = {}): Trip {
  return {
    id: 't', name: '美西', city: '', startDate: '2026-12-03', endDate: '2026-12-08', localCurrency: 'USD', homeCurrency: 'TWD',
    rate: 32, members: ['我'], items: [], expenses: [], cover: { kind: 'orb' }, ai: { dayChecks: {} }, createdAt: 0, updatedAt: 0, ...over,
  };
}
const banner = (label: string): DayMeta => ({ label, source: 'rule' });

describe('parseDayBanner', () => {
  it('路線＋住宿＋活動：過夜城市是路線終點，活動段落不當城市', () => {
    expect(parseDayBanner('12/04（五）｜舊金山 → 拉斯維加斯｜住 Maple Lodge｜NBA 季中賽')).toEqual({
      label: '舊金山 → 拉斯維加斯｜住 Maple Lodge｜NBA 季中賽',
      cities: ['舊金山', '拉斯維加斯'],
      city: '拉斯維加斯',
      lodging: 'Maple Lodge',
    });
  });
  it('第一格是圖例＋第一天日期列', () => {
    const b = parseDayBanner('★ = 必去 ◇ = 有空再去 ⚠ = 要注意 日期 12/03（四）｜台北 → 舊金山｜住 Hotel Zephyr');
    expect(b.label).toBe('台北 → 舊金山｜住 Hotel Zephyr');
    expect(b.city).toBe('舊金山');
    expect(b.cities).toEqual(['台北', '舊金山']);
    expect(b.lodging).toBe('Hotel Zephyr');
  });
  it('單一城市段落；去掉星期括號', () => {
    expect(parseDayBanner('（六）｜拉斯維加斯｜Strip 一日').city).toBe('拉斯維加斯');
    expect(parseDayBanner('Los Angeles | 海灘日').city).toBe('洛杉磯');
    expect(parseDayBanner('京都市區｜寺廟巡禮').city).toBe('京都');
  });
  it('只有活動、沒有城市 → 沒有 city（之後沿用前一天）', () => {
    const b = parseDayBanner('12/06（日）｜大峽谷一日遊｜South Rim + 日落');
    expect(b.city).toBeUndefined();
    expect(b.cities).toEqual([]);
    expect(parseDayBanner('（四）感恩節｜主題樂園一日').city).toBeUndefined();
  });
  it('住宿名稱裡的城市（沒有路線時當過夜城市）', () => {
    const b = parseDayBanner('12/07｜海邊放空｜住 Loews Santa Monica');
    expect(b.lodging).toBe('Loews Santa Monica');
    expect(b.city).toBe('聖塔莫尼卡');
  });
  it('「～」「到」只有兩端都是城市才算路線', () => {
    expect(parseDayBanner('京都～大阪｜住 難波').city).toBe('大阪');
    expect(parseDayBanner('睡到自然醒｜京都').city).toBe('京都');
    expect(parseDayBanner('Day 3 | Kyoto | Stay: Hotel Granvia')).toMatchObject({ city: '京都', lodging: 'Hotel Granvia' });
  });
});

describe('classifyLocation', () => {
  it.each([
    ['1000 S Las Vegas Blvd', '1000 S Las Vegas Blvd'],
    ['123 N Broadway', '123 N Broadway'],
    ['1 Ferry Building Plaza', '1 Ferry Building Plaza'],
    ['88 Ocean Avenue', '88 Ocean Avenue'],
    ['對面 200 E 5th St', '200 E 5th St'],
    ['Mission St × 3rd St', 'Mission St & 3rd St'],
    ['京都市東山区清水1-294', '京都市東山区清水1-294'],
    ['台北市信義路五段7號', '台北市信義路五段7號'],
  ])('地址：%s', (cell, value) => {
    expect(classifyLocation(cell)).toEqual({ kind: 'address', value });
  });
  it('路線（A → B、→ B、機場代碼）', () => {
    expect(classifyLocation('SFO → LAS')).toEqual({ kind: 'route', value: 'LAS', from: 'SFO', to: 'LAS' });
    expect(classifyLocation('→ Golden Gate Bridge')).toEqual({ kind: 'route', value: 'Golden Gate Bridge', from: '', to: 'Golden Gate Bridge' });
    expect(classifyLocation('Maple Lodge -> Central 站')).toMatchObject({ kind: 'route', from: 'Maple Lodge', to: 'Central 站' });
  });
  it.each(['車程 10 分', '步行 5–8 分 / 0.4 mile', 'Lyft 20 分 / 6 mile', '驅車 30 mile', '開車 45 分', '約 15 分', 'Kanab 東邊 3 mile'])('交通說明：%s', (cell) => {
    expect(classifyLocation(cell).kind).toBe('transit');
  });
  it.each(['看台', '回程', 'Monorail', '機場', '飯店', '會場周邊', 'Uber'])('泛稱：%s', (cell) => {
    expect(classifyLocation(cell).kind).toBe('generic');
  });
  it('地點名稱：去掉括號、只取「｜」前面', () => {
    expect(classifyLocation('Maple Lodge')).toEqual({ kind: 'place', value: 'Maple Lodge' });
    expect(classifyLocation('Ferry Building 大廳')).toEqual({ kind: 'place', value: 'Ferry Building 大廳' });
    expect(classifyLocation('Union Square 停車場')).toEqual({ kind: 'place', value: 'Union Square 停車場' });
    expect(classifyLocation('Kanab｜MST')).toEqual({ kind: 'place', value: 'Kanab' });
    expect(classifyLocation('Hilltop Observatory（停車場旁）')).toEqual({ kind: 'place', value: 'Hilltop Observatory' });
    expect(classifyLocation('淺草')).toEqual({ kind: 'place', value: '淺草' });
  });
  it('空白', () => {
    expect(classifyLocation('  ')).toEqual({ kind: 'empty', value: '' });
  });
});

describe('cleanTitle', () => {
  it('★ → must、◇ → optional，去掉標記與時間括號', () => {
    expect(cleanTitle('★ Alcatraz 渡輪（建議 3 小時）')).toEqual({ title: 'Alcatraz 渡輪', flag: 'must' });
    expect(cleanTitle('★★ 晚餐 Blue Fin（1h05m）')).toEqual({ title: '晚餐 Blue Fin', flag: 'must' });
    expect(cleanTitle('◇【二選一】夜市（45–60 分鐘）')).toEqual({ title: '夜市', flag: 'optional' });
    expect(cleanTitle('◇ 海邊散步 (12–15 mile)')).toEqual({ title: '海邊散步', flag: 'optional' });
  });
  it('保留有意義的括號；沒有標記時沒有 flag', () => {
    expect(cleanTitle('★ 演唱會（加場）').title).toBe('演唱會（加場）');
    expect(cleanTitle('⚠️ 注意封路')).toEqual({ title: '注意封路' });
    expect(cleanTitle('咖啡（West Village）')).toEqual({ title: '咖啡（West Village）' });
  });
});

/* ---------------- 整趟套用 ---------------- */

function westTrip(): Trip {
  seq = 0;
  const days: Record<string, DayMeta> = {
    '2026-12-03': banner('台北 → 舊金山｜住 Hotel Zephyr'),
    '2026-12-04': banner('舊金山 → 拉斯維加斯｜住 Maple Lodge｜NBA 季中賽'),
    '2026-12-05': banner('拉斯維加斯｜Strip 一日'),
    '2026-12-06': banner('大峽谷一日遊｜South Rim'),
    '2026-12-07': banner('拉斯維加斯 → 洛杉磯｜住 Loews Santa Monica'),
  };
  const D3 = '2026-12-03', D4 = '2026-12-04', D5 = '2026-12-05', D6 = '2026-12-06', D7 = '2026-12-07', D8 = '2026-12-08';
  return trip({
    days,
    items: [
      item(D3, '★ 桃園機場 T1 報到', 'TPE Terminal 1', { tag: '機場' }),
      item(D3, '★ BR018 起飛', 'TPE → SFO', { tag: '航班' }),
      item(D3, '★ 抵達 SFO 國際航廈', 'SFO International Terminal', { tag: '航班' }),
      item(D3, '★ 搭 BART 進市區', 'SFO → Powell St 站', { tag: '交通' }),
      item(D3, '★ Hotel Zephyr check-in', '250 Beach St', { tag: '住宿' }),
      item(D4, '飯店早餐', 'Hotel Zephyr', { tag: '早餐' }),
      item(D4, '★ United SFO → LAS', 'SFO → LAS', { tag: '航班' }),
      item(D4, '★ 抵達 LAS', 'LAS T3', { tag: '航班' }),
      item(D4, '★ 午餐 Blue Fin Sushi', '1000 S Las Vegas Blvd', { tag: '午餐' }),
      item(D4, '★ 步行到 Central 站搭 Tram', 'Maple Lodge → Central 站', { tag: '交通' }),
      item(D4, '★ 季中賽', '看台', { tag: '活動' }),
      item(D4, '★ Tram 回飯店', '回程', { tag: '交通' }),
      item(D5, '起床', '回程', { tag: '起床' }),
      item(D5, '◇ New York-New York 雲霄飛車', 'New York-New York Las Vegas', { tag: '景點' }),
      item(D5, '回飯店休息', '車程 10 分', { tag: '休息' }),
      item(D6, '★ 抵達 Grand Canyon', 'Grand Canyon｜MST', { tag: '抵達' }),
      item(D6, '★★ Mather Point 日落', 'Grand Canyon｜MST', { tag: '景點' }),
      item(D6, '★ Desert View 瞭望台', 'Grand Canyon 東邊 20 mile', { tag: '景點' }),
      item(D6, '★ 出發回拉斯維加斯', 'Grand Canyon → Las Vegas', { tag: '回程' }),
      item(D7, '飯店早餐、退房', 'Maple Lodge', { tag: '早餐' }),
      item(D7, '★ 開往 Santa Monica', 'LAX → Santa Monica', { tag: '交通' }),
      item(D7, '★ 晚餐 Ocean Grill（海景）', '101 Ocean Ave', { tag: '晚餐' }),
      item(D8, '★ The Getty Center', '1200 Getty Center Dr', { tag: '美術館' }),
      item(D8, '打包', '', { tag: '整理' }),
    ],
  });
}

describe('applyRulePlaces', () => {
  const t = applyRulePlaces(westTrip());
  const q = (title: string) => t.items.find((i) => i.title === title)?.place;

  it('補齊每天的城市與住宿：沒寫城市的日子沿用前一天，沒寫住宿但同城市也沿用', () => {
    const days = t.days!;
    expect(days['2026-12-03']).toMatchObject({ city: '舊金山', lodging: 'Hotel Zephyr' });
    expect(days['2026-12-04']).toMatchObject({ city: '拉斯維加斯', lodging: 'Maple Lodge' });
    expect(days['2026-12-05']).toMatchObject({ city: '拉斯維加斯', lodging: 'Maple Lodge' });
    expect(days['2026-12-06']).toMatchObject({ city: '拉斯維加斯', lodging: 'Maple Lodge', label: '大峽谷一日遊｜South Rim' });
    expect(days['2026-12-07']).toMatchObject({ city: '洛杉磯', lodging: 'Loews Santa Monica' });
    // 沒有日期列的最後一天
    expect(days['2026-12-08']).toMatchObject({ city: '洛杉磯', lodging: 'Loews Santa Monica' });
    expect(days['2026-12-08'].label).toBeUndefined();
  });

  it('行程主要城市：出現最多天的城市（出發地台北不算）', () => {
    expect(t.city).toBe('拉斯維加斯');
  });

  it('機場：代碼展開成「XXX airport」，城市用機場所在城市；起飛用起點', () => {
    expect(q('★ 桃園機場 T1 報到')?.query).toBe('TPE airport Terminal 1, Taoyuan, Taiwan');
    expect(q('★ BR018 起飛')?.query).toBe('TPE airport, Taoyuan, Taiwan');
    expect(q('★ 抵達 LAS')?.query).toBe('LAS airport Terminal 3, Las Vegas, NV, USA');
    expect(q('★ United SFO → LAS')?.query).toBe('SFO airport, San Francisco, CA, USA');
  });

  it('車站：「站」換成 station，加上城市背景', () => {
    expect(q('★ 搭 BART 進市區')?.query).toBe('Powell St station, San Francisco, CA, USA');
    expect(q('★ 步行到 Central 站搭 Tram')?.query).toBe('Central station, Las Vegas, NV, USA');
  });

  it('地址：店名＋地址＋城市；路名裡的城市（Las Vegas Blvd）不算已經有城市', () => {
    expect(q('★ Hotel Zephyr check-in')?.query).toBe('Hotel Zephyr, 250 Beach St, San Francisco, CA, USA');
    expect(q('★ 午餐 Blue Fin Sushi')?.query).toBe('Blue Fin Sushi, 1000 S Las Vegas Blvd, Las Vegas, NV, USA');
  });

  it('回飯店 → 當天住宿；早上還沒離開時用前一晚的住宿', () => {
    expect(q('★ Tram 回飯店')?.query).toBe('Maple Lodge, Las Vegas, NV, USA');
    expect(q('回飯店休息')?.query).toBe('Maple Lodge, Las Vegas, NV, USA');
    expect(q('飯店早餐')?.query).toBe('Hotel Zephyr, San Francisco, CA, USA');
    expect(q('飯店早餐、退房')?.query).toBe('Maple Lodge, Las Vegas, NV, USA');
  });

  it('往住宿所在城市的路線 → 住宿；之後的行程用那個城市', () => {
    expect(q('★ 開往 Santa Monica')?.query).toBe('Loews Santa Monica, CA, USA');
    expect(q('★ 晚餐 Ocean Grill（海景）')?.query).toBe('Ocean Grill, 101 Ocean Ave, Santa Monica, CA, USA');
  });

  it('一日遊：地點欄寫了別的城市（大峽谷），用那個城市的背景；回程回到住宿', () => {
    expect(q('★ 抵達 Grand Canyon')?.query).toBe('Grand Canyon Village, AZ, USA');
    expect(q('★★ Mather Point 日落')?.query).toBe('Mather Point, Grand Canyon Village, AZ, USA');
    expect(q('★ Desert View 瞭望台')?.query).toBe('Desert View, Grand Canyon Village, AZ, USA');
    expect(q('★ 出發回拉斯維加斯')?.query).toBe('Maple Lodge, Las Vegas, NV, USA');
  });

  it('地點名稱已含城市不重複；泛稱用標題', () => {
    expect(q('◇ New York-New York 雲霄飛車')?.query).toBe('New York-New York Las Vegas, NV, USA');
    expect(q('★ 季中賽')).toMatchObject({ query: '季中賽, Las Vegas, NV, USA', navigable: true });
  });

  it('只有動作、沒有地點 → navigable = false', () => {
    expect(q('起床')?.navigable).toBe(false);
    expect(q('打包')?.navigable).toBe(false);
    expect(q('★ The Getty Center')).toMatchObject({ source: 'rule', navigable: true, query: 'The Getty Center, 1200 Getty Center Dr, Los Angeles, CA, USA' });
  });

  it('不改動傳入的物件；手動、AI 的地點保留；再套一次結果相同', () => {
    const src = westTrip();
    src.items[0].place = { query: '我自己填的', source: 'manual' };
    src.items[1].place = { query: 'AI 給的', source: 'ai' };
    const before = JSON.stringify(src);
    const out = applyRulePlaces(src);
    expect(JSON.stringify(src)).toBe(before);
    expect(out.items[0].place).toEqual({ query: '我自己填的', source: 'manual' });
    expect(out.items[1].place).toEqual({ query: 'AI 給的', source: 'ai' });
    const again = applyRulePlaces(out);
    expect(again.days).toEqual(out.days);
    expect(again.items.map((i) => i.place)).toEqual(out.items.map((i) => i.place));
    // 沒變的行程點保留同一個物件
    expect(again.items[5]).toBe(out.items[5]);
  });

  it('已存的城市座標跟著城市走：城市改了就清掉，同城市的下一天沿用', () => {
    const src = westTrip();
    src.days!['2026-12-04'].geo = { lat: 36.17, lng: -115.14, en: 'Las Vegas', label: '拉斯維加斯，美國' };
    src.days!['2026-12-03'].geo = { lat: 34.05, lng: -118.24, en: 'Los Angeles', label: '洛杉磯，美國' };
    const out = applyRulePlaces(src);
    expect(out.days!['2026-12-03'].geo).toBeUndefined();
    expect(out.days!['2026-12-05'].geo?.en).toBe('Las Vegas');
    expect(out.days!['2026-12-06'].geo?.en).toBe('Las Vegas');
  });

  it('沒有任何日期列：用行程城市', () => {
    const out = applyRulePlaces(
      trip({ city: '京都', cityGeo: { lat: 35.01, lng: 135.75, label: '京都，日本', countryCode: 'JP' }, items: [item('2026-12-03', '清水寺', '清水寺')] }),
    );
    expect(out.days!['2026-12-03']).toMatchObject({ city: '京都', source: 'rule' });
    expect(out.items[0].place?.query).toBe('清水寺, Kyoto, Japan');
  });
});

describe('buildPlace', () => {
  const day: DayMeta = { city: '京都', lodging: 'Hotel Granvia', geo: { lat: 34.98, lng: 135.76, en: 'Kyoto', countryCode: 'JP' } };
  const base = { city: '京都', cityGeo: undefined };
  it('中日韓的地名照原文（Google 地圖認得），去掉動作詞', () => {
    expect(buildPlace(item('d', '前往伏見稻荷'), day, base)?.query).toBe('伏見稻荷, Kyoto, Japan');
    expect(buildPlace(item('d', '嵐山竹林', '嵐山'), day, base)?.query).toBe('嵐山竹林, Kyoto, Japan');
    expect(buildPlace(item('d', '抹茶甜點', '中村藤吉'), day, base)?.query).toBe('抹茶甜點, 中村藤吉, Kyoto, Japan');
    expect(buildPlace(item('d', '★ 京都站 → 奈良'), day, base)?.query).toBe('Nara, Japan');
  });
  it('菜名裡的城市（北京烤鴨、大阪燒）不會換城市', () => {
    const tp: DayMeta = { city: '台北', geo: { lat: 25.03, lng: 121.56, en: 'Taipei', countryCode: 'TW' } };
    expect(buildPlace(item('d', '北京烤鴨', '車程 10 分'), tp, { city: '台北' })?.query).toBe('北京烤鴨, Taipei, Taiwan');
    expect(buildPlace(item('d', '晚餐 大阪燒', '步行 5 分'), day, base)?.query).toBe('大阪燒, Kyoto, Japan');
  });
  it('手動的地點不覆蓋；沒有當天資料時用行程城市', () => {
    const manual = item('d', 'X', undefined, { place: { query: '自訂', source: 'manual' } });
    expect(buildPlace(manual, day, base)).toEqual({ query: '自訂', source: 'manual' });
    expect(buildPlace(item(null, 'Pike Place Market'), undefined, { city: '西雅圖' })?.query).toBe('Pike Place Market, Seattle, WA, USA');
  });
});

describe('dayMetaFor', () => {
  const days: Record<string, DayMeta> = {
    '2026-12-03': { city: '舊金山', lodging: 'Hotel Zephyr' },
    '2026-12-05': { label: '一日遊' },
    '2026-12-06': { city: '拉斯維加斯' },
  };
  const t = { days, city: '舊金山', cityGeo: { lat: 37.77, lng: -122.42, label: '舊金山，美國' } };
  it('沒有城市就往前找最近一天（保留當天的日期列文字）', () => {
    expect(dayMetaFor(t, '2026-12-03')).toBe(days['2026-12-03']);
    expect(dayMetaFor(t, '2026-12-04')).toBe(days['2026-12-03']);
    expect(dayMetaFor(t, '2026-12-05')).toEqual({ city: '舊金山', lodging: 'Hotel Zephyr', label: '一日遊' });
    expect(dayMetaFor(t, '2026-12-09')).toBe(days['2026-12-06']);
  });
  it('最前面的日子、沒有日期：用行程城市', () => {
    expect(dayMetaFor(t, '2026-12-01')).toMatchObject({ city: '舊金山', geo: { lat: 37.77, lng: -122.42, en: 'San Francisco', admin1: 'California' } });
    expect(dayMetaFor(t, null)?.city).toBe('舊金山');
    expect(dayMetaFor({ city: '' }, '2026-12-01')).toBeUndefined();
  });
});

/* ---------------- 城市定位（fetch 換成假的） ---------------- */

type Body = { results?: unknown[] } | { features?: unknown[] };
function mockFetch(route: (u: URL) => Body | undefined) {
  const calls: URL[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const u = new URL(String(input));
      calls.push(u);
      const b = route(u);
      if (!b) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify(b), { status: 200 });
    }),
  );
  return calls;
}
const om = (name: string, admin1: string, lat: number, lng: number, population: number, fc = 'PPL') => ({
  name, admin1, latitude: lat, longitude: lng, population, feature_code: fc, country_code: 'US', timezone: 'America/Phoenix',
});

describe('geocodeDays', () => {
  it('中文城市名換成英文查（帶國家代碼、英文結果），同一個城市只查一次；同名城市選別名表指定的州', async () => {
    const calls = mockFetch((u) => {
      const name = u.searchParams.get('name');
      if (name === 'Las Vegas') return { results: [om('Las Vegas', 'Nevada', 36.175, -115.1372, 641903, 'PPLA2'), om('Las Vegas', 'New Mexico', 35.59, -105.22, 13386, 'PPLA2')] };
      // Page 有好幾個：北達科他州那個人口「比較多」（假資料）也要選亞利桑那州
      if (name === 'Page') return { results: [om('Page', 'North Dakota', 47.16, -97.57, 9000), om('Page', 'Arizona', 36.9147, -111.4558, 7490)] };
      return { results: [] };
    });
    const t = trip({
      days: {
        '2026-12-04': { city: '拉斯維加斯' },
        '2026-12-05': { city: '拉斯維加斯' },
        '2026-12-06': { city: '佩吉' },
        '2026-12-07': { city: '火星基地' },
        '2026-12-08': { city: '舊金山', geo: { lat: 37.77, lng: -122.42 } },
      },
    });
    const got: Record<string, NonNullable<DayMeta['geo']>> = {};
    const n = await geocodeDays(t, (d, g) => (got[d] = g));
    expect(n).toBe(3);
    expect(Object.keys(got).sort()).toEqual(['2026-12-04', '2026-12-05', '2026-12-06']);
    expect(got['2026-12-06']).toMatchObject({ lat: 36.9147, lng: -111.4558, en: 'Page', admin1: 'Arizona', countryCode: 'US', label: '佩吉，美國' });
    expect(got['2026-12-04']).toMatchObject({ en: 'Las Vegas', admin1: 'Nevada' });
    const om_ = calls.filter((u) => u.host === 'geocoding-api.open-meteo.com');
    expect(om_.filter((u) => u.searchParams.get('name') === 'Las Vegas')).toHaveLength(1);
    expect(om_[0].searchParams.get('language')).toBe('en');
    expect(om_[0].searchParams.get('countryCode')).toBe('US');
  });

  it('其他天已定位的同一個城市直接沿用，不連線', async () => {
    const calls = mockFetch(() => ({ results: [] }));
    const geo = { lat: 36.175, lng: -115.1372, en: 'Las Vegas', admin1: 'Nevada', countryCode: 'US', label: '拉斯維加斯，美國' };
    const got: string[] = [];
    const n = await geocodeDays(trip({ days: { '2026-12-04': { city: 'Las Vegas', geo }, '2026-12-05': { city: '拉斯維加斯' } } }), (d, g) => {
      got.push(d);
      expect(g).toMatchObject({ lat: 36.175, en: 'Las Vegas' });
    });
    expect(n).toBe(1);
    expect(got).toEqual(['2026-12-05']);
    expect(calls).toHaveLength(0);
  });

  it('連線失敗：一天都沒找到時丟出中文錯誤', async () => {
    mockFetch(() => undefined);
    await expect(geocodeDays(trip({ days: { '2026-12-04': { city: '拉斯維加斯' } } }), () => {})).rejects.toThrow('無法連線');
  });
});
