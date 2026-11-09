import { useSyncExternalStore } from 'react';
import { useData } from '@/store/data';

const QUERY = '(prefers-color-scheme: dark)';
const media = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(QUERY) : null);

function subscribe(cb: () => void) {
  const mq = media();
  mq?.addEventListener('change', cb);
  return () => mq?.removeEventListener('change', cb);
}
const systemDark = () => media()?.matches ?? false;

/** 目前畫面實際是不是深色（設定為「跟隨系統」時看系統；系統切換時會即時更新） */
export function useDarkTheme(): boolean {
  const pref = useData((s) => s.settings.theme);
  const sys = useSyncExternalStore(subscribe, systemDark, () => false);
  return pref === 'dark' || (pref === 'system' && sys);
}
