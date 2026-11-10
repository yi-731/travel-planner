/**
 * 天氣頁：整趟旅程每天的天氣（像 iOS 天氣的 10 日預報）。
 * 上方焦點卡（今天或第一天，點下方任一天可切換）→ 每日列表＋溫度條 → AI 穿搭建議 → 其他天氣來源 → 資料來源。
 * 天氣資料由 services/hooks 的 useTripWeather 提供（會自動快取、過期重抓）。
 */
import { motion, useReducedMotion } from 'motion/react';
import { useState, type CSSProperties } from 'react';
import { fmtMD, today, tripPhase, weekday } from '@/domain/dates';
import type { DailyWeather, ISODate, Trip } from '@/domain/types';
import AiKeyNotice from '@/features/ai/AiKeyNotice';
import { haptic } from '@/platform';
import { aiErrorMessage, packingAdvice } from '@/services/ai';
import { useTripWeather, type TripWeather } from '@/services/hooks';
import { weatherLinks } from '@/services/links';
import { weatherInfo } from '@/services/weather';
import { useActiveTrip, useData } from '@/store';
import { useUI } from '@/store/ui';
import { Button, Empty, Icon, ListGroup, ListRow, Note, Orb, Sheet, Spinner, type IconName } from '@/ui';
import { barInset, fmtDayLabel, fmtUpdated, rainLong, rainText, tempScale, type TempScale } from './model';
import s from './weather.module.css';

function attempt<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

const info = (code: number) => attempt(() => weatherInfo(code), { label: '', icon: 'cloud' as IconName });
const dayLabel = (d: ISODate) => fmtDayLabel(fmtMD(d), weekday(d));
const KIND_LABEL = { forecast: '預報', climate: '歷年平均' } as const;

export default function WeatherSheet() {
  const trip = useActiveTrip();
  const weather = useTripWeather(trip);
  const closeSheet = useUI((st) => st.closeSheet);

  if (!trip)
    return (
      <Sheet title="天氣">
        <Empty
          icon="sun"
          title="還沒有旅程"
          action={
            <Button variant="ghost" onClick={closeSheet}>
              關閉
            </Button>
          }
        >
          建立一趟旅程並設定城市後，這裡會顯示每天的天氣。
        </Empty>
      </Sheet>
    );
  return <WeatherBody trip={trip} weather={weather} />;
}

