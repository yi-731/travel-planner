/**
 * 行程時間軸：卡片（時間、名稱、分類、必做／可省略、停留／需時、費用、評分、完成勾勾）＋卡片之間的移動資訊。
 * 卡片最多兩行小字：一排分類資訊，再一行路線／交通說明（「LAX → LAS · Uber 30 分」）。
 * 點卡片開地點頁；點移動那一行開「移動」彈出頁。
 */
import { AnimatePresence, motion } from 'motion/react';
import { Fragment, useState } from 'react';
import { cssVar, durationWord, itemType } from '@/domain/constants';
import type { SegmentInfo } from '@/domain/schedule';
import type { Item } from '@/domain/types';
import { haptic } from '@/platform';
import { useData } from '@/store/data';
import { useUI } from '@/store/ui';
import { Chip, Icon } from '@/ui';
import { cardInfo, fmtLocal, segmentLine } from './model';
import s from './plan.module.css';

const EASE = [0.2, 0.8, 0.2, 1] as const;

export function Timeline({
  tripId,
  items,
  segs,
  currency,
  reduce,
  stagger = !reduce,
}: {
  tripId: string;
  items: Item[];
  segs: SegmentInfo[];
  currency: string;
  /** 系統「減少動態效果」：關掉所有動畫 */
  reduce: boolean;
  /** 卡片逐張浮現（只在掛上時有作用；換天滑入時關掉） */
  stagger?: boolean;
}) {
  const rise = !reduce && stagger;
  return (
    <ol className={s.timeline} aria-label="當天行程">
      {items.map((it, i) => {
        const seg = i > 0 ? (segs.find((sg) => sg.to.id === it.id) ?? null) : null;
        return (
          <Fragment key={it.id}>
            {seg && (
              <li className={s.connItem}>
                <Connector seg={seg} />
              </li>
            )}
            <motion.li
              className={s.cardItem}
              initial={rise ? { opacity: 0, y: 10 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.32, delay: rise ? Math.min(i, 8) * 0.035 : 0, ease: EASE }}
            >
              <ItemCard tripId={tripId} it={it} currency={currency} reduce={reduce} />
            </motion.li>
          </Fragment>
        );
      })}
    </ol>
  );
}

function ItemCard({ tripId, it, currency, reduce }: { tripId: string; it: Item; currency: string; reduce: boolean }) {
  const openSheet = useUI((st) => st.openSheet);
  const type = itemType(it.type);
  const info = cardInfo(it);
  const hasRating = typeof it.rating === 'number' && Number.isFinite(it.rating);
  const hasCost = typeof it.cost === 'number' && Number.isFinite(it.cost);
  return (
    <div className={`${s.card} ${it.done ? s.isDone : ''}`} style={{ ['--c' as string]: cssVar(type.color) }}>
      <button
        type="button"
        className={s.cardMain}
        onClick={() => {
          void haptic('light');
          openSheet({ name: 'place', itemId: it.id });
        }}
      >
        {it.time ? <span className={`serif num ${s.time}`}>{it.time}</span> : <span className={s.noTime}>時間未定</span>}
        <span className={s.cardBody}>
          <span className={s.cardTitle}>
            {it.title}
            {it.done && <span className="sr-only">，已完成</span>}
          </span>
          <span className={s.meta}>
            <span className={s.parts}>
              <span>
                <Chip color={type.color}>{info.tag}</Chip>
              </span>
              {info.flag === 'must' && (
                <span className={s.must}>
                  <b aria-hidden>★</b>必做
                </span>
              )}
              {info.flag === 'optional' && (
                <span>
                  <i className={s.optional}>可省略</i>
                </span>
              )}
              {it.durationMin ? (
                <span className="num">
                  {durationWord(it.type)} {it.durationMin} 分
                </span>
              ) : null}
              {hasCost ? <span className="num">{it.cost === 0 ? '免費' : fmtLocal(it.cost as number, currency)}</span> : null}
              {hasRating ? (
                <span className={`num ${s.rating}`}>
                  <b aria-hidden>★</b>
                  <span className="sr-only">評分</span> {it.rating}
                </span>
              ) : null}
            </span>
            {info.line && <span className={`num ${s.cardLine}`}>{info.line}</span>}
          </span>
        </span>
      </button>
      <CheckToggle tripId={tripId} it={it} reduce={reduce} />
    </div>
  );
}

/** 圓形完成勾勾：勾起來時填色、畫勾、外圈擴散一下 */
function CheckToggle({ tripId, it, reduce }: { tripId: string; it: Item; reduce: boolean }) {
  const toggleDone = useData((st) => st.toggleDone);
  // 只有使用者剛按下時才播放擴散，打開頁面時已完成的不播
  const [pulse, setPulse] = useState(0);
  return (
    <button
      type="button"
      className={s.check}
      aria-pressed={it.done}
      aria-label={it.done ? `「${it.title}」改回未完成` : `完成「${it.title}」`}
      onClick={() => {
        if (!it.done) {
          void haptic('success');
          setPulse((n) => n + 1);
        } else void haptic('light');
        toggleDone(tripId, it.id);
      }}
    >
      <motion.span
        className={s.ring}
        initial={false}
        animate={reduce ? undefined : it.done ? { scale: [1, 0.82, 1.12, 1] } : { scale: 1 }}
        transition={{ duration: 0.42, ease: EASE }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <motion.path
            d="M5.5 12.5l4.2 4.2 8.8-9.4"
            stroke="currentColor"
            strokeWidth={2.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={false}
            animate={{ pathLength: it.done ? 1 : 0, opacity: it.done ? 1 : 0 }}
            transition={{ duration: reduce ? 0 : 0.32, delay: it.done && !reduce ? 0.08 : 0, ease: EASE }}
          />
        </svg>
        <AnimatePresence>
          {pulse > 0 && it.done && !reduce && (
            <motion.span
              key={pulse}
              className={s.burst}
              initial={{ scale: 0.8, opacity: 0.55 }}
              animate={{ scale: 1.9, opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.55, ease: 'easeOut' }}
            />
          )}
        </AnimatePresence>
      </motion.span>
    </button>
  );
}

function Connector({ seg }: { seg: SegmentInfo }) {
  const openSheet = useUI((st) => st.openSheet);
  const line = segmentLine(seg);
  const warn = !!line.warn;
  return (
    <button
      type="button"
      className={`${s.conn} ${warn ? s.connWarn : ''}`}
      aria-label={`從「${seg.from.title}」到「${seg.to.title}」：${[line.text, line.warn, line.leave].filter(Boolean).join('，')}`}
      onClick={() => {
        void haptic('light');
        openSheet({ name: 'segment', fromId: seg.from.id, toId: seg.to.id });
      }}
    >
      <span className={s.rail} aria-hidden>
        <span className={s.mode}>
          <Icon name={warn ? 'warning' : line.icon} size={14} stroke={2.1} />
        </span>
      </span>
      <span className={s.connText} aria-hidden>
        <span className={s.parts}>
          <span className={`num ${line.hint ? s.connHint : ''}`}>{line.text}</span>
          {line.warn && <span className={s.connWarnText}>{line.warn}</span>}
          {line.leave && <span className="num">{line.leave}</span>}
        </span>
      </span>
      <span className={s.connChev} aria-hidden>
        <Icon name="chevron" size={14} stroke={2.2} />
      </span>
    </button>
  );
}
