/**
 * 「還能去哪裡」彈出頁：挑一天＋輸入需求 → AI 推薦 5 個順路的真實地點 → 一鍵加入當天行程。
 * 狀態放在 ./recommendStore（關掉再打開結果還在）。
 */
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { itemType } from '@/domain/constants';
import { fmtMD, fmtMDW, tripDays, tripPhase } from '@/domain/dates';
import { itemsOfDay } from '@/domain/schedule';
import type { ISODate, Trip } from '@/domain/types';
import { haptic } from '@/platform';
import type { Recommendation } from '@/services/ai';
import { gmapsSearch, socialLinks } from '@/services/links';
import { useActiveTrip, useData } from '@/store/data';
import { useUI } from '@/store/ui';
import { Button, Chip, Empty, Icon, Note, Orb, Picker, Select, Sheet, Spinner, TextInput } from '@/ui';
import { AiKeyNotice } from './AiKeyNotice';
import { cancelRecommend, EMPTY_SESSION, markAdded, patchSession, recKey, runRecommend, useRecommend } from './recommendStore';
import s from './ai.module.css';

const QUICK = ['在地美食', '雨天備案', '夜景', '咖啡廳', '伴手禮', '親子', '小眾景點'] as const;

export default function RecommendSheet({ date }: { date?: ISODate }) {
  const trip = useActiveTrip();
  if (!trip)
    return (
      <Sheet title="還能去哪裡" eyebrow="AI 推薦">
        <Empty icon="map" title="還沒有旅程">先建立一趟旅程，AI 才知道要推薦哪裡。</Empty>
      </Sheet>
    );
  return <RecommendBody trip={trip} initialDate={date} />;
}

function RecommendBody({ trip, initialDate }: { trip: Trip; initialDate?: ISODate }) {
  const session = useRecommend((st) => st.sessions[trip.id]) ?? EMPTY_SESSION;
  const selectedDate = useUI((st) => st.selectedDate);
  const days = useMemo(() => tripDays(trip), [trip]);
  const dayNo = (d: ISODate | null) => (d ? days.indexOf(d) + 1 : 0);

  // 從某一天打開時，切到那一天（結果保留，標題會寫結果是哪一天的）
  useLayoutEffect(() => {
    if (initialDate && days.includes(initialDate)) patchSession(trip.id, { date: initialDate });
    // 只在打開（或換成別天打開）時套用，之後由使用者自己選
  }, [trip.id, initialDate]);

  const pick = (d: ISODate | null | undefined) => (d && days.includes(d) ? d : null);
  const formDate = pick(session.date) ?? pick(initialDate) ?? pick(selectedDate) ?? pick(tripPhase(trip).focusDay) ?? days[0] ?? null;
  const loading = session.status === 'loading';
  const sameAsResults = session.status === 'done' && session.forDate === formDate && session.forQuery === session.query.trim();

  const city = (trip.city || trip.cityGeo?.label || '').trim().toUpperCase();
  const run = () => void runRecommend(trip.id, formDate, session.query);

  const footer = loading ? (
    <div className={s.footRow}>
      <Button variant="go" block disabled icon="spark" className={s.footGo}>
        <span className={s.busyLabel}>
          <Spinner /> 推薦中…
        </span>
      </Button>
      <Button variant="ghost" onClick={() => cancelRecommend(trip.id)}>
        取消
      </Button>
    </div>
  ) : (
    <Button variant="go" block icon="spark" onClick={run}>
      {session.status === 'error' ? '再試一次' : sameAsResults ? '換一批推薦' : '開始推薦'}
    </Button>
  );

  return (
    <Sheet title="還能去哪裡" eyebrow={`AI 推薦${city ? ` · ${city}` : ''}`} footer={footer}>
      <AiKeyNotice feature="AI 推薦" />

      <form
        className={s.form}
        onSubmit={(e) => {
          e.preventDefault();
          (document.activeElement as HTMLElement | null)?.blur();
          if (!loading) run();
        }}
      >
        {days.length > 0 && (
          <Select label="哪一天" value={formDate ?? ''} onChange={(e) => patchSession(trip.id, { date: e.target.value })}>
            {days.map((d, i) => (
              <option key={d} value={d}>
                {`Day ${i + 1} · ${fmtMD(d)} · ${itemsOfDay(trip, d)[0]?.title ?? '尚無行程'}`}
              </option>
            ))}
          </Select>
        )}
        <TextInput
          label="想找什麼"
          placeholder="例如：清水寺附近的抹茶甜點"
          value={session.query}
          enterKeyHint="search"
          autoComplete="off"
          maxLength={120}
          onChange={(e) => patchSession(trip.id, { query: e.target.value })}
        />
        <Picker
          ariaLabel="常用主題"
          options={QUICK.map((k) => ({ key: k, label: k }))}
          value={(QUICK as readonly string[]).includes(session.query.trim()) ? (session.query.trim() as (typeof QUICK)[number]) : null}
          onChange={(k) => {
            const v = Array.isArray(k) ? k[0] ?? '' : k;
            patchSession(trip.id, { query: session.query.trim() === v ? '' : v });
          }}
        />
      </form>

      {loading ? (
        <Loading dayNo={dayNo(session.pending?.date ?? null)} query={session.pending?.query ?? ''} />
      ) : session.status === 'error' && session.error ? (
        <Note tone="bad">
          <strong>這次沒有推薦成功</strong>
          <span>{session.error}</span>
        </Note>
      ) : null}

      {!loading && session.results.length > 0 ? (
        <Results trip={trip} days={days} />
      ) : !loading && session.status !== 'error' ? (
        <Intro dayNo={dayNo(formDate)} />
      ) : null}
    </Sheet>
  );
}

