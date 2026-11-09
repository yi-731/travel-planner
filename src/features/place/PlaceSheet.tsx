/**
 * 地點頁：單一行程點的詳情。
 * 頂部是依類型上色的光球＋霧面玻璃標題卡，下面依序是：四個前往動作、資訊清單、口碑連結；
 * 底部固定「標記完成」與「編輯」。
 */
import { motion, useReducedMotion } from 'motion/react';
import type { CSSProperties, ReactNode } from 'react';
import { itemType } from '@/domain/constants';
import { fmtMD, tripDays, weekday } from '@/domain/dates';
import { fmtMoney, toHome } from '@/domain/money';
import { daySegments, itemsOfDay, placeQuery } from '@/domain/schedule';
import type { DailyWeather, Item, Trip } from '@/domain/types';
import { haptic } from '@/platform';
import { useTripWeather } from '@/services/hooks';
import { appleMapsNavigate, gmapsNavigate, gmapsTraffic, googleCalendar, socialLinks } from '@/services/links';
import { weatherInfo } from '@/services/weather';
import { useActiveTrip, useData } from '@/store';
import { useUI } from '@/store/ui';
import { Button, Chip, Empty, Icon, Orb, Sheet, type IconName } from '@/ui';
import { fmtDuration, fmtRating, linkHost, normalizeUrl, placeMeta, ratingPct, timeRange } from './model';
import s from './place.module.css';

/** 服務還在開發或出錯時不要讓整頁壞掉 */
function attempt<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export default function PlaceSheet({ itemId }: { itemId: string }) {
  const trip = useActiveTrip();
  const weather = useTripWeather(trip);
  const closeSheet = useUI((st) => st.closeSheet);
  const item = trip?.items.find((i) => i.id === itemId);

  if (!trip || !item)
    return (
      <Sheet title="行程點">
        <Empty
          icon="pin"
          title="找不到這個行程點"
          action={
            <Button variant="ghost" onClick={closeSheet}>
              關閉
            </Button>
          }
        >
          可能已經被刪除，或屬於另一趟旅程。
        </Empty>
      </Sheet>
    );

  const wx = item.date ? attempt(() => weather.forDate(item.date as string), undefined) : undefined;
  return <PlaceBody trip={trip} item={item} wx={wx} />;
}

