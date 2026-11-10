import { registerSW } from 'virtual:pwa-register';
import { useUI } from '@/store/ui';

/** 從背景切回 App 時檢查新版的最短間隔 */
export const UPDATE_CHECK_MS = 30 * 60 * 1000;

/**
 * PWA：離線快取＋更新提示（vite.config.ts 的 registerType 是 'prompt'）。
 * 新版下載好後先等待，不在使用中途換掉；有新版時提示一次，下次完全關閉再打開 App 即生效。
 */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  let notified = false;
  registerSW({
    immediate: true,
    onNeedRefresh() {
      // 同一個新版可能先後觸發 installed 與 waiting，只提示一次
      if (notified) return;
      notified = true;
      const installed = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
      const how = installed ? '從多工畫面把 App 滑掉，再打開就會更新' : '關閉這個分頁再重新打開就會更新';
      useUI.getState().toast(`有新版本：${how}`, 'default', 6000);
    },
    onOfflineReady() {
      useUI.getState().toast('已可離線使用', 'good');
    },
    onRegisteredSW(_swUrl, registration) {
      if (registration) checkOnResume(registration);
    },
  });
  // 舊版的地圖圖磚快取存的是不透明回應（很佔容量），已改用 map-tiles-v2，刪掉舊的
  if ('caches' in window) void caches.delete('map-tiles').catch(() => undefined);
}

/**
 * iOS 主畫面 App 常在背景放好幾天，切回來時不會自己重新檢查新版：
 * 回到前景就檢查一次（最多每 30 分鐘一次）。
 */
export function checkOnResume(registration: { update(): Promise<unknown> }, now: () => number = Date.now) {
  let last = now();
  const onVisible = () => {
    if (document.visibilityState !== 'visible' || now() - last < UPDATE_CHECK_MS) return;
    last = now();
    // 離線時會失敗，下次回到前景再試
    registration.update().catch(() => undefined);
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => document.removeEventListener('visibilitychange', onVisible);
}
