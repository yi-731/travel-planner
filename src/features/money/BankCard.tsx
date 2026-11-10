import type { CSSProperties } from 'react';
import { fmtMoney } from '@/domain/money';
import type { Trip } from '@/domain/types';
import { useUI } from '@/store/ui';
import { Icon, Orb } from '@/ui';
import type { MoneySummary } from './model';
import s from './money.module.css';

/** 記帳總覽卡：夜色底＋右上日落光球、總花費大字、預算進度、今日／日均／剩餘（出發前改成距出發／每天可花／剩餘） */
export function BankCard({ trip, sum }: { trip: Trip; sum: MoneySummary }) {
  const openSheet = useUI((st) => st.openSheet);
  const total = fmtMoney(sum.total);
  const pct = sum.used != null ? Math.round(sum.used * 100) : null;
  const hue = trip.cover.hue ?? 0;

  return (
    <section className={s.bank} aria-label="總花費">
      <Orb size={260} halo hue={hue} style={{ right: -120, top: -130 }} />
      <Orb size={176} hue={hue} style={{ right: -62, top: -72 }} />

      <div className={s.bankTop}>
        <span className={s.bankEyebrow}>總花費</span>
        <div className={s.bankTotal} style={{ '--len': total.length } as CSSProperties}>
          <span className="serif num">{total}</span>
          <span className={s.bankCur}>{trip.homeCurrency}</span>
        </div>
      </div>

      {sum.budget != null ? (
        <div className={s.budget}>
          <div
            className={`${s.bar} ${sum.over ? s.barOver : ''}`}
            role="progressbar"
            aria-label="預算使用比例"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, pct ?? 0)}
          >
            <span style={{ width: `${Math.min(100, Math.max(sum.total > 0 ? 2 : 0, pct ?? 0))}%` }} />
          </div>
          <div className={s.budgetRow}>
            <span>
              已用 <b className="num">{pct}%</b>
            </span>
            <span className="num">
              預算 {fmtMoney(sum.budget)} {trip.homeCurrency}
            </span>
          </div>
        </div>
      ) : (
        <button type="button" className={s.setBudget} onClick={() => openSheet({ name: 'tripSettings' })}>
          <Icon name="plus" size={14} stroke={2.4} />
          設定預算，隨時看還剩多少
        </button>
      )}

      <dl className={s.stats}>
        {sum.phase === 'before' ? (
          // 出發前：今日一定是 0、日均被預付的機票飯店撐大，改顯示距出發與每天可花
          <>
            <div>
              <dt>距出發</dt>
              <dd className="serif num">
                {sum.daysUntil}
                <small className={s.statUnit}>天</small>
              </dd>
            </div>
            {sum.perDayLeft != null ? (
              <div>
                <dt>每天可花</dt>
                <dd className="serif num">{fmtMoney(sum.perDayLeft)}</dd>
              </div>
            ) : (
              <div>
                <dt>行程</dt>
                <dd className="serif num">
                  {sum.tripDays}
                  <small className={s.statUnit}>天</small>
                </dd>
              </div>
            )}
          </>
        ) : (
          <>
            <div>
              <dt>今日</dt>
              <dd className="serif num">{fmtMoney(sum.today)}</dd>
            </div>
            <div>
              <dt>日均</dt>
              <dd className="serif num">{fmtMoney(sum.dailyAvg)}</dd>
            </div>
          </>
        )}
        <div>
          <dt>{sum.over ? '超支' : '剩餘'}</dt>
          <dd className={`serif num ${sum.over ? s.statBad : ''}`}>{sum.remaining != null ? fmtMoney(Math.abs(sum.remaining)) : '—'}</dd>
        </div>
      </dl>
    </section>
  );
}
