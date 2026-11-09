import { addDays, today } from '@/domain/dates';
import { uid } from '@/domain/ids';
import type { Expense, Item, ItemType, Trip } from '@/domain/types';

/** 首次開啟時建立的範例行程（日期以今天往後 12 天計，讓首頁呈現倒數） */
export function buildSampleTrip(): Trip {
  const start = addDays(today(), 12);
  const d = (n: number) => addDays(start, n);
  const now = Date.now();
  const mk = (date: string, time: string, title: string, type: ItemType, address = '', note = '', cost?: number, durationMin?: number): Item => ({
    id: uid(), date, time, title, type, address: address || undefined, note: note || undefined, cost, durationMin, done: false, createdAt: now, updatedAt: now,
  });
  const items: Item[] = [
    mk(d(0), '08:10', '桃園機場 → 關西機場', 'transport', '桃園國際機場第二航廈', '航班 CI152，提前 2 小時報到'),
    mk(d(0), '12:30', 'HARUKA 特急到京都', 'transport', '関西空港駅', '買 ICOCA & HARUKA 套票', 3600, 80),
    mk(d(0), '15:00', '京都站前飯店 Check-in', 'stay', '京都駅', '', undefined, 45),
    mk(d(0), '16:30', '清水寺', 'sight', '京都市東山区清水1-294', '秋季夜間特別拜觀', 500, 90),
    mk(d(0), '19:00', '先斗町晚餐', 'food', '先斗町', '先訂位', 5000, 90),
    mk(d(1), '07:30', '伏見稻荷大社', 'sight', '京都市伏見区深草藪之内町68', '千本鳥居，早去避開人潮', 0, 120),
    mk(d(1), '11:00', '錦市場', 'food', '錦市場', '邊走邊吃', 3000, 90),
    mk(d(1), '14:00', '嵐山竹林小徑', 'sight', '嵐山 竹林の小径', '', 0, 60),
    mk(d(1), '16:00', '天龍寺', 'sight', '天龍寺', '', 500, 60),
    mk(d(2), '10:00', '奈良公園', 'sight', '奈良公園', '鹿仙貝 200 円', 200, 90),
    mk(d(2), '13:00', '東大寺', 'sight', '東大寺', '', 800, 60),
    mk(d(2), '17:30', '移動到大阪難波', 'transport', 'なんば駅', '', 680, 50),
    mk(d(2), '19:00', '道頓堀', 'food', '道頓堀', '章魚燒、大阪燒', 4000, 120),
    mk(d(3), '09:30', '大阪城公園', 'sight', '大阪城', '天守閣 600 円', 600, 120),
    mk(d(3), '13:00', '黑門市場', 'food', '黒門市場', '', 3500, 90),
    mk(d(3), '16:00', '心齋橋購物', 'shop', '心斎橋筋商店街', '藥妝、電器', undefined, 180),
    mk(d(4), '10:00', '臨空城 Outlet', 'shop', 'りんくうプレミアム・アウトレット', '', undefined, 180),
    mk(d(4), '15:40', '關西機場 → 桃園', 'transport', '関西国際空港', '航班 CI153'),
  ];
  const ex = (date: string, title: string, amount: number, currency: string, category: Expense['category'], payer: string): Expense => ({
    id: uid(), date, title, amount, currency, category, payer, split: [], createdAt: now, updatedAt: now,
  });
  return {
    id: uid(),
    name: '京阪奈五日（範例）',
    city: 'KYOTO',
    cityGeo: { lat: 35.0211, lng: 135.7539, label: '京都', timezone: 'Asia/Tokyo', countryCode: 'JP' },
    routeCode: 'TPE → KIX',
    startDate: d(0),
    endDate: d(4),
    localCurrency: 'JPY',
    homeCurrency: 'TWD',
    rate: 0.21,
    budget: 45000,
    members: ['我', '旅伴'],
    items,
    expenses: [
      ex(d(0), 'ICOCA & HARUKA', 5600, 'JPY', 'transport', '我'),
      ex(d(0), '先斗町晚餐', 9800, 'JPY', 'food', '旅伴'),
      ex(d(0), '飯店 4 晚', 18000, 'TWD', 'stay', '我'),
    ],
    cover: { kind: 'orb', hue: 0 },
    ai: { dayChecks: {} },
    isExample: true,
    createdAt: now,
    updatedAt: now,
  };
}
