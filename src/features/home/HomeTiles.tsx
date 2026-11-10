import type { ReactNode } from 'react';
import type { TripPhase } from '@/domain/dates';
import { fmtMoney } from '@/domain/money';
import type { SegmentInfo } from '@/domain/schedule';
import type { Trip } from '@/domain/types';
import { useTripWeather } from '@/services/hooks';
import { gmapsTraffic } from '@/services/links';
import { dayMetaFor } from '@/services/places';
import { useUI } from '@/store/ui';
import { Icon, Tile } from '@/ui';
import { fmtDistance, isMultiCity, safeWeatherInfo, spendSummary, travelTileKind, valueSizeClass, weatherTileSub } from './model';
import s from './home.module.css';

const SIZE = { md: '', sm: s.valSm, xs: s.valXs } as const;

/** 首頁三張小卡：天氣、花費、第三張依階段（出發前倒數／沒日期提醒設定／旅途中移動） */
export function HomeTiles({ trip, phase, seg }: { trip: Trip; phase: TripPhase; seg: SegmentInfo | null }) {
  return (
    <div className={s.tiles}>
      <WeatherTile trip={trip} phase={phase} />
      <SpendTile trip={trip} phase={phase} />
      <TravelTile phase={phase} seg={seg} />
    </div>
  );
}

function WeatherTile({ trip, phase }: { trip: Trip; phase: TripPhase }) {
  const openSheet = useUI((st) => st.openSheet);
  const weather = useTripWeather(trip);
  const day = phase.focusDay ? weather.forDate(phase.focusDay) : undefined;
  const info = day ? safeWeatherInfo(day.code) : null;
  // 多城市行程：寫出這天的天氣是哪個城市的
  let city: string | undefined;
  if (isMultiCity(trip) && phase.focusDay) {
    try {
      city = day?.place?.trim() || dayMetaFor(trip, phase.focusDay)?.city?.trim() || undefined;
    } catch {
      city = day?.place?.trim() || undefined;
    }
  }

  let value: ReactNode = <span className={s.valDim}>—</span>;
  let sub: string;
  if (day && info) {
    value = (
      <span className={s.valTemp}>
        {Math.round(day.tMin)}°<span className={s.dash}>–</span>
        {Math.round(day.tMax)}°
      </span>
    );
    sub = weatherTileSub(city, info.label, day.kind);
  } else if (weather.loading) sub = '讀取中';
  else if (weather.error) sub = '點我重試';
  else if (!phase.focusDay) sub = '設定日期後顯示';
  else if (!trip.city.trim() && !trip.cityGeo) sub = '先設定城市';
  else sub = '查看天氣';

  return (
    <Tile
      hot
      label={
        <>
          天氣
          <span className={s.labelIcon}>
            <Icon name={info?.icon ?? 'sun'} size={15} stroke={2.2} />
          </span>
        </>
      }
      value={value}
      sub={sub}
      onClick={() => {
        if (weather.error) weather.refresh();
        openSheet({ name: 'weather' });
      }}
    />
  );
}

function SpendTile({ trip, phase }: { trip: Trip; phase: TripPhase }) {
  const setTab = useUI((st) => st.setTab);
  const sum = spendSummary(trip, phase);
  const text = fmtMoney(sum.value);
  const over = sum.budgetPct != null && sum.budgetPct > 100;
  return (
    <Tile
      label={sum.label}
      value={<span className={SIZE[valueSizeClass(text)]}>{text}</span>}
      sub={
        <>
          {sum.currency}
          {sum.budgetText && (
            <>
              {' · '}
              <span className={over ? s.over : undefined}>{sum.budgetText}</span>
            </>
          )}
        </>
      }
      onClick={() => setTab('money')}
    />
  );
}

function TravelTile({ phase, seg }: { phase: TripPhase; seg: SegmentInfo | null }) {
  const openSheet = useUI((st) => st.openSheet);
  const t = travelTileKind(phase, seg);
  if (t.kind === 'countdown')
    return (
      <Tile
        label="倒數"
        value={
          t.daysUntil === 1 ? (
            <span className={s.valWord}>明天</span>
          ) : (
            <>
              {t.daysUntil}
              <span className={s.unit}>天</span>
            </>
          )
        }
        sub={`共 ${t.tripDays} 天行程`}
        onClick={() => openSheet({ name: 'tripSettings' })}
      />
    );
  if (t.kind === 'setDates')
    return (
      <Tile
        label="倒數"
        value={<span className={s.valWord}>未定</span>}
        sub="設定出發日"
        onClick={() => openSheet({ name: 'tripSettings' })}
      />
    );
  if (t.kind === 'traffic')
    return (
      <Tile
        label={
          <>
            移動
            <span className={s.labelIcon}>
              <Icon name="arrowUpRight" size={14} stroke={2.2} />
            </span>
          </>
        }
        value={<span className={s.valWord}>路況</span>}
        sub="Google 即時交通"
        href={gmapsTraffic}
      />
    );

  let value: ReactNode;
  let sub: string;
  if (t.kind === 'estimate') {
    value = (
      <>
        {t.minutes}
        <span className={s.unit}>分</span>
      </>
    );
    sub = t.mode || 'AI 估計';
  } else if (t.kind === 'distance') {
    const d = fmtDistance(t.km);
    value = (
      <>
        {d.value}
        <span className={s.unit}>{d.unit}</span>
      </>
    );
    sub = '直線距離';
  } else {
    value = <span className={s.valWord}>路線</span>;
    sub = '查看怎麼去';
  }
  return (
    <Tile
      label={
        <>
          移動
          {t.seg.tight && <span className={`${s.labelIcon} ${s.over}`} aria-label="時間偏趕"><Icon name="warning" size={14} stroke={2.2} /></span>}
        </>
      }
      value={value}
      sub={sub}
      onClick={() => openSheet({ name: 'segment', fromId: t.seg.from.id, toId: t.seg.to.id })}
    />
  );
}
