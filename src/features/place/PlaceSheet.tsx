/**
 * 地點頁：單一行程點的詳情。
 * 頂部是依類型上色的光球＋霧面玻璃標題卡（天氣是這天所在城市的），下面依序是：四個前往動作、資訊清單、口碑連結；
 * 底部固定「標記完成」與「編輯」。
 * 資訊清單第一列是「導航目的地」（含城市背景，導航按鈕就是用它），可以直接修改成手動的目的地；
 * 沒有特定地點的行程點（起床、整理）導航按鈕會停用並說明。
 */
import { motion, useReducedMotion } from 'motion/react';
import { useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { itemType } from '@/domain/constants';
import { fmtMD, tripDays, weekday } from '@/domain/dates';
import { fmtMoney, toHome } from '@/domain/money';
import { canNavigate, daySegments, itemsOfDay } from '@/domain/schedule';
import type { DailyWeather, Item, Trip } from '@/domain/types';
import { cardInfo, navQuery, routeText } from '@/features/plan/model';
import { haptic } from '@/platform';
import { useTripWeather } from '@/services/hooks';
import { appleMapsNavigate, gmapsNavigate, gmapsTraffic, googleCalendar, socialLinks } from '@/services/links';
import { dayMetaFor } from '@/services/places';
import { weatherInfo } from '@/services/weather';
import { useActiveTrip, useData } from '@/store';
import { useUI } from '@/store/ui';
import { Button, Chip, Empty, Icon, Orb, Sheet, type IconName } from '@/ui';
import {
  clearPlacePatch,
  factsHint,
  fmtDuration,
  fmtRating,
  linkHost,
  manualPlacePatch,
  normalizeUrl,
  PLACE_SOURCE_LABEL,
  placeMeta,
  placeSocials,
  ratingPct,
  timeRange,
} from './model';
import { refreshRulePlace } from './rulePlace';
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
  const toast = useUI((st) => st.toast);
  const toggleDone = useData((st) => st.toggleDone);

  const type = itemType(item.type);
  // 導航目的地（地點辨識的含城市背景的目的地優先；地址是貼上的網址時改用座標）
  const q = navQuery(item);
  // 起床、整理這類沒有特定地點的：不能導航
  const navOk = canNavigate(item);
  const noNavHint = '這一站沒有特定地點';
  const days = tripDays(trip);
  const dayNo = item.date ? days.indexOf(item.date) + 1 : 0;

  // 同一天的上一站 → 路況改成看「上一站到這裡」怎麼走
  const sameDay = item.date ? itemsOfDay(trip, item.date) : [];
  const k = sameDay.findIndex((i) => i.id === item.id);
  const prev = k > 0 ? sameDay[k - 1] : null;
  const tight = prev && item.date ? attempt(() => daySegments(trip, item.date as string).some((g) => g.to.id === item.id && g.tight), false) : false;
  // 多城市行程：日曆時區、口碑搜尋都用這天所在的城市
  const day = attempt(() => dayMetaFor(trip, item.date), undefined);
  const dayGeo = day?.geo;
  // 時區依這一站所在的城市（見 stopTimezone）；過了午夜的「0:45」記在隔天
  const cal = attempt(() => googleCalendar(trip, item), null);

  const meta = placeMeta(dayNo, item.date ? fmtMD(item.date) : '', item.date ? weekday(item.date) : '', item.time);
  const searchCity = dayGeo?.label || day?.city || trip.cityGeo?.label || trip.city;
  // 沒有特定地點的（起床、整理）不用查口碑
  const socials = navOk ? placeSocials(item.type, attempt(() => socialLinks(searchCity, item), []), dayGeo?.countryCode || trip.cityGeo?.countryCode) : [];

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
          {/* 疊在地點頁上面，儲存或放棄後回到這裡 */}
          <Button variant="ghost" icon="edit" onClick={() => openSheet({ name: 'itemForm', itemId: item.id })}>
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
              <Chip color={type.color}>{cardInfo(item).tag}</Chip>
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
        <Action href={gmapsNavigate(q)} icon="navigate" label="導航" primary disabled={!navOk} hint={navOk ? undefined : noNavHint} />
        <Action href={appleMapsNavigate(q)} icon="map" label="Apple 地圖" disabled={!navOk} hint={navOk ? undefined : noNavHint} />
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
      {!navOk && (
        <p className={s.noNav}>這一站沒有特定地點（例如起床、整理），所以不能導航。需要的話，在下面的「導航目的地」設定要去哪裡。</p>
      )}

      {/* 資訊 */}
      <motion.div {...enter(2)}>
        <Facts trip={trip} item={item} />
      </motion.div>

      {/* 口碑與評價（交通不顯示；住宿只留評價類，見 placeSocials） */}
      {socials.length > 0 && (
        <motion.section className={s.section} aria-labelledby="place-social" {...enter(3)}>
          <h3 id="place-social" className={s.secTitle}>
            口碑與評價
          </h3>
          <div className={s.socials}>
            {socials.map((l) => (
              <a key={l.label} className={s.social} href={l.url} target="_blank" rel="noopener noreferrer" onClick={() => void haptic('light')}>
                <span className={s.brandDot} style={{ background: l.color }} aria-hidden />
                {l.label}
              </a>
            ))}
          </div>
        </motion.section>
      )}
    </Sheet>
  );
}

