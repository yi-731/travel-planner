import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react';
import { type ReactNode, type RefObject, useRef } from 'react';
import { fromMinutes, type TripPhase } from '@/domain/dates';
import { itemType } from '@/domain/constants';
import { fmtMoney, totalHome } from '@/domain/money';
import { placeQuery, type SegmentInfo } from '@/domain/schedule';
import type { Trip } from '@/domain/types';
import { haptic } from '@/platform';
import { gmapsNavigate } from '@/services/links';
import { useData } from '@/store/data';
import { useUI } from '@/store/ui';
import { Button, Chip, Icon, LinkButton, Orb, useBlobUrl } from '@/ui';
import { leaveTone, startsIn, type NextStop } from './model';
import s from './home.module.css';

interface Props {
  trip: Trip;
  phase: TripPhase;
  next: NextStop | null;
  /** 這一天（focusDay）有幾個行程點 */
  dayCount: number;
  /** 抵達下一站的那段移動 */
  seg: SegmentInfo | null;
  nowMin: number;
}

const EYEBROW: Record<NextStop['status'], string> = { first: '第一站', next: '下一站', now: '進行中' };

/**
 * 打勾後主卡會換成下一站（舊面板淡出 0.22 秒、新面板再淡入）。連點兩下時第二下會落在新面板同一個位置，
 * 這段時間內的打勾一律忽略，避免順手把下一站也標成完成。
 */
const DONE_COOLDOWN_MS = 700;

