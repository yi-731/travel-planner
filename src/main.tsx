import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import './styles/global.css';
import { App } from './app/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// 開發模式：讓截圖腳本可以切換分頁、開彈出頁（scripts/shot.mjs）
if (import.meta.env.DEV) {
  void Promise.all([import('./store/ui'), import('./store/data')]).then(([ui, data]) => {
    (window as unknown as Record<string, unknown>).__tp = { useUI: ui.useUI, useData: data.useData };
  });
}