function WeatherBody({ trip, weather }: { trip: Trip; weather: TripWeather }) {
  const reduce = useReducedMotion();
  const openSheet = useUI((st) => st.openSheet);
  const phase = attempt(() => tripPhase(trip), null);
  const days = phase?.days ?? [];
  const now = today();

  const cityName = trip.city.trim() || trip.cityGeo?.label || '';
  const hasCity = !!cityName || !!trip.cityGeo;
  const title = days.length ? (
    <span className={s.titleSerif}>
      {fmtMD(days[0])}
      {days.length > 1 && (
        <>
          <span className={s.titleDash}>–</span>
          {fmtMD(days[days.length - 1])}
        </>
      )}
    </span>
  ) : (
    '天氣'
  );

  const byDate = new Map<ISODate, DailyWeather>();
  for (const d of days) {
    const w = attempt(() => weather.forDate(d), undefined);
    if (w) byDate.set(d, w);
  }
  const known = [...byDate.values()];
  const scale = tempScale(known);
  const hasClimate = known.some((d) => d.kind === 'climate');

  const defaultFocus = phase?.phase === 'during' ? phase.focusDay : (days[0] ?? null);
  const [picked, setPicked] = useState<ISODate | null>(null);
  // 預設聚焦的那天沒資料（例如超出可查範圍）時，改用第一個有資料的日子
  const fallback = defaultFocus && byDate.has(defaultFocus) ? defaultFocus : (known[0]?.date ?? defaultFocus);
  const focus = picked && days.includes(picked) ? picked : fallback;
  const focusWx = focus ? byDate.get(focus) : undefined;

  const showSkeleton = weather.loading && !known.length && hasCity && days.length > 0;

  const enter = (i: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 8 },
          animate: { opacity: 1, y: 0 },
          transition: {
            delay: Math.min(i, 10) * 0.035,
            duration: 0.26,
            ease: [0.2, 0.8, 0.2, 1] as const,
          },
        };

  return (
    <Sheet eyebrow={cityName ? `天氣 · ${cityName}` : undefined} title={title}>
      {!hasCity && (
        <Note tone="info">
          <strong>{days.length ? '還沒設定城市' : '還沒設定城市和日期'}</strong>
          <span>{days.length ? '設定這趟旅程的城市後，就能看到每天的天氣預報。' : '設定城市和出發、回程日期後，就能看到每天的天氣預報。'}</span>
          <div className={s.noteAct}>
            <Button variant="ghost" size="sm" icon="pin" onClick={() => openSheet({ name: 'tripSettings' })}>
              {days.length ? '設定城市' : '設定城市和日期'}
            </Button>
          </div>
        </Note>
      )}

      {hasCity && !days.length && (
        <Note tone="info">
          <strong>還沒設定旅行日期</strong>
          <span>設定出發日與回程日後，這裡會顯示每天的天氣。</span>
          <div className={s.noteAct}>
            <Button variant="ghost" size="sm" icon="calendar" onClick={() => openSheet({ name: 'tripSettings' })}>
              設定日期
            </Button>
          </div>
        </Note>
      )}

      {weather.error && hasCity && (
        <Note tone={known.length ? 'warn' : 'bad'}>
          <strong>{known.length ? '天氣沒有更新成功，下面是上次的資料' : '天氣載入失敗'}</strong>
          <span>{weather.error}</span>
          <div className={s.noteAct}>
            <Button variant="ghost" size="sm" icon="refresh" onClick={() => attempt(() => weather.refresh(), undefined)} disabled={weather.loading}>
              {weather.loading ? '重新載入中…' : '再試一次'}
            </Button>
          </div>
        </Note>
      )}

      {hasCity && days.length > 0 && !known.length && !weather.loading && !weather.error && (
        <Note tone="info">
          <strong>還沒有這幾天的天氣資料</strong>
          <span>可能還在等待連線，或日期超出可查詢的範圍。可以稍後再按重新整理。</span>
          <div className={s.noteAct}>
            <Button variant="ghost" size="sm" icon="refresh" onClick={() => attempt(() => weather.refresh(), undefined)}>
              重新整理
            </Button>
          </div>
        </Note>
      )}

      {/* 圓角卡片包一層：彈出頁內容超過一頁時，overflow: hidden 的卡片才不會被壓扁 */}
      {focus && focusWx && (
        <div>
          <FocusCard date={focus} wx={focusWx} dayNo={days.indexOf(focus) + 1} isToday={focus === now} />
        </div>
      )}

      {showSkeleton && (
        <div>
          <Skeleton count={Math.min(days.length, 6)} />
        </div>
      )}

      {known.length > 0 && scale && (
        <div className={s.daysWrap}>
          <ol className={s.days} aria-label="每日天氣">
            {days.map((d, i) => (
              <motion.li key={d} {...enter(i)}>
                <DayRow
                  date={d}
                  dayNo={i + 1}
                  wx={byDate.get(d)}
                  scale={scale}
                  isToday={d === now}
                  selected={d === focus}
                  onPick={() => {
                    void haptic('selection');
                    setPicked(d);
                  }}
                />
              </motion.li>
            ))}
          </ol>
          {hasClimate && <p className={s.footnote}>超過 16 天的日期顯示近 3 年同期平均，出發前兩週會自動換成即時預報。</p>}
        </div>
      )}

      {hasCity && days.length > 0 && <PackingSection trip={trip} weather={weather} hasWeather={known.length > 0} />}

      {hasCity && (
        <ListGroup title="其他天氣來源">
          {attempt(() => weatherLinks(trip.cityGeo?.label || cityName), []).map((l) => (
            <ListRow key={l.label} icon="globe" title={l.label} href={l.url} />
          ))}
        </ListGroup>
      )}

      {hasCity && days.length > 0 && (
        <div className={s.source}>
          <span className={s.sourceText}>
            資料來源 Open-Meteo
            {weather.fetchedAt ? (
              <>
                {' · 更新於 '}
                <span className="num">{fmtUpdated(weather.fetchedAt)}</span>
              </>
            ) : null}
          </span>
          <button
            type="button"
            className={s.refresh}
            aria-label="重新整理天氣"
            disabled={weather.loading}
            onClick={() => {
              void haptic('light');
              attempt(() => weather.refresh(), undefined);
            }}
          >
            {weather.loading ? <Spinner /> : <Icon name="refresh" size={18} stroke={2.2} />}
          </button>
        </div>
      )}
    </Sheet>
  );
}

