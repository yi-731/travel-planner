import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { cssVar, expenseCategory } from '@/domain/constants';
import { expenseHome, fmtMoney } from '@/domain/money';
import type { Expense, ExpenseCategory, Trip } from '@/domain/types';
import { haptic } from '@/platform';
import { useUI } from '@/store/ui';
import { Icon, type IconName } from '@/ui';
import { dayNumber, fmtDayHead, type DayGroup } from './model';
import s from './money.module.css';

export const CATEGORY_ICON: Record<ExpenseCategory, IconName> = {
  food: 'food',
  transport: 'train',
  stay: 'home',
  ticket: 'star',
  shop: 'store',
  other: 'receipt',
};

/** 明細：依日期分組，點一筆開編輯 */
export function ExpenseList({ trip, groups }: { trip: Trip; groups: DayGroup[] }) {
  return (
    <div className={s.days}>
      {groups.map((g) => {
        const n = dayNumber(trip, g.date);
        return (
          <section key={g.date} className={s.day} aria-label={fmtDayHead(g.date)}>
            <div className={s.dayHead}>
              <span className={s.dayDate}>{fmtDayHead(g.date)}</span>
              {n != null && <span className={s.dayNum}>第 {n} 天</span>}
              <span className={`num ${s.daySum}`}>
                小計 {fmtMoney(g.total)} {trip.homeCurrency}
              </span>
            </div>
            <ul className={s.list}>
              <AnimatePresence initial={false}>
                {g.expenses.map((e) => (
                  <ExpenseRow key={e.id} trip={trip} e={e} />
                ))}
              </AnimatePresence>
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function ExpenseRow({ trip, e }: { trip: Trip; e: Expense }) {
  const reduce = useReducedMotion();
  const openSheet = useUI((st) => st.openSheet);
  const cat = expenseCategory(e.category);
  const foreign = e.currency !== trip.homeCurrency;
  const multi = trip.members.length > 1;
  const sub = [multi ? `${e.payer}付` : null, cat.label, e.split.length && multi ? `${e.split.length} 人分` : null].filter(Boolean).join(' · ');

  return (
    <motion.li
      className={s.item}
      initial={reduce ? false : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
      transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <button
        type="button"
        className={s.itemBtn}
        onClick={() => {
          void haptic('light');
          openSheet({ name: 'expenseForm', expenseId: e.id });
        }}
      >
        <span className={s.catTile} style={{ ['--c' as string]: cssVar(cat.color) }} aria-hidden>
          <Icon name={CATEGORY_ICON[e.category] ?? 'receipt'} size={18} />
        </span>
        <span className={s.itemText}>
          <span className={s.itemTitle}>
            <span className={s.itemTitleText}>{e.title || cat.label}</span>
            {e.receiptBlobKey && (
              <span className={s.clip} title="有收據照片">
                <Icon name="image" size={13} stroke={2.2} />
                <span className="sr-only">有收據照片</span>
              </span>
            )}
          </span>
          <span className={s.itemSub}>{sub}</span>
        </span>
        <span className={s.itemEnd}>
          <span className={`num ${s.itemAmt}`}>
            {fmtMoney(e.amount)}
            <small>{e.currency}</small>
          </span>
          {foreign && (
            <span className={`num ${s.itemConv}`}>
              ≈ {fmtMoney(expenseHome(trip, e))} {trip.homeCurrency}
            </span>
          )}
        </span>
      </button>
    </motion.li>
  );
}
