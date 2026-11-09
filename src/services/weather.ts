/**
 * 天氣服務（Open-Meteo，免費、免金鑰）
 * - 16 天內：即時預報 https://api.open-meteo.com/v1/forecast
 * - 超過 16 天：歷年同期平均 https://archive-api.open-meteo.com/v1/archive（取近 3 年平均）
 * - 城市定位：https://geocoding-api.open-meteo.com/v1/search
 * TODO（服務代理）：實作以下函式
 */
import type { IconName } from '@/ui/Icon';
import type { DailyWeather, LatLng, Trip, WeatherCache } from '@/domain/types';

export interface CityGeo extends LatLng {
  label: string;
  timezone?: string;
  countryCode?: string;
}

/** 城市名（中英日皆可）→ 座標；找不到回傳 null */
export async function geocodeCity(_name: string): Promise<CityGeo | null> {
  throw new Error('TODO');
}

/** 取得行程期間每天的天氣（預報或歷年平均），結果可存進 trip.weather */
export async function fetchTripWeather(_trip: Trip): Promise<WeatherCache> {
  throw new Error('TODO');
}

/** 快取是否過期（預報 3 小時、只有氣候平均 7 天） */
export function weatherStale(_cache: WeatherCache | undefined, _trip: Trip): boolean {
  throw new Error('TODO');
}

/** WMO 天氣代碼 → 中文與圖示 */
export function weatherInfo(_code: number): { label: string; icon: IconName } {
  throw new Error('TODO');
}

export type { DailyWeather };
