/**
 * 匯率服務（ExchangeRate-API 開放端點，免金鑰）https://open.er-api.com/v6/latest/{FROM}
 * 同一個基準幣別的整張匯率表在記憶體快取 1 小時（服務本身每天更新一次）。
 */
import { fetchJson } from './net';

const SERVICE = '匯率服務';
export const FX_TTL_MS = 60 * 60 * 1000;

interface ErApiResponse {
  result?: 'success' | 'error';
  'error-type'?: string;
  base_code?: string;
  rates?: Record<string, number>;
}

const cache = new Map<string, { at: number; rates: Record<string, number> }>();
const inflight = new Map<string, Promise<Record<string, number>>>();

/** 測試用：清空記憶體快取 */
export function clearRateCache() {
  cache.clear();
  inflight.clear();
}

function code(c: string): string {
  const s = (c ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(s)) throw new Error(`「${c}」不是有效的幣別代碼，請使用三個英文字母的代碼，例如 JPY、TWD。`);
  return s;
}

async function ratesFor(base: string): Promise<Record<string, number>> {
  const hit = cache.get(base);
  if (hit && Date.now() - hit.at < FX_TTL_MS) return hit.rates;
  const running = inflight.get(base);
  if (running) return running;

  const p = (async () => {
    const data = await fetchJson<ErApiResponse>(`https://open.er-api.com/v6/latest/${base}`, { service: SERVICE });
    if (data.result !== 'success' || !data.rates) {
      if (data['error-type'] === 'unsupported-code') throw new Error(`${SERVICE}不支援 ${base}，請確認幣別代碼是否正確。`);
      throw new Error(`${SERVICE}暫時查不到 ${base} 的匯率，請稍後再試一次。`);
    }
    cache.set(base, { at: Date.now(), rates: data.rates });
    return data.rates;
  })();
  inflight.set(base, p);
  try {
    return await p;
  } finally {
    inflight.delete(base);
  }
}

/** 1 單位 from = ? 單位 to */
export async function fetchRate(from: string, to: string): Promise<number> {
  const f = code(from), t = code(to);
  if (f === t) return 1;
  const rates = await ratesFor(f);
  const r = rates[t];
  if (typeof r !== 'number' || !Number.isFinite(r) || r <= 0) {
    throw new Error(`${SERVICE}沒有 ${f} 換 ${t} 的匯率，請確認幣別代碼，或在行程設定手動輸入匯率。`);
  }
  return r;
}
