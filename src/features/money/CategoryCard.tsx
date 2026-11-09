import { cssVar } from '@/domain/constants';
import { fmtMoney } from '@/domain/money';
import type { CategorySlice } from './model';
import s from './money.module.css';

/** 各分類花費：一條比例長條＋圖例 */
export function CategoryCard({ slices, currency }: { slices: CategorySlice[]; currency: string }) {
  if (!slices.length) return null;
  return (
    <section className={s.card} aria-labelledby="money-cat">
      <div className={s.cardHead}>
        <h2 id="money-cat" className={s.cardTitle}>
          分類
        </h2>
        <span className={s.cardMeta}>以 {currency} 計</span>
      </div>
      <div className={s.stack} aria-hidden>
        {slices.map((c) => (
          <span key={c.key} style={{ flexGrow: c.share, background: cssVar(c.color) }} />
        ))}
      </div>
      <ul className={s.legend}>
        {slices.map((c) => (
          <li key={c.key} className={s.legendRow}>
            <span className={s.legendDot} style={{ background: cssVar(c.color) }} />
            <span className={s.legendLabel}>{c.label}</span>
            <span className={`num ${s.legendAmt}`}>{fmtMoney(c.total)}</span>
            <span className={`num ${s.legendPct}`}>{c.pct}%</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
