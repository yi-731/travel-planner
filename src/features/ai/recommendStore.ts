/**
 * 「還能去哪裡」的工作狀態（只存在記憶體，不寫入裝置）。
 * 放在元件外面，所以：
 *  - 關掉彈出頁再打開、或先開別的彈出頁（地點、App 設定）再回來，表單與結果都還在；
 *  - 請求進行中關掉彈出頁也會繼續完成，不會白花費用。
 */
import { create } from 'zustand';
import type { ISODate } from '@/domain/types';
import { haptic } from '@/platform';
import { AIError, aiErrorMessage, aiReady, recommendPlaces, type Recommendation } from '@/services/ai';
import { isAbort } from '@/services/net';
import { useData } from '@/store/data';
import { useUI } from '@/store/ui';

export interface RecSession {
  /** 表單：選的日期（沒有日期的旅程為 null） */
  date: ISODate | null;
  query: string;
  status: 'idle' | 'loading' | 'done' | 'error';
  error: string | null;
  /** 進行中的請求是哪一天、什麼需求（顯示「正在找…」用） */
  pending: { date: ISODate | null; query: string } | null;
  /** 最近一次的結果，以及它對應的日期與需求 */
  results: Recommendation[];
  forDate: ISODate | null;
  forQuery: string;
  /** recKey → 加入後的行程點 id */
  added: Record<string, string>;
  /** 結果剛送達、還沒捲到畫面上 */
  fresh: boolean;
}

export const EMPTY_SESSION: RecSession = {
  date: null, query: '', status: 'idle', error: null, pending: null, results: [], forDate: null, forQuery: '', added: {}, fresh: false,
};

interface RecState {
  sessions: Record<string, RecSession>;
}

export const useRecommend = create<RecState>()(() => ({ sessions: {} }));

const get = (tripId: string) => useRecommend.getState().sessions[tripId] ?? EMPTY_SESSION;
export function patchSession(tripId: string, p: Partial<RecSession>) {
  useRecommend.setState((s) => ({ sessions: { ...s.sessions, [tripId]: { ...(s.sessions[tripId] ?? EMPTY_SESSION), ...p } } }));
}

/** 同一天的同一個地點只算一次 */
export const recKey = (date: ISODate | null, r: Pick<Recommendation, 'name'>) => `${date ?? ''}|${r.name}`;

const controllers = new Map<string, AbortController>();

function askForKey() {
  const ui = useUI.getState();
  ui.toast('AI 推薦要用你的 Anthropic API 金鑰，請先貼上金鑰');
  ui.openSheet({ name: 'appSettings' });
}

export async function runRecommend(tripId: string, date: ISODate | null, query: string): Promise<void> {
  if (get(tripId).status === 'loading') return;
  if (!aiReady()) return askForKey();
  const trip = useData.getState().trips[tripId];
  if (!trip) return;

  const q = query.trim();
  const ctrl = new AbortController();
  controllers.set(tripId, ctrl);
  patchSession(tripId, { status: 'loading', error: null, pending: { date, query: q } });
  try {
    const results = await recommendPlaces(trip, date ?? '', q, ctrl.signal);
    if (ctrl.signal.aborted) return;
    patchSession(tripId, { status: 'done', pending: null, results, forDate: date, forQuery: q, fresh: true });
    void haptic('success');
    const top = useUI.getState().sheets.at(-1);
    if (top?.name !== 'recommend') useUI.getState().toast(`AI 找到 ${results.length} 個推薦地點，打開「還能去哪裡」查看`, 'good');
  } catch (e) {
    if (isAbort(e) || ctrl.signal.aborted) return;
    const s = get(tripId);
    if (e instanceof AIError && e.code === 'no_key') {
      patchSession(tripId, { status: s.results.length ? 'done' : 'idle', pending: null });
      return askForKey();
    }
    patchSession(tripId, { status: 'error', pending: null, error: aiErrorMessage(e) });
    void haptic('error');
  } finally {
    if (controllers.get(tripId) === ctrl) controllers.delete(tripId);
  }
}

/** 取消進行中的推薦；之前的結果保留 */
export function cancelRecommend(tripId: string) {
  controllers.get(tripId)?.abort();
  controllers.delete(tripId);
  const s = get(tripId);
  patchSession(tripId, { status: s.results.length ? 'done' : 'idle', pending: null, error: null });
}

export function markAdded(tripId: string, key: string, itemId: string) {
  patchSession(tripId, { added: { ...get(tripId).added, [key]: itemId } });
}