function Intro({ dayNo }: { dayNo: number }) {
  return (
    <div className={s.intro}>
      <Orb size={124} className={s.introOrb} />
      <div className={s.introGlass}>
        <span className={`serif num ${s.bigNum}`}>5</span>
        <div className={s.introText}>
          <strong>個順路去處</strong>
          <span>
            AI 會依{dayNo ? ` Day ${dayNo} ` : '這趟旅程'}的行程和你的需求挑選真實地點，附上原文名稱，方便直接查 Google 評價。
          </span>
        </div>
      </div>
    </div>
  );
}

function Loading({ dayNo, query }: { dayNo: number; query: string }) {
  return (
    <div className={s.loading} aria-live="polite">
      <p className={s.loadingText}>
        正在找{dayNo ? ` Day ${dayNo} ` : ''}附近的{query ? `「${query}」` : '順路去處'}，通常不到一分鐘
      </p>
      {[0, 1, 2].map((i) => (
        <div key={i} className={s.skeleton} aria-hidden>
          <span className={s.skLine} style={{ width: '32%' }} />
          <span className={s.skLine} style={{ width: '64%', height: 18 }} />
          <span className={s.skLine} style={{ width: '92%' }} />
          <span className={s.skLine} style={{ width: '78%' }} />
        </div>
      ))}
    </div>
  );
}

function Results({ trip, days }: { trip: Trip; days: ISODate[] }) {
  const session = useRecommend((st) => st.sessions[trip.id]) ?? EMPTY_SESSION;
  const reduce = useReducedMotion();
  const d = session.forDate;
  const n = d ? days.indexOf(d) + 1 : 0;
  const sub = [n ? `Day ${n}` : null, d ? fmtMDW(d) : null, session.forQuery || null].filter(Boolean).join(' · ');

  // 剛推薦完：捲到結果開頭（重新打開彈出頁時不捲）
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!session.fresh) return;
    patchSession(trip.id, { fresh: false });
    ref.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }, [session.fresh, trip.id, reduce]);

  return (
    <section ref={ref} className={s.results} aria-label="推薦結果">
      <header className={s.resHead}>
        <span className={`serif num ${s.bigNum}`}>{session.results.length}</span>
        <div className={s.introText}>
          <strong>個順路去處</strong>
          {sub && <span>{sub}</span>}
        </div>
      </header>
      {session.results.map((r, i) => (
        <motion.div
          key={recKey(d, r)}
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduce ? 0.01 : 0.32, delay: reduce ? 0 : i * 0.05, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <RecCard trip={trip} r={r} index={i} date={d} dayNo={n} />
        </motion.div>
      ))}
      <p className={s.disclaimer}>
        <Icon name="info" size={14} />
        <span>AI 依一般知識推薦，評分與營業時間請點 Google 確認</span>
      </p>
    </section>
  );
}

