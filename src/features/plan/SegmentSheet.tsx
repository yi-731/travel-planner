/**
 * 「移動」彈出頁：兩站之間要多久、何時出發，以及各種交通方式的地圖連結。
 * 有 AI 排程檢查結果就用大字顯示分鐘數；沒有就建議跑一次檢查（可直接在這裡執行）。
 */
import { fmtMD, fromMinutes, toMinutes } from '@/domain/dates';
import { daySegments, haversineKm, segmentEstimate, type SegmentInfo } from '@/domain/schedule';
import type { Item, Trip } from '@/domain/types';
import { useDayCheck } from '@/features/ai/useDayCheck';
import { appleMapsNavigate, gmapsDirections, gmapsTraffic, type TravelMode } from '@/services/links';
import { useActiveTrip } from '@/store/data';
import { Button, Empty, Icon, ListGroup, ListRow, Note, Orb, Sheet, Spinner, type IconName } from '@/ui';
import { fmtKm, fmtMDWeek, modeIcon, navQuery, tightDetail, travelMinutes } from './model';
import s from './plan.module.css';

export default function SegmentSheet({ fromId, toId }: { fromId: string; toId: string }) {
  const trip = useActiveTrip();
  const from = trip?.items.find((i) => i.id === fromId);
  const to = trip?.items.find((i) => i.id === toId);
  if (!trip || !from || !to)
    return (
      <Sheet eyebrow="移動" title="找不到這段移動">
        <Empty icon="navigate" title="行程點可能已經被刪除或改過">
          回到行程頁再點一次兩站之間的移動資訊。
        </Empty>
      </Sheet>
    );
  return <Segment trip={trip} seg={findSegment(trip, from, to)} />;
}

/** 先找當天相鄰的那一段；不相鄰（例如順序改了）就自己算 */
function findSegment(trip: Trip, from: Item, to: Item): SegmentInfo {
  const hit =
    from.date && from.date === to.date ? daySegments(trip, from.date).find((sg) => sg.from.id === from.id && sg.to.id === to.id) : undefined;
  if (hit) return hit;
  return {
    from,
    to,
    estimate: segmentEstimate(trip, from, to),
    distanceKm: from.geo && to.geo ? haversineKm(from.geo, to.geo) : null,
    tight: false,
    leaveBy: null,
  };
}

const MODES: { mode: TravelMode; label: string; icon: IconName; sub?: string }[] = [
  { mode: 'transit', label: '大眾運輸', icon: 'train', sub: '電車、地鐵、巴士' },
  { mode: 'driving', label: '開車（含即時路況）', icon: 'car', sub: '計程車也看這個' },
  { mode: 'walking', label: '步行', icon: 'walk' },
  { mode: 'bicycling', label: '單車', icon: 'bike' },
];
const ICON_MODE: Partial<Record<IconName, TravelMode>> = { train: 'transit', car: 'driving', walk: 'walking', bike: 'bicycling' };

