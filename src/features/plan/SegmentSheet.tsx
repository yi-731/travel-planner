/**
 * 「移動」彈出頁：兩站之間要多久、何時出發，以及各種交通方式的地圖連結。
 * 有 AI 排程檢查結果就用大字顯示分鐘數；沒有就先放基本時間，再放一行「AI 檢查」（可直接在這裡執行）。
 */
import type { ReactNode } from 'react';
import { durationWord } from '@/domain/constants';
import { fmtMD, fromMinutes, toMinutes } from '@/domain/dates';
import { daySegments, haversineKm, segmentEstimate, type SegmentInfo } from '@/domain/schedule';
import type { Item, Trip } from '@/domain/types';
import { useDayCheck } from '@/features/ai/useDayCheck';
import { appleMapsNavigate, gmapsDirections, gmapsNavigate, gmapsTraffic, type TravelMode } from '@/services/links';
import { useActiveTrip } from '@/store/data';
import { Empty, Icon, ListGroup, ListRow, Note, Orb, Sheet, Spinner, type IconName } from '@/ui';
import { fmtKm, fmtMDWeek, modeIcon, segmentRoute, tightDetail, travelMinutes } from './model';
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
  // 起點沒有特定地點（起床）：從目前位置出發；終點沒有特定地點（休息）：不放地圖路線
  const route = segmentRoute(from, to);
  const routeUrl = (mode: TravelMode) =>
    route ? (route.origin ? gmapsDirections(route.origin, route.dest, mode) : gmapsNavigate(route.dest, mode)) : undefined;
  const travel = travelMinutes(seg);
  // 兩站在不同天（例如打開後改了日期）：時間差沒有意義，不算空檔也不警告
  const crossDay = !!from.date && !!to.date && from.date !== to.date;
  const tight = crossDay ? null : tightDetail(seg);
  const suggested = estimate ? ICON_MODE[modeIcon(estimate.mode)] : undefined;

  // 時間：上一站結束（開始＋停留）→ 下一站開始
  const startA = toMinutes(from.time),
    startB = toMinutes(to.time);
  const endA = startA != null ? startA + (from.durationMin ?? 0) : null;
  const gap = endA != null && startB != null && !crossDay ? startB - endA : null;
  const leaveBy = seg.leaveBy != null && seg.leaveBy >= 0 ? seg.leaveBy : null;

  const ride = from.type === 'transport';
  const leaveSub = from.durationMin
    ? `${durationWord(from.type)} ${from.durationMin} 分後`
    : from.time
      ? ride
        ? '沒填所需時間'
        : '沒填停留時間'
      : '時間未定';

  // 標題：兩行，第二行前面用小字「到」，避免和行程點名稱裡的箭頭混在一起
  const title = (
    <span className={s.segTitle}>
      <span className={s.segFrom}>{from.title}</span>
      <span className={s.segTo}>
        <span className={s.segToLabel}>到</span>
        <span>{to.title}</span>
      </span>
    </span>
  );

  const hero = estimate && (
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
  );

  // 還沒有估計：只放一行可以點的「AI 檢查」；兩站不在同一天就不放（下面的 Google 地圖就夠用）
  const askAI = !estimate && date && (
    <div className={s.askAI}>
      <ListGroup>
        <ListRow
          icon="spark"
          title={`AI 檢查 ${fmtMD(date)} 的行程`}
          subtitle={ai.busy ? '檢查中…' : '估計這天每段怎麼走、要多久'}
          end={ai.busy ? <Spinner /> : undefined}
          chevron={!ai.busy}
          onClick={() => void ai.run()}
        />
      </ListGroup>
      {ai.error && !ai.busy && <span className={`${s.err} ${s.askAIErr}`}>{ai.error}</span>}
    </div>
  );

  const tightNote = tight && (
    <Note tone="warn">
      <strong>時間可能不夠</strong>
      <span className="num">
        {from.durationMin
          ? ride
            ? `「${from.title}」需時 ${from.durationMin} 分，`
            : `在「${from.title}」停留 ${from.durationMin} 分，`
          : ''}
        {tight.leaveAt} 出發{travel ? `、移動約 ${travel} 分` : ''}，會在 {tight.arriveAt} 抵達，比預定的 {to.time} 晚 {tight.lateMin}{' '}
        分。可以提早出發或{ride ? '調整時間' : '縮短停留'}。
      </span>
    </Note>
  );

  const gapH = gap != null && gap >= 90 ? Math.floor(gap / 60) : null;
  const gapM = gap != null ? gap % 60 : 0;
  const facts = (
    <>
      {(endA != null || startB != null) && (
        <div className={s.stats}>
          <Stat label="離開" value={endA != null ? fromMinutes(endA) : '—'} sub={leaveSub} />
          <Stat
            label="空檔"
            value={
              gap == null ? (
                '—'
              ) : gapH != null ? (
                // 90 分以上寫成「4小時20分」，數字維持大字、單位用小字，才放得進格子
                <>
                  {gapH}
                  <span className={s.statUnit}>小時</span>
                  {gapM ? (
                    <>
                      {gapM}
                      <span className={s.statUnit}>分</span>
                    </>
                  ) : null}
                </>
              ) : (
                String(gap)
              )
            }
            unit={gap != null && gapH == null ? '分' : undefined}
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
    </>
  );

  return (
    <Sheet eyebrow={date ? `移動 · ${fmtMDWeek(date)}` : '移動'} title={title}>
      {/* 有 AI 估計：大字估計在最上面；沒有：先放基本時間，再放一行 AI 檢查 */}
      {estimate ? (
        <>
          {hero}
          {tightNote}
          {facts}
        </>
      ) : (
        <>
          {facts}
          {askAI}
          {tightNote}
        </>
      )}

      {route ? (
        <ListGroup title={route.origin ? '用 Google 地圖查路線' : '用 Google 地圖查路線（從目前位置出發）'}>
          {MODES.map((m) => (
            <ListRow
              key={m.mode}
              icon={m.icon}
              title={m.label}
              subtitle={m.sub}
              end={suggested === m.mode ? <span className={s.aiPill}>AI 建議</span> : undefined}
              href={routeUrl(m.mode)}
            />
          ))}
        </ListGroup>
      ) : (
        <Note tone="info">
          <span>「{to.title}」沒有特定地點，不需要導航。要導航的話，可以在這一站的「編輯 → 進階」填寫導航目的地。</span>
        </Note>
      )}

      <ListGroup title="其他">
        {route && <ListRow icon="map" title="Apple 地圖" subtitle={`從目前位置導航到「${to.title}」`} href={appleMapsNavigate(route.dest)} />}
        <ListRow icon="traffic" title="即時路況圖層" subtitle="看目前位置附近哪裡在塞車" href={gmapsTraffic} />
      </ListGroup>

      {estimate && <p className={s.tiny}>AI 估計，出發前以 Google 地圖即時路況為準</p>}
    </Sheet>
  );
}

function Stat({ label, value, unit, sub, warn }: { label: string; value: ReactNode; unit?: string; sub?: string; warn?: boolean }) {
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