function WeatherPill({ wx }: { wx: DailyWeather }) {
  const info = attempt(() => weatherInfo(wx.code), {
    label: '',
    icon: 'cloud' as IconName,
  });
  return (
    <span
      className={s.wx}
      aria-label={`${wx.place ? `${wx.place} ` : ''}${info.label} ${Math.round(wx.tMin)} 到 ${Math.round(wx.tMax)} 度${wx.kind === 'climate' ? '（歷年平均）' : ''}`}
    >
      <Icon name={info.icon} size={14} stroke={2.2} />
      {wx.place && <span className={s.wxPlace}>{wx.place}</span>}
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
  /** 標籤旁的小標籤（導航目的地的來源） */
  badge?: ReactNode;
  value: ReactNode;
  action?: ReactNode;
}

function Facts({ trip, item }: { trip: Trip; item: Item }) {
  const toast = useUI((st) => st.toast);
  const openSheet = useUI((st) => st.openSheet);
  const upsertItem = useData((st) => st.upsertItem);
  const [editing, setEditing] = useState(false);

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

  // 導航目的地：導航按鈕用的就是這段文字（含城市、州、國家），可以直接改成手動的
  const navOk = canNavigate(item);
  const dest = navQuery(item);
  const address = item.address?.trim() ?? '';
  const sameAsAddress = navOk && !!address && dest === address;
  const saveDest = (text: string) => {
    const patch = manualPlacePatch(item, text);
    if (patch) {
      upsertItem(trip.id, patch);
      void haptic('success');
      toast('已更新導航目的地', 'good');
    }
    setEditing(false);
  };
  const resetDest = () => {
    upsertItem(trip.id, clearPlacePatch(item));
    refreshRulePlace(trip.id, item.id, null);
    void haptic('success');
    toast('已改回自動辨識');
    setEditing(false);
  };
  facts.push({
    key: 'dest',
    label: '導航目的地',
    badge: item.place ? <span className={s.srcBadge}>{PLACE_SOURCE_LABEL[item.place.source] ?? '自動辨識'}</span> : undefined,
    value: editing ? (
      <DestEditor
        initial={item.place?.source === 'manual' || navOk ? dest : ''}
        manual={item.place?.source === 'manual'}
        onSave={saveDest}
        onCancel={() => setEditing(false)}
        onReset={resetDest}
      />
    ) : navOk ? (
      <span className={s.selectable}>{dest}</span>
    ) : (
      <span className={s.soft}>沒有特定地點，不需要導航</span>
    ),
    action: editing ? undefined : (
      <span className={s.factBtns}>
        {/* 目的地就是地址（沒有城市背景的行程）：地址那一列不重複，複製放這裡 */}
        {sameAsAddress && (
          <button type="button" className={s.factBtn} onClick={() => void copy(address)} aria-label="複製地址">
            複製
          </button>
        )}
        <button
          type="button"
          className={s.factBtn}
          onClick={() => {
            void haptic('light');
            setEditing(true);
          }}
          aria-label={navOk ? '修改導航目的地' : '設定導航目的地'}
        >
          {navOk ? '修改' : '設定'}
        </button>
      </span>
    ),
  });

  if (address && !sameAsAddress)
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

  const route = routeText(item.route);
  if (route) facts.push({ key: 'route', label: '路線', value: <span className="num">{route}</span> });
  const transit = item.transit?.trim();
  if (transit) facts.push({ key: 'transit', label: '交通', value: <span className="num">{transit}</span> });

  // 只有開始時間時，標題卡已經寫了，不再重複；有停留時間才多出結束時間與「停留 X」
  const range = timeRange(item);
  const stay = fmtDuration(item.durationMin);
  if (stay)
    facts.push({
      key: 'time',
      label: range ? '時間 · 停留' : '停留',
      value: (
        <>
          {range && <span className="num">{range}</span>}
          {range && <span className={s.sep}> · </span>}
          <span className={range ? s.soft : undefined}>停留 {stay}</span>
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

  // 只有導航目的地（其他都沒填）：下面再放一張提示補資訊的卡片（沒有特定地點的不用補）
  const onlyDest = facts.length === 1 && navOk;

  return (
    <div className={s.factsWrap}>
      <dl className={s.facts}>
        {facts.map((f) => (
          <div key={f.key} className={s.fact}>
            <dt className={s.factLabel}>
              {f.label}
              {f.badge}
            </dt>
            <dd className={s.factValue}>
              <span className={s.factText}>{f.value}</span>
              {f.action}
            </dd>
          </div>
        ))}
      </dl>
      {onlyDest && (
        <div className={s.factsEmpty}>
          <span>{factsHint(item)}</span>
          <Button variant="soft" size="sm" icon="edit" onClick={() => openSheet({ name: 'itemForm', itemId: item.id })}>
            補上資訊
          </Button>
        </div>
      )}
    </div>
  );
}

/** 導航目的地的就地編輯：輸入框＋取消／儲存；目前是手動的，多一個「改回自動辨識」 */
function DestEditor({
  initial,
  manual,
  onSave,
  onCancel,
  onReset,
}: {
  initial: string;
  manual: boolean;
  onSave: (text: string) => void;
  onCancel: () => void;
  onReset: () => void;
}) {
  const [text, setText] = useState(initial);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave(text);
  };
  return (
    <form className={s.destEdit} onSubmit={submit}>
      <input
        className={s.destInput}
        value={text}
        autoFocus
        autoComplete="off"
        autoCapitalize="off"
        enterKeyHint="done"
        maxLength={200}
        aria-label="導航目的地"
        placeholder="例如：清水寺, 京都"
        onChange={(e) => setText(e.target.value)}
      />
      <span className={s.destHint}>寫店名或地址，再加上城市（必要時加國家），Google 地圖比較不會找錯。</span>
      <span className={s.destBtns}>
        {manual && (
          <button type="button" className={s.destLink} onClick={onReset}>
            改回自動辨識
          </button>
        )}
        <span className={s.destSpacer} />
        <button type="button" className={s.factBtn} onClick={onCancel}>
          取消
        </button>
        <button type="submit" className={`${s.factBtn} ${s.factBtnGo}`} disabled={!text.trim()}>
          儲存
        </button>
      </span>
    </form>
  );
}
