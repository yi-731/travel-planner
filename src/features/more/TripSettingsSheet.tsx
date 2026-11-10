/**
 * 行程設定：名稱、城市（自動定位）、航段、日期、幣別與匯率、預算、旅伴。
 * - 表單內容存在元件狀態，背景資料更新（天氣、匯率）不會洗掉正在輸入的內容。
 * - 有改動時關閉會先確認；儲存時城市有改就重新定位（失敗仍會儲存，並說明原因）。
 * - 儲存中不能放棄修改；儲存完成時這頁已經不在最上層（或已關閉）就不再動彈出頁。
 * - 改出發日且「跟著移動」開著：回程日一起移動（使用者沒自己改回程日時），行程天數不變。
 * - 套用規則（日期平移、「第 N 天」換算）在 ./model.ts，有測試。
 */
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { COMMON_CURRENCIES } from '@/domain/constants';
import { fmtMoney } from '@/domain/money';
import type { Trip } from '@/domain/types';
import { haptic } from '@/platform';
import { fetchRate } from '@/services/fx';
import { refreshRate } from '@/services/hooks';
import { geocodeCity, type CityGeo } from '@/services/weather';
import { useData } from '@/store/data';
import { useUI } from '@/store/ui';
import { Button, Empty, Field, Grid2, Icon, Note, Select, Sheet, Spinner, TextInput } from '@/ui';
import { errorText } from './actions';
import { Switch } from './Switch';
import {
  applyForm,
  currencyChoices,
  currencyLabel,
  fmtClock,
  fmtRateInput,
  formDirty,
  initialForm,
  memberError,
  memberExpenseCount,
  parseDecimal,
  ratePreview,
  shiftedEndDate,
  shiftPlanFor,
  validateForm,
  type TripForm,
} from './model';
import s from './more.module.css';

export default function TripSettingsSheet() {
  // 開啟當下的行程；之後切換行程也不會改到別的行程
  const [tripId] = useState(() => useData.getState().activeTripId);
  const trip = useData((st) => (tripId ? st.trips[tripId] : undefined));
  if (!trip)
    return (
      <Sheet title="行程設定">
        <Empty icon="info" title="找不到這趟行程">
          可能已經被刪除。回到「更多」重新選一個行程。
        </Empty>
      </Sheet>
    );
  return <TripSettingsForm trip={trip} />;
}

type GeoState =
  | { status: 'idle' }
  | { status: 'loading'; city: string }
  | { status: 'ok'; city: string; geo: CityGeo }
  | { status: 'notfound'; city: string }
  | { status: 'error'; city: string; message: string };

type RateState = { status: 'idle' } | { status: 'loading' } | { status: 'error'; message: string };

