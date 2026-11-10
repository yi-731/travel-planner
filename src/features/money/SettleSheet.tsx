/**
 * 分帳結算（彈出頁）：誰該給誰多少，加上每人已付／應分攤／差額的表格。
 * 記帳頁的結算卡只放轉帳摘要，點「每人已付與分攤」才開這頁。
 */
import { useMemo } from 'react';
import { fmtMoney, settle } from '@/domain/money';
import { useActiveTrip } from '@/store/data';
import { Empty, Sheet } from '@/ui';
import { memberRows } from './model';
import { TransferList } from './SettleCard';
import s from './money.module.css';

const signed = (n: number) => (Math.abs(n) < 0.5 ? '0' : `${n > 0 ? '+' : '−'}${fmtMoney(Math.abs(n))}`);

export default function SettleSheet() {
  const trip = useActiveTrip();
  const transfers = useMemo(() => (trip ? settle(trip) : []), [trip]);
  const rows = useMemo(() => (trip ? memberRows(trip) : []), [trip]);

  if (!trip)
    return (
      <Sheet title="分帳結算">
        <Empty icon="wallet" title="還沒有旅程">
          先建立一趟旅程，才能開始記帳。
        </Empty>
      </Sheet>
    );

  const currency = trip.homeCurrency;
  return (
    <Sheet eyebrow={`以 ${currency} 計`} title="分帳結算">
      <TransferList transfers={transfers} currency={currency} />

      <section className={s.card} aria-labelledby="settle-table">
        <div className={s.cardHead}>
          <h2 id="settle-table" className={s.cardTitle}>
            每人已付與分攤
          </h2>
        </div>
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

      <p className={s.hint}>差額＝已付減應分攤：正數是別人要還他，負數是他還要再付。</p>
    </Sheet>
  );
}
