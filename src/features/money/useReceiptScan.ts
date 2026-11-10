import { create } from 'zustand';
import type { Expense } from '@/domain/types';
import { haptic, pickImage } from '@/platform';
import { aiErrorMessage, aiReady, scanReceipt } from '@/services/ai';
import { isAbort } from '@/services/net';
import { blobStore, useData } from '@/store';
import { useUI } from '@/store/ui';

export const SCAN_BUSY_KEY = 'scan';

/** 拍好的收據（AI 辨識結果或只有照片），等著開記帳表單 */
export interface PendingReceipt {
  prefill: Partial<Expense>;
  /** prefill 來自 AI 辨識 */
  fromAI: boolean;
}

/**
 * 辨識完成時畫面正忙（開著別的彈出頁，或已經換到別趟旅程），結果先放這裡：tripId → 收據。
 * 記帳頁的按鈕會變成「查看辨識結果」，點了才開表單，不會蓋掉使用者正在填的內容。
 * 只放在記憶體：App 重開就沒了（不影響已記的帳）。
 */
export const usePendingReceipts = create<Record<string, PendingReceipt>>()(() => ({}));

/** 等著查看的收據按鈕文字（提示訊息也用同一個說法） */
export const pendingLabel = (r: PendingReceipt) => (r.fromAI ? '查看辨識結果' : '填寫收據');

const openForm = (tripId: string, r: PendingReceipt) => useUI.getState().openSheet({ name: 'expenseForm', tripId, prefill: r.prefill, fromAI: r.fromAI });

/**
 * 收據準備好了：畫面空著（沒有彈出頁、還在同一趟旅程）就直接開記帳表單；
 * 否則先存起來，提示使用者回記帳頁再打開。回傳 true 表示已經開了表單。
 */
export function deliverReceipt(tripId: string, r: PendingReceipt): boolean {
  const ui = useUI.getState();
  const data = useData.getState();
  if (ui.sheets.length === 0 && data.activeTripId === tripId) {
    openForm(tripId, r);
    return true;
  }
  // 同一趟已經有一張在等（正常操作不會發生）：舊照片清掉，免得留在手機裡
  const prev = usePendingReceipts.getState()[tripId]?.prefill.receiptBlobKey;
  if (prev && prev !== r.prefill.receiptBlobKey) void blobStore.remove(prev).catch(() => undefined);
  usePendingReceipts.setState({ [tripId]: r });

  const label = pendingLabel(r);
  const what = r.fromAI ? '收據辨識好了' : '收據照片先幫你留著';
  const name = data.trips[tripId]?.name;
  ui.toast(
    data.activeTripId === tripId || !name ? `${what}，回到記帳頁點「${label}」` : `「${name}」的${what}，切回這趟旅程後到記帳頁點「${label}」`,
    'default',
    4200,
  );
  return false;
}

/** 打開等著查看的收據（記帳頁按鈕） */
export function openPendingReceipt(tripId: string): void {
  const all = usePendingReceipts.getState();
  const r = all[tripId];
  if (!r) return;
  const rest = { ...all };
  delete rest[tripId];
  usePendingReceipts.setState(rest, true);
  openForm(tripId, r);
}

/**
 * 「拍收據」：拍照／選照片 → 存起來 → AI 讀金額 → 開記帳表單（已帶入金額與收據）。
 * 沒設定金鑰或 AI 失敗時，照樣開表單並附上收據，讓使用者手動填。
 * 辨識要好幾秒：這段時間使用者可能已經開了別的表單或換了旅程，結果就先存著（見 deliverReceipt）。
 */
export function useReceiptScan(tripId: string) {
  const busy = useUI((st) => !!st.busy[SCAN_BUSY_KEY]);
  const pending = usePendingReceipts((st) => st[tripId] ?? null);

  const scan = async () => {
    if (useUI.getState().busy[SCAN_BUSY_KEY]) return;
    const blob = await pickImage({ preferCamera: true });
    if (!blob) return;

    let receiptBlobKey: string;
    try {
      receiptBlobKey = await blobStore.put(blob);
    } catch {
      useUI.getState().toast('照片存不進手機，可能是儲存空間不足。清出一些空間後再試一次。', 'bad');
      return;
    }

    if (!aiReady()) {
      if (deliverReceipt(tripId, { prefill: { receiptBlobKey }, fromAI: false }))
        useUI.getState().toast('已附上收據。AI 辨識需要金鑰，可到 更多 → App 設定 填入');
      return;
    }

    const trip = useData.getState().trips[tripId];
    if (!trip) {
      void blobStore.remove(receiptBlobKey).catch(() => undefined);
      return;
    }
    useUI.getState().setBusy(SCAN_BUSY_KEY, true);
    try {
      const r = await scanReceipt(trip, blob);
      void haptic('success');
      deliverReceipt(tripId, {
        prefill: { ...r, receiptBlobKey },
        fromAI: true,
      });
    } catch (e) {
      if (!isAbort(e)) {
        void haptic('error');
        useUI.getState().toast(aiErrorMessage(e), 'bad');
      }
      deliverReceipt(tripId, { prefill: { receiptBlobKey }, fromAI: false });
    } finally {
      useUI.getState().setBusy(SCAN_BUSY_KEY, false);
    }
  };

  return { scan, busy, pending, openPending: () => openPendingReceipt(tripId) };
}