/* ---------- 焦點卡 ---------- */

function FocusCard({ date, wx, dayNo, isToday }: { date: ISODate; wx: DailyWeather; dayNo: number; isToday: boolean }) {
  const reduce = useReducedMotion();
  const w = info(wx.code);
  const rain = rainLong(wx);
  const stats = [rain && { k: rain.label, v: rain.value }, wx.sunrise && { k: '日出', v: wx.sunrise }, wx.sunset && { k: '日落', v: wx.sunset }].filter(
    (x): x is { k: string; v: string } => !!x,
  );

  return (
    <section className={s.focus} aria-label={`${isToday ? '今天' : `Day ${dayNo}`}的天氣`}>
      <Orb size={250} halo style={{ right: -78, top: -64 }} />
      <Orb size={168} style={{ right: -38, top: -22 }} />
      <motion.div
        key={date}
        className={s.focusIn}
        initial={reduce ? false : { opacity: 0.35, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <div className={s.focusTop}>
          <span className={`eyebrow ${s.focusEyebrow}`}>
            {isToday ? '今天' : `Day ${dayNo}`} · <span className="num">{dayLabel(date)}</span>
          </span>
        </div>
        <div className={s.focusMain}>
          <span className={`serif num ${s.focusTemp}`}>{Math.round(wx.tMax)}°</span>
          <div className={s.focusDesc}>
            <span className={s.focusLabel}>
              <Icon name={w.icon} size={18} stroke={2.1} />
              {w.label || '天氣'}
            </span>
            <span className={`num ${s.focusRange}`}>
              最低 {Math.round(wx.tMin)}° · 最高 {Math.round(wx.tMax)}°
            </span>
          </div>
        </div>
        <div className={s.focusGlass}>
          {stats.length > 0 ? (
            <dl className={s.stats}>
              {stats.map((x) => (
                <div key={x.k} className={s.stat}>
                  <dt>{x.k}</dt>
                  <dd className="serif num">{x.v}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <span className={s.statsNone}>這天沒有降雨與日出日落資料</span>
          )}
          <span className={`${s.kind} ${s.kindOnGlass} ${wx.kind === 'climate' ? s.kindClimate : ''}`}>{KIND_LABEL[wx.kind]}</span>
        </div>
      </motion.div>
    </section>
  );
}

/* ---------- 每日列 ---------- */

interface DayRowProps {
  date: ISODate;
  dayNo: number;
  wx: DailyWeather | undefined;
  scale: TempScale;
  isToday: boolean;
  selected: boolean;
  onPick: () => void;
}

function DayRow({ date, dayNo, wx, scale, isToday, selected, onPick }: DayRowProps) {
  const head = (
    <span className={s.dayHead}>
      <span className={s.dayName}>
        Day {dayNo}
        {isToday && <span className={s.todayTag}>今天</span>}
      </span>
      <span className={`num ${s.dayDate}`}>{dayLabel(date)}</span>
    </span>
  );

  if (!wx)
    return (
      <div className={`${s.row} ${isToday ? s.isToday : ''}`}>
        {head}
        <span className={s.iconCol} aria-hidden>
          <span className={s.noIcon}>—</span>
        </span>
        <span className={s.noData}>還沒有這天的資料</span>
      </div>
    );

  const w = info(wx.code);
  const rain = rainText(wx);
  const inset = barInset(wx, scale);
  const lo = Math.round(wx.tMin),
    hi = Math.round(wx.tMax);

  return (
    <button
      type="button"
      className={`${s.row} ${isToday ? s.isToday : ''} ${selected ? s.selected : ''}`}
      aria-pressed={selected}
      aria-label={`Day ${dayNo}，${dayLabel(date)}，${w.label}，${lo} 到 ${hi} 度${rain ? `，降雨 ${rain}` : ''}，${KIND_LABEL[wx.kind]}`}
      onClick={onPick}
    >
      {head}
      <span className={s.iconCol}>
        <Icon name={w.icon} size={22} stroke={1.9} />
        {rain && <span className={`num ${s.rain} ${wx.kind === 'climate' ? s.rainAvg : ''}`}>{rain}</span>}
      </span>
      <span className={s.mainCol}>
        <span className={s.labelLine}>
          <span className={s.wxLabel}>{w.label}</span>
          {/* 預報是常態，列表只標出「歷年平均」的日子；aria-label 仍會念出「預報」 */}
          {wx.kind === 'climate' && <span className={`${s.kind} ${s.kindClimate}`}>{KIND_LABEL.climate}</span>}
        </span>
        <span className={s.temps}>
          <span className={`num ${s.tLo}`}>{lo}°</span>
          <span className={s.track}>
            <span
              className={s.fill}
              style={
                {
                  ['--l' as string]: `${inset.left}%`,
                  ['--r' as string]: `${inset.right}%`,
                } as CSSProperties
              }
            />
          </span>
          <span className={`num ${s.tHi}`}>{hi}°</span>
        </span>
      </span>
    </button>
  );
}

function Skeleton({ count }: { count: number }) {
  return (
    <div className={s.days} aria-busy="true" aria-label="正在載入天氣">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`${s.row} ${s.skelRow}`}>
          <span className={s.dayHead}>
            <span className={`${s.skel} ${s.skelA}`} />
            <span className={`${s.skel} ${s.skelB}`} />
          </span>
          <span className={s.iconCol}>
            <span className={`${s.skel} ${s.skelIcon}`} />
          </span>
          <span className={s.mainCol}>
            <span className={`${s.skel} ${s.skelB}`} />
            <span className={`${s.skel} ${s.skelBar}`} />
          </span>
        </div>
      ))}
    </div>
  );
}

/* ---------- AI 穿搭建議 ---------- */

function PackingSection({ trip, weather, hasWeather }: { trip: Trip; weather: TripWeather; hasWeather: boolean }) {
  const ready = useData((st) => !!st.settings.anthropicApiKey?.trim());
  const busy = useUI((st) => !!st.busy.packing);
  const setBusy = useUI((st) => st.setBusy);
  const toast = useUI((st) => st.toast);
  const mutateTrip = useData((st) => st.mutateTrip);
  const [error, setError] = useState<string | null>(null);
  const packing = trip.ai?.packing;

  const generate = async () => {
    const cache = useData.getState().trips[trip.id]?.weather;
    if (!cache || !weather.days.length) {
      setError('還沒有這趟旅程的天氣資料，請等天氣載入完成後再試一次。');
      return;
    }
    setError(null);
    setBusy('packing', true);
    try {
      const latest = useData.getState().trips[trip.id] ?? trip;
      const res = await packingAdvice(latest, cache);
      mutateTrip(trip.id, (d) => {
        d.ai.packing = { at: Date.now(), text: res.text, tips: res.tips };
      });
      void haptic('success');
      toast('已產生穿搭建議', 'good');
    } catch (e) {
      const msg = attempt(() => aiErrorMessage(e), 'AI 暫時無法使用，請稍後再試一次。');
      setError(msg);
      void haptic('error');
    } finally {
      setBusy('packing', false);
    }
  };

  return (
    <section className={s.section} aria-labelledby="wx-packing">
      <h3 id="wx-packing" className={s.secTitle}>
        AI 穿搭建議
      </h3>
      {packing ? (
        <div className={s.pack}>
          <p className={s.packText}>{packing.text}</p>
          {packing.tips.length > 0 && (
            <ul className={s.tips}>
              {packing.tips.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          )}
          <div className={s.packFoot}>
            <span className={s.packMeta}>
              <Icon name="spark" size={13} stroke={2.2} />
              產生於 <span className="num">{fmtUpdated(packing.at)}</span>
            </span>
            {ready && (
              <Button variant="plain" size="sm" icon={busy ? undefined : 'refresh'} onClick={() => void generate()} disabled={busy || !hasWeather}>
                {busy ? (
                  <>
                    <Spinner /> 產生中
                  </>
                ) : (
                  '重新產生'
                )}
              </Button>
            )}
          </div>
        </div>
      ) : (
        ready && (
          <div className={s.pack}>
            <p className={s.packIntro}>依每天的氣溫和降雨，建議怎麼穿、行李帶什麼。</p>
            <Button variant="soft" block icon={busy ? undefined : 'spark'} onClick={() => void generate()} disabled={busy || !hasWeather}>
              {busy ? (
                <>
                  <Spinner /> 正在產生建議…
                </>
              ) : (
                '用 AI 產生穿搭建議'
              )}
            </Button>
            {!hasWeather && <span className={s.packHint}>天氣載入後才能產生。</span>}
          </div>
        )
      )}
      {error && (
        <Note tone="bad">
          <span>{error}</span>
        </Note>
      )}
      <AiKeyNotice feature="穿搭建議" />
    </section>
  );
}
