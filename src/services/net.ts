/**
 * 共用的 JSON 連線工具（weather / fx / geocode 使用）。
 * - 逾時（預設 12 秒）與外部取消訊號合併
 * - 所有失敗都轉成中文訊息的 Error，元件直接顯示 error.message 即可
 * - 被呼叫端取消（signal.abort()）時丟出 name === 'AbortError' 的錯誤，呼叫端可用 isAbort() 靜默略過
 */

export class HttpError extends Error {
  readonly status: number;
  /** 伺服器回傳的原因（英文，給程式判斷用，不直接顯示） */
  readonly reason: string;
  constructor(message: string, status: number, reason: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.reason = reason;
  }
}

export const isAbort = (e: unknown): boolean => e instanceof Error && e.name === 'AbortError';

export function abortError(): Error {
  const e = new Error('已取消');
  e.name = 'AbortError';
  return e;
}

/** 可中止的等待（節流用）；被取消時丟出 AbortError */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface FetchJsonOptions {
  /** 顯示在錯誤訊息裡的服務名稱，例如「天氣服務」 */
  service: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** GET 一個 JSON 端點；任何失敗都丟出帶中文訊息的 Error */
export async function fetchJson<T>(url: string, { service, timeoutMs = 12_000, signal }: FetchJsonOptions): Promise<T> {
  if (signal?.aborted) throw abortError();
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('目前沒有網路連線，連上網路後再試一次。');
  }

  // 不用 AbortSignal.timeout / AbortSignal.any：舊版 iOS Safari 沒有
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  const onOuterAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onOuterAbort, { once: true });

  try {
    let res: Response;
    try {
      res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    } catch {
      if (signal?.aborted) throw abortError();
      if (timedOut) throw new Error(`${service}回應太慢，請稍後再試一次。`);
      throw new Error(`無法連線到${service}，請確認網路連線後再試一次。`);
    }

    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      if (signal?.aborted) throw abortError();
      if (timedOut) throw new Error(`${service}回應太慢，請稍後再試一次。`);
      if (res.ok) throw new Error(`${service}回傳的資料無法讀取，請稍後再試一次。`);
    }

    if (!res.ok) {
      const reason = readReason(body);
      if (res.status === 429) {
        throw new HttpError(`${service}的免費查詢次數暫時用完了，請過一段時間再試。`, res.status, reason);
      }
      if (res.status >= 500) {
        throw new HttpError(`${service}暫時無法使用（錯誤 ${res.status}），請稍後再試一次。`, res.status, reason);
      }
      throw new HttpError(`${service}無法處理這個查詢（錯誤 ${res.status}）。`, res.status, reason);
    }
    return body as T;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }
}

function readReason(body: unknown): string {
  if (body && typeof body === 'object' && 'reason' in body && typeof (body as { reason: unknown }).reason === 'string') {
    return (body as { reason: string }).reason;
  }
  return '';
}