function RecCard({ trip, r, index, date, dayNo }: { trip: Trip; r: Recommendation; index: number; date: ISODate | null; dayNo: number }) {
  const key = recKey(date, r);
  const addedId = useRecommend((st) => st.sessions[trip.id]?.added[key]);
  const stillThere = useData((st) => !!addedId && !!st.trips[trip.id]?.items.some((it) => it.id === addedId));
  const openSheet = useUI((st) => st.openSheet);
  const t = itemType(r.type);
  const cityLabel = trip.cityGeo?.label?.trim() || trip.city.trim();
  const showOrig = r.name && r.name !== r.nameZh;

  const links = useMemo(() => {
    const zh = socialLinks(cityLabel, { title: r.nameZh || r.name, type: r.type });
    const orig = socialLinks('', { title: r.name, type: r.type });
    return [
      { label: 'Google 星等', url: gmapsSearch(`${r.name} ${cityLabel}`.trim()), color: '#4285F4', icon: true },
      { label: '小紅書', url: zh.find((l) => l.label === '小紅書')?.url ?? '', color: '#FF2442', icon: false },
      { label: 'Instagram', url: orig.find((l) => l.label === 'Instagram')?.url ?? '', color: '#E1306C', icon: false },
    ].filter((l) => l.url);
  }, [cityLabel, r.name, r.nameZh, r.type]);

  const add = () => {
    const title = r.nameZh || r.name;
    const id = useData.getState().upsertItem(trip.id, { title, address: r.name, type: r.type, note: r.why, date });
    markAdded(trip.id, key, id);
    void haptic('success');
    useUI.getState().toast(dayNo ? `已加入 Day ${dayNo}：${title}` : `已加入行程：${title}`, 'good');
  };

  return (
    <article className={s.card}>
      <div className={s.cardHead}>
        <span className={`serif num ${s.idx}`}>{String(index + 1).padStart(2, '0')}</span>
        <Chip color={t.color}>{t.label}</Chip>
        <span className="spacer" />
        {addedId && stillThere ? (
          <button type="button" className={s.addedBtn} onClick={() => openSheet({ name: 'place', itemId: addedId })}>
            <Icon name="check" size={15} stroke={2.6} />
            已加入 · 查看
          </button>
        ) : (
          <Button variant="ghost" size="sm" icon="plus" className={s.addBtn} onClick={add}>
            {dayNo ? `加入 Day ${dayNo}` : '加入行程'}
          </Button>
        )}
      </div>

      <div className={s.names}>
        <h3 className={s.name}>{r.nameZh || r.name}</h3>
        {showOrig && <p className={s.orig}>{r.name}</p>}
      </div>
      {r.why && <p className={s.why}>{r.why}</p>}

      {(r.bestTime || r.price) && (
        <div className={s.meta}>
          {r.bestTime && (
            <span>
              <Icon name="clock" size={14} />
              {r.bestTime}
            </span>
          )}
          {r.price && (
            <span className="num">
              <Icon name="wallet" size={14} />
              {r.price}
            </span>
          )}
        </div>
      )}

      <nav className={s.links} aria-label={`查看 ${r.nameZh || r.name} 的評價`}>
        {links.map((l) => (
          <a key={l.label} href={l.url} target="_blank" rel="noopener noreferrer" className={s.link} onClick={() => void haptic('light')}>
            {l.icon ? <Icon name="star" size={13} stroke={2.2} className={s.star} /> : <span className={s.dot} style={{ background: l.color }} />}
            {l.label}
          </a>
        ))}
      </nav>
    </article>
  );
}
