import { useEffect, useState } from 'react';
import { toISODate } from '@/domain/dates';

export interface Now {
  /** 今天 'YYYY-MM-DD' */
  date: string;
  /** 從午夜起算的分鐘數 */
  minutes: number;
}

const read = (): Now => {
  const d = new Date();
  return { date: toISODate(d), minutes: d.getHours() * 60 + d.getMinutes() };
};

/** 目前日期與時間；每 30 秒、以及 App 回到前景時更新，讓「下一站」自動往前走 */
export function useNow(): Now {
  const [now, setNow] = useState(read);
  useEffect(() => {
    const tick = () =>
      setNow((prev) => {
        const next = read();
        return next.date === prev.date && next.minutes === prev.minutes ? prev : next;
      });
    const id = window.setInterval(tick, 30_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return now;
}
