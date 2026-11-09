import { useEffect, useRef } from 'react';
import { fmtMD, today, weekday } from '@/domain/dates';
import type { ISODate } from '@/domain/types';
import { haptic } from '@/platform';
import s from './dayStrip.module.css';

/** 橫向日期膠囊列（行程、地圖分頁共用）。選中的會自動捲到可見位置。 */
export function DayStrip({ days, value, onChange }: { days: ISODate[]; value: ISODate | null; onChange: (d: ISODate) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [value]);
  const t = today();
  return (
    <div className={s.strip} ref={ref} role="toolbar" aria-label="選擇日期">
      {days.map((d, i) => (
        <button
          key={d}
          type="button"
          className={`${s.day} ${d === t ? s.today : ''}`}
          aria-pressed={d === value}
          onClick={() => {
            void haptic('selection');
            onChange(d);
          }}
        >
          <small>DAY {i + 1}</small>
          <b className="num">{fmtMD(d)}</b>
          <span>週{weekday(d)}</span>
        </button>
      ))}
    </div>
  );
}