/** 首頁主卡：封面（照片或日落光球）＋底部霧面玻璃面板 */
export function HeroCard({ trip, phase, next, dayCount, seg, nowMin }: Props) {
  const reduce = useReducedMotion();
  const cover = useBlobUrl(trip.cover.kind === 'image' ? trip.cover.blobKey : null);
  const hue = trip.cover.hue ?? 0;
  // 上一次在主卡打勾的時間（換站時 StopPanel 會重新掛載，所以記在外層）
  const lastDoneAt = useRef(0);

  let key: string;
  let body: ReactNode;
  if (next) {
    key = `stop-${next.item.id}`;
    body = <StopPanel trip={trip} phase={phase} next={next} seg={seg} nowMin={nowMin} lastDoneAt={lastDoneAt} />;
  } else if (phase.phase === 'after') {
    key = 'after';
    body = <RecapPanel trip={trip} phase={phase} />;
  } else {
    key = `empty-${phase.phase}-${dayCount}`;
    body = <EmptyPanel phase={phase} allDone={dayCount > 0} />;
  }

  return (
    <section className={`${s.hero} ${cover ? s.onImage : ''}`} aria-label="旅程重點">
      {cover ? (
        <img className={s.cover} src={cover} alt="" />
      ) : (
        <>
          <Orb size={300} halo hue={hue} style={{ right: -96, top: -110 }} />
          <Orb size={228} hue={hue} style={{ right: -54, top: -66 }} />
        </>
      )}
      <div className={s.glass}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={key}
            className={s.glassIn}
            initial={reduce ? false : { opacity: 0, x: 14 }}
            animate={{ opacity: 1, x: 0, pointerEvents: 'auto' }}
            exit={reduce ? { opacity: 0, pointerEvents: 'none' } : { opacity: 0, x: -14, pointerEvents: 'none' }}
            transition={{ duration: reduce ? 0.01 : 0.22, ease: [0.2, 0.8, 0.2, 1] }}
          >
            {body}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}

interface StopPanelProps {
  trip: Trip;
  phase: TripPhase;
  next: NextStop;
  seg: SegmentInfo | null;
  nowMin: number;
  lastDoneAt: RefObject<number>;
}

function StopPanel({ trip, phase, next, seg, nowMin, lastDoneAt }: StopPanelProps) {
  // 換站時舊面板還在淡出，這時不接受點按
  const isPresent = useIsPresent();
  const openSheet = useUI((st) => st.openSheet);
  const toast = useUI((st) => st.toast);
  const toggleDone = useData((st) => st.toggleDone);
  const { item } = next;
  const type = itemType(item.type);
  const leaveBy = seg?.leaveBy ?? null;
  const tone = leaveTone(seg, phase.phase, nowMin);
  const soon = phase.phase === 'during' && next.status === 'next' ? startsIn(item, nowMin) : null;

  // 只會「標記完成」，不會切回未完成（要取消請到地點頁或行程分頁）
  const markDone = () => {
    if (!isPresent) return;
    const t = performance.now();
    if (t - lastDoneAt.current < DONE_COOLDOWN_MS) return;
    const cur = useData.getState().trips[trip.id]?.items.find((i) => i.id === item.id);
    if (!cur || cur.done) return;
    lastDoneAt.current = t;
    void haptic('success');
    toggleDone(trip.id, item.id);
    toast(`已完成「${item.title}」`, 'good');
  };

  return (
    <>
      <div className={s.panelTop}>
        <span className={`eyebrow ${next.status === 'now' ? s.live : ''}`}>
          {EYEBROW[next.status]}
          {soon && <span className={`num ${s.soon}`}> · {soon}</span>}
        </span>
        {leaveBy != null && leaveBy >= 0 && (
          <span className={`${s.leave} ${tone === 'warn' ? s.leaveWarn : ''}`}>
            <Icon name="clock" size={12} stroke={2.4} />
            建議 <span className="num">{fromMinutes(leaveBy)}</span> 出發
          </span>
        )}
        {leaveBy == null && seg?.tight && <span className={`${s.leave} ${s.leaveWarn}`}>時間偏趕</span>}
      </div>
      <div className={s.timeRow}>
        {item.time ? <span className={`serif num ${s.bigTime}`}>{item.time}</span> : <span className={s.noTime}>時間未定</span>}
        <Chip color={type.color}>{type.label}</Chip>
      </div>
      <div className={s.stopTitle}>{item.title}</div>
      {item.address && <div className={s.stopAddr}>{item.address}</div>}
      <div className={s.actions}>
        <LinkButton variant="go" icon="navigate" href={gmapsNavigate(placeQuery(item))}>
          導航
        </LinkButton>
        <Button variant="ghost" onClick={() => openSheet({ name: 'place', itemId: item.id })}>
          詳情
        </Button>
        {phase.phase === 'during' && (
          <button type="button" className={s.doneBtn} aria-label={`把「${item.title}」標記為完成`} disabled={!isPresent} onClick={markDone}>
            <Icon name="check" size={19} stroke={2.4} />
          </button>
        )}
      </div>
    </>
  );
}

function RecapPanel({ trip, phase }: { trip: Trip; phase: TripPhase }) {
  const setTab = useUI((st) => st.setTab);
  const total = totalHome(trip);
  const stats = [`${phase.days.length} 天`, `${trip.items.length} 站`, `${trip.expenses.length} 筆花費`].join(' · ');
  return (
    <>
      <div className={s.panelTop}>
        <span className="eyebrow">旅程回顧</span>
      </div>
      <div className={s.timeRow}>
        <span className={`serif num ${s.bigTime}`}>{fmtMoney(total)}</span>
        <span className={s.currency}>{trip.homeCurrency}</span>
      </div>
      <div className={s.stopAddr}>總花費 · {stats}</div>
      <div className={s.actions}>
        <Button variant="go" icon="download" onClick={() => setTab('more')}>
          匯出回憶
        </Button>
      </div>
    </>
  );
}

function EmptyPanel({ phase, allDone }: { phase: TripPhase; allDone: boolean }) {
  const openSheet = useUI((st) => st.openSheet);
  const date = phase.focusDay ?? undefined;

  if (phase.phase === 'none')
    return (
      <>
        <div className={s.panelTop}>
          <span className="eyebrow">開始規劃</span>
        </div>
        <div className={s.stopTitle}>還沒設定旅行日期</div>
        <div className={s.emptySub}>設定出發日後，這裡會顯示倒數、下一站和天氣。</div>
        <div className={s.actions}>
          <Button variant="go" icon="calendar" onClick={() => openSheet({ name: 'tripSettings' })}>
            設定日期
          </Button>
          <Button variant="ghost" onClick={() => openSheet({ name: 'itemForm' })}>
            新增行程點
          </Button>
        </div>
      </>
    );

  const isToday = phase.phase === 'during';
  const title = isToday ? (allDone ? '今天的行程都完成了' : '今天還沒有安排') : '第一天還沒有安排';
  const sub = allDone
    ? '辛苦了。還想多走走，可以再加一站，或讓 AI 推薦附近去處。'
    : '加幾個想去的地方，或讓 AI 依天氣和位置推薦。';
  return (
    <>
      <div className={s.panelTop}>
        <span className="eyebrow">{isToday ? '今天' : '第一天'}</span>
        {allDone && (
          <span className={`${s.leave} ${s.leaveGood}`}>
            <Icon name="check" size={12} stroke={2.6} />
            全部完成
          </span>
        )}
      </div>
      <div className={s.stopTitle}>{title}</div>
      <div className={s.emptySub}>{sub}</div>
      <div className={s.actions}>
        <Button variant="go" icon="plus" onClick={() => openSheet({ name: 'itemForm', date })}>
          新增行程點
        </Button>
        <Button variant="ghost" icon="spark" onClick={() => openSheet({ name: 'recommend', date })}>
          AI 推薦
        </Button>
      </div>
    </>
  );
}
