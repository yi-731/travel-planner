import { fmtMoney, type Transfer } from '@/domain/money';
import { useUI } from '@/store/ui';
import { Icon, ListRow } from '@/ui';
import s from './money.module.css';

/** 誰該給誰多少（記帳頁的結算卡與分帳明細頁共用） */
export function TransferList({ transfers, currency }: { transfers: Transfer[]; currency: string }) {
  if (!transfers.length)
    return (
      <div className={s.balanced}>
        <span className={s.balancedIcon}>
          <Icon name="check" size={14} stroke={2.6} />
        </span>
        帳目已平衡，不用互相轉帳
      </div>
    );
  return (
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
  );
}

/** 分帳結算（記帳頁摘要）：只放誰該給誰；每人已付／應分攤的表格收在「分帳結算」彈出頁 */
export function SettleCard({ transfers, currency }: { transfers: Transfer[]; currency: string }) {
  const openSheet = useUI((st) => st.openSheet);
  return (
    <section className={s.card} aria-labelledby="money-settle">
      <div className={s.cardHead}>
        <h2 id="money-settle" className={s.cardTitle}>
          分帳結算
        </h2>
        <span className={s.cardMeta}>以 {currency} 計</span>
      </div>

      <TransferList transfers={transfers} currency={currency} />

      <div className={s.cardFoot}>
        <ListRow icon="users" title="每人已付與分攤" onClick={() => openSheet({ name: 'settle' })} />
      </div>
    </section>
  );
}
