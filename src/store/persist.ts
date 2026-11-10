import { createStore, del, get, set, type UseStore } from 'idb-keyval';
import type { StateStorage } from 'zustand/middleware';
import { useUI } from './ui';

/*
 * zustand persist 的 IndexedDB 儲存（比 localStorage 容量大、iOS 上較不易被清掉）。
 *
 * 三個保護：
 * 1. 寫入閘門：還沒成功讀到手機裡的資料前，一律不寫入。讀取失敗（iOS 偶爾斷線、資料壞掉、
 *    遷移出錯）時也不寫入，否則記憶體裡的空白初始狀態會蓋掉使用者所有的行程與金鑰。
 * 2. 讀取失敗會稍等後換一條新連線重試。
 * 3. 寫入失敗（空間不足、斷線）會提示使用者，並在下次變更或回到 App 時自動補存。
 */

/**
 * - 'pending'：還沒讀完（或正在重新讀取），寫入直接略過
 * - 'open'：讀取成功，正常寫入
 * - 'blocked'：讀取失敗，寫入直接略過並提示一次（資料還在手機裡，等重新讀取）
 */
export type WriteGate = 'pending' | 'open' | 'blocked';
let gate: WriteGate = 'pending';
let blockedNotified = false;

export function setWriteGate(g: WriteGate) {
  gate = g;
  if (g !== 'blocked') blockedNotified = false;
}
export const writeGate = (): WriteGate => gate;

/** 目前使用的資料庫連線；undefined = idb-keyval 預設（同一個 keyval-store 資料庫） */
let kv: UseStore | undefined;

/** iOS 偶爾會出現「Connection to Indexed Database server lost」：換一條新連線 */
function reconnect() {
  try {
    kv = createStore('keyval-store', 'keyval');
  } catch {
    /* 測試環境的 idb-keyval 替身沒有 createStore，沿用原本的 */
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const READ_RETRY_MS = [300, 900];

const isQuota = (e: unknown) => {
  const name = (e as { name?: string } | null)?.name;
  return name === 'QuotaExceededError' || (e as { code?: number } | null)?.code === 22;
};

const toast = (text: string, tone: 'good' | 'bad') => {
  try {
    useUI.getState().toast(text, tone, tone === 'bad' ? 7000 : 2600);
  } catch {
    /* 提示失敗不影響存檔 */
  }
};

const MSG_QUOTA = '剛才的變更沒有存到手機，可能是儲存空間不足。清出空間後回到 App，會自動補存。';
const MSG_FAIL = '剛才的變更沒有存到手機，稍後會自動再試。若一直失敗，請先到「更多」備份全部資料。';
const MSG_SAVED = '已補存剛才的變更';
const MSG_BLOCKED = '手機裡的資料還沒讀取成功，剛才的變更不會儲存。請關閉 App 後再重新開啟。';

/* ---------------- 讀取 ---------------- */

let lastRaw: string | null = null;
/** 最近一次讀到的原始字串（讀取失敗時可另存或匯出） */
export const lastReadRaw = () => lastRaw;

let backedUp: string | null = null;
/**
 * 讀取失敗時，把讀到的原始字串另存一份（key：`<name>:backup-<時間>`），同一份只存一次。
 * 讀不到任何字串（例如資料庫打不開）就不用存，原本的資料也還在。
 */
export async function backupUnreadable(name: string): Promise<string | null> {
  const raw = lastRaw;
  if (!raw || raw === backedUp) return null;
  const key = `${name}:backup-${Date.now()}`;
  try {
    await set(key, raw, kv);
    backedUp = raw;
    return key;
  } catch {
    return null;
  }
}

/* ---------------- 寫入 ---------------- */

/** 每次寫入都是整份資料，所以只要存「最新的一份」 */
let latest: { name: string; value: string } | null = null;
let seq = 0;
let savedSeq = 0;
let failing = false;

async function flush(): Promise<void> {
  const job = latest;
  const mine = seq;
  if (!job || mine <= savedSeq) return;
  let err: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    // 已經有更新的內容要存，交給那一次（避免舊內容晚一步蓋過新內容）
    if (attempt > 0 && (mine < seq || mine <= savedSeq)) return;
    try {
      await set(job.name, job.value, kv);
      if (mine > savedSeq) savedSeq = mine;
      if (failing && savedSeq >= seq) {
        failing = false;
        toast(MSG_SAVED, 'good');
      }
      return;
    } catch (e) {
      err = e;
      if (isQuota(e)) break;
      reconnect();
    }
  }
  if (mine <= savedSeq || mine < seq) return;
  console.warn('[travel-planner] 存檔失敗', err);
  if (!failing) {
    failing = true;
    toast(isQuota(err) ? MSG_QUOTA : MSG_FAIL, 'bad');
  }
}

/** 存檔失敗後的補存：回到 App（或離開 App）時再試一次 */
export function retryPendingSave(): Promise<void> {
  if (!failing || gate !== 'open') return Promise.resolve();
  return flush();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => void retryPendingSave());
}

export const idbStorage: StateStorage = {
  getItem: async (name) => {
    lastRaw = null;
    for (let attempt = 0; ; attempt++) {
      try {
        const v = await get<unknown>(name, kv);
        lastRaw = typeof v === 'string' ? v : null;
        return (v ?? null) as string | null;
      } catch (e) {
        if (attempt >= READ_RETRY_MS.length) throw e;
        await sleep(READ_RETRY_MS[attempt]);
        reconnect();
      }
    }
  },
  setItem: async (name, value) => {
    if (gate !== 'open') {
      if (gate === 'blocked' && !blockedNotified) {
        blockedNotified = true;
        toast(MSG_BLOCKED, 'bad');
      }
      return;
    }
    latest = { name, value };
    seq++;
    await flush();
  },
  removeItem: async (name) => {
    await del(name, kv);
  },
};

/**
 * 請瀏覽器把這個網站的資料標成「不要自動清除」（Safari 分頁太久沒開可能被清掉）。
 * 盡力而為：不支援或被拒絕都不影響使用。
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    const s = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!s?.persist) return false;
    if (await s.persisted?.()) return true;
    return await s.persist();
  } catch {
    return false;
  }
}

/** 圖片等大型檔案另外存，資料裡只記 key */
export const blobStore = {
  put: async (blob: Blob): Promise<string> => {
    const key = `blob:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    await set(key, blob, kv);
    return key;
  },
  get: (key: string) => get<Blob>(key, kv),
  remove: (key: string) => del(key, kv),
};

