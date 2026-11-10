/**
 * 「行程」分頁：選一天 → 看當天時間軸。
 * 由上而下：標題（第幾天、日期、預估花費）→ 日期列 → 當天城市一行（城市、住宿、天氣；點了開「這一天」）
 * → 主要動作（新增、AI 排程檢查、AI 推薦）
 * → AI 檢查結果 → 時間軸（左右滑動換天）→ 還沒有日期的行程點。
 * 顯示規則（選哪一天、移動資訊文字）在 ./model.ts，有測試。
 */
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { itemType } from '@/domain/constants';
import { fmtDayNo, today, tripDays } from '@/domain/dates';
import { daySegments, itemsOfDay, validDayCheck } from '@/domain/schedule';
import type { ISODate, Trip } from '@/domain/types';
import { useDayCheck } from '@/features/ai/useDayCheck';
import { haptic } from '@/platform';
import { useTripWeather } from '@/services/hooks';
import { dayMetaFor } from '@/services/places';
import { weatherInfo } from '@/services/weather';
import { useActiveTrip } from '@/store/data';
import { useUI } from '@/store/ui';
import { Button, DayStrip, Empty, Icon, ListGroup, ListRow, Note, PageHead, Spinner } from '@/ui';
import { dayHeader, neighborDay, planEyebrow, resolveDate } from './model';
import { Timeline } from './Timeline';
import { useDaySwipe } from './useDaySwipe';
import s from './plan.module.css';

const EASE = [0.2, 0.8, 0.2, 1] as const;

/** 服務還在開發或出錯時不要讓整頁壞掉 */
function attempt<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export default function PlanView() {
  const trip = useActiveTrip();
  // AppShell 在沒有行程時會顯示 NoTrip，這裡只是保險
  if (!trip) return <></>;
  return <Plan trip={trip} />;
}

