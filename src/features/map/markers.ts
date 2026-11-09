/**
 * 地圖標記（Leaflet divIcon）。外觀在 map.module.css 的 .pin / .me。
 * 同樣的編號＋顏色＋狀態共用同一個 icon 物件，Leaflet 才不會每次重畫都換 DOM。
 */
import { divIcon, type DivIcon } from 'leaflet';
import s from './map.module.css';

const SIZE = 30;
const SIZE_SELECTED = 40;
const cache = new Map<string, DivIcon>();

/** 編號圓章：類型色底、白字、白邊；完成的變淡；選取的放大 */
export function stopIcon(n: number, color: string, done: boolean, selected: boolean): DivIcon {
  const key = `${n}|${color}|${done ? 1 : 0}|${selected ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const size = selected ? SIZE_SELECTED : SIZE;
  const cls = [s.pin, done && s.pinDone, selected && s.pinSel].filter(Boolean).join(' ');
  // color 來自 ITEM_TYPES（固定的 CSS 變數名），n 是數字，沒有使用者輸入，可直接放進 HTML
  const icon = divIcon({
    className: s.pinHost,
    html: `<span class="${cls}" style="--c: var(${color})">${n}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
  cache.set(key, icon);
  return icon;
}

let me: DivIcon | null = null;
/** 目前位置：藍色圓點＋脈動光圈 */
export function meIcon(): DivIcon {
  me ??= divIcon({ className: s.pinHost, html: `<span class="${s.me}"></span>`, iconSize: [22, 22], iconAnchor: [11, 11] });
  return me;
}
