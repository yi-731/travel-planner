/**
 * 地圖卡片（Leaflet）：當天站點的編號標記、依時間順序的虛線路線、目前位置，
 * 以及疊在地圖上的玻璃按鈕（全部／定位）、定位進度、離線提示、選取站點的小卡。
 *
 * 父元件透過 ref 呼叫 focus(id)（移到某站並放大）與 fitAll()（框住全部）。
 * 框選規則（幾個點怎麼框）在 ./model.ts 的 framing()。
 */
import { latLngBounds, point, type LatLngTuple, type Map as LeafletMap } from 'leaflet';
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { AttributionControl, MapContainer, Marker, Polyline, TileLayer } from 'react-leaflet';
import type { LatLng } from '@/domain/types';
import { currentPosition, haptic } from '@/platform';
import { gmapsNavigate } from '@/services/links';
import { useUI } from '@/store/ui';
import { Icon, LinkButton, Spinner } from '@/ui';
import { meIcon, stopIcon } from './markers';
import { framing, locatedStops, navQuery, pointsKey, stopSubtitle, TILE_ATTRIBUTION, tileUrl, type Framing, type Stop } from './model';
import s from './map.module.css';

export interface TripMapHandle {
  /** 移到這一站並放大 */
  focus: (itemId: string) => void;
  /** 框住當天全部站點 */
  fitAll: () => void;
}

interface Props {
  stops: Stop[];
  selectedId: string | null;
  onSelect: (itemId: string | null) => void;
  /** 開地點詳情 */
  onOpen: (itemId: string) => void;
  /** 沒有站點座標時的中心（行程城市） */
  city: LatLng | null;
  dark: boolean;
  /** 換天時改變：重新框選並清除「使用者自己移過地圖」的狀態 */
  frameKey: string;
  /** 背景定位進行中的文字（例如「定位中 3/8…」），沒有就不顯示 */
  geocoding: string | null;
  reduceMotion: boolean;
  ref?: Ref<TripMapHandle>;
}

/** 框選時留給疊加元件的邊距：左上（定位進度膠囊）、右下（右上角按鈕列） */
const PAD_TOP_LEFT = point(28, 60);
const PAD_BOTTOM_RIGHT = point(66, 34);
/** 選取站點時地圖中心往下移，讓標記落在底部小卡上方 */
const CALLOUT_SHIFT = 44;
const FOCUS_ZOOM = 15;

const tuple = (p: LatLng): LatLngTuple => [p.lat, p.lng];
const hasSize = (el: HTMLElement) => el.clientWidth > 0 && el.clientHeight > 0;

function applyFraming(map: LeafletMap, f: Framing, animate: boolean) {
  if (f.kind === 'bounds') {
    map.fitBounds(latLngBounds(f.points.map(tuple)), {
      paddingTopLeft: PAD_TOP_LEFT,
      paddingBottomRight: PAD_BOTTOM_RIGHT,
      maxZoom: 16,
      animate,
    });
  } else map.setView(tuple(f.center), f.zoom, { animate });
}

