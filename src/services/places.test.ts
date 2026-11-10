import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DayMeta, Item, Trip } from '@/domain/types';
import { applyRulePlaces, buildPlace, classifyLocation, cleanTitle, dayMetaFor, geocodeDays, parseDayBanner } from './places';

afterEach(() => vi.unstubAllGlobals());

/* ---------------- 合成測試資料（結構仿照手排的多城市試算表，內容全部是虛構的） ---------------- */

let seq = 0;
function item(date: string | null, title: string, address?: string, over: Partial<Item> = {}): Item {
  return { id: `i${++seq}`, date, title, address, type: 'other', done: false, createdAt: 0, updatedAt: 0, ...over };
}
function trip(over: Partial<Trip> = {}): Trip {
  return {
    id: 't', name: '美西北', city: '', startDate: '2026-12-03', endDate: '2026-12-08', localCurrency: 'USD', homeCurrency: 'TWD',
    rate: 32, members: ['我'], items: [], expenses: [], cover: { kind: 'orb' }, ai: { dayChecks: {} }, createdAt: 0, updatedAt: 0, ...over,
  };
}
const banner = (label: string): DayMeta => ({ label, source: 'rule' });

describe('parseDayBanner', () => {
  it('路線＋住宿＋活動：過夜城市是路線終點，活動段落不當城市', () => {
    expect(parseDayBanner('12/04（五）｜舊金山 → 西雅圖｜住 Maple Lodge｜音樂祭')).toEqual({
      label: '舊金山 → 西雅圖｜住 Maple Lodge｜音樂祭',
      cities: ['舊金山', '西雅圖'],
      city: '西雅圖',
      lodging: 'Maple Lodge',
      origin: '舊金山',
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
    expect(parseDayBanner('（六）｜西雅圖｜市區一日').city).toBe('西雅圖');
    expect(parseDayBanner('Portland | 咖啡日').city).toBe('波特蘭');
    expect(parseDayBanner('京都市區｜寺廟巡禮').city).toBe('京都');
  });
  it('只有活動、沒有城市 → 沒有 city（之後沿用前一天）', () => {
    const b = parseDayBanner('12/06（日）｜主題樂園一日｜夜間遊行');
    expect(b.city).toBeUndefined();
    expect(b.cities).toEqual([]);
    expect(parseDayBanner('（五）跨年夜｜主題樂園一日').city).toBeUndefined();
    expect(parseDayBanner('（五）跨年夜｜主題樂園一日').tour).toBeUndefined();
  });
  it('一日遊：去掉「一日遊」字尾找目的地；沒有整段是城市時從活動說明裡找（寫一日遊的段落優先）', () => {
    expect(parseDayBanner('12/06（日）｜溫哥華一日遊｜Stanley Park + 日落')).toMatchObject({ city: '溫哥華', cities: ['溫哥華'], tour: true });
    expect(parseDayBanner('12/06（日）｜海岸健行一日遊｜Waikiki 日出 + 鑽石頭山')).toMatchObject({ city: '檀香山', tour: true });
    expect(parseDayBanner('奈良一日遊｜住 Hotel Granvia Kyoto')).toMatchObject({ city: '奈良', base: '京都', tour: true, lodging: 'Hotel Granvia Kyoto' });
    expect(parseDayBanner('購物日｜宇治 + 回程')).toMatchObject({ city: '宇治', tour: true });
    expect(parseDayBanner('Day 3｜Portland Old Town')).toMatchObject({ city: '波特蘭' });
    expect(parseDayBanner('Day 3｜Portland Old Town').tour).toBeUndefined();
    // 整段是城市就不是一日遊
    expect(parseDayBanner('（六）｜西雅圖｜市區一日').tour).toBeUndefined();
  });
  it('住宿名稱裡的城市（沒有路線時當過夜城市）', () => {
    const b = parseDayBanner('12/07｜河邊放空｜住 Harbor Inn Portland');
    expect(b.lodging).toBe('Harbor Inn Portland');
    expect(b.city).toBe('波特蘭');
  });
  it('「～」「到」只有兩端都是城市才算路線', () => {
    expect(parseDayBanner('京都～大阪｜住 難波').city).toBe('大阪');
    expect(parseDayBanner('睡到中午｜京都').city).toBe('京都');
    expect(parseDayBanner('Day 3 | Kyoto | Stay: Hotel Granvia')).toMatchObject({ city: '京都', lodging: 'Hotel Granvia' });
  });
});

describe('classifyLocation', () => {
  it.each([
    ['1000 S Seattle Blvd', '1000 S Seattle Blvd'],
    ['123 N Broadway', '123 N Broadway'],
    ['1 Ferry Building Plaza', '1 Ferry Building Plaza'],
    ['88 Harbor Avenue', '88 Harbor Avenue'],
    ['對面 200 E 5th St', '200 E 5th St'],
    ['Mission St × 3rd St', 'Mission St & 3rd St'],
    ['京都市東山区清水1-294', '京都市東山区清水1-294'],
    ['台北市信義路五段7號', '台北市信義路五段7號'],
  ])('地址：%s', (cell, value) => {
    expect(classifyLocation(cell)).toEqual({ kind: 'address', value });
  });
  it('路線（A → B、→ B、機場代碼）', () => {
    expect(classifyLocation('SFO → SEA')).toEqual({ kind: 'route', value: 'SEA', from: 'SFO', to: 'SEA' });
    expect(classifyLocation('→ Golden Gate Bridge')).toEqual({ kind: 'route', value: 'Golden Gate Bridge', from: '', to: 'Golden Gate Bridge' });
    expect(classifyLocation('Maple Lodge -> Central 站')).toMatchObject({ kind: 'route', from: 'Maple Lodge', to: 'Central 站' });
  });
  it.each(['車程 10 分', '步行 5–8 分 / 0.4 mile', 'Lyft 20 分 / 6 mile', '驅車 30 mile', '開車 45 分', '約 15 分', 'Hood River 東邊 3 mile'])('交通說明：%s', (cell) => {
    expect(classifyLocation(cell).kind).toBe('transit');
  });
  it.each(['看台', '回程', 'Tram', '機場', '飯店', '會場周邊', 'Uber'])('泛稱：%s', (cell) => {
    expect(classifyLocation(cell).kind).toBe('generic');
  });
  it('地點名稱：去掉括號、只取「｜」前面', () => {
    expect(classifyLocation('Maple Lodge')).toEqual({ kind: 'place', value: 'Maple Lodge' });
    expect(classifyLocation('Ferry Building 大廳')).toEqual({ kind: 'place', value: 'Ferry Building 大廳' });
    expect(classifyLocation('Union Square 停車場')).toEqual({ kind: 'place', value: 'Union Square 停車場' });
    expect(classifyLocation('Hood River｜PST')).toEqual({ kind: 'place', value: 'Hood River' });
    expect(classifyLocation('Hilltop Observatory（停車場旁）')).toEqual({ kind: 'place', value: 'Hilltop Observatory' });
    expect(classifyLocation('淺草')).toEqual({ kind: 'place', value: '淺草' });
  });
  it('空白', () => {
    expect(classifyLocation('  ')).toEqual({ kind: 'empty', value: '' });
  });
});

describe('cleanTitle', () => {
  it('★ → must、◇ → optional，去掉標記與時間括號', () => {
    expect(cleanTitle('★ Alcatraz 渡輪（建議 4 小時）')).toEqual({ title: 'Alcatraz 渡輪', flag: 'must' });
    expect(cleanTitle('★★ 晚餐 Blue Fin（1h05m）')).toEqual({ title: '晚餐 Blue Fin', flag: 'must' });
    expect(cleanTitle('◇【二選一】夜市（30–40 分鐘）')).toEqual({ title: '夜市', flag: 'optional' });
    expect(cleanTitle('◇ 海邊散步 (8–10 mile)')).toEqual({ title: '海邊散步', flag: 'optional' });
  });
  it('保留有意義的括號；沒有標記時沒有 flag', () => {
    expect(cleanTitle('★ 演唱會（加場）').title).toBe('演唱會（加場）');
    expect(cleanTitle('⚠️ 注意施工')).toEqual({ title: '注意施工' });
    expect(cleanTitle('咖啡（West Village）')).toEqual({ title: '咖啡（West Village）' });
  });
});

/* ---------------- 整趟套用 ---------------- */

/** 台北 → 舊金山 → 西雅圖（音樂祭、溫哥華一日遊）→ 波特蘭 */
function coastTrip(): Trip {
  seq = 0;
  const days: Record<string, DayMeta> = {
    '2026-12-03': banner('台北 → 舊金山｜住 Hotel Zephyr'),
    '2026-12-04': banner('舊金山 → 西雅圖｜住 Maple Lodge｜音樂祭'),
    '2026-12-05': banner('西雅圖｜市區一日'),
    '2026-12-06': banner('溫哥華一日遊｜Stanley Park'),
    '2026-12-07': banner('西雅圖 → 波特蘭｜住 Harbor Inn Portland'),
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
      item(D4, '★ Alaska SFO → SEA', 'SFO → SEA', { tag: '航班' }),
      item(D4, '★ 抵達 SEA', 'SEA T3', { tag: '航班' }),
      item(D4, '★ 午餐 Blue Fin Sushi', '1000 S Seattle Blvd', { tag: '午餐' }),
      item(D4, '★ 步行到 Central 站搭 Tram', 'Maple Lodge → Central 站', { tag: '交通' }),
      item(D4, '★ 演唱會', '看台', { tag: '活動' }),
      item(D4, '★ Tram 回飯店', '回程', { tag: '交通' }),
      item(D5, '起床', '回程', { tag: '起床' }),
      item(D5, '◇ Tokyo Ramen 宵夜', 'Tokyo Ramen Seattle', { tag: '宵夜' }),
      item(D5, '回飯店休息', '車程 10 分', { tag: '休息' }),
      item(D6, '★ 抵達 Vancouver', 'Vancouver｜當地時間', { tag: '抵達' }),
      item(D6, '★★ Stanley Park 日落', 'Vancouver｜當地時間', { tag: '景點' }),
      item(D6, '★ Capilano 吊橋', 'Vancouver 北邊 10 km', { tag: '景點' }),
      item(D6, '★ 開車回西雅圖', 'Vancouver → Seattle', { tag: '回程' }),
      item(D7, '早餐後退房', 'Maple Lodge', { tag: '早餐' }),
      item(D7, '★ 開往 Portland', 'Seattle → Portland', { tag: '交通' }),
      item(D7, '★ 晚餐 River Grill（河景）', '101 SW Naito Pkwy', { tag: '晚餐' }),
      item(D8, '★ Rose Garden Museum', '400 SW Kingston Ave', { tag: '美術館' }),
      item(D8, '打包', '', { tag: '整理' }),
    ],
  });
}

