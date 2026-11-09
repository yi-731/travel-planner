/**
 * 新增／編輯行程點。
 * - 表單內容存在元件狀態裡，行程資料在背景更新（例如地圖定位寫回座標）也不會洗掉正在輸入的內容。
 * - 有改動時往下滑或點背景關閉，會先問要不要放棄變更。
 * - 地址欄貼上 Google 地圖分享連結會直接定位（座標來源記為 link），地址文字照原樣保留。
 */
import { useEffect, useId, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ITEM_TYPES } from '@/domain/constants';
import { tripDays } from '@/domain/dates';
import type { ISODate, Item, ItemType, LatLng, Trip } from '@/domain/types';
import { haptic } from '@/platform';
import { parseMapsLink } from '@/services/geocode';
import { useActiveTrip, useData } from '@/store/data';
import { useUI } from '@/store/ui';
import { Button, Empty, Grid2, Icon, Picker, Select, Sheet, TextArea, TextInput } from '@/ui';
import { dayOptionLabel, draftFromItem, fmtMDWeek, draftToPatch, emptyDraft, validateDraft, type DraftErrors, type ItemDraft } from './model';
import s from './plan.module.css';

const OTHER = '__other';
const NONE = '__none';
const DELETE_WINDOW_MS = 4000;

/** parseMapsLink 可能還在實作中，失敗一律當作不是連結 */
function safeParseLink(text: string): LatLng | null {
  try {
    return parseMapsLink(text);
  } catch {
    return null;
  }
}

export default function ItemFormSheet({ itemId, date }: { itemId?: string; date?: ISODate }) {
  const trip = useActiveTrip();
  // 打開時的那一筆（之後資料更新不影響表單初始值）
  const [original] = useState<Item | null>(() => (itemId && trip ? (trip.items.find((i) => i.id === itemId) ?? null) : null));
  if (!trip)
    return (
      <Sheet title="新增行程點">
        <Empty icon="calendar" title="還沒有旅程">
          先建立一趟旅程，才能加入行程點。
        </Empty>
      </Sheet>
    );
  if (itemId && !original)
    return (
      <Sheet title="找不到這個行程點">
        <Empty icon="info" title="可能已經被刪除">
          回到行程頁重新整理看看，或新增一個行程點。
        </Empty>
      </Sheet>
    );
  return <ItemForm trip={trip} original={original} initialDate={date} />;
}