function Plan({ trip }: { trip: Trip }) {
  const selected = useUI((st) => st.selectedDate);
  const selectDate = useUI((st) => st.selectDate);
  const openSheet = useUI((st) => st.openSheet);
  const reduce = !!useReducedMotion();

  const days = useMemo(() => tripDays(trip), [trip]);
  const date = resolveDate(days, selected, today());
  // 日期被刪掉或還沒選時，把有效的那天寫回去（地圖分頁也用同一個日期）
  useEffect(() => {
    if (date !== selected) selectDate(date);
  }, [date, selected, selectDate]);

  const items = useMemo(() => (date ? itemsOfDay(trip, date) : []), [trip, date]);
  const segs = useMemo(() => (date ? daySegments(trip, date) : []), [trip, date]);
  const pending = useMemo(
    () =>
      trip.items
        .filter((i) => !i.date)
        .sort((a, b) => (a.dayOffset ?? 999) - (b.dayOffset ?? 999) || (a.time ?? '99:99').localeCompare(b.time ?? '99:99')),
    [trip.items],
  );
  const check = date ? validDayCheck(trip, date) : null;
  const stale = !!date && !check && !!trip.ai.dayChecks[date];
  const ai = useDayCheck(trip.id, date);

  // 換天方向：1 = 往後一天（內容從右邊進來），-1 = 往前
  const [dir, setDir] = useState<-1 | 0 | 1>(0);
  const goTo = (d: ISODate) => {
    if (!date || d === date) return;
    setDir(days.indexOf(d) > days.indexOf(date) ? 1 : -1);
    selectDate(d);
  };
  const prev = neighborDay(days, date, -1);
  const next = neighborDay(days, date, 1);
  const swipe = useDaySwipe({
    canPrev: !!prev,
    canNext: !!next,
    reduce,
    onSwipe: (d) => {
      const target = d === 1 ? next : prev;
      if (!target) return;
      void haptic('selection');
      goTo(target);
    },
  });

  const add = () => openSheet({ name: 'itemForm', date: date ?? undefined });
  const canCheck = items.length >= 2;

  return (
    <div className={s.plan}>
      <PageHead eyebrow={<span className="num">{planEyebrow(days, date, items, trip.localCurrency)}</span>} title="行程" />

      {days.length > 0 && <DayStrip days={days} value={date} onChange={goTo} />}

      {date && <DayLine trip={trip} date={date} />}

      {(date || days.length === 0) && (
        <div className={s.actionsWrap}>
          <div className={s.actions}>
            <Button variant="go" icon="plus" onClick={add}>
              新增
            </Button>
            {date && (
              <>
                {/* 少於 2 站時不放灰掉的按鈕，改在下面用一行字說明 */}
                {(canCheck || ai.busy) && (
                  <Button
                    variant="ghost"
                    icon={ai.busy ? undefined : 'spark'}
                    className={s.aiBtn}
                    disabled={ai.busy}
                    onClick={() => void ai.run()}
                  >
                    {ai.busy ? (
                      <>
                        <Spinner /> 檢查中…
                      </>
                    ) : (
                      'AI 排程檢查'
                    )}
                  </Button>
                )}
                <Button variant="ghost" icon="spark" className={s.aiBtn} onClick={() => openSheet({ name: 'recommend', date })}>
                  AI 推薦
                </Button>
              </>
            )}
          </div>
          {date && items.length === 1 && !ai.busy && <p className={s.actionHint}>再加 1 站就能用 AI 排程檢查</p>}
        </div>
      )}

      {ai.error && !ai.busy && (
        <Note tone="bad">
          <strong>AI 排程檢查沒有完成</strong>
          <span>{ai.error}</span>
          <span className={s.noteAction}>
            <Button variant="ghost" icon="refresh" onClick={() => void ai.run()}>
              再試一次
            </Button>
          </span>
        </Note>
      )}

      {check && (
        <Note tone={check.warnings.length ? 'warn' : 'accent'}>
          <strong className={s.noteHead}>
            {check.summary?.trim() || (check.warnings.length ? `有 ${check.warnings.length} 個地方要注意` : '這天的行程很順')}
          </strong>
          {check.warnings.length > 0 && (
            <ul className={s.warnList}>
              {check.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          <span className={s.tiny}>AI 估計，出發前以 Google 地圖即時路況為準</span>
        </Note>
      )}

      {stale && !ai.busy && !ai.error && (
        <Note tone="info">
          <span>
            行程改過了，上次的 AI 估計已不適用。
            {canCheck ? '再檢查一次就會更新。' : ''}
          </span>
        </Note>
      )}

      {(date || pending.length === 0) && (
        <div className={s.swipeArea} {...swipe.handlers}>
          <motion.div style={{ x: swipe.x }}>
            <motion.div
              key={date ?? 'none'}
              initial={reduce || !dir ? false : { opacity: 0, x: dir * 36 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.28, ease: EASE }}
              // 滑完就歸零：之後從別處換日期（例如表單儲存）不會沿用上一次的方向
              onAnimationComplete={() => setDir(0)}
            >
              {items.length > 0 ? (
                <Timeline
                  tripId={trip.id}
                  items={items}
                  segs={segs}
                  currency={trip.localCurrency}
                  reduce={reduce}
                  // 換天滑入時整塊一起進來，卡片不再逐張浮現
                  stagger={!reduce && !dir}
                />
              ) : (
                <DayEmpty hasDate={!!date} onAdd={add} onImport={() => openSheet({ name: 'import' })} />
              )}
            </motion.div>
          </motion.div>
        </div>
      )}

      {pending.length > 0 && (
        <section className={s.pending} aria-label="還沒有日期的行程點">
          <Note tone="info">
            <strong>有 {pending.length} 個行程點還沒有日期</strong>
            <span>到 更多 → 行程設定 填出發日即可自動換算。</span>
            <span className={s.noteAction}>
              <Button variant="ghost" icon="calendar" onClick={() => openSheet({ name: 'tripSettings' })}>
                填寫出發日
              </Button>
            </span>
          </Note>
          <ListGroup title={`還沒有日期（${pending.length}）`}>
            {pending.map((it) => (
              <ListRow
                key={it.id}
                icon="clock"
                iconColor={`var(${itemType(it.type).color})`}
                title={it.title}
                subtitle={[it.dayOffset ? fmtDayNo(it.dayOffset) : '尚未指定日期', it.time].filter(Boolean).join(' · ')}
                onClick={() => openSheet({ name: 'place', itemId: it.id })}
              />
            ))}
          </ListGroup>
        </section>
      )}
    </div>
  );
}

/** 日期列下方一行：當天城市（粗體）、住宿、天氣；點了開「這一天」看原文與修改城市 */
function DayLine({ trip, date }: { trip: Trip; date: ISODate }) {
  const openSheet = useUI((st) => st.openSheet);
  const weather = useTripWeather(trip);
  const meta = attempt(() => dayMetaFor(trip, date), trip.days?.[date]);
  const { city, lodging } = dayHeader(meta);
  const wx = attempt(() => weather.forDate(date), undefined);
  const w = wx ? attempt(() => weatherInfo(wx.code), null) : null;
  const lo = wx ? Math.round(wx.tMin) : 0,
    hi = wx ? Math.round(wx.tMax) : 0;
  const label = [
    city ? `這天在${city}` : '還沒設定這天的城市',
    lodging ? `住 ${lodging}` : '',
    wx && w ? `${w.label} ${lo} 到 ${hi} 度` : '',
    '查看或修改',
  ]
    .filter(Boolean)
    .join('，');
  return (
    <button
      type="button"
      className={s.dayLine}
      aria-label={label}
      onClick={() => {
        void haptic('light');
        openSheet({ name: 'dayInfo', date });
      }}
    >
      <span className={s.dayWhere} aria-hidden>
        {city ? <b className={s.dayCity}>{city}</b> : <span className={s.dayAsk}>這天在哪個城市？</span>}
        {lodging && <span className={s.dayLodging}>住 {lodging}</span>}
      </span>
      {wx && w && (
        <span className={s.dayWx} aria-hidden>
          <Icon name={w.icon} size={16} stroke={2.1} />
          <span className="num">
            {lo}°–{hi}°
          </span>
        </span>
      )}
      <span className={s.dayChev} aria-hidden>
        <Icon name="chevron" size={14} stroke={2.2} />
      </span>
    </button>
  );
}

/** 空的一天：上面的動作列已經有「新增」，這裡只補匯入；完全沒有日期時兩個都放 */
function DayEmpty({ hasDate, onAdd, onImport }: { hasDate: boolean; onAdd: () => void; onImport: () => void }) {
  return (
    <div className={s.empty}>
      <Empty icon="calendar" title={hasDate ? '這天還沒有安排' : '還沒有任何行程點'}>
        {hasDate ? '用上面的「新增」加第一站，或從試算表匯入整趟行程。' : '一站一站新增，或把行程試算表匯入進來。'}
      </Empty>
      <div className={s.emptyActions}>
        {!hasDate && (
          <Button variant="ghost" icon="plus" onClick={onAdd}>
            新增行程點
          </Button>
        )}
        <Button variant="ghost" icon="sheet" onClick={onImport}>
          匯入試算表
        </Button>
      </div>
    </div>
  );
}
