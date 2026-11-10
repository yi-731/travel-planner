/**
 * 「今天」分頁（首頁）：一眼看出下一步。
 * 由上而下：標題列（出發日／第幾天／當天城市或路線）→ 城市大字（旅途中是當天所在的城市）→ 主卡（下一站／回顧／空狀態）→ 三張小卡 → 當日行程。
 * 旅程結束後不顯示小卡，當日行程換成「回顧全部行程」一列。
 * 顯示規則（下一站怎麼挑、移動資訊、花費摘要）在 ./model.ts，有測試。
 */
import { motion, useReducedMotion } from 'motion/react';
import { type CSSProperties, useMemo } from 'react';
import { fmtMD, tripPhase } from '@/domain/dates';
import { daySegments, itemsOfDay } from '@/domain/schedule';
import type { Trip } from '@/domain/types';
import { dayMetaFor, parseDayBanner } from '@/services/places';
import { useActiveTrip } from '@/store/data';
import { useUI } from '@/store/ui';
import { DayList, ReviewRow } from './DayList';
import { HeroCard } from './HeroCard';
import { HomeTiles } from './HomeTiles';
import { cityFitLength, eyebrowPlace, eyebrowText, hasCJK, heroCity, pickNextStop, segmentInto, showHomeTiles } from './model';
import { useNow } from './useNow';
import s from './home.module.css';

const EASE = [0.2, 0.8, 0.2, 1] as const;

/** 服務還在開發或出錯時不要讓整頁壞掉 */
function attempt<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export default function HomeView() {
  const trip = useActiveTrip();
  // AppShell 在沒有行程時會顯示 NoTrip，這裡只是保險
  if (!trip) return <></>;
  return <Home trip={trip} />;
}

function Home({ trip }: { trip: Trip }) {
  const now = useNow();
  const setTab = useUI((st) => st.setTab);
  const selectDate = useUI((st) => st.selectDate);
  const reduce = useReducedMotion();

  const phase = useMemo(() => tripPhase(trip, now.date), [trip, now.date]);
  const focusDay = phase.focusDay;
  const dayItems = useMemo(
    () => (focusDay ? itemsOfDay(trip, focusDay) : trip.items.filter((i) => !i.date)),
    [trip, focusDay],
  );
  const segs = useMemo(() => (focusDay ? daySegments(trip, focusDay) : []), [trip, focusDay]);
  const next = pickNextStop(phase.phase, dayItems, now.minutes);
  const seg = segmentInto(segs, next?.item.id);

  // 當天的城市（多城市行程每天不同）與日期列提到的路線
  const dayMeta = useMemo(() => (focusDay ? attempt(() => dayMetaFor(trip, focusDay), trip.days?.[focusDay]) : undefined), [trip, focusDay]);
  const dayCity = dayMeta?.city?.trim() || undefined;
  const ownLabel = focusDay ? trip.days?.[focusDay]?.label : undefined;
  const bannerCities = useMemo(() => (ownLabel ? attempt(() => parseDayBanner(ownLabel).cities, []) : []), [ownLabel]);

  const city = heroCity(trip, dayCity, phase.phase);
  const cjk = hasCJK(city);
  const where = phase.phase === 'during' ? eyebrowPlace(bannerCities, dayCity, city) : '';
  const listTitle = phase.phase === 'during' ? '今日行程' : focusDay ? `${fmtMD(focusDay)} 行程` : '尚未排日期';

  // 由上而下依序淡入；系統開啟「減少動態效果」時不播放
  const enter = (i: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 14 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.45, delay: 0.03 + i * 0.06, ease: EASE },
        };

  return (
    <div className={s.home}>
      <motion.header className={s.head} {...enter(0)}>
        <div className={s.eyebrowRow}>
          <span className="eyebrow num">{eyebrowText(phase, where)}</span>
          {trip.isExample && <span className={s.badge}>範例</span>}
          {trip.routeCode && <span className={s.route}>{trip.routeCode}</span>}
        </div>
        <h1
          className={cjk ? s.cityCjk : `serif ${s.city}`}
          style={{ ['--len' as string]: cityFitLength(city) } as CSSProperties}
          lang={cjk ? 'zh-Hant' : undefined}
        >
          {city}
        </h1>
      </motion.header>

      <motion.div {...enter(1)}>
        <HeroCard trip={trip} phase={phase} next={next} dayCount={dayItems.length} seg={seg} nowMin={now.minutes} />
      </motion.div>

      {showHomeTiles(phase.phase) && (
        <motion.div {...enter(2)}>
          <HomeTiles trip={trip} phase={phase} seg={seg} />
        </motion.div>
      )}

      {phase.phase === 'after' ? (
        trip.items.length > 0 && (
          <motion.div {...enter(2)}>
            <ReviewRow
              count={trip.items.length}
              onClick={() => {
                selectDate(phase.days[0] ?? null);
                setTab('plan');
              }}
            />
          </motion.div>
        )
      ) : (
        dayItems.length > 0 && (
          <motion.div {...enter(3)}>
            <DayList
              title={listTitle}
              items={dayItems}
              nextId={next?.item.id}
              during={phase.phase === 'during'}
              nowMin={now.minutes}
              onShowAll={() => {
                selectDate(focusDay);
                setTab('plan');
              }}
            />
          </motion.div>
        )
      )}
    </div>
  );
}