function Segment({ trip, seg }: { trip: Trip; seg: SegmentInfo }) {
  const { from, to, estimate } = seg;
  const date = from.date && from.date === to.date ? from.date : null;
  const ai = useDayCheck(trip.id, date);
  const origin = navQuery(from),
    dest = navQuery(to);
  const travel = travelMinutes(seg);
  const tight = tightDetail(seg);
  const suggested = estimate ? ICON_MODE[modeIcon(estimate.mode)] : undefined;

  // 時間：上一站結束（開始＋停留）→ 下一站開始
  const startA = toMinutes(from.time),
    startB = toMinutes(to.time);
  const endA = startA != null ? startA + (from.durationMin ?? 0) : null;
  const gap = endA != null && startB != null ? startB - endA : null;
  const leaveBy = seg.leaveBy != null && seg.leaveBy >= 0 ? seg.leaveBy : null;

  const title = (
    <span className={s.segTitle}>
      <span className={s.segFrom}>{from.title}</span>
      <span className={s.segTo}>
        <Icon name="arrow" size={20} stroke={2.4} className={s.segArrow} />
        <span>{to.title}</span>
      </span>
    </span>
  );

  return (
    <Sheet eyebrow={date ? `移動 · ${fmtMDWeek(date)}` : '移動'} title={title}>
      {estimate ? (
        <section className={s.hero} aria-label="AI 估計">
          <Orb size={260} halo style={{ right: -90, top: -110 }} />
          <Orb size={190} style={{ right: -46, top: -70 }} />
          <div className={s.glass}>
            <span className="eyebrow">AI 估計</span>
            <div className={s.minRow}>
              <span className={`serif num ${s.bigMin}`}>{Math.round(estimate.minutes)}</span>
              <span className={s.minUnit}>分鐘{estimate.mode.trim() ? ` · ${estimate.mode.trim()}` : ''}</span>
            </div>
            {estimate.tip && <p className={s.tip}>{estimate.tip}</p>}
            {leaveBy != null && (
              <span className={`num ${s.leaveLine} ${seg.tight ? s.leaveWarn : ''}`}>
                <Icon name="clock" size={14} stroke={2.4} />
                建議 {fromMinutes(leaveBy)} 前出發，{fromMinutes(leaveBy + Math.round(estimate.minutes))} 抵達
              </span>
            )}
          </div>
        </section>
      ) : (
        <Note>
          <strong>還沒有這段的 AI 估計</strong>
          <span>
            {date
              ? 'AI 排程檢查會估計這天每段移動要多久、怎麼去最順，並提醒太趕的地方。'
              : '兩站不在同一天，AI 排程檢查不會估計這段。可以直接用下面的地圖查路線。'}
          </span>
          {date && (
            <span className={s.noteAction}>
              <Button variant="go" icon="spark" disabled={ai.busy} onClick={() => void ai.run()}>
                {ai.busy ? (
                  <>
                    <Spinner /> 檢查中…
                  </>
                ) : (
                  `AI 檢查 ${fmtMD(date)} 的行程`
                )}
              </Button>
            </span>
          )}
          {ai.error && <span className={s.err}>{ai.error}</span>}
        </Note>
      )}

      {tight && (
        <Note tone="warn">
          <strong>時間可能不夠</strong>
          <span className="num">
            {from.durationMin ? `在「${from.title}」停留 ${from.durationMin} 分，` : ''}
            {tight.leaveAt} 出發{travel ? `、移動約 ${travel} 分` : ''}，會在 {tight.arriveAt} 抵達，比預定的 {to.time} 晚 {tight.lateMin}{' '}
            分。可以提早出發或縮短停留。
          </span>
        </Note>
      )}

      {(endA != null || startB != null) && (
        <div className={s.stats}>
          <Stat
            label="離開"
            value={endA != null ? fromMinutes(endA) : '—'}
            sub={from.durationMin ? `停留 ${from.durationMin} 分後` : from.time ? '開始時間' : '時間未定'}
          />
          <Stat
            label="空檔"
            value={gap != null ? String(gap) : '—'}
            unit={gap != null ? '分' : undefined}
            sub={travel != null ? `移動約 ${travel} 分` : '可用來移動'}
            warn={!!tight || (gap != null && gap < 0)}
          />
          <Stat label="抵達" value={to.time ?? '—'} sub={to.time ? '下一站開始' : '時間未定'} />
        </div>
      )}

      {seg.distanceKm != null && (
        <div className={s.distance}>
          <Icon name="pin" size={16} />
          <span className="num">直線距離 {fmtKm(seg.distanceKm)}</span>
        </div>
      )}

      <ListGroup title="用 Google 地圖查路線">
        {MODES.map((m) => (
          <ListRow
            key={m.mode}
            icon={m.icon}
            title={m.label}
            subtitle={m.sub}
            end={suggested === m.mode ? <span className={s.aiPill}>AI 建議</span> : undefined}
            href={gmapsDirections(origin, dest, m.mode)}
          />
        ))}
      </ListGroup>

      <ListGroup title="其他">
        <ListRow icon="map" title="Apple 地圖" subtitle={`從目前位置導航到「${to.title}」`} href={appleMapsNavigate(dest)} />
        <ListRow icon="traffic" title="即時路況圖層" subtitle="看目前位置附近哪裡在塞車" href={gmapsTraffic} />
      </ListGroup>

      {estimate && <p className={s.tiny}>AI 估計，出發前以 Google 地圖即時路況為準</p>}
    </Sheet>
  );
}

function Stat({ label, value, unit, sub, warn }: { label: string; value: string; unit?: string; sub?: string; warn?: boolean }) {
  return (
    <div className={`${s.stat} ${warn ? s.statWarn : ''}`}>
      <span className={s.statLabel}>{label}</span>
      <span className={s.statValue}>
        {value}
        {unit && <span className={s.statUnit}>{unit}</span>}
      </span>
      {sub && <span className={s.statSub}>{sub}</span>}
    </div>
  );
}