function ItemForm({ trip, original, initialDate }: { trip: Trip; original: Item | null; initialDate?: ISODate }) {
  const ui = useUI;
  const selectedDate = useUI((st) => st.selectedDate);
  const upsertItem = useData((st) => st.upsertItem);
  const deleteItem = useData((st) => st.deleteItem);
  const days = useMemo(() => tripDays(trip), [trip]);

  const [initial] = useState<ItemDraft>(() => {
    if (original) return draftFromItem(original);
    const d = initialDate ?? selectedDate ?? days[0] ?? null;
    return emptyDraft(d);
  });
  const [draft, setDraft] = useState<ItemDraft>(initial);
  const [otherDate, setOtherDate] = useState(() => !!initial.date && !days.includes(initial.date));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [askDiscard, setAskDiscard] = useState(false);
  const [armedDelete, setArmedDelete] = useState(false);
  const titleId = useId();

  useEffect(() => {
    if (!armedDelete) return;
    const t = setTimeout(() => setArmedDelete(false), DELETE_WINDOW_MS);
    return () => clearTimeout(t);
  }, [armedDelete]);

  const set = <K extends keyof ItemDraft>(k: K, v: ItemDraft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
    if (askDiscard) setAskDiscard(false);
  };

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const linkGeo = useMemo(() => (draft.address.trim() ? safeParseLink(draft.address.trim()) : null), [draft.address]);
  const currency = trip.localCurrency;

  const close = () => {
    if (dirty && !askDiscard) {
      void haptic('warning');
      setAskDiscard(true);
      return;
    }
    ui.getState().closeSheet();
  };

  const save = () => {
    const errs = validateDraft(draft);
    if (Object.values(errs).some(Boolean)) {
      setErrors(errs);
      void haptic('error');
      if (errs.title) document.getElementById(titleId)?.focus();
      return;
    }
    const patch = draftToPatch(draft, original, safeParseLink);
    upsertItem(trip.id, patch);
    void haptic('success');
    const st = ui.getState();
    if (patch.date) st.selectDate(patch.date);
    st.toast('已儲存', 'good');
    st.closeSheet();
  };

  const remove = () => {
    if (!original) return;
    if (!armedDelete) {
      void haptic('warning');
      setArmedDelete(true);
      return;
    }
    deleteItem(trip.id, original.id);
    void haptic('success');
    const st = ui.getState();
    st.toast(`已刪除「${original.title}」`);
    // 也關掉底下這個行程點的地點頁，避免回到已刪除的內容
    st.closeSheet();
    for (let i = 0; i < 4; i++) {
      const top = ui.getState().sheets.at(-1);
      if (top && (top.name === 'place' || top.name === 'itemForm') && 'itemId' in top && top.itemId === original.id) ui.getState().closeSheet();
      else break;
    }
  };

  // 鍵盤上的「完成」只收起鍵盤，不直接儲存（避免打到一半就關掉）
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

  const dateValue = otherDate ? OTHER : draft.date || NONE;

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
    <div className={s.footRow}>
      {original && (
        <Button variant="danger" icon={armedDelete ? 'warning' : 'trash'} onClick={remove} aria-live="polite">
          {armedDelete ? '再按一次刪除' : '刪除'}
        </Button>
      )}
      <Button variant="go" block icon="check" onClick={() => save()}>
        儲存
      </Button>
    </div>
  );

  return (
    <Sheet
      eyebrow={
        original
          ? '編輯行程點'
          : draft.date && days.includes(draft.date)
            ? dayOptionLabel(days, draft.date)
            : draft.date
              ? fmtMDWeek(draft.date)
              : '還沒有日期'
      }
      title={original ? original.title : '新增行程點'}
      footer={footer}
      onClose={close}
    >
      <form className={s.form} onSubmit={onSubmit} onKeyDown={onKeyDown} noValidate>
        <TextInput
          id={titleId}
          label="名稱"
          placeholder="例如：清水寺"
          value={draft.title}
          autoFocus={!original}
          enterKeyHint="done"
          autoComplete="off"
          maxLength={120}
          aria-invalid={!!errors.title}
          hint={errors.title ? <span className={s.err}>{errors.title}</span> : undefined}
          onChange={(e) => set('title', e.target.value)}
        />

        <div className={s.fieldGroup} role="group" aria-label="類型">
          <span className={s.fieldLabel}>類型</span>
          <Picker<ItemType>
            ariaLabel="類型"
            options={ITEM_TYPES.map((t) => ({ key: t.key, label: t.label, color: t.color }))}
            value={draft.type}
            onChange={(v) => set('type', (Array.isArray(v) ? v[0] : v) ?? 'other')}
          />
        </div>

        <Select
          label="日期"
          value={dateValue}
          hint={errors.date ? <span className={s.err}>{errors.date}</span> : undefined}
          onChange={(e) => {
            const v = e.target.value;
            if (v === OTHER) {
              setOtherDate(true);
              if (!draft.date) set('date', days[0] ?? '');
            } else {
              setOtherDate(false);
              set('date', v === NONE ? '' : v);
            }
          }}
        >
          {days.map((d) => (
            <option key={d} value={d}>
              {dayOptionLabel(days, d)}
            </option>
          ))}
          {(!draft.date || original?.date == null) && !otherDate && <option value={NONE}>還沒有日期</option>}
          <option value={OTHER}>其他日期…</option>
        </Select>
        {otherDate && (
          <TextInput
            label="自訂日期"
            type="date"
            value={draft.date}
            onChange={(e) => set('date', e.target.value)}
            hint="選行程以外的日期，旅程的出發／回程日會自動延長。"
          />
        )}

        <TextInput
          label="時間"
          type="time"
          value={draft.time}
          hint={errors.time ? <span className={s.err}>{errors.time}</span> : undefined}
          onChange={(e) => set('time', e.target.value)}
        />

        <TextInput
          label="地址"
          placeholder="地址或地點名稱"
          value={draft.address}
          autoComplete="off"
          enterKeyHint="done"
          hint={
            linkGeo ? (
              <span className={s.ok}>
                <Icon name="check" size={12} stroke={2.6} />
                已從連結取得位置，儲存後會標在地圖上
              </span>
            ) : (
              '也可以貼上 Google 地圖分享連結，會自動定位'
            )
          }
          onChange={(e) => set('address', e.target.value)}
        />

        <Grid2>
          <TextInput
            label="停留分鐘"
            inputMode="numeric"
            placeholder="例如 90"
            value={draft.durationMin}
            enterKeyHint="done"
            hint={errors.durationMin ? <span className={s.err}>{errors.durationMin}</span> : undefined}
            onChange={(e) => set('durationMin', e.target.value)}
          />
          <TextInput
            label={`預估費用（${currency}）`}
            inputMode="decimal"
            placeholder="例如 1500"
            value={draft.cost}
            enterKeyHint="done"
            hint={errors.cost ? <span className={s.err}>{errors.cost}</span> : undefined}
            onChange={(e) => set('cost', e.target.value)}
          />
        </Grid2>

        <Grid2>
          <TextInput
            label="評分"
            inputMode="decimal"
            placeholder="例如 4.5"
            value={draft.rating}
            enterKeyHint="done"
            hint={errors.rating ? <span className={s.err}>{errors.rating}</span> : undefined}
            onChange={(e) => set('rating', e.target.value)}
          />
          <TextInput
            label="連結"
            type="url"
            inputMode="url"
            placeholder="https://"
            value={draft.link}
            autoComplete="off"
            autoCapitalize="off"
            enterKeyHint="done"
            onChange={(e) => set('link', e.target.value)}
          />
        </Grid2>

        <TextArea label="備註" placeholder="訂位資訊、要買的東西、注意事項…" value={draft.note} onChange={(e) => set('note', e.target.value)} />
      </form>
    </Sheet>
  );
}
