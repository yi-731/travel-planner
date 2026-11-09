import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearRateCache, fetchRate } from './fx';

function mockErApi(body: (base: string) => unknown) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const base = String(input).split('/').pop() ?? '';
    return new Response(JSON.stringify(body(base)), { status: 200 });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => clearRateCache());
afterEach(() => vi.unstubAllGlobals());

describe('fetchRate', () => {
  it('同幣別回傳 1、不連線', async () => {
    const fn = mockErApi(() => ({}));
    expect(await fetchRate('jpy', 'JPY')).toBe(1);
    expect(fn).not.toHaveBeenCalled();
  });

  it('查 rates[TO]，同基準幣別 1 小時內共用快取', async () => {
    const fn = mockErApi((base) => ({ result: 'success', base_code: base, rates: { JPY: 1, TWD: 0.2087, USD: 0.0063 } }));
    expect(await fetchRate('JPY', 'TWD')).toBe(0.2087);
    expect(await fetchRate('JPY', 'USD')).toBe(0.0063);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(String(fn.mock.calls[0][0])).toBe('https://open.er-api.com/v6/latest/JPY');
  });

  it('同時查詢只連線一次', async () => {
    const fn = mockErApi(() => ({ result: 'success', rates: { TWD: 0.2 } }));
    await Promise.all([fetchRate('JPY', 'TWD'), fetchRate('JPY', 'TWD')]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('錯誤訊息為中文且說明怎麼修正', async () => {
    mockErApi(() => ({ result: 'error', 'error-type': 'unsupported-code' }));
    await expect(fetchRate('XYZ', 'TWD')).rejects.toThrow('不支援 XYZ');
    mockErApi(() => ({ result: 'success', rates: { USD: 1 } }));
    await expect(fetchRate('EUR', 'TWD')).rejects.toThrow('手動輸入匯率');
    await expect(fetchRate('日圓', 'TWD')).rejects.toThrow('三個英文字母');
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(fetchRate('KRW', 'TWD')).rejects.toThrow('無法連線到匯率服務');
  });
});
