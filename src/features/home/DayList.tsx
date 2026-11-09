import { motion, useReducedMotion } from 'motion/react';
import { cssVar, itemType } from '@/domain/constants';
import type { Item } from '@/domain/types';
import { haptic } from '@/platform';
import { useUI } from '@/store/ui';
import { Icon } from '@/ui';
import s from './home.module.css';

/** 首頁最多列幾站，其餘收成「還有 N 站」 */
export const MAX_ROWS = 6;

interface Props {
  title: string;
  items: Item[];
  /** 主卡正在顯示的那一站（時間用主色標出） */
  nextId?: string;
  /** 「全部」與「還有 N 站」：切到行程分頁並選這一天 */
  onShowAll: () => void;
}

/** 精簡版當日行程：時間、類型色點、名稱。完成的劃線變淡，點一下開地點頁 */
export function DayList({ title, items, nextId, onShowAll }: Props) {
  const openSheet = useUI((st) => st.openSheet);
  const reduce = useReducedMotion();
  const shown = items.slice(0, MAX_ROWS);
  const rest = items.length - shown.length;

  return (
    <section className={s.section} aria-label={title}>
      <div className={s.secHead}>
        <h2 className={s.secTitle}>{title}</h2>
        <button
          type="button"
          className={s.secLink}
          onClick={() => {
            void haptic('light');
            onShowAll();
          }}
        >
          全部
          <Icon name="chevron" size={14} stroke={2.4} />
        </button>
      </div>
      <div className={s.list}>
        {shown.map((it, i) => {
          const type = itemType(it.type);
          const isNext = it.id === nextId;
          return (
            <motion.button
              key={it.id}
              type="button"
              className={`${s.row} ${it.done ? s.isDone : ''} ${isNext ? s.isNext : ''}`}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: reduce ? 0 : 0.18 + i * 0.035, ease: [0.2, 0.8, 0.2, 1] }}
              onClick={() => {
                void haptic('light');
                openSheet({ name: 'place', itemId: it.id });
              }}
            >
              <span className={s.rowTime}>{it.time ?? '—'}</span>
              <span className={s.dot} style={{ ['--c' as string]: cssVar(type.color) }} aria-hidden />
              <span className={s.rowTitle}>
                {it.title}
                <span className="sr-only">
                  {`，${type.label}`}
                  {it.done ? '，已完成' : isNext ? '，下一站' : ''}
                </span>
              </span>
              <span className={s.chev}>
                {it.done ? <Icon name="check" size={15} stroke={2.4} /> : <Icon name="chevron" size={15} stroke={2.2} />}
              </span>
            </motion.button>
          );
        })}
        {rest > 0 && (
          <button
            type="button"
            className={`${s.row} ${s.moreRow}`}
            onClick={() => {
              void haptic('light');
              onShowAll();
            }}
          >
            <span />
            <span />
            <span className={s.rowTitle}>還有 {rest} 站</span>
            <span className={s.chev}>
              <Icon name="chevron" size={15} stroke={2.2} />
            </span>
          </button>
        )}
      </div>
    </section>
  );
}