function PlaceBody({ trip, item, wx }: { trip: Trip; item: Item; wx: DailyWeather | undefined }) {
  const reduce = useReducedMotion();
  const openSheet = useUI((st) => st.openSheet);
  const replaceSheet = useUI((st) => st.replaceSheet);
  const toast = useUI((st) => st.toast);
  const toggleDone = useData((st) => st.toggleDone);

  const type = itemType(item.type);
  const q = placeQuery(item);
  const days = tripDays(trip);
  const dayNo = item.date ? days.indexOf(item.date) + 1 : 0;

  // 同一天的上一站 → 路況改成看「上一站到這裡」怎麼走
  const sameDay = item.date ? itemsOfDay(trip, item.date) : [];
  const k = sameDay.findIndex((i) => i.id === item.id);
  const prev = k > 0 ? sameDay[k - 1] : null;
  const tight = prev && item.date ? attempt(() => daySegments(trip, item.date as string).some((g) => g.to.id === item.id && g.tight), false) : false;
  const cal = attempt(() => googleCalendar(trip, item), null);

  const meta = placeMeta(dayNo, item.date ? fmtMD(item.date) : '', item.date ? weekday(item.date) : '', item.time);

  const toggle = () => {
    const willBeDone = !item.done;
    toggleDone(trip.id, item.id);
    if (willBeDone) {
      void haptic('success');
      toast(`已完成「${item.title}」`, 'good');
    } else toast('已改回未完成');
  };

  const enter = (i: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 10 },
          animate: { opacity: 1, y: 0 },
          transition: {
            delay: 0.04 * i,
            duration: 0.28,
            ease: [0.2, 0.8, 0.2, 1] as const,
          },
        };

  return (
    <Sheet
      bare
      footer={
        <div className={s.foot}>
          <Button variant="go" block icon={item.done ? 'refresh' : 'check'} onClick={toggle}>
            {item.done ? '取消完成' : '標記完成'}
          </Button>
          <Button variant="ghost" icon="edit" onClick={() => replaceSheet({ name: 'itemForm', itemId: item.id })}>
            編輯
          </Button>
        </div>
      }
    >
      {/* 標題卡 */}
      {/* 外層 div：彈出頁內容超過一頁時，overflow: hidden 的卡片才不會被壓扁 */}
      <motion.div
        className={s.heroWrap}
        {...(reduce
          ? {}
          : {
              initial: { opacity: 0, scale: 0.985 },
              animate: { opacity: 1, scale: 1 },
              transition: { duration: 0.3, ease: [0.2, 0.8, 0.2, 1] },
            })}
      >
        <header className={`${s.hero} ${item.done ? s.heroDone : ''}`} style={{ ['--c' as string]: `var(${type.color})` } as CSSProperties}>
          <Orb size={240} halo className={s.tint} style={{ right: -70, top: -84 }} />
          <Orb size={150} className={s.tint} style={{ right: -26, top: -40 }} />
          <div className={s.glass}>
            <div className={s.heroTop}>
              <Chip color={type.color}>{type.label}</Chip>
              {item.done && (
                <span className={s.doneBadge}>
                  <Icon name="check" size={12} stroke={2.8} />
                  已完成
                </span>
              )}
            </div>
            <h2 className={s.title}>{item.title}</h2>
            <div className={s.metaRow}>
              <span className={`num ${s.meta}`}>{meta}</span>
              {wx && <WeatherPill wx={wx} />}
            </div>
          </div>
        </header>
      </motion.div>

      {/* 四個前往動作 */}
      <motion.nav className={s.actions} aria-label="前往這裡" {...enter(1)}>
        <Action href={gmapsNavigate(q)} icon="navigate" label="導航" primary />
        <Action href={appleMapsNavigate(q)} icon="map" label="Apple 地圖" />
        {prev ? (
          <Action
            icon="traffic"
            label="路況"
            warn={tight}
            hint={tight ? `從「${prev.title}」過來時間偏趕` : `從「${prev.title}」怎麼過來`}
            onClick={() => openSheet({ name: 'segment', fromId: prev.id, toId: item.id })}
          />
        ) : (
          <Action href={gmapsTraffic} icon="traffic" label="路況" hint="Google 地圖即時路況" />
        )}
        <Action href={cal ?? undefined} icon="calendar" label="日曆" hint={cal ? '加到 Google 日曆' : '排好日期後才能加到日曆'} disabled={!cal} />
      </motion.nav>

      {/* 資訊 */}
      <motion.div {...enter(2)}>
        <Facts trip={trip} item={item} />
      </motion.div>

      {/* 口碑與評價 */}
      <motion.section className={s.section} aria-labelledby="place-social" {...enter(3)}>
        <h3 id="place-social" className={s.secTitle}>
          口碑與評價
        </h3>
        <div className={s.socials}>
          {attempt(() => socialLinks(trip.cityGeo?.label || trip.city, item), []).map((l) => (
            <a key={l.label} className={s.social} href={l.url} target="_blank" rel="noopener noreferrer" onClick={() => void haptic('light')}>
              <span className={s.brandDot} style={{ background: l.color }} aria-hidden />
              {l.label}
            </a>
          ))}
        </div>
      </motion.section>
    </Sheet>
  );
}

function WeatherPill({ wx }: { wx: DailyWeather }) {
  const info = attempt(() => weatherInfo(wx.code), {
    label: '',
    icon: 'cloud' as IconName,
  });
  return (
    <span className={s.wx} aria-label={`${info.label} ${Math.round(wx.tMin)} 到 ${Math.round(wx.tMax)} 度${wx.kind === 'climate' ? '（歷年平均）' : ''}`}>
      <Icon name={info.icon} size={14} stroke={2.2} />
      <span className="num">
        {Math.round(wx.tMin)}°–{Math.round(wx.tMax)}°
      </span>
      {wx.kind === 'climate' && <span className={s.wxTag}>均</span>}
    </span>
  );
}

interface ActionProps {
  icon: IconName;
  label: string;
  href?: string;
  onClick?: () => void;
  primary?: boolean;
  warn?: boolean;
  disabled?: boolean;
  hint?: string;
}

