import { fmtMoney, type Transfer } from '@/domain/money';
import { Icon } from '@/ui';
import type { MemberRow } from './model';
import s from './money.module.css';

const signed = (n: number) => (Math.abs(n) < 0.5 ? '0' : `${n > 0 ? '+' : '−'}${fmtMoney(Math.abs(n))}`);

/** 分帳結算：誰該給誰多少，加上每人已付／應分攤 */
export function SettleCard({ transfers, rows, currency }: { transfers: Transfer[]; rows: MemberRow[]; currency: string }) {
  return (
    <section className={s.card} aria-labelledby="money-settle">
      <div className={s.cardHead}>
        <h2 id="money-settle" className={s.cardTitle}>
          分帳結算
        </h2>
        <span className={s.cardMeta}>以 {currency} 計</span>
      </div>

      {transfers.length ? (
        <ul className={s.transfers}>
          {transfers.map((t) => (
            <li key={`${t.from}>${t.to}`} className={s.transfer}>
              <span className={s.who}>{t.from}</span>
              <span className={s.toArrow} aria-label="要給">
                <Icon name="arrow" size={14} stroke={2.4} />
              </span>
              <span className={s.who}>{t.to}</span>
              <span className={s.transferAmt}>
                <span className="serif num">{fmtMoney(t.amount)}</span>
                <small>{currency}</small>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className={s.balanced}>
          <span className={s.balancedIcon}>
            <Icon name="check" size={14} stroke={2.6} />
          </span>
          帳目已平衡，不用互相轉帳
        </div>
      )}

      <table className={s.table}>
        <thead>
          <tr>
            <th scope="col">成員</th>
            <th scope="col">已付</th>
            <th scope="col">應分攤</th>
            <th scope="col">差額</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <th scope="row">{r.name}</th>
              <td className="num">{fmtMoney(r.paid)}</td>
              <td className="num">{fmtMoney(r.share)}</td>
              <td className={`num ${r.net > 0.5 ? s.pos : r.net < -0.5 ? s.neg : ''}`}>{signed(r.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
