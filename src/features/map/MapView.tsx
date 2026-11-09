/**
 * 「地圖」分頁：選一天 → 看當天站點在地圖上的位置與順序，一鍵用 Google／Apple 地圖導航。
 * 由上而下：標題 → 日期列 → 地圖卡（TripMap）→ 當天摘要＋整天路線 → 附近快捷 → 站點清單（StopList）
 * → 找不到位置的提示 → 匯出到 Google 我的地圖。
 * 顯示規則（選哪一天、編號、框選、連結）在 ./model.ts，有測試。
 */
import { useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtMDW, today, tripDays } from '@/domain/dates';
import type { Trip } from '@/domain/types';
import { exportFile, haptic } from '@/platform';
import { tripToMyMapsCsv } from '@/services/exporter';
import { useAutoGeocode } from '@/services/hooks';
import { gmapsDayRoute } from '@/services/links';
import { useActiveTrip } from '@/store/data';
import { useUI } from '@/store/ui';
import { Button, DayStrip, Empty, Icon, LinkButton, ListGroup, ListRow, Note, PageHead, Spinner } from '@/ui';
import { dayStops, fmtKm, geocodeLabel, missingTitle, myMapsFileName, QUICK_LINKS, resolveDate, straightKm, timeSpan, type Stop } from './model';
import { StopList, type GeoState } from './StopList';
import { TripMap, type TripMapHandle } from './TripMap';
import { useDarkTheme } from './useDarkTheme';
import s from './map.module.css';

const MY_MAPS_URL = 'https://www.google.com/maps/d/';

export default function MapView() {
  const trip = useActiveTrip();
  // AppShell 在沒有行程時會顯示 NoTrip，這裡只是保險
  if (!trip) return <></>;
  return <TripMapPage trip={trip} />;
}

