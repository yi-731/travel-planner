/**
 * 選擇旅程（參考圖的「Choose your destination」轉盤）：
 * 依出發日排列的大字城市名，目前的旅程全亮＋橘點，其他淡出；點一下切換並回到首頁。
 */
import { motion, useReducedMotion } from 'motion/react';
import { useMemo } from 'react';
import type { Trip } from '@/domain/types';
import { haptic } from '@/platform';
import { useData } from '@/store';
import { useUI } from '@/store/ui';
import { Button, Empty, Sheet } from '@/ui';
import { isCjk, sortTrips, tripCity, tripSubtitle } from './model';
import s from './trips.module.css';

export default function TripPickerSheet() {
  const trips = useData((st) => st.trips);
  const activeId = useData((st) => st.activeTripId);
  const replaceSheet = useUI((st) => st.replaceSheet);
  const list = useMemo(() => sortTrips(Object.values(trips)), [trips]);

  const pick = (id: string) => {
    void haptic(id === activeId ? 'light' : 'medium');
    useData.getState().setActiveTrip(id);
    const ui = useUI.getState();
    ui.selectDate(null);
    ui.setTab('home');
    ui.closeAllSheets();
  };

  return (
    <Sheet
      eyebrow="選擇旅程"
      footer={
        <div className={s.footRow}>
          <Button variant="go" icon="plus" block onClick={() => replaceSheet({ name: 'newTrip' })}>
            新行程
          </Button>
          <Button variant="ghost" icon="sheet" block onClick={() => replaceSheet({ name: 'import' })}>
            從試算表匯入
          </Button>
        </div>
      }
    >
      {list.length ? (
        <ul className={s.dial} aria-label="所有旅程">
          {list.map((t, i) => (
            <TripRow key={t.id} trip={t} index={i} active={t.id === activeId} onPick={pick} />
          ))}
        </ul>
      ) : (
        <Empty icon="globe" title="還沒有旅程">
          建立第一趟旅程，或從試算表匯入現有的行程。
        </Empty>
      )}
    </Sheet>
  );
}

function TripRow({ trip, index, active, onPick }: { trip: Trip; index: number; active: boolean; onPick: (id: string) => void }) {
  const reduce = useReducedMotion();
  const city = tripCity(trip);
  const cjk = isCjk(city.text);
  return (
    <motion.li
      initial={reduce ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, delay: reduce ? 0 : Math.min(index, 8) * 0.05, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <button
        type="button"
        className={`${s.trip} ${active ? s.active : ''}`}
        aria-current={active ? 'true' : undefined}
        onClick={() => onPick(trip.id)}
      >
        <span className={s.dotCol} aria-hidden>
          <span className={s.dot} />
        </span>
        <span className={s.tripText}>
          <span className={cjk ? s.cityCjk : `serif ${s.city}`}>{city.text}</span>
          <span className={`num ${s.sub}`}>{tripSubtitle(trip)}</span>
        </span>
      </button>
    </motion.li>
  );
}