function Action({ icon, label, href, onClick, primary, warn, disabled, hint }: ActionProps) {
  const cls = `${s.action} ${primary ? s.primary : ''} ${warn ? s.warn : ''}`;
  const body = (
    <>
      <span className={s.badge}>
        <Icon name={icon} size={19} stroke={2.1} />
      </span>
      <span className={s.actionLabel}>{label}</span>
    </>
  );
  if (disabled)
    return (
      <button type="button" className={cls} disabled aria-label={hint ? `${label}：${hint}` : label}>
        {body}
      </button>
    );
  if (href)
    return (
      <a
        className={cls}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={hint ? `${label}：${hint}` : label}
        onClick={() => void haptic('light')}
      >
        {body}
      </a>
    );
  return (
    <button
      type="button"
      className={cls}
      aria-label={hint ? `${label}：${hint}` : label}
      onClick={() => {
        void haptic('light');
        onClick?.();
      }}
    >
      {body}
    </button>
  );
}

interface Fact {
  key: string;
  label: string;
  value: ReactNode;
  action?: ReactNode;
}

function Facts({ trip, item }: { trip: Trip; item: Item }) {
  const toast = useUI((st) => st.toast);
  const replaceSheet = useUI((st) => st.replaceSheet);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      void haptic('success');
      toast('已複製');
    } catch {
      toast('無法複製，請長按地址手動選取後複製', 'bad');
    }
  };

  const facts: Fact[] = [];
  const address = item.address?.trim();
  if (address)
    facts.push({
      key: 'address',
      label: '地址',
      value: <span className={s.selectable}>{address}</span>,
      action: (
        <button type="button" className={s.factBtn} onClick={() => void copy(address)} aria-label="複製地址">
          複製
        </button>
      ),
    });

  const range = timeRange(item);
  const stay = fmtDuration(item.durationMin);
  if (range || stay)
    facts.push({
      key: 'time',
      label: range && stay ? '時間 · 停留' : range ? '時間' : '停留',
      value: (
        <>
          {range && <span className="num">{range}</span>}
          {range && stay && <span className={s.sep}> · </span>}
          {stay && <span className={range ? s.soft : undefined}>停留 {stay}</span>}
        </>
      ),
    });

  if (item.cost != null && Number.isFinite(item.cost)) {
    const home = trip.localCurrency !== trip.homeCurrency ? attempt(() => toHome(trip, item.cost as number, trip.localCurrency), null) : null;
    facts.push({
      key: 'cost',
      label: '預估費用',
      value:
        item.cost === 0 ? (
          '免費'
        ) : (
          <>
            <span className="num">{fmtMoney(item.cost)}</span> <span className={s.cur}>{trip.localCurrency}</span>
            {home != null && (
              <span className={s.soft}>
                {' '}
                ≈ <span className="num">{fmtMoney(home)}</span> {trip.homeCurrency}
              </span>
            )}
          </>
        ),
    });
  }

  if (item.rating != null && Number.isFinite(item.rating) && item.rating > 0)
    facts.push({
      key: 'rating',
      label: '評分',
      value: (
        <span className={s.rating} aria-label={`${fmtRating(item.rating)} 顆星`}>
          <span className={s.stars} style={{ ['--pct' as string]: `${ratingPct(item.rating)}%` }} aria-hidden>
            ★★★★★
          </span>
          <span className="num">{fmtRating(item.rating)}</span>
        </span>
      ),
    });

  const note = item.note?.trim();
  if (note)
    facts.push({
      key: 'note',
      label: '備註',
      value: <span className={s.note}>{note}</span>,
    });

  const url = normalizeUrl(item.link);
  if (url)
    facts.push({
      key: 'link',
      label: '連結',
      value: <span className={s.host}>{linkHost(url)}</span>,
      action: (
        <a className={s.factBtn} href={url} target="_blank" rel="noopener noreferrer" onClick={() => void haptic('light')}>
          開啟
          <Icon name="arrowUpRight" size={13} stroke={2.4} />
        </a>
      ),
    });

  if (!facts.length)
    return (
      <div className={s.factsEmpty}>
        <span>補上地址、時間或費用，導航和行程檢查會更準確。</span>
        <Button variant="soft" size="sm" icon="edit" onClick={() => replaceSheet({ name: 'itemForm', itemId: item.id })}>
          補上資訊
        </Button>
      </div>
    );

  return (
    <dl className={s.facts}>
      {facts.map((f) => (
        <div key={f.key} className={s.fact}>
          <dt className={s.factLabel}>{f.label}</dt>
          <dd className={s.factValue}>
            <span className={s.factText}>{f.value}</span>
            {f.action}
          </dd>
        </div>
      ))}
    </dl>
  );
}
