/**
 * 「這一天」彈出頁（行程分頁日期列下方那一行點進來）：
 * 試算表日期列的原文 → 城市、住宿（可修改）→ 這天的天氣。
 * 改了城市：這天標成手動（不會再被自動辨識蓋掉）、清掉舊座標重新定位，並重新辨識整趟的導航目的地
 * （手動設定過的導航目的地不受影響）。規則在 ./model.ts（editDayMeta、cityFeedback），有測試。
 */
import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { tripDays } from '@/domain/dates';
import type { DayMeta, ISODate, Trip } from '@/domain/types';
import { haptic } from '@/platform';
import { useTripWeather } from '@/services/hooks';
import { applyRulePlaces, dayMetaFor } from '@/services/places';
import { weatherInfo } from '@/services/weather';
import { useActiveTrip, useData } from '@/store/data';
import { useUI } from '@/store/ui';
import { Button, Empty, ListGroup, ListRow, Sheet, TextInput, type IconName } from '@/ui';
import { cityFeedback, dayOptionLabel, dropStaleGeo, editDayMeta, fmtMDWeek } from './model';
import s from './plan.module.css';

function attempt<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

const SOURCE_TEXT: Record<NonNullable<DayMeta['source']>, string> = {
  rule: '自動辨識',
  ai: 'AI 判斷',
  manual: '手動設定',
};

export default function DayInfoSheet({ date }: { date: ISODate }) {
  const trip = useActiveTrip();
  if (!trip)
    return (
      <Sheet title="這一天">
        <Empty icon="calendar" title="還沒有旅程">
          先建立一趟旅程，才能設定每天的城市。
        </Empty>
      </Sheet>
    );
  return <DayInfo trip={trip} date={date} />;
}

function DayInfo({ trip, date }: { trip: Trip; date: ISODate }) {
  const ui = useUI;
  const openSheet = useUI((st) => st.openSheet);
  const mutateTrip = useData((st) => st.mutateTrip);
  const weather = useTripWeather(trip);
  const days = tripDays(trip);

  const own = trip.days?.[date];
  const shown = attempt(() => dayMetaFor(trip, date), own);
  // 打開時的值（之後背景定位寫回座標也不會洗掉正在輸入的內容）
  const [initial] = useState(() => ({ city: shown?.city?.trim() ?? '', lodging: shown?.lodging?.trim() ?? '' }));
  const [city, setCity] = useState(initial.city);
  const [lodging, setLodging] = useState(initial.lodging);
  const [askDiscard, setAskDiscard] = useState(false);

  const dirty = city.trim() !== initial.city || lodging.trim() !== initial.lodging;
  const fb = cityFeedback(city, shown);
  const label = (own?.label ?? shown?.label ?? '').trim();
  const source = own?.source && (own.city || own.lodging || own.geo) ? own.source : undefined;
  const wx = attempt(() => weather.forDate(date), undefined);

  const close = () => {
    if (dirty && !askDiscard) {
      void haptic('warning');
      setAskDiscard(true);
      return;
    }
    ui.getState().closeSheet();
  };

  const save = () => {
    const next = editDayMeta(own, shown, { city, lodging });
    const st = ui.getState();
    if (!next) {
      st.closeSheet();
      return;
    }
    const cityChanged = (next.city ?? '') !== (shown?.city?.trim() ?? '');
    mutateTrip(trip.id, (d) => {
      d.days = { ...(d.days ?? {}), [date]: next };
      // 依新的城市重新辨識每一站的導航目的地；地點辨識出錯時至少保留使用者改的城市與住宿
      try {
        const before = d.items;
        const r = applyRulePlaces(d);
        Object.assign(d, r, { items: dropStaleGeo(before, r.items) });
      } catch (e) {
        console.warn('[travel-planner] 重新辨識地點失敗', e);
      }
    });
    void haptic('success');
    st.toast(cityChanged ? '已儲存，這天的天氣和導航會依新城市更新' : '已儲存', 'good');
    st.closeSheet();
  };

  // 鍵盤上的「完成」只收起鍵盤，不直接儲存
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    (document.activeElement as HTMLElement | null)?.blur();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
      e.preventDefault();
      e.target.blur();
    }
  };

  const footer = askDiscard ? (
    <div className={s.discard}>
      <div className={s.discardText}>還沒儲存，要放棄這些變更嗎？</div>
      <div className={s.footSplit}>
        <Button variant="ghost" onClick={() => setAskDiscard(false)}>
          繼續編輯
        </Button>
        <Button variant="danger" onClick={() => ui.getState().closeSheet()}>
          放棄變更
        </Button>
      </div>
    </div>
  ) : (
    <Button variant="go" block icon="check" onClick={save}>
      儲存
    </Button>
  );

  const w = wx ? attempt(() => weatherInfo(wx.code), { label: '', icon: 'cloud' as IconName }) : null;
  const tone = fb.tone === 'ok' ? s.ok : fb.tone === 'warn' ? s.warnText : undefined;

  return (
    <Sheet
      eyebrow={days.includes(date) ? dayOptionLabel(days, date) : fmtMDWeek(date)}
      title={initial.city || '這一天'}
      footer={footer}
      onClose={close}
    >
      {label && (
        <section className={s.banner} aria-label="試算表的日期列">
          <span className={s.bannerHead}>
            <span>試算表的日期列</span>
            {source && <span className={s.srcBadge}>{SOURCE_TEXT[source]}</span>}
          </span>
          <p className={s.bannerText}>{label}</p>
        </section>
      )}

      <form className={s.form} onSubmit={onSubmit} onKeyDown={onKeyDown} noValidate>
        <TextInput
          label={!label && source ? `城市（${SOURCE_TEXT[source]}）` : '城市'}
          placeholder="例如：京都 或 Kyoto"
          value={city}
          autoComplete="off"
          enterKeyHint="done"
          maxLength={60}
          hint={<span className={tone}>{fb.text}</span>}
          onChange={(e) => {
            setCity(e.target.value);
            if (askDiscard) setAskDiscard(false);
          }}
        />
        <TextInput
          label="住宿"
          placeholder="例如：京都格蘭比亞"
          value={lodging}
          autoComplete="off"
          enterKeyHint="done"
          maxLength={120}
          hint="「回飯店」「飯店接駁」這類行程點會導航到這裡。"
          onChange={(e) => {
            setLodging(e.target.value);
            if (askDiscard) setAskDiscard(false);
          }}
        />
      </form>

      <ListGroup title="這天的天氣">
        {wx && w ? (
          <ListRow
            icon={w.icon}
            title={
              <span className="num">
                {w.label ? `${w.label} · ` : ''}
                {Math.round(wx.tMin)}°–{Math.round(wx.tMax)}°
              </span>
            }
            subtitle={[wx.place, wx.kind === 'climate' ? '歷年同期平均' : '預報'].filter(Boolean).join(' · ')}
            onClick={() => openSheet({ name: 'weather' })}
          />
        ) : (
          <ListRow
            icon="sun"
            title={weather.loading ? '天氣讀取中…' : '還沒有這天的天氣'}
            subtitle={weather.error ? '天氣暫時無法取得，點這裡查看' : city.trim() ? '城市定位後會自動更新' : '設定城市後會顯示'}
            onClick={() => openSheet({ name: 'weather' })}
          />
        )}
      </ListGroup>
    </Sheet>
  );
}