function TripMapPage({ trip }: { trip: Trip }) {
  const selected = useUI((st) => st.selectedDate);
  const selectDate = useUI((st) => st.selectDate);
  const openSheet = useUI((st) => st.openSheet);
  const toast = useUI((st) => st.toast);
  const reduce = !!useReducedMotion();
  const dark = useDarkTheme();

  const days = useMemo(() => tripDays(trip), [trip]);
  const date = resolveDate(days, selected, today());
  // 日期被刪掉或還沒選時，把有效的那天寫回去（行程分頁也用同一個日期）
  useEffect(() => {
    if (date !== selected) selectDate(date);
  }, [date, selected, selectDate]);

  const stops = useMemo(() => dayStops(trip, date), [trip, date]);
  const km = straightKm(stops);
  const route = useMemo(() => gmapsDayRoute(stops.map((st) => st.item)), [stops]);

  // 背景補座標：顯示「定位中 3/8…」
  const geo = useAutoGeocode(trip);
  const runTotal = useRunTotal(geo.running, geo.pending);
  const geocoding = geo.running && geo.pending > 0 ? geocodeLabel(runTotal, geo.pending) : null;
  // running：定位中；waiting：還有待定位的（剛開啟或連線中斷，稍後會再試）；done：查過了，沒座標的就是找不到
  const geoState: GeoState = geo.running ? 'running' : geo.pending > 0 ? 'waiting' : 'done';
  const missing = geoState === 'done' ? stops.filter((st) => !st.geo).map((st) => st.item) : [];

  // 選取的站點：換天就清掉；被刪掉或失去座標也清掉
  const [focusId, setFocusId] = useState<string | null>(null);
  const [focusDate, setFocusDate] = useState(date);
  if (focusDate !== date) {
    setFocusDate(date);
    setFocusId(null);
  }
  const focusValid = !!focusId && stops.some((st) => st.item.id === focusId && st.geo);
  const selectedId = focusValid ? focusId : null;

  const mapRef = useRef<TripMapHandle>(null);
  const mapBox = useRef<HTMLDivElement>(null);

  const pick = (st: Stop) => {
    if (!st.geo) {
      openSheet({ name: 'place', itemId: st.item.id });
      return;
    }
    setFocusId(st.item.id);
    // 地圖不在畫面中（已捲到清單）：先捲回地圖
    const box = mapBox.current;
    if (box) {
      const r = box.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      if (r.top < 56 || mid > window.innerHeight - 110) box.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    }
    mapRef.current?.focus(st.item.id);
  };

  const [exporting, setExporting] = useState(false);
  const exportMyMaps = async () => {
    if (exporting) return;
    if (!trip.items.length) {
      toast('這趟旅程還沒有行程點，新增後再匯出', 'bad');
      return;
    }
    setExporting(true);
    try {
      const csv = tripToMyMapsCsv(trip);
      const res = await exportFile({ name: myMapsFileName(trip.name), mime: 'text/csv;charset=utf-8', data: csv });
      if (res !== 'cancelled') {
        void haptic('success');
        toast('已匯出。到我的地圖 → 建立地圖 → 匯入', 'good');
      }
    } catch (e) {
      void haptic('error');
      const why = e instanceof Error && e.message ? e.message : '產生檔案時發生問題';
      toast(`匯出失敗：${why}。請再試一次`, 'bad');
    } finally {
      setExporting(false);
    }
  };

  const dayIndex = date ? days.indexOf(date) : -1;

  return (
    <div className={s.page}>
      <PageHead eyebrow="Google 地圖 · Apple 地圖" title="地圖" />

      {days.length > 0 && <DayStrip days={days} value={date} onChange={selectDate} />}

      <div ref={mapBox} className={s.mapBox}>
        <TripMap
          ref={mapRef}
          stops={stops}
          selectedId={selectedId}
          onSelect={setFocusId}
          onOpen={(itemId) => openSheet({ name: 'place', itemId })}
          city={trip.cityGeo ?? null}
          dark={dark}
          frameKey={`${trip.id}|${date ?? ''}`}
          geocoding={geocoding}
          reduceMotion={reduce}
        />
      </div>

      {date && stops.length > 0 && (
        <div className={s.dayBar}>
          <div className={s.dayStat}>
            <span className="eyebrow num">
              DAY {dayIndex + 1} · {timeSpan(stops) || fmtMDW(date)}
            </span>
            <span className={s.dayNums}>
              <span className="serif num">{stops.length}</span>
              <span className={s.unit}>站</span>
              {km != null && (
                <span className={`${s.km} num`} title="依序連線的直線距離，實際路程會更長">
                  直線 {fmtKm(km)}
                </span>
              )}
            </span>
          </div>
          {route && (
            <LinkButton variant="go" href={route}>
              整天路線
            </LinkButton>
          )}
        </div>
      )}

      <nav className={s.quick} aria-label="在 Google 地圖找附近">
        {QUICK_LINKS.map((q) => (
          <a key={q.key} className={s.q} href={q.href} target="_blank" rel="noopener noreferrer" onClick={() => void haptic('light')}>
            <span className={s.qIcon}>
              <Icon name={q.icon} size={20} />
            </span>
            <span className={s.qLabel}>{q.label}</span>
          </a>
        ))}
      </nav>

      <section className={s.section} aria-label="當天站點">
        <div className={s.secHead}>
          <h2 className={s.secTitle}>站點</h2>
          {stops.length > 0 && (
            <span className={s.legend} aria-hidden>
              <span>
                <i>G</i>Google 地圖
              </span>
              <span>
                <i>A</i>Apple 地圖
              </span>
            </span>
          )}
        </div>
        {stops.length > 0 ? (
          <StopList key={date ?? ''} stops={stops} selectedId={selectedId} geoState={geoState} onPick={pick} reduceMotion={reduce} />
        ) : (
          <div className={s.emptyCard}>
            {date ? (
              <Empty icon="pin" title="這天還沒有行程點" action={<Button variant="ghost" icon="plus" onClick={() => openSheet({ name: 'itemForm', date })}>新增行程點</Button>}>
                新增後會自動標在地圖上。
              </Empty>
            ) : (
              <Empty
                icon="calendar"
                title="還沒有旅行日期"
                action={
                  <Button variant="ghost" icon="calendar" onClick={() => openSheet({ name: 'tripSettings' })}>
                    填寫出發日
                  </Button>
                }
              >
                填好出發日，每天的行程點就會出現在地圖上。
              </Empty>
            )}
          </div>
        )}

        {missing.length > 0 && (
          <Note tone="info">
            <strong>{missingTitle(missing)}</strong>
            <span>可在編輯時貼上 Google 地圖連結。點清單中的那一站就能查看與編輯。</span>
          </Note>
        )}
      </section>

      <ListGroup title="Google 我的地圖">
        <ListRow
          icon="download"
          title="匯出整趟行程（CSV）"
          subtitle="到 Google 我的地圖 → 建立地圖 → 匯入"
          onClick={() => void exportMyMaps()}
          end={exporting ? <Spinner /> : undefined}
        />
        <ListRow icon="map" title="開啟 Google 我的地圖" href={MY_MAPS_URL} />
      </ListGroup>
    </div>
  );
}

/** 這一輪背景定位一開始要處理幾個（讓進度顯示成 3/8）；沒在跑時歸零 */
function useRunTotal(running: boolean, pending: number): number {
  const [total, setTotal] = useState(0);
  useEffect(() => {
    setTotal((t) => (running ? Math.max(t, pending) : 0));
  }, [running, pending]);
  return running ? Math.max(total, pending) : 0;
}
