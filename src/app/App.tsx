import { useEffect } from 'react';
import { useData } from '@/store/data';
import { hideSplash, isNative, syncStatusBar } from '@/platform';
import { AppShell } from './AppShell';
import { registerServiceWorker } from './pwa';

export function App() {
  const hydrated = useData((s) => s.hydrated);
  const theme = useData((s) => s.settings.theme);

  // 主題：system 時不設 data-theme，交給 prefers-color-scheme
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      void syncStatusBar(dark);
      document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#0f0f11' : '#ecebe7'));
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    if (hydrated) void hideSplash();
  }, [hydrated]);

  useEffect(() => {
    if (!isNative) registerServiceWorker();
  }, []);

  if (!hydrated) return null;
  return <AppShell />;
}
