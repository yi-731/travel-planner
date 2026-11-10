import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn() }));

import { checkOnResume, UPDATE_CHECK_MS } from './pwa';

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('checkOnResume', () => {
  let stop: (() => void) | undefined;
  afterEach(() => {
    stop?.();
    stop = undefined;
  });

  it('回到前景時檢查新版，但 30 分鐘內只檢查一次', () => {
    let t = 1_000_000;
    const update = vi.fn(() => Promise.resolve());
    stop = checkOnResume({ update }, () => t);

    t += 60_000;
    setVisibility('visible');
    expect(update).not.toHaveBeenCalled();

    t += UPDATE_CHECK_MS;
    setVisibility('hidden');
    expect(update).not.toHaveBeenCalled();
    setVisibility('visible');
    expect(update).toHaveBeenCalledTimes(1);

    t += 5 * 60_000;
    setVisibility('visible');
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('離線時檢查失敗不會丟出錯誤，下次回到前景再試', async () => {
    let t = 0;
    const update = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    stop = checkOnResume({ update }, () => t);
    t += UPDATE_CHECK_MS;
    setVisibility('visible');
    await Promise.resolve();
    t += UPDATE_CHECK_MS;
    setVisibility('visible');
    expect(update).toHaveBeenCalledTimes(2);
  });
});
