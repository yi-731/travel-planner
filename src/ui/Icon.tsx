/** 線條圖示集（24×24，stroke = currentColor）。新增圖示：在 PATHS 加一筆。 */
const PATHS = {
  home: 'M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z',
  calendar: 'M3.5 9.5h17M8 2.5v4M16 2.5v4|R3.5,4.5,17,16,3',
  map: 'M9 4L3.5 6v14L9 18l6 2 5.5-2V4L15 6zM9 4v14M15 6v14',
  wallet: 'M3 10h18M16 15h2M6 6l9-3 1.5 3|R3,6,18,14,3',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  arrowUpRight: 'M7 17L17 7M8 7h9v9',
  back: 'M15 6l-6 6 6 6',
  chevron: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  close: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12l5 5 9-10',
  navigate: 'M3 11l18-8-8 18-2-8z',
  pin: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z|C12,9.5,2.5',
  car: 'M5 16v-5l2-5h10l2 5v5M5 16h14M5 16v2M19 16v2|C8,13.5,.8|C16,13.5,.8',
  train: 'M6 10h12M9 21l1.5-4M15 21l-1.5-4|R6,3,12,14,3',
  walk: 'M10 21l2-6 3 3v3M9 11l3-3 3 3 3 1M12 8l-1 7|C13,4.5,1.6',
  bike: 'M6 16l4-7h5l3 7M10 9L8 6h3|C6,16,3.5|C18,16,3.5',
  traffic: 'R8,2.5,8,19,4|C12,7,1.2|C12,12,1.2|C12,17,1.2',
  food: 'M7 3v8a2 2 0 0 0 4 0V3M9 11v10M17 21V3c-2 0-3.5 2.5-3.5 6s1.5 4 3.5 4',
  store: 'M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9h16M10 20v-6h4v6',
  locate: 'M12 2v3M12 19v3M2 12h3M19 12h3|C12,12,3|C12,12,7',
  sun: 'M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6L19 19M5 19l1.4-1.4M17.6 6.4L19 5|C12,12,4',
  cloud: 'M7 18h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.2 9.6 4.2 4.2 0 0 0 7 18z',
  rain: 'M7 15h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.2 6.6 4.2 4.2 0 0 0 7 15zM8 18l-1 3M12 18l-1 3M16 18l-1 3',
  snow: 'M7 14h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.2 5.6 4.2 4.2 0 0 0 7 14zM8 18h.01M12 20h.01M16 18h.01',
  storm: 'M7 14h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.2 5.6 4.2 4.2 0 0 0 7 14zM13 15l-3 4h4l-3 4',
  fog: 'M4 10h16M6 14h12M8 18h8M7 6h10',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6',
  sheet: 'M4 9h16M4 15h16M10 3v18|R4,3,16,18,2.5',
  gear: 'M4 7h10M18 7h2M4 17h4M12 17h8|C16,7,2|C10,17,2',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  upload: 'M12 16V5M7 10l5-5 5 5M5 20h14',
  share: 'M12 15V3M7 8l5-5 5 5M5 12v8h14v-8',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4z|C12,13,3.5',
  image: 'M21 16l-5-5-9 9|R3,4,18,16,3|C9,10,2',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16z',
  exchange: 'M4 8h13l-3-3M20 16H7l3 3',
  link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  clock: 'M12 7v5l3 2|C12,12,9',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4',
  users: 'M3 20c0-3 2.7-5 6-5s6 2 6 5M15 15c3 0 6 2 6 5|C9,8.5,3.5|C16.5,9,2.8',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6',
  key: 'M14 10l7-7M18 6l3 3|C9,15,5',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  globe: 'M3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18|C12,12,9',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  info: 'M12 11v6M12 7h.01|C12,12,9',
  warning: 'M12 9v4M12 17h.01M10.3 3.9L2 18.5A2 2 0 0 0 3.7 21h16.6a2 2 0 0 0 1.7-2.5L13.7 3.9a2 2 0 0 0-3.4 0z',
  drag: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, stroke = 2, className, title }: { name: IconName; size?: number; stroke?: number; className?: string; title?: string }) {
  const parts = PATHS[name].split('|');
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      {parts.map((p, i) => {
        if (p.startsWith('R')) {
          const [x, y, w, h, r] = p.slice(1).split(',').map(Number);
          return <rect key={i} x={x} y={y} width={w} height={h} rx={r} />;
        }
        if (p.startsWith('C')) {
          const [cx, cy, r] = p.slice(1).split(',').map(Number);
          return <circle key={i} cx={cx} cy={cy} r={r} />;
        }
        return <path key={i} d={p} />;
      })}
    </svg>
  );
}
