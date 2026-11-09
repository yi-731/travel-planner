import { registerSW } from 'virtual:pwa-register';
import { useUI } from '@/store/ui';

/** PWA：離線快取＋自動更新。有新版時提示一次，下次開啟即生效。 */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  registerSW({
    immediate: true,
    onNeedRefresh() {
      useUI.getState().toast('有新版本，重新開啟 App 即可更新');
    },
    onOfflineReady() {
      useUI.getState().toast('已可離線使用', 'good');
    },
  });
}