export function TripMap({ stops, selectedId, onSelect, onOpen, city, dark, frameKey, geocoding, reduceMotion, ref }: Props) {
  const toast = useUI((st) => st.toast);
  const [map, setMap] = useState<LeafletMap | null>(null);
  const [me, setMe] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);
  const tiles = useTileHealth();

  /** 使用者自己拖過／縮放過地圖：背景定位補上新座標時就不再自動框選 */
  const userMoved = useRef(false);
  const lastFrame = useRef<string | null>(null);
  // 事件處理器裡要讀最新值（不想因為這些改變就重新綁定 Leaflet 事件）
  const latest = useRef({ stops, city, onSelect });
  useEffect(() => {
    latest.current = { stops, city, onSelect };
  });

  const located = useMemo(() => locatedStops(stops), [stops]);
  const pkey = pointsKey(stops);
  const cityKey = city ? `${city.lat},${city.lng}` : '';
  // 只在座標真的變了（pkey 改變）才換新陣列，Polyline 才不會每次 render 都重畫
  const line = useMemo(() => located.map((st) => tuple(st.geo)), [pkey]);
  const selected = selectedId ? located.find((st) => st.item.id === selectedId) ?? null : null;

  // 初始畫面：MapContainer 只在建立時讀 center/zoom，之後由下方 effect 框選
  const [initial] = useState(() => {
    const f = framing(stops, city);
    return f.kind === 'point' ? { center: tuple(f.center), zoom: f.zoom } : { center: tuple(f.points[0]), zoom: 13 };
  });

  // 所有鏡頭移動都經過 whenIdle：縮放動畫進行中就等動畫結束再做（否則 Leaflet 會直接忽略）
  const whenIdle = useWhenIdle(map);
  /** 依目前站點框選；使用者自己移過地圖就不動 */
  const frame = (animate: boolean) =>
    whenIdle((m) => {
      if (!userMoved.current) applyFraming(m, framing(latest.current.stops, latest.current.city), animate);
    });

  // 換天、站點座標變了、城市座標變了 → 重新框選（使用者自己移過地圖時，只有換天才框）
  useEffect(() => {
    if (!map) return;
    const first = lastFrame.current === null;
    if (lastFrame.current !== frameKey) userMoved.current = false;
    lastFrame.current = frameKey;
    frame(!first && !reduceMotion);
  }, [map, frameKey, pkey, cityKey, reduceMotion]); // frame 只讀 ref 與 map

  // Leaflet 要知道容器尺寸：掛載後（分頁進場動畫結束）、尺寸改變、App 回到前景、切回地圖分頁都重算
  useEffect(() => {
    if (!map) return;
    const el = map.getContainer();
    let raf = 0;
    let wasEmpty = !hasSize(el);
    const refresh = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        map.invalidateSize({ pan: false });
        // 第一次框選時容器還沒有尺寸：等有尺寸再框一次
        if (wasEmpty && hasSize(el)) frame(false);
        wasEmpty = !hasSize(el);
      });
    };
    const ro = new ResizeObserver(refresh);
    ro.observe(el);
    const t = window.setTimeout(refresh, 320);
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    const unsub = useUI.subscribe((st, prev) => {
      if (st.tab === 'map' && prev.tab !== 'map') window.setTimeout(refresh, 260);
    });
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisible);
      unsub();
    };
  }, [map]); // frame 只讀 ref 與 map

  // 記下使用者自己移動地圖（拖曳、雙指縮放、滾輪、雙擊）；點地圖空白處取消選取
  useEffect(() => {
    if (!map) return;
    const mark = () => void (userMoved.current = true);
    const el = map.getContainer();
    const onTouch = (e: TouchEvent) => e.touches.length > 1 && mark();
    const onClick = () => latest.current.onSelect(null);
    map.on('dragstart', mark);
    map.on('dblclick', mark);
    map.on('click', onClick);
    el.addEventListener('touchstart', onTouch, { passive: true });
    el.addEventListener('wheel', mark, { passive: true });
    return () => {
      map.off('dragstart', mark);
      map.off('dblclick', mark);
      map.off('click', onClick);
      el.removeEventListener('touchstart', onTouch);
      el.removeEventListener('wheel', mark);
    };
  }, [map]);

  const fitAll = () => {
    userMoved.current = false;
    frame(!reduceMotion);
  };

  /** 移到某一點並放大；shift > 0 讓點落在中心上方（避開底部小卡） */
  const moveTo = (p: LatLng, shift: number) => {
    userMoved.current = true;
    whenIdle((m) => {
      const z = Math.max(m.getZoom(), FOCUS_ZOOM);
      const target = m.unproject(m.project(tuple(p), z).add([0, shift]), z);
      if (reduceMotion) m.setView(target, z, { animate: false });
      else m.flyTo(target, z, { duration: 0.6 });
    });
  };

  useImperativeHandle(ref, () => ({
    fitAll,
    focus: (itemId) => {
      const st = located.find((x) => x.item.id === itemId);
      if (st) moveTo(st.geo, CALLOUT_SHIFT);
    },
  }));

  const locate = async () => {
    if (locating) return;
    setLocating(true);
    const pos = await currentPosition();
    setLocating(false);
    if (!pos) {
      void haptic('error');
      toast('無法取得位置，請到設定開啟定位權限', 'bad');
      return;
    }
    void haptic('success');
    setMe(pos);
    moveTo(pos, 0);
  };

  return (
    <div className={`${s.mapCard} ${selected ? s.hasCallout : ''}`}>
      <MapContainer
        ref={setMap}
        className={s.leaflet}
        center={initial.center}
        zoom={initial.zoom}
        minZoom={3}
        maxZoom={19}
        zoomSnap={0.5}
        zoomControl={false}
        attributionControl={false}
      >
        <TileLayer url={tileUrl(dark)} subdomains="abc" maxZoom={20} attribution={TILE_ATTRIBUTION} eventHandlers={tiles.handlers} />
        <AttributionControl position="bottomright" prefix={false} />
        {line.length >= 2 && (
          <Polyline
            positions={line}
            interactive={false}
            pathOptions={{ className: s.route, weight: 3.5, dashArray: '0.5 9', lineCap: 'round', lineJoin: 'round' }}
          />
        )}
        {located.map((st) => {
          const on = st.item.id === selectedId;
          return (
            <Marker
              key={st.item.id}
              position={tuple(st.geo)}
              icon={stopIcon(st.n, st.color, st.item.done, on)}
              zIndexOffset={on ? 1000 : st.item.done ? -100 : 0}
              title={st.item.title}
              alt={`第 ${st.n} 站：${st.item.title}`}
              eventHandlers={{
                click: () => {
                  onSelect(st.item.id);
                  onOpen(st.item.id);
                },
              }}
            />
          );
        })}
        {me && <Marker position={tuple(me)} icon={meIcon()} interactive={false} keyboard={false} zIndexOffset={-500} />}
      </MapContainer>

      <div className={s.topLeft} aria-live="polite">
        {geocoding && (
          <span className={s.glassPill}>
            <Spinner />
            <span className="num">{geocoding}</span>
          </span>
        )}
        {tiles.down && (
          <span className={`${s.glassPill} ${s.pillWarn}`}>
            <Icon name="warning" size={14} stroke={2.2} />
            離線中，地圖暫時無法顯示
          </span>
        )}
      </div>

      <div className={s.ctrls}>
        <button
          type="button"
          className={s.ctrl}
          aria-label="顯示當天全部站點"
          onClick={() => {
            void haptic('light');
            fitAll();
          }}
        >
          <FitIcon />
        </button>
        <button type="button" className={s.ctrl} aria-label="移到我的位置" aria-busy={locating} onClick={() => void locate()}>
          {locating ? <Spinner /> : <Icon name="locate" size={19} stroke={2} />}
        </button>
      </div>

      {selected && (
        <div className={s.callout}>
          <button type="button" className={s.calloutMain} onClick={() => onOpen(selected.item.id)} aria-label={`查看「${selected.item.title}」詳情`}>
            <span className={`${s.badge} ${selected.item.done ? s.badgeDone : ''}`} style={{ ['--c' as string]: `var(${selected.color})` }}>
              {selected.n}
            </span>
            <span className={s.calloutText}>
              <span className={s.calloutTitle}>{selected.item.title}</span>
              <span className={`${s.calloutSub} num`}>{stopSubtitle(selected.item) || '查看詳情'}</span>
            </span>
          </button>
          <LinkButton variant="go" size="sm" href={gmapsNavigate(navQuery(selected.item))}>
            導航
          </LinkButton>
        </div>
      )}
    </div>
  );
}