describe('applyRulePlaces', () => {
  const t = applyRulePlaces(coastTrip());
  const q = (title: string) => t.items.find((i) => i.title === title)?.place;

  it('補齊每天的城市與住宿：沒寫城市的日子沿用前一天，沒寫住宿但同城市也沿用', () => {
    const days = t.days!;
    expect(days['2026-12-03']).toMatchObject({ city: '舊金山', lodging: 'Hotel Zephyr' });
    expect(days['2026-12-04']).toMatchObject({ city: '西雅圖', lodging: 'Maple Lodge' });
    expect(days['2026-12-05']).toMatchObject({ city: '西雅圖', lodging: 'Maple Lodge' });
    // 一日遊：白天的城市（天氣以這裡為準），住宿沿用前一天
    expect(days['2026-12-06']).toMatchObject({ city: '溫哥華', lodging: 'Maple Lodge', label: '溫哥華一日遊｜Stanley Park' });
    expect(days['2026-12-07']).toMatchObject({ city: '波特蘭', lodging: 'Harbor Inn Portland' });
    // 沒有日期列的最後一天：不存，往前找前一天
    expect(days['2026-12-08']).toBeUndefined();
    expect(dayMetaFor(t, '2026-12-08')).toMatchObject({ city: '波特蘭', lodging: 'Harbor Inn Portland' });
  });

  it('行程主要城市：出現最多天的城市（出發地台北不算）', () => {
    expect(t.city).toBe('西雅圖');
  });

  it('機場：代碼展開成「XXX airport」，城市用機場所在城市；起飛用起點', () => {
    expect(q('★ 桃園機場 T1 報到')?.query).toBe('TPE airport Terminal 1, Taoyuan, Taiwan');
    expect(q('★ BR018 起飛')?.query).toBe('TPE airport, Taoyuan, Taiwan');
    expect(q('★ 抵達 SEA')?.query).toBe('SEA airport Terminal 3, Seattle, WA, USA');
    expect(q('★ Alaska SFO → SEA')?.query).toBe('SFO airport, San Francisco, CA, USA');
  });

  it('車站：「站」換成 station，加上城市背景', () => {
    expect(q('★ 搭 BART 進市區')?.query).toBe('Powell St station, San Francisco, CA, USA');
    expect(q('★ 步行到 Central 站搭 Tram')?.query).toBe('Central station, Seattle, WA, USA');
  });

  it('地址：店名＋地址＋城市；路名裡的城市（Seattle Blvd）不算已經有城市', () => {
    expect(q('★ Hotel Zephyr check-in')?.query).toBe('Hotel Zephyr, 250 Beach St, San Francisco, CA, USA');
    expect(q('★ 午餐 Blue Fin Sushi')?.query).toBe('Blue Fin Sushi, 1000 S Seattle Blvd, Seattle, WA, USA');
  });

  it('回飯店 → 當天住宿；早上還沒離開時用前一晚的住宿', () => {
    expect(q('★ Tram 回飯店')?.query).toBe('Maple Lodge, Seattle, WA, USA');
    expect(q('回飯店休息')?.query).toBe('Maple Lodge, Seattle, WA, USA');
    expect(q('飯店早餐')?.query).toBe('Hotel Zephyr, San Francisco, CA, USA');
    expect(q('早餐後退房')?.query).toBe('Maple Lodge, Seattle, WA, USA');
  });

  it('往住宿所在城市的路線 → 住宿；之後的行程用那個城市', () => {
    expect(q('★ 開往 Portland')?.query).toBe('Harbor Inn Portland, OR, USA');
    expect(q('★ 晚餐 River Grill（河景）')?.query).toBe('River Grill, 101 SW Naito Pkwy, Portland, OR, USA');
  });

  it('一日遊：地點欄寫了別的城市（溫哥華），用那個城市的背景；回程回到住宿', () => {
    expect(q('★ 抵達 Vancouver')?.query).toBe('Vancouver, British Columbia, Canada');
    expect(q('★★ Stanley Park 日落')?.query).toBe('Stanley Park, Vancouver, British Columbia, Canada');
    expect(q('★ Capilano 吊橋')?.query).toBe('Capilano, Vancouver, British Columbia, Canada');
    expect(q('★ 開車回西雅圖')?.query).toBe('Maple Lodge, Seattle, WA, USA');
  });

  it('地點名稱已含城市不重複（店名裡的別的城市不換城市）；泛稱用標題', () => {
    expect(q('◇ Tokyo Ramen 宵夜')?.query).toBe('Tokyo Ramen Seattle, WA, USA');
    // 只有活動名稱、地點欄是「看台」：沒有場館可以導航（找不到同名的地方）
    expect(q('★ 演唱會')).toMatchObject({ query: '演唱會, Seattle, WA, USA', navigable: false });
  });

  it('只有動作、沒有地點 → navigable = false', () => {
    expect(q('起床')?.navigable).toBe(false);
    expect(q('打包')?.navigable).toBe(false);
    expect(q('★ Rose Garden Museum')).toMatchObject({ source: 'rule', navigable: true, query: 'Rose Garden Museum, 400 SW Kingston Ave, Portland, OR, USA' });
  });

  it('不改動傳入的物件；手動、AI 的地點保留；再套一次結果相同', () => {
    const src = coastTrip();
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
    const src = coastTrip();
    src.days!['2026-12-04'].geo = { lat: 47.61, lng: -122.33, en: 'Seattle', label: '西雅圖，美國' };
    src.days!['2026-12-03'].geo = { lat: 45.52, lng: -122.68, en: 'Portland', label: '波特蘭，美國' };
    const out = applyRulePlaces(src);
    expect(out.days!['2026-12-03'].geo).toBeUndefined();
    expect(out.days!['2026-12-05'].geo?.en).toBe('Seattle');
    // 一日遊去溫哥華：不是西雅圖的座標
    expect(out.days!['2026-12-06'].geo).toBeUndefined();
  });

  it('沒有任何日期列：用行程城市', () => {
    const out = applyRulePlaces(
      trip({ city: '京都', cityGeo: { lat: 35.01, lng: 135.75, label: '京都，日本', countryCode: 'JP' }, items: [item('2026-12-03', '清水寺', '清水寺')] }),
    );
    // 沒有日期列的日子不存：之後改行程城市，天氣與導航會跟著變
    expect(out.days).toEqual({});
    expect(dayMetaFor(out, '2026-12-03')).toMatchObject({ city: '京都' });
    expect(out.items[0].place?.query).toBe('清水寺, Kyoto, Japan');
    const moved = applyRulePlaces({ ...out, city: '大阪', cityGeo: { lat: 34.69, lng: 135.5, label: '大阪，日本', countryCode: 'JP' } });
    expect(moved.items[0].place?.query).toBe('清水寺, Osaka, Japan');
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
    '2026-12-06': { city: '西雅圖' },
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
  name, admin1, latitude: lat, longitude: lng, population, feature_code: fc, country_code: 'US', timezone: 'America/Los_Angeles',
});

describe('geocodeDays', () => {
  it('中文城市名換成英文查（帶國家代碼、英文結果），同一個城市只查一次；同名城市選別名表指定的州', async () => {
    const calls = mockFetch((u) => {
      const name = u.searchParams.get('name');
      if (name === 'Seattle') return { results: [om('Seattle', 'Washington', 47.6062, -122.3321, 737015, 'PPLA2')] };
      // Portland 有好幾個：緬因州那個人口「比較多」（假資料）也要選奧勒岡州
      if (name === 'Portland') return { results: [om('Portland', 'Maine', 43.6591, -70.2568, 900000), om('Portland', 'Oregon', 45.5152, -122.6784, 652503)] };
      return { results: [] };
    });
    const t = trip({
      days: {
        '2026-12-04': { city: '西雅圖' },
        '2026-12-05': { city: '西雅圖' },
        '2026-12-06': { city: '波特蘭' },
        '2026-12-07': { city: '火星基地' },
        '2026-12-08': { city: '舊金山', geo: { lat: 37.77, lng: -122.42 } },
      },
    });
    const got: Record<string, NonNullable<DayMeta['geo']>> = {};
    const n = await geocodeDays(t, (d, g) => (got[d] = g));
    expect(n).toBe(3);
    expect(Object.keys(got).sort()).toEqual(['2026-12-04', '2026-12-05', '2026-12-06']);
    expect(got['2026-12-06']).toMatchObject({ lat: 45.5152, lng: -122.6784, en: 'Portland', admin1: 'Oregon', countryCode: 'US', label: '波特蘭，美國' });
    expect(got['2026-12-04']).toMatchObject({ en: 'Seattle', admin1: 'Washington' });
    const om_ = calls.filter((u) => u.host === 'geocoding-api.open-meteo.com');
    expect(om_.filter((u) => u.searchParams.get('name') === 'Seattle')).toHaveLength(1);
    expect(om_[0].searchParams.get('language')).toBe('en');
    expect(om_[0].searchParams.get('countryCode')).toBe('US');
  });

  it('其他天已定位的同一個城市直接沿用，不連線', async () => {
    const calls = mockFetch(() => ({ results: [] }));
    const geo = { lat: 47.6062, lng: -122.3321, en: 'Seattle', admin1: 'Washington', countryCode: 'US', label: '西雅圖，美國' };
    const got: string[] = [];
    const n = await geocodeDays(trip({ days: { '2026-12-04': { city: 'Seattle', geo }, '2026-12-05': { city: '西雅圖' } } }), (d, g) => {
      got.push(d);
      expect(g).toMatchObject({ lat: 47.6062, en: 'Seattle' });
    });
    expect(n).toBe(1);
    expect(got).toEqual(['2026-12-05']);
    expect(calls).toHaveLength(0);
  });

  it('連線失敗：一天都沒找到時丟出中文錯誤', async () => {
    mockFetch(() => undefined);
    await expect(geocodeDays(trip({ days: { '2026-12-04': { city: '西雅圖' } } }), () => {})).rejects.toThrow('無法連線');
  });
});

/* ---------------- 真實格式裡容易認錯的地方（合成資料） ---------------- */

describe('只有活動名稱、場館裡的某一區', () => {
  const D = '2026-12-04';
  const festival = () =>
    applyRulePlaces(
      trip({
        days: { [D]: banner('舊金山 → 西雅圖｜住 Maple Lodge｜音樂祭彩排') },
        items: [
          item(D, '★ 抵達 SEA', 'SEA T1', { tag: '航班' }),
          item(D, '★ 彩排 Rehearsal', '看台', { tag: '音樂祭' }),
          item(D, '◇【二選一】加場 Encore — 想看就提早出門', '看台', { tag: '音樂祭' }),
          item(D, '★ 開幕演唱會', '看台', { tag: '音樂祭' }),
          item(D, '★★ 演唱會 Night 2（約 90 分鐘）', '看台', { tag: '音樂祭' }),
          item(D, '★ 閉幕典禮', '看台', { tag: '音樂祭' }),
          item(D, '★ 季後賽 Game 7', '3 號看台', { tag: '活動' }),
          item(D, '湖邊晚餐（Food Court）', '會場周邊', { tag: '晚餐' }),
        ],
      }),
    );
  it('看台＋只有活動名稱 → 不能導航（不會找到同名的診所、貸款公司）；有場館名稱的照常', () => {
    const t = festival();
    const p = (title: string) => t.items.find((i) => i.title === title)!.place!;
    for (const title of ['★ 彩排 Rehearsal', '◇【二選一】加場 Encore — 想看就提早出門', '★ 開幕演唱會', '★★ 演唱會 Night 2（約 90 分鐘）', '★ 閉幕典禮', '★ 季後賽 Game 7']) {
      expect(p(title).navigable, title).toBe(false);
    }
    expect(p('湖邊晚餐（Food Court）')).toMatchObject({ query: 'Food Court, Seattle, WA, USA', navigable: true });
  });

  const D2 = '2026-12-07';
  const park = () =>
    applyRulePlaces(
      trip({
        days: { [D2]: banner('波特蘭｜主題樂園一日') },
        items: [
          item(D2, '★ 停車、排隊等開園', 'Sunrise Park 停車場', { tag: '停車' }),
          item(D2, '★ Sky Coaster（40–50 分鐘）', 'North Zone', { tag: '樂園' }),
          item(D2, '★ South Zone：雲霄飛車、水上設施', 'South Zone', { tag: '樂園' }),
          item(D2, '★ 星光城堡（燈光秀）', 'North Zone', { tag: '樂園' }),
          item(D2, '晚餐', 'Sunrise Park Harbor Walk', { tag: '晚餐' }),
        ],
      }),
    );
  it('「North Zone」接在同一天前面的場館（Sunrise Park 停車場）後面', () => {
    const q = (title: string) => park().items.find((i) => i.title === title)!.place!.query;
    expect(q('★ 停車、排隊等開園')).toBe('Sunrise Park parking, Portland, OR, USA');
    expect(q('★ Sky Coaster（40–50 分鐘）')).toBe('Sky Coaster, Sunrise Park North Zone, Portland, OR, USA');
    expect(q('★ South Zone：雲霄飛車、水上設施')).toBe('Sunrise Park South Zone, Portland, OR, USA');
    expect(q('★ 星光城堡（燈光秀）')).toBe('Sunrise Park North Zone, Portland, OR, USA');
    expect(q('晚餐')).toBe('Sunrise Park Harbor Walk, Portland, OR, USA');
  });
  it('前面沒有場館的「North Zone」：用標題（沒有地點就不能導航）', () => {
    const t = applyRulePlaces(trip({ days: { [D2]: banner('波特蘭') }, items: [item(D2, '集合', 'North Zone')] }));
    expect(t.items[0].place?.navigable).toBe(false);
  });
  it('在住宿起床、收行李：目的地是住宿，但不用導航；回飯店放東西要導航', () => {
    const t = applyRulePlaces(
      trip({
        days: { [D]: banner('西雅圖｜住 Maple Lodge') },
        items: [item(D, '★ 起床', 'Maple Lodge'), item(D, '★ 收行李', 'Maple Lodge'), item(D, '回飯店放東西', '車程 8 分'), item(D, '寄放行李', 'Maple Lodge')],
      }),
    );
    expect(t.items.map((i) => [i.place?.query, i.place?.navigable])).toEqual([
      ['Maple Lodge, Seattle, WA, USA', false],
      ['Maple Lodge, Seattle, WA, USA', false],
      ['Maple Lodge, Seattle, WA, USA', true],
      ['Maple Lodge, Seattle, WA, USA', true],
    ]);
  });
});

describe('標題裡的路線', () => {
  const D = '2026-12-04';
  const day = { [D]: banner('西雅圖｜住 Maple Lodge') };
  const one = (title: string, address?: string, over: Partial<Item> = {}) => applyRulePlaces(trip({ days: day, items: [item(D, title, address, over)] })).items[0].place!;
  it('航班寫在標題（「Alaska SEA → SFO」「BR12 TPE → SEA」）：起飛的機場，不是抵達的', () => {
    expect(one('★ UA SEA → SFO（2h05m）', undefined, { tag: '航班' }).query).toBe('SEA airport, Seattle, WA, USA');
    expect(one('UA 100 SFO → SEA').query).toBe('SFO airport, San Francisco, CA, USA');
    expect(one('BR12 TPE → SEA').query).toBe('TPE airport, Taoyuan, Taiwan');
    // 寫了抵達：抵達的機場
    expect(one('抵達 Alaska SFO → SEA').query).toBe('SEA airport, Seattle, WA, USA');
  });
  it('終點是動作、泛稱或只有中文（英文地區）：不當路線，也不能導航', () => {
    for (const title of ['早餐 → 出發', '起床 → 打包 → 退房', '★ 新設施 → 必看', 'Plan B → 如果下雨改去室內', '演唱會 → 看台']) {
      expect(one(title).navigable, title).toBe(false);
    }
    // 正常的路線照用
    expect(one('出發（Maple Lodge → Snoqualmie Falls 約 45 分）', '驅車 30 mile')).toMatchObject({ query: 'Snoqualmie Falls, Seattle, WA, USA', navigable: true });
    expect(buildPlace(item('d', '★ 京都站 → 奈良'), { city: '京都' }, { city: '京都' })?.query).toBe('Nara, Japan');
  });
});

describe('地址欄的網址、交通說明、場館內的位置', () => {
  it('貼上 Google 地圖連結：有連結座標就用座標，沒有就用名稱；網址不會出現在導航目的地', () => {
    const day: DayMeta = { city: '京都', geo: { lat: 35, lng: 135.77, en: 'Kyoto', countryCode: 'JP' } };
    for (const url of ['https://maps.app.goo.gl/AbCdEf123', 'https://www.google.com/maps/place/Kiyomizu', 'www.google.com/maps?q=kiyomizu']) {
      expect(classifyLocation(url).kind).toBe('empty');
      const withGeo = buildPlace(item('d', '清水寺', url, { geo: { lat: 34.9949, lng: 135.785, source: 'link' } }), day, { city: '京都' })!;
      expect(withGeo.query).toBe('34.9949,135.785');
      const plain = buildPlace(item('d', '清水寺', url), day, { city: '京都' })!;
      expect(plain.query).toBe('清水寺, Kyoto, Japan');
    }
  });
  it.each(['10 min walk via Main St', '15 分鐘 Uber 經 Sunset Blvd', '20 分鐘走 Pine St', 'Uber 12 分 / 3 mile'])('交通說明不是地址：%s', (cell) => {
    expect(classifyLocation(cell).kind).toBe('transit');
  });
  it.each(['3 號看台', 'E 區看台', 'Section 104'])('看台、座位當泛稱：%s', (cell) => {
    expect(classifyLocation(cell).kind).toBe('generic');
  });
  it.each(['5 號出口 / Broadway', '2 樓 Food Court', '1 E 區看台'])('場館內的位置不是地址：%s', (cell) => {
    expect(classifyLocation(cell).kind).not.toBe('address');
  });
  it('地址後面接交通說明還是地址', () => {
    expect(classifyLocation('1500 S Main St（步行 5 分）')).toEqual({ kind: 'address', value: '1500 S Main St' });
    expect(classifyLocation('4200 W 52nd St')).toEqual({ kind: 'address', value: '4200 W 52nd St' });
  });
});

describe('一日遊與之後的日子', () => {
  const days = (): Record<string, DayMeta> => ({
    '2026-12-04': banner('舊金山 → 西雅圖｜住 Maple Lodge'),
    '2026-12-05': banner('溫哥華一日遊｜Stanley Park + 日落'),
    '2026-12-06': banner('Outlet 購物日'),
    '2026-12-07': banner('購物日｜波特蘭 + 回程'),
  });
  it('一日遊：白天的城市是目的地，住宿沿用前一天；隔天沒寫城市的回到住宿的城市', () => {
    const t = applyRulePlaces(
      trip({
        endDate: '2026-12-07',
        days: days(),
        items: [
          item('2026-12-05', '★ 起床', 'Maple Lodge'),
          item('2026-12-05', '★ 搭車到集合點', 'Maple Lodge → Union Station'),
          item('2026-12-05', '★ 抵達 Vancouver', 'Vancouver｜當地時間'),
          item('2026-12-05', '★ 開車回西雅圖', 'Vancouver → Seattle'),
          item('2026-12-07', '★ Maple Avenue（Portland）', 'Maple Avenue'),
          item('2026-12-07', '午餐 Corner Bistro', '300 NW Maple Ave'),
        ],
      }),
    );
    expect(t.days!['2026-12-05']).toMatchObject({ city: '溫哥華', lodging: 'Maple Lodge' });
    expect(t.days!['2026-12-06']).toMatchObject({ city: '西雅圖', lodging: 'Maple Lodge' });
    expect(t.days!['2026-12-07']).toMatchObject({ city: '波特蘭', lodging: 'Maple Lodge' });
    const q = (title: string) => t.items.find((i) => i.title === title)!.place!.query;
    // 早上還在住宿的城市
    expect(q('★ 起床')).toBe('Maple Lodge, Seattle, WA, USA');
    expect(q('★ 搭車到集合點')).toBe('Union Station, Seattle, WA, USA');
    expect(q('★ 抵達 Vancouver')).toBe('Vancouver, British Columbia, Canada');
    expect(q('★ 開車回西雅圖')).toBe('Maple Lodge, Seattle, WA, USA');
    // 出現過當天城市之後，只有地址的站也用那個城市
    expect(q('午餐 Corner Bistro')).toBe('Corner Bistro, 300 NW Maple Ave, Portland, OR, USA');
  });
  it('一日遊的隔天沒有日期列：存下過夜城市（不然往前找會找到一日遊的城市）', () => {
    const t = applyRulePlaces(trip({ endDate: '2026-12-06', days: { '2026-12-04': days()['2026-12-04'], '2026-12-05': days()['2026-12-05'] } }));
    expect(t.days!['2026-12-06']).toMatchObject({ city: '西雅圖', lodging: 'Maple Lodge', source: 'rule' });
    expect(t.days!['2026-12-06'].label).toBeUndefined();
  });
  it('AI 判斷的一日遊（城市換了、住宿沒換）：隔天沒寫城市的用住宿的城市', () => {
    const t = applyRulePlaces(
      trip({
        days: {
          '2026-12-04': banner('西雅圖｜住 Maple Lodge'),
          '2026-12-05': { label: '跨境一日遊', city: '溫哥華', lodging: 'Maple Lodge', source: 'ai' },
          '2026-12-06': banner('Outlet 購物日'),
        },
      }),
    );
    expect(t.days!['2026-12-05'].city).toBe('溫哥華');
    expect(t.days!['2026-12-06']).toMatchObject({ city: '西雅圖', lodging: 'Maple Lodge' });
  });
  it('還沒換算的「第 N 天」日期列（__D3）原樣保留', () => {
    const d = { label: '大阪 → 京都｜住 Hotel Kyoto', city: '京都', source: 'rule' as const };
    const t = applyRulePlaces(trip({ startDate: null, endDate: null, days: { __D1: d } }));
    expect(t.days).toEqual({ __D1: d });
  });
});

describe('geocodeDays：連線失敗與找不到分開回報', () => {
  it('前面那天連線失敗、後面同城市查到了：前面也補上；找不到的回報 notfound，失敗的回報 error', async () => {
    let n = 0;
    mockFetch((u) => {
      const name = u.searchParams.get('name');
      if (name === 'Seattle' && n++ === 0) return undefined; // 第一次連線失敗
      if (name === 'Seattle') return { results: [om('Seattle', 'Washington', 47.6062, -122.3321, 737015, 'PPLA2')] };
      if (name === 'Portland') return undefined; // 一直連不上
      return { results: [] };
    });
    const t = trip({
      days: {
        '2026-12-03': { city: '西雅圖' },
        '2026-12-04': { city: '火星基地' },
        '2026-12-05': { city: '波特蘭' },
        '2026-12-06': { city: '西雅圖' },
      },
    });
    const got: string[] = [];
    const miss: Record<string, string> = {};
    const found = await geocodeDays(t, (d) => got.push(d), undefined, (d, why) => (miss[d] = why));
    expect(found).toBe(2);
    expect(got.sort()).toEqual(['2026-12-03', '2026-12-06']);
    expect(miss).toEqual({ '2026-12-04': 'notfound', '2026-12-05': 'error' });
  });
});
