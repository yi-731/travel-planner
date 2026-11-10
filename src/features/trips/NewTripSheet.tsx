/**
 * 新增行程：名稱、城市、日期、幣別。上方預覽卡即時呈現首頁大字的樣子。
 * 建立後立即關閉並回到首頁；城市定位與匯率在背景補上（enrich.ts）。
 * 填了東西後誤點背景／往下滑，先在底部問一次要不要放棄，不直接丟掉。
 */
import { useId, useMemo, useState } from 'react';
import { diffDays } from '@/domain/dates';
import { haptic } from '@/platform';
import { findCityAlias } from '@/services/weather';
import { useData } from '@/store';
import { useUI } from '@/store/ui';
import { Button, Grid2, Orb, Select, Sheet, TextInput } from '@/ui';
import { enrichNewTrip } from './enrich';
import { currencyForCountry, currencyLabel, currencyList, dateRange, isCjk } from './model';
import s from './trips.module.css';

export default function NewTripSheet() {
  const defaultHome = useData((st) => st.settings.defaultHomeCurrency) || 'TWD';
  const nameId = useId();
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [local, setLocal] = useState('JPY');
  const [localTouched, setLocalTouched] = useState(false);
  const [home, setHome] = useState(defaultHome);
  const [nameError, setNameError] = useState(false);
  const [askDiscard, setAskDiscard] = useState(false);

  const codes = useMemo(() => currencyList([local, home]), [local, home]);
  const dateError = !!start && !!end && end < start;
  // 城市帶出的當地貨幣跟著 city 算；手動改過貨幣才看 localTouched
  const dirty = !!(name.trim() || city.trim() || start || end || localTouched || home !== defaultHome);

  /** 又動了欄位：收起「要放棄嗎？」，回到「建立」 */
  const edited = () => {
    if (askDiscard) setAskDiscard(false);
  };

  const close = () => {
    if (dirty && !askDiscard) {
      void haptic('warning');
      setAskDiscard(true);
      return;
    }
    useUI.getState().closeSheet();
  };

  const onCity = (v: string) => {
    setCity(v);
    edited();
    if (localTouched) return;
    // 認得的城市（KYOTO、首爾、Paris…）自動帶入當地貨幣；使用者手動改過就不再動
    const cur = currencyForCountry(findCityAlias(v.trim())?.cc);
    if (cur) setLocal(cur);
  };

  const onStart = (v: string) => {
    setStart(v);
    edited();
    if (v && end && end < v) setEnd(v);
  };

  const create = () => {
    const title = name.trim();
    if (!title) {
      setNameError(true);
      void haptic('warning');
      document.getElementById(nameId)?.focus();
      return;
    }
    if (dateError) {
      void haptic('warning');
      return;
    }
    const id = useData.getState().createTrip({
      name: title,
      city: city.trim(),
      startDate: start || null,
      endDate: end || null,
      localCurrency: local,
      homeCurrency: home,
      rate: 1,
    });
    enrichNewTrip(id);
    void haptic('success');
    const ui = useUI.getState();
    ui.closeAllSheets();
    ui.selectDate(null);
    ui.setTab('home');
    ui.toast('已建立', 'good');
  };

  return (
    <Sheet
      title="要去哪裡？"
      onClose={close}
      footer={
        askDiscard ? (
          <div className={s.discard}>
            <div className={s.discardText} role="alert">
              還沒建立，要放棄這趟行程嗎？
            </div>
            <div className={s.footRow}>
              <Button variant="ghost" onClick={() => setAskDiscard(false)}>
                繼續填寫
              </Button>
              <Button variant="danger" onClick={() => useUI.getState().closeSheet()}>
                放棄
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="go" block onClick={create}>
            建立
          </Button>
        )
      }
    >
      <Preview name={name} city={city} start={start} end={end} local={local} home={home} />

      <TextInput
        id={nameId}
        label="行程名稱"
        placeholder="例如：京阪奈五日"
        value={name}
        enterKeyHint="next"
        aria-invalid={nameError || undefined}
        hint={nameError ? <span className={s.err}>請輸入行程名稱，之後也可以再改。</span> : undefined}
        onChange={(e) => {
          setName(e.target.value);
          edited();
          if (e.target.value.trim()) setNameError(false);
        }}
      />
      <TextInput
        label="城市"
        placeholder="KYOTO、首爾、Paris"
        value={city}
        autoCapitalize="characters"
        autoComplete="off"
        enterKeyHint="done"
        hint="首頁大字顯示的城市，也用來查天氣。英文名稱最好看。"
        onChange={(e) => onCity(e.target.value)}
      />
      <Grid2>
        <TextInput label="出發日" type="date" value={start} onChange={(e) => onStart(e.target.value)} />
        <TextInput
          label="回程日"
          type="date"
          value={end}
          min={start || undefined}
          aria-invalid={dateError || undefined}
          onChange={(e) => {
            setEnd(e.target.value);
            edited();
          }}
        />
      </Grid2>
      {dateError && <p className={s.errLine} role="alert">回程日比出發日早，請重新選擇回程日。</p>}
      <Grid2>
        <Select
          label="當地貨幣"
          value={local}
          onChange={(e) => {
            setLocal(e.target.value);
            setLocalTouched(true);
            edited();
          }}
        >
          {codes.map((c) => (
            <option key={c} value={c}>
              {currencyLabel(c)}
            </option>
          ))}
        </Select>
        <Select
          label="本國貨幣"
          value={home}
          onChange={(e) => {
            setHome(e.target.value);
            edited();
          }}
        >
          {codes.map((c) => (
            <option key={c} value={c}>
              {currencyLabel(c)}
            </option>
          ))}
        </Select>
      </Grid2>
    </Sheet>
  );
}

/** 預覽卡：日落光球＋霧面玻璃，城市大字即時更新 */
function Preview({ name, city, start, end, local, home }: { name: string; city: string; start: string; end: string; local: string; home: string }) {
  const c = city.trim();
  const range = dateRange(start || null, end || null);
  const days = start && end && end >= start ? diffDays(start, end) + 1 : 0;
  return (
    <div className={s.preview} aria-hidden>
      <Orb size={270} halo style={{ right: -84, top: -120 }} />
      <Orb size={196} style={{ right: -48, top: -78 }} />
      <div className={s.previewGlass}>
        <span className={`eyebrow ${s.previewEyebrow}`}>{name.trim() || '新行程'}</span>
        {c ? (
          <span className={isCjk(c) ? s.previewCjk : `serif ${s.previewCity}`}>{c}</span>
        ) : (
          <span className={s.previewEmpty}>目的地</span>
        )}
        <span className={`num ${s.previewMeta}`}>
          <span>{range ? (days > 1 ? `${range} · ${days} 天` : range) : '日期未定'}</span>
          <span className={s.previewFx}>{local === home ? local : `${local} → ${home}`}</span>
        </span>
      </div>
    </div>
  );
}