/**
 * Leaflet 在縮放動畫進行中會直接忽略新的 setView／fitBounds（Map._tryAnimatedZoom 檢查 _animatingZoom），
 * 例如剛換天又馬上補到新座標時，第二次框選就會不見。這裡改成等 zoomend 再做，而且只做最後一次要求。
 */
function useWhenIdle(map: LeafletMap | null) {
  const pending = useRef<((m: LeafletMap) => void) | null>(null);
  return useCallback(
    (fn: (m: LeafletMap) => void) => {
      if (!map) return;
      const zooming = (map as unknown as { _animatingZoom?: boolean })._animatingZoom === true;
      if (!zooming) {
        pending.current = null;
        fn(map);
        return;
      }
      const waiting = pending.current !== null;
      pending.current = fn;
      if (!waiting)
        map.once('zoomend', () => {
          const next = pending.current;
          pending.current = null;
          next?.(map);
        });
    },
    [map],
  );
}

/** 「全部」按鈕圖示：四個角框住中心點 */
function FitIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
      <circle cx="12" cy="12" r="2.2" />
    </svg>
  );
}

/** 圖磚載入狀態：瀏覽器回報離線，或一張都還沒載入成功就出錯 → down */
function useTileHealth() {
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  const [failed, setFailed] = useState(false);
  const loaded = useRef(0);
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  const handlers = useMemo(
    () => ({
      tileload: () => {
        if (loaded.current++ === 0) setFailed(false);
      },
      tileerror: () => {
        if (loaded.current === 0) setFailed(true);
      },
    }),
    [],
  );
  return { down: offline || failed, handlers };
}
