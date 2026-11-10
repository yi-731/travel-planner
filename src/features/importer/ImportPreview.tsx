/**
 * 匯入預覽：數量、注意事項、每天的城市與住宿（App 看懂了哪些地點）、前 6 個行程點與導航目的地，
 * 以及「建立為新行程／更新／附加」三種套用方式。套用的實際動作由 ImportSheet 執行（onCreate / onMerge）。
 */
import { motion, useReducedMotion } from 'motion/react';
import { Fragment, forwardRef, useDeferredValue, useMemo, useState } from 'react';
import { itemType } from '@/domain/constants';
import { fmtMD } from '@/domain/dates';
import type { Trip } from '@/domain/types';
import { haptic } from '@/platform';
import { aiReady } from '@/services/ai';
import { applyImport, type ImportResult } from '@/services/importer';
import { useData } from '@/store';
import { Button, Chip, Grid2, Note, TextInput } from '@/ui';
import {
  AI_PLACES_COST_HINT,
  currencyHint,
  dayRows,
  dayRowText,
  flagCounts,
  hasWrittenCurrency,
  previewDate,
  previewPlaces,
  removedCount,
  shortName,
  suggestedCity,
  unwrittenCount,
  type NewTripDraft,
} from './model';
import s from './importer.module.css';

const ROWS = 6;
/** 每天的城市先顯示幾天（其餘按「顯示全部」） */
const DAY_ROWS = 4;

export interface CreateOptions {
  name: string;
  city: string;
  startDate: string | null;
}

interface Props {
  result: ImportResult;
  /** 建立新行程用（決定當地貨幣、沒寫幣別的記帳） */
  newTrip: NewTripDraft;
  /** 依目前行程出發日辨識的結果（更新／附加用）；沒有目前行程時為 null */
  forTrip: ImportResult | null;
  /** 預覽來源，例如「Google 試算表」或檔名 */
  sourceLabel: string;
  /** 目前的行程（沒有則不顯示更新／附加） */
  trip: Trip | null;
  error: string | null;
  /** 正在讀取、同步或套用：先停用套用按鈕 */
  busy: boolean;
  onCreate: (o: CreateOptions) => void;
  onMerge: (mode: 'replace' | 'append') => void;
}

