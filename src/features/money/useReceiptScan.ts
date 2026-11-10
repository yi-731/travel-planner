import { haptic, pickImage } from '@/platform';
import { aiErrorMessage, aiReady, scanReceipt } from '@/services/ai';
import { isAbort } from '@/services/net';
import { blobStore, useData } from '@/store';
import { useUI } from '@/store/ui';

export const SCAN_BUSY_KEY = 'scan';

/**
 * 「拍收據」：拍照／選照片 → 存起來 → AI 讀金額 → 開記帳表單（已帶入金額與收據）。
 * 沒設定金鑰或 AI 失敗時，照樣開表單並附上收據，讓使用者手動填。
 */
export function useReceiptScan(tripId: string) {
  const busy = useUI((st) => !!st.busy[SCAN_BUSY_KEY]);

  const scan = async () => {
    const ui = useUI.getState();
    if (ui.busy[SCAN_BUSY_KEY]) return;
    const blob = await pickImage({ preferCamera: true });
    if (!blob) return;

    let receiptBlobKey: string;
    try {
      receiptBlobKey = await blobStore.put(blob);
    } catch {
      ui.toast('照片存不進手機，可能是儲存空間不足。清出一些空間後再試一次。', 'bad');
      return;
    }

    if (!aiReady()) {
      ui.openSheet({ name: 'expenseForm', prefill: { receiptBlobKey } });
      ui.toast('已附上收據。AI 辨識需要金鑰，可到 更多 → App 設定 填入');
      return;
    }

    const trip = useData.getState().trips[tripId];
    if (!trip) return;
    ui.setBusy(SCAN_BUSY_KEY, true);
    try {
      const r = await scanReceipt(trip, blob);
      void haptic('success');
      useUI.getState().openSheet({ name: 'expenseForm', prefill: { ...r, receiptBlobKey }, fromAI: true });
    } catch (e) {
      const st = useUI.getState();
      if (!isAbort(e)) {
        void haptic('error');
        st.toast(aiErrorMessage(e), 'bad');
      }
      st.openSheet({ name: 'expenseForm', prefill: { receiptBlobKey } });
    } finally {
      useUI.getState().setBusy(SCAN_BUSY_KEY, false);
    }
  };

  return { scan, busy };
}
