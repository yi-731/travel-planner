/**
 * 給元件用的資料 hook（天氣、地點定位、匯率）。會把結果寫回 store 快取。
 * TODO（服務代理）：實作
 */
import type { DailyWeather, ISODate, Trip } from '@/domain/types';

export interface TripWeather {
  days: DailyWeather[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  forDate: (d: ISODate) => DailyWeather | undefined;
  /** 最後更新時間（ms） */
  fetchedAt: number | null;
}
/** 行程天氣：快取過期才重抓；沒有城市座標時先定位城市 */
export function useTripWeather(_trip: Trip | null): TripWeather {
  return { days: [], loading: false, error: null, refresh: () => {}, forDate: () => undefined, fetchedAt: null };
}

/** 背景幫沒座標的行程點補座標（地圖頁使用） */
export function useAutoGeocode(_trip: Trip | null): { pending: number; running: boolean } {
  return { pending: 0, running: false };
}

/** 更新行程匯率（當地→本國），回傳新匯率 */
export async function refreshRate(_tripId: string): Promise<number> {
  throw new Error('TODO');
}
