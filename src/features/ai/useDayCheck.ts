/**
 * AI 排程檢查 hook：執行 checkDay 並把結果存進 trip.ai.dayChecks[date]。
 * - 進行中狀態放在 useUI().busy['daycheck:<date>']，任何元件都看得到（例如行程頁與首頁同時顯示）。
 * - 元件卸載後請求仍會完成並寫入，不會白花費用。
 * - 沒有金鑰：提示並打開 App 設定。
 */
import { useCallback, useState } from 'react';
import { fmtMD } from '@/domain/dates';
import type { ISODate } from '@/domain/types';
import { haptic } from '@/platform';
import { AIError, aiErrorMessage, aiReady, checkDay } from '@/services/ai';
import { isAbort } from '@/services/net';
import { useData } from '@/store/data';
import { useUI } from '@/store/ui';

const busyKey = (date: ISODate) => `daycheck:${date}`;

function askForKey() {
  const ui = useUI.getState();
  ui.toast('AI 排程檢查要用你的 Anthropic API 金鑰，請先貼上金鑰');
  ui.openSheet({ name: 'appSettings' });
}

export function useDayCheck(tripId: string, date: ISODate | null): { run: () => Promise<void>; busy: boolean; error: string | null } {
  const busy = useUI((s) => (date ? !!s.busy[busyKey(date)] : false));
  // 錯誤跟著日期：換一天就不顯示前一天的錯誤
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const key = `${tripId}|${date ?? ''}`;

  const run = useCallback(async () => {
    if (!date) return;
    const ui = useUI.getState();
    if (ui.busy[busyKey(date)]) return;
    if (!aiReady()) return askForKey();
    const trip = useData.getState().trips[tripId];
    if (!trip) {
      setFailure({ key, message: '找不到這趟旅程，可能已經被刪除。' });
      return;
    }

    setFailure(null);
    ui.setBusy(busyKey(date), true);
    try {
      const result = await checkDay(trip, date);
      useData.getState().mutateTrip(tripId, (d) => {
        d.ai = { ...d.ai, dayChecks: { ...(d.ai?.dayChecks ?? {}), [date]: result } };
      });
      void haptic('success');
      const n = result.warnings.length;
      useUI.getState().toast(n ? `已檢查 ${fmtMD(date)}：有 ${n} 個地方要注意` : `已檢查 ${fmtMD(date)}：行程很順`, 'good');
    } catch (e) {
      if (isAbort(e)) return;
      if (e instanceof AIError && e.code === 'no_key') return askForKey();
      const message = aiErrorMessage(e);
      setFailure({ key, message });
      void haptic('error');
      useUI.getState().toast(message, 'bad');
    } finally {
      useUI.getState().setBusy(busyKey(date), false);
    }
  }, [tripId, date, key]);

  return { run, busy, error: failure && failure.key === key ? failure.message : null };
}