function TripSettingsForm({ trip }: { trip: Trip }) {
  const closeSheet = useUI((st) => st.closeSheet);
  const toast = useUI((st) => st.toast);
  const reduce = useReducedMotion();
  const [initial, setInitial] = useState(() => initialForm(trip));
  const [f, setF] = useState<TripForm>(initial);
  const [geo, setGeo] = useState<GeoState>({ status: 'idle' });
  const [rateState, setRateState] = useState<RateState>({ status: 'idle' });
  const [memberInput, setMemberInput] = useState('');
  const [memberMsg, setMemberMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  /** 儲存後定位失敗：留在這頁說明 */
  const [savedNote, setSavedNote] = useState<string | null>(null);
  /** 儲存中按了關閉：提示會自動關閉 */
  const [closeAsked, setCloseAsked] = useState(false);
  /** 使用者自己改過回程日：改出發日時就不再自動移動回程日 */
  const endEdited = useRef(false);
  const geoSeq = useRef(0);
  const rateSeq = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  /** 最新的表單內容（儲存等待定位時，用來判斷使用者有沒有又改了東西） */
  const latest = useRef(f);
  latest.current = f;

  const patch = (p: Partial<TripForm>) => {
    setF((prev) => ({ ...prev, ...p }));
    setConfirmClose(false);
    setSavedNote(null);
  };
  const set = <K extends keyof TripForm>(k: K, v: TripForm[K]) => patch({ [k]: v } as Partial<TripForm>);

  const errors = validateForm(f);
  const firstError = Object.values(errors)[0];
  const dirty = formDirty(f, initial);
  const cityChanged = f.city.trim() !== trip.city.trim();
  const plan = shiftPlanFor(trip, f.startDate);
  const shift = plan.days;
  const sameCurrency = f.localCurrency === f.homeCurrency;
  const rateNum = sameCurrency ? 1 : parseDecimal(f.rate);
  const preview = rateNum != null && Number.isFinite(rateNum) ? ratePreview(rateNum) : null;
  const currencies = currencyChoices(COMMON_CURRENCIES, f.localCurrency, f.homeCurrency, trip.localCurrency, trip.homeCurrency);

  /* ---------- 背景查到匯率（例如新行程剛建立）：匯率欄位沒動過就跟著更新 ---------- */
  useEffect(() => {
    const next = fmtRateInput(trip.rate);
    // 儲存中不動表單（存完會再檢查一次）
    if (!next || saving) return;
    const untouched = (a: TripForm, b: TripForm) =>
      a.rate === b.rate && a.rateUpdatedAt === b.rateUpdatedAt && a.localCurrency === b.localCurrency && a.homeCurrency === b.homeCurrency;
    if (!untouched(f, initial) || f.localCurrency !== trip.localCurrency || f.homeCurrency !== trip.homeCurrency) return;
    if (f.rate === next && f.rateUpdatedAt === trip.rateUpdatedAt) return;
    const synced = { rate: next, rateUpdatedAt: trip.rateUpdatedAt };
    setInitial((prev) => ({ ...prev, ...synced }));
    setF((prev) => ({ ...prev, ...synced }));
    // 只在行程的匯率變了（或剛存完）時檢查；表單本身的變化不用
  }, [trip.rate, trip.rateUpdatedAt, saving]);

  /* ---------- 日期 ---------- */
  const changeStart = (v: string) => {
    const p: Partial<TripForm> = { startDate: v };
    // 行程點跟著移動時，回程日也移動同樣天數（使用者自己改過回程日就不動）
    if (!endEdited.current) p.endDate = shiftedEndDate(initial, v, f.shiftItems && shiftPlanFor(trip, v).days !== 0);
    patch(p);
  };
  const changeShift = (on: boolean) => {
    const p: Partial<TripForm> = { shiftItems: on };
    if (!endEdited.current) p.endDate = shiftedEndDate(initial, f.startDate, on && shift !== 0);
    patch(p);
  };

  /* ---------- 城市定位 ---------- */
  async function lookupCity(city: string): Promise<GeoState> {
    const q = city.trim();
    if (!q) return { status: 'idle' };
    const seq = ++geoSeq.current;
    setGeo({ status: 'loading', city: q });
    let next: GeoState;
    try {
      const g = await geocodeCity(q);
      next = g ? { status: 'ok', city: q, geo: g } : { status: 'notfound', city: q };
    } catch (e) {
      next = { status: 'error', city: q, message: errorText(e, '暫時連不上城市定位服務。') };
    }
    if (seq === geoSeq.current) setGeo(next);
    return next;
  }
  const geoFor = (city: string): GeoState => (geo.status !== 'idle' && geo.city === city.trim() ? geo : { status: 'idle' });

  /* ---------- 匯率 ---------- */
  async function updateRate(local = f.localCurrency, home = f.homeCurrency) {
    if (local === home) {
      setF((prev) => ({ ...prev, rate: '1', rateUpdatedAt: Date.now() }));
      setRateState({ status: 'idle' });
      return;
    }
    const seq = ++rateSeq.current;
    setRateState({ status: 'loading' });
    try {
      const stored = useData.getState().trips[trip.id];
      // 幣別跟已儲存的一樣：用 refreshRate 一併寫回行程；改了幣別：先只查匯率，按儲存才寫入
      const saved = !!stored && stored.localCurrency === local && stored.homeCurrency === home;
      const r = saved ? await refreshRate(trip.id) : await fetchRate(local, home);
      if (seq !== rateSeq.current || !alive.current) return;
      // 已寫回行程的：用行程上的更新時間，儲存時就知道兩邊是同一個匯率
      const at = (saved && useData.getState().trips[trip.id]?.rateUpdatedAt) || Date.now();
      setF((prev) => (prev.localCurrency === local && prev.homeCurrency === home ? { ...prev, rate: fmtRateInput(r), rateUpdatedAt: at } : prev));
      setRateState({ status: 'idle' });
      void haptic('success');
    } catch (e) {
      if (seq !== rateSeq.current) return;
      setRateState({ status: 'error', message: errorText(e, '暫時查不到即時匯率，請確認網路後再試一次，或直接手動輸入。') });
    }
  }
  const changeCurrency = (k: 'localCurrency' | 'homeCurrency', v: string) => {
    set(k, v);
    const local = k === 'localCurrency' ? v : f.localCurrency;
    const home = k === 'homeCurrency' ? v : f.homeCurrency;
    void updateRate(local, home);
  };

  /* ---------- 旅伴 ---------- */
  const addMember = () => {
    const err = memberError(memberInput, f.members);
    if (err) {
      setMemberMsg(err);
      void haptic('warning');
      return;
    }
    set('members', [...f.members, memberInput.trim()]);
    setMemberInput('');
    setMemberMsg(null);
    void haptic('light');
  };
  const removeMember = (m: string) => {
    if (f.members.length <= 1) return;
    set('members', f.members.filter((x) => x !== m));
    const n = memberExpenseCount(trip, m);
    setMemberMsg(n ? `「${m}」有 ${n} 筆記帳紀錄，移除後這些花費不會算進分帳。改變心意可以再加回來。` : null);
    void haptic('light');
  };
  const onMemberKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      addMember();
    }
  };

  /* ---------- 儲存／關閉 ---------- */
  async function save() {
    setTouched(true);
    if (saving) return;
    if (firstError) {
      void haptic('warning');
      return;
    }
    // 這一頁（彈出頁堆疊最上層）；儲存完只關這一頁，不會關到後來打開的別頁
    const sheets = useUI.getState().sheets;
    const mine = sheets[sheets.length - 1];
    const snap = f;
    const opened = initial;
    setSaving(true);
    let cityGeo: CityGeo | undefined;
    let note: string | null = null;
    const city = f.city.trim();
    if (city && city !== trip.city.trim()) {
      const known = geoFor(city);
      const res = known.status === 'ok' || known.status === 'notfound' ? known : await lookupCity(city);
      if (res.status === 'ok') cityGeo = res.geo;
      else if (res.status === 'notfound')
        note = `已儲存，但找不到「${city}」的位置，天氣和地圖會用不到。可以改成完整名稱或英文（例如 Osaka）再儲存一次。`;
      else if (res.status === 'error') note = `已儲存。${res.message}之後會自動再定位一次。`;
    }
    // 等定位時這頁被關掉了（例如點了通知）：不寫入，也不動其他彈出頁
    if (!alive.current) return;
    useData.getState().mutateTrip(trip.id, (d) => applyForm(d, snap, { cityGeo, initial: opened }));
    setInitial(snap);
    setSaving(false);
    setCloseAsked(false);
    void haptic('success');
    endEdited.current = false;
    // 等定位時又改了內容：留在這頁，提醒再存一次
    if (formDirty(latest.current, snap)) {
      toast('已儲存。剛才等待時改的內容還沒存，請再按一次「儲存」。', 'good', 5000);
      return;
    }
    toast('已儲存', 'good');
    if (note) {
      setSavedNote(note);
      return;
    }
    const now = useUI.getState().sheets;
    if (now[now.length - 1] === mine) closeSheet();
  }

  const requestClose = () => {
    if (saving) {
      // 已經在儲存：不能放棄，存好會自動關閉
      void haptic('warning');
      setCloseAsked(true);
      return;
    }
    if (dirty && !savedNote && !confirmClose) {
      void haptic('warning');
      setConfirmClose(true);
      return;
    }
    closeSheet();
  };

  /* ---------- 城市提示 ---------- */
  const g = geoFor(f.city);
  let cityHint: ReactNode = '例如 KYOTO、首爾';
  if (!cityChanged && trip.cityGeo?.label) cityHint = <Located label={trip.cityGeo.label} />;
  else if (g.status === 'loading') cityHint = <span className={s.hintLine}><Spinner /> 定位中…</span>;
  else if (g.status === 'ok') cityHint = <Located label={g.geo.label} />;
  else if (cityChanged && f.city.trim()) cityHint = '儲存時會自動定位，天氣與地圖會用這個城市';

  const footer = confirmClose ? (
    <div className={s.confirmFoot}>
      <span className={s.confirmText}>還沒儲存，要放棄這些修改嗎？</span>
      <div className={s.footBtns}>
        <Button variant="ghost" onClick={() => setConfirmClose(false)}>
          繼續編輯
        </Button>
        <Button variant="danger" onClick={closeSheet}>
          放棄修改
        </Button>
      </div>
    </div>
  ) : savedNote ? (
    <Button variant="go" block icon="check" onClick={closeSheet}>
      完成
    </Button>
  ) : (
    <>
      {touched && firstError && !saving && (
        <p className={s.footError} role="alert">
          {firstError}
        </p>
      )}
      {saving && closeAsked && (
        <p className={s.footNote} role="status">
          正在儲存，完成後會自動關閉。
        </p>
      )}
      <Button variant="go" block icon={saving ? undefined : 'check'} disabled={saving} onClick={() => void save()}>
        {saving ? (
          <span className={s.busyLabel}>
            <Spinner /> {cityChanged ? '定位城市中…' : '儲存中…'}
          </span>
        ) : (
          '儲存'
        )}
      </Button>
    </>
  );

  const show = (k: keyof typeof errors) => (touched || k === 'dates' ? errors[k] : undefined);

  return (
    <Sheet title="行程設定" eyebrow={trip.isExample ? '範例行程 · 儲存後就是你的' : undefined} footer={footer} onClose={requestClose}>
      <AnimatePresence initial={false}>
        {savedNote && (
          <motion.div key="saved" initial={reduce ? false : { opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Note tone="warn">{savedNote}</Note>
          </motion.div>
        )}
      </AnimatePresence>

      <section className={s.formSec} aria-label="基本資料">
        <TextInput label="行程名稱" value={f.name} placeholder="例如 京都五日" maxLength={40} onChange={(e) => set('name', e.target.value)} enterKeyHint="next" />
        {show('name') && <p className={s.fieldError}>{errors.name}</p>}
        <TextInput
          label="城市大字"
          hint={cityHint}
          value={f.city}
          placeholder="KYOTO"
          maxLength={24}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          onChange={(e) => set('city', e.target.value)}
          onBlur={() => {
            if (cityChanged && f.city.trim() && geoFor(f.city).status === 'idle') void lookupCity(f.city);
          }}
        />
        {cityChanged && g.status === 'notfound' && (
          <Note tone="warn">找不到「{g.city}」。試試完整名稱或英文（例如 Osaka、Seoul）；也可以先儲存，只是天氣與地圖會用不到。</Note>
        )}
        {cityChanged && g.status === 'error' && <Note tone="warn">{g.message}可以先儲存，之後會自動再定位一次。</Note>}
        <TextInput
          label="航段代碼"
          hint="顯示在首頁，例如 TPE → KIX"
          value={f.routeCode}
          placeholder="TPE → KIX"
          maxLength={24}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => set('routeCode', e.target.value)}
        />
      </section>

      <section className={s.formSec} aria-labelledby="ts-dates">
        <h3 id="ts-dates" className={s.secTitle}>日期</h3>
        <Grid2>
          <TextInput label="出發日" type="date" value={f.startDate} onChange={(e) => changeStart(e.target.value)} />
          <TextInput
            label="回程日"
            type="date"
            value={f.endDate}
            min={f.startDate || undefined}
            onChange={(e) => {
              endEdited.current = true;
              set('endDate', e.target.value);
            }}
          />
        </Grid2>
        {show('dates') && <p className={s.fieldError}>{errors.dates}</p>}
        {shift !== 0 && (
          <div className={s.switchRow}>
            <span className={s.switchText}>
              <b>{shiftTitle(plan.items, plan.expenses)}</b>
              <small>{shiftHint(plan.items, plan.expenses, shift, !!initial.endDate && !endEdited.current)}</small>
            </span>
            <Switch checked={f.shiftItems} onChange={changeShift} label={`${shiftTitle(plan.items, plan.expenses)}（跟著出發日）`} />
          </div>
        )}
      </section>

      <section className={s.formSec} aria-labelledby="ts-money">
        <h3 id="ts-money" className={s.secTitle}>幣別與預算</h3>
        <Grid2>
          <Select label="當地貨幣" value={f.localCurrency} onChange={(e) => changeCurrency('localCurrency', e.target.value)}>
            {currencies.map((c) => (
              <option key={c} value={c}>
                {currencyLabel(c)}
              </option>
            ))}
          </Select>
          <Select label="本國貨幣" value={f.homeCurrency} onChange={(e) => changeCurrency('homeCurrency', e.target.value)}>
            {currencies.map((c) => (
              <option key={c} value={c}>
                {currencyLabel(c)}
              </option>
            ))}
          </Select>
        </Grid2>

        {!sameCurrency && (
          <Field label={`匯率（1 ${f.localCurrency} = ? ${f.homeCurrency}）`}>
            {(id) => (
              <div className={s.rateRow}>
                <input
                  id={id}
                  className={`${s.input} num`}
                  inputMode="decimal"
                  value={f.rate}
                  placeholder="0.21"
                  autoComplete="off"
                  onChange={(e) => patch({ rate: e.target.value, rateUpdatedAt: undefined })}
                />
                <Button variant="soft" icon={rateState.status === 'loading' ? undefined : 'refresh'} disabled={rateState.status === 'loading'} onClick={() => void updateRate()}>
                  {rateState.status === 'loading' ? (
                    <span className={s.busyLabel}>
                      <Spinner /> 查詢中
                    </span>
                  ) : (
                    '更新即時匯率'
                  )}
                </Button>
              </div>
            )}
          </Field>
        )}
        {!sameCurrency && (
          <div className={s.rateMeta}>
            {preview && (
              <span className="num">
                {fmtMoney(preview.amount)} {f.localCurrency} ≈ {fmtMoney(preview.converted)} {f.homeCurrency}
              </span>
            )}
            {f.rateUpdatedAt && <span className="num">更新於 {fmtClock(f.rateUpdatedAt)}</span>}
          </div>
        )}
        {rateState.status === 'error' && <Note tone="bad">{rateState.message}</Note>}
        {show('rate') && <p className={s.fieldError}>{errors.rate}</p>}

        <TextInput
          label={`總預算（${f.homeCurrency}）`}
          hint="記帳頁會顯示還剩多少；不需要可以留白"
          inputMode="numeric"
          value={f.budget}
          placeholder="45000"
          autoComplete="off"
          onChange={(e) => set('budget', e.target.value)}
        />
        {show('budget') && <p className={s.fieldError}>{errors.budget}</p>}
      </section>

      <section className={s.formSec} aria-labelledby="ts-members">
        <h3 id="ts-members" className={s.secTitle}>旅伴</h3>
        <ul className={s.members} aria-label="旅伴">
          <AnimatePresence initial={false}>
            {f.members.map((m) => (
              <motion.li
                key={m}
                className={s.member}
                layout={!reduce}
                initial={reduce ? false : { opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.18 }}
              >
                <span className={s.memberName}>{m}</span>
                {f.members.length > 1 && (
                  <button type="button" className={s.memberX} aria-label={`移除${m}`} onClick={() => removeMember(m)}>
                    <Icon name="close" size={12} stroke={2.6} />
                  </button>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
        <div className={s.addRow}>
          <input
            className={s.input}
            value={memberInput}
            placeholder="新增旅伴的名字"
            aria-label="新增旅伴的名字"
            maxLength={20}
            enterKeyHint="done"
            onChange={(e) => {
              setMemberInput(e.target.value);
              setMemberMsg(null);
            }}
            onKeyDown={onMemberKey}
          />
          <button type="button" className={s.addBtn} aria-label="加入旅伴" disabled={!memberInput.trim()} onClick={addMember}>
            <Icon name="plus" size={20} stroke={2.4} />
          </button>
        </div>
        {memberMsg && <p className={s.fieldHint}>{memberMsg}</p>}
        {show('members') && <p className={s.fieldError}>{errors.members}</p>}
      </section>
    </Sheet>
  );
}

const shiftTitle = (items: number, expenses: number) =>
  items && expenses ? '行程點和記帳跟著移動' : expenses ? '記帳跟著移動' : '行程點跟著移動';

/** 「5 個行程點、2 筆記帳和回程日一起往後 2 天」 */
function shiftHint(items: number, expenses: number, days: number, withEnd: boolean): string {
  const parts = [items ? `${items} 個行程點` : '', expenses ? `${expenses} 筆記帳` : '', withEnd ? '回程日' : ''].filter(Boolean);
  const what = parts.length > 1 ? `${parts.slice(0, -1).join('、')}和${parts[parts.length - 1]}` : parts[0];
  return `${what}一起${days > 0 ? '往後' : '往前'} ${Math.abs(days)} 天`;
}

function Located({ label }: { label: string }) {
  return (
    <span className={s.hintLine}>
      <Icon name="pin" size={12} stroke={2.4} />
      已定位：{label}
    </span>
  );
}
