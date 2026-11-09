/**
 * 記帳分頁：總覽卡（總花費／預算／今日・日均・剩餘）、記一筆／拍收據、分類、分帳結算、明細。
 * 數字整理在 ./model.ts（有測試）；各區塊拆成獨立元件，方便日後調整。
 */
import { useMemo } from 'react';
import { settle } from '@/domain/money';
import type { Trip } from '@/domain/types';
import { fxSearch } from '@/services/links';
import { useActiveTrip } from '@/store/data';
import { useUI } from '@/store/ui';
import { Button, Empty, LinkButton, PageHead, Spinner } from '@/ui';
import { BankCard } from './BankCard';
import { CategoryCard } from './CategoryCard';
import { ExpenseList } from './ExpenseList';
import { categorySlices, groupByDate, memberRows, rateLine, summarize } from './model';
import { SettleCard } from './SettleCard';
import { useReceiptScan } from './useReceiptScan';
import s from './money.module.css';

export default function MoneyView() {
  const trip = useActiveTrip();
  if (!trip)
    return (
      <Empty icon="wallet" title="還沒有旅程">
        先建立一趟旅程，才能開始記帳。
      </Empty>
    );
  return <Money trip={trip} />;
}

function Money({ trip }: { trip: Trip }) {
  const openSheet = useUI((st) => st.openSheet);
  const { scan, busy } = useReceiptScan(trip.id);

  const sum = useMemo(() => summarize(trip), [trip]);
  const slices = useMemo(() => categorySlices(trip), [trip]);
  const groups = useMemo(() => groupByDate(trip), [trip]);
  const multi = trip.members.length > 1;
  const transfers = useMemo(() => (multi ? settle(trip) : []), [trip, multi]);
  const rows = useMemo(() => (multi ? memberRows(trip) : []), [trip, multi]);
  const foreign = trip.localCurrency !== trip.homeCurrency;
  const count = trip.expenses.length;

  return (
    <div className={s.money}>
      <PageHead
        eyebrow={<span className="num">{rateLine(trip)}</span>}
        title="記帳"
        end={
          foreign ? (
            <LinkButton variant="ghost" icon="exchange" href={fxSearch(trip.localCurrency, trip.homeCurrency)} className={s.fxLink}>
              即時匯率
            </LinkButton>
          ) : undefined
        }
      />

      <BankCard trip={trip} sum={sum} />

      <div className={s.actions}>
        <Button variant="go" icon="plus" block className={s.addBtn} onClick={() => openSheet({ name: 'expenseForm' })}>
          記一筆
        </Button>
        <Button variant="ghost" icon={busy ? undefined : 'camera'} onClick={() => void scan()} disabled={busy} aria-busy={busy} className={s.scanBtn}>
          {busy ? (
            <>
              <span className={s.scanSpin}>
                <Spinner />
              </span>
              辨識中…
            </>
          ) : (
            '拍收據'
          )}
        </Button>
      </div>

      {count === 0 ? (
        <div className={s.card}>
          <Empty icon="receipt" title="還沒有任何花費">
            記下每一筆，會自動換算成 {trip.homeCurrency}
            {multi ? '，也幫你算好誰該給誰多少' : ''}。拍收據可以讓 AI 幫你填金額。
          </Empty>
        </div>
      ) : (
        <>
          <CategoryCard slices={slices} currency={trip.homeCurrency} />
          {multi && <SettleCard transfers={transfers} rows={rows} currency={trip.homeCurrency} />}
          <section className={s.section} aria-labelledby="money-list">
            <div className={s.secHead}>
              <h2 id="money-list" className={s.secTitle}>
                明細
              </h2>
              <span className={`num ${s.cardMeta}`}>{count} 筆</span>
            </div>
            <ExpenseList trip={trip} groups={groups} />
          </section>
        </>
      )}
    </div>
  );
}
