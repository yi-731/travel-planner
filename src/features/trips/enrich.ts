/**
 * 新行程建立後在背景補資料：城市座標（天氣、地圖）與匯率。
 * 不阻擋畫面；失敗時城市座標交給首頁天氣再試，匯率只提示一次。
 */
import { refreshRate } from '@/services/hooks';
import { geocodeCity } from '@/services/weather';
import { useData } from '@/store';
import { useUI } from '@/store/ui';

export function enrichNewTrip(tripId: string): void {
  const trip = useData.getState().trips[tripId];
  if (!trip) return;
  const city = trip.city.trim();

  const geo = async () => {
    if (!city || trip.cityGeo) return;
    try {
      const found = await geocodeCity(city);
      if (!found) return;
      useData.getState().mutateTrip(tripId, (d) => {
        // 查詢期間使用者改了城市：這筆結果不適用
        if (!d.cityGeo && d.city.trim() === city) d.cityGeo = { ...found };
      });
    } catch {
      /* 首頁的天氣 hook 會再定位一次 */
    }
  };

  const rate = async () => {
    if (trip.localCurrency === trip.homeCurrency) return;
    try {
      await refreshRate(tripId);
    } catch {
      useUI.getState().toast('匯率稍後可在行程設定更新');
    }
  };

  void Promise.all([geo(), rate()]);
}