export const ImportPreview = forwardRef<HTMLElement, Props>(function ImportPreview({ result, newTrip, forTrip, sourceLabel, trip, error, busy, onCreate, onMerge }, ref) {
  const reduce = useReducedMotion();
  const [name, setName] = useState(result.suggestedName);
  const [city, setCity] = useState('');
  const [start, setStart] = useState('');
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [allDays, setAllDays] = useState(false);
  const autoPlaces = useData((st) => st.settings.aiAutoResolvePlaces);

  const nItems = result.items.length;
  const nExp = result.expenses.length;
  const empty = !nItems && !nExp;

  // App 看懂了什麼：每天的城市與住宿、必做／可省略、每一站的導航目的地
  const days = useMemo(() => dayRows(result), [result]);
  const flags = useMemo(() => flagCounts(result), [result]);
  const suggested = useMemo(() => suggestedCity(result), [result]);
  const cityFor = city.trim() || suggested;
  const deferredCity = useDeferredValue(cityFor);
  const places = useMemo(() => (nItems ? previewPlaces(result, deferredCity, ROWS) : []), [result, deferredCity, nItems]);
  const hasPlaces = places.some(Boolean);
  const shownDays = allDays ? days : days.slice(0, DAY_ROWS);
  const willResolve = autoPlaces && nItems > 0 && aiReady();

  // 以試算表為準更新時，會被移除的行程點數（先算好，才能事先提醒）
  const removed = useMemo(() => {
    if (!trip || !nItems) return 0;
    try {
      return removedCount(trip, applyImport(trip, forTrip ?? result, 'replace'));
    } catch {
      return 0;
    }
  }, [trip, forTrip, result, nItems]);
  // 「第幾天」併入目前行程時，會依目前行程的出發日換算
  const relativeOnTrip = result.hasRelativeDays && !!trip?.startDate && !!forTrip && !forTrip.hasRelativeDays;
  const unwritten = unwrittenCount(newTrip);

  // 按鈕要放得下一行：更新按鈕較長，名稱限 7 個字
  const tripName = trip ? trip.name.trim() || '目前的行程' : '';

  const replace = () => {
    if (removed > 0 && !confirmReplace) {
      void haptic('warning');
      setConfirmReplace(true);
      return;
    }
    onMerge('replace');
  };

  return (
    <motion.section
      ref={ref}
      className={s.preview}
      aria-label="匯入預覽"
      initial={reduce ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.36, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div className={s.pvHead}>
        <span className={`eyebrow ${s.pvEyebrow}`}>預覽 · {sourceLabel}</span>
        {empty ? (
          <span className={s.pvEmpty}>沒有可以匯入的資料</span>
        ) : (
          <div className={s.counts}>
            {nItems > 0 && (
              <span className={s.count}>
                <span className={`serif num ${s.countNum}`}>{nItems}</span>
                <span className={s.countLabel}>個行程點</span>
              </span>
            )}
            {days.length > 0 && (
              <span className={s.count}>
                <span className={`serif num ${s.countNum}`}>{days.length}</span>
                <span className={s.countLabel}>天</span>
              </span>
            )}
            {nExp > 0 && (
              <span className={s.count}>
                <span className={`serif num ${s.countNum}`}>{nExp}</span>
                <span className={s.countLabel}>筆記帳</span>
              </span>
            )}
          </div>
        )}
        {(flags.must > 0 || flags.optional > 0) && (
          <p className={s.flags}>
            {flags.must > 0 && (
              <span>
                ★ 必做 <span className="num">{flags.must}</span>
              </span>
            )}
            {flags.optional > 0 && (
              <span>
                ◇ 可省略 <span className="num">{flags.optional}</span>
              </span>
            )}
          </p>
        )}
      </div>

      {result.warnings.length > 0 && (
        <Note tone="warn">
          <strong>{empty ? '找不到資料' : '匯入前請留意'}</strong>
          <ul className={s.warnList}>
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Note>
      )}

      {days.length > 0 && (
        <div className={s.days}>
          <div className={s.daysHead}>
            <span className={s.blockTitle}>每天的城市與住宿</span>
            <span className={s.daysHint}>天氣與導航會依當天的城市</span>
          </div>
          <ul className={s.dayList}>
            {shownDays.map((d) => (
              <li key={d.key} className={s.dayRow}>
                <span className={`num ${s.dayDate}`}>{d.date}</span>
                <span className={`${s.dayText} ${d.route ? '' : s.dayUnknown}`}>{dayRowText(d)}</span>
              </li>
            ))}
          </ul>
          {days.length > DAY_ROWS && (
            <Button variant="plain" size="sm" className={s.daysMore} aria-expanded={allDays} onClick={() => setAllDays((v) => !v)}>
              {allDays ? '收起' : `顯示全部 ${days.length} 天`}
            </Button>
          )}
        </div>
      )}

      {nItems > 0 && (
        <div className={s.tableWrap} role="region" tabIndex={0} aria-label="前幾個行程點（可左右滑動）">
          <table className={s.table}>
            <thead>
              <tr>
                <th scope="col">日期</th>
                <th scope="col">時間</th>
                <th scope="col">行程</th>
                <th scope="col">類型</th>
              </tr>
            </thead>
            <tbody>
              {result.items.slice(0, ROWS).map((it, i) => {
                const t = itemType(it.type);
                return (
                  <Fragment key={i}>
                    <tr className={hasPlaces ? s.hasSub : undefined}>
                      <td className="num">{previewDate(it)}</td>
                      <td className={`num ${it.time ? '' : s.dim}`}>{it.time ?? '—'}</td>
                      <td className={s.tdTitle}>
                        {it.flag && (
                          <span className={s.flagMark} aria-label={it.flag === 'must' ? '必做' : '可省略'}>
                            {it.flag === 'must' ? '★' : '◇'}
                          </span>
                        )}
                        {it.title}
                      </td>
                      <td>
                        <Chip color={t.color}>{it.tag ?? t.label}</Chip>
                      </td>
                    </tr>
                    {/* 導航目的地：整列寬顯示（不用左右滑就看得到 App 認出的地點與城市） */}
                    {hasPlaces && (
                      <tr className={s.subRow}>
                        <td colSpan={4}>
                          <span className={s.navLabel}>導航目的地</span>
                          <span className={places[i] ? undefined : s.dim}>{places[i] || '—'}</span>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {nItems > ROWS && <p className={s.more}>還有 {nItems - ROWS} 個行程點</p>}

      {!nItems && nExp > 0 && (
        <div className={s.tableWrap} role="region" tabIndex={0} aria-label="前幾筆記帳（可左右滑動）">
          <table className={s.table}>
            <thead>
              <tr>
                <th scope="col">日期</th>
                <th scope="col">項目</th>
                <th scope="col" className={s.right}>金額</th>
              </tr>
            </thead>
            <tbody>
              {result.expenses.slice(0, ROWS).map((e, i) => (
                <tr key={i}>
                  <td className="num">{previewDate(e)}</td>
                  <td className={s.tdTitle}>{e.title || '—'}</td>
                  <td className={`num ${s.right}`}>
                    {e.amount.toLocaleString('zh-TW')}
                    {/* 沒寫幣別的先不標，看套用到哪個行程（下方有說明） */}
                    {hasWrittenCurrency(newTrip, i) && <span className={s.dim}> {e.currency}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!empty && (
        <div className={s.block}>
          <div className={s.blockTitle}>建立為新行程</div>
          <Grid2>
            <TextInput label="行程名稱" value={name} placeholder={result.suggestedName} onChange={(e) => setName(e.target.value)} />
            <TextInput label="城市（選填）" value={city} placeholder={suggested || 'KYOTO'} autoCapitalize="characters" autoComplete="off" onChange={(e) => setCity(e.target.value)} />
          </Grid2>
          <p className={s.blockHint} aria-live="polite">
            {!city.trim() && suggested ? `沒填城市會用 ${suggested}（依每天的城市）。` : ''}
            {currencyHint(newTrip, cityFor)}
          </p>
          {willResolve && (
            <p className={s.blockHint}>建立後會用 AI 辨識每一站的導航地點（{AI_PLACES_COST_HINT}），可在 App 設定關閉。</p>
          )}
          {result.hasRelativeDays && (
            <TextInput
              label="出發日"
              type="date"
              value={start}
              hint="填了就會把「第幾天」換成實際日期；也可以之後再到行程設定填。"
              onChange={(e) => setStart(e.target.value)}
            />
          )}
          <Button variant="go" block disabled={busy} onClick={() => onCreate({ name: name.trim() || result.suggestedName, city: cityFor, startDate: start || null })}>
            建立為新行程
          </Button>
        </div>
      )}

      {!empty && trip && (
        <div className={s.block}>
          <div className={s.blockTitle}>或更新目前的行程</div>
          {relativeOnTrip && trip?.startDate && <p className={s.blockHint}>「第幾天」會依這趟行程的出發日 {fmtMD(trip.startDate)} 換算成日期。</p>}
          {unwritten > 0 && <p className={s.blockHint}>沒寫幣別的 {unwritten} 筆記帳會以這趟行程的 {trip.localCurrency} 計算。</p>}
          {confirmReplace && (
            <Note tone="warn">
              「{shortName(tripName, 14)}」有 {removed} 個行程點不在試算表裡，更新後會移除。相同的行程點會保留完成狀態與地圖位置。
            </Note>
          )}
          {nItems > 0 &&
            (confirmReplace ? (
              <div className={s.confirmRow}>
                <Button variant="plain" onClick={() => setConfirmReplace(false)}>
                  取消
                </Button>
                <Button variant="danger" block className={s.wrapBtn} disabled={busy} onClick={replace}>
                  確定更新並移除 {removed} 個
                </Button>
              </div>
            ) : (
              <Button variant="ghost" block icon="refresh" className={s.wrapBtn} disabled={busy} onClick={replace}>
                以試算表為準更新「{shortName(tripName, 7)}」
              </Button>
            ))}
          <Button variant="ghost" block icon="plus" className={s.wrapBtn} disabled={busy} onClick={() => onMerge('append')}>
            附加到「{shortName(tripName, 12)}」
          </Button>
        </div>
      )}

      {error && (
        <Note tone="bad">
          <strong>匯入沒有完成</strong>
          {error}
        </Note>
      )}
    </motion.section>
  );
});
