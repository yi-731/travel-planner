/**
 * 記一筆／編輯花費。
 * - 表單內容存在元件狀態，資料在背景更新也不會洗掉正在輸入的內容。
 * - 有改動時往下滑或點背景關閉，會先問要不要放棄。
 * - 收據照片存在 IndexedDB（blobStore），這裡負責清掉沒用到的照片。
 * - fromAI：prefill 是 AI 收據辨識結果（由「拍收據」帶入），表單會提示使用者確認。
 */
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { expenseCategory } from '@/domain/constants';
import { tripDays } from '@/domain/dates';
import { fmtMoney, toHome } from '@/domain/money';
import type { Expense, ExpenseCategory, ISODate, Trip } from '@/domain/types';
import { haptic, pickImage } from '@/platform';
import { blobStore } from '@/store/persist';
import { useActiveTrip, useData } from '@/store/data';
import { useUI } from '@/store/ui';
import { Button, Empty, Icon, Note, Picker, Select, Sheet, Spinner, TextInput, useBlobUrl } from '@/ui';
import {
  categoryOptions,
  currencyOptions,
  dayNumber,
  defaultExpenseDate,
  fmtDayHead,
  fmtRate,
  hasRate,
  normalizeSplit,
  parseAmount,
  sanitizeAmountInput,
} from './model';
import s from './money.module.css';

const OTHER = '__other';
const DELETE_WINDOW_MS = 4000;

export default function ExpenseFormSheet({ expenseId, prefill, fromAI }: { expenseId?: string; prefill?: Partial<Expense>; fromAI?: boolean }) {
  const trip = useActiveTrip();
  const [original] = useState<Expense | null>(() => (expenseId && trip ? (trip.expenses.find((e) => e.id === expenseId) ?? null) : null));
  if (!trip)
    return (
      <Sheet title="記一筆">
        <Empty icon="wallet" title="還沒有旅程">
          先建立一趟旅程，才能開始記帳。
        </Empty>
      </Sheet>
    );
  if (expenseId && !original)
    return (
      <Sheet title="找不到這筆花費">
        <Empty icon="info" title="可能已經被刪除">
          回到記帳頁看看，或重新記一筆。
        </Empty>
      </Sheet>
    );
  return <ExpenseForm trip={trip} original={original} prefill={prefill} fromAI={!!fromAI} />;
}

interface Draft {
  amount: string;
  currency: string;
  category: ExpenseCategory;
  title: string;
  date: ISODate;
  payer: string;
  /** 畫面上勾選的分攤者（存檔時全員會存成空陣列） */
  split: string[];
  receiptBlobKey: string | undefined;
}

function initialDraft(trip: Trip, src: Partial<Expense> | null, selected: ISODate | null): Draft {
  const members = trip.members.length ? trip.members : ['我'];
  const split = src?.split?.length ? src.split.filter((m) => members.includes(m)) : members;
  return {
    amount: src?.amount != null && src.amount > 0 ? String(src.amount) : '',
    currency: src?.currency || trip.localCurrency,
    category: src?.category ?? 'food',
    // 標題當初是自動用分類名稱填的：顯示成空白，改分類時會跟著換
    title: src?.title && src.title !== expenseCategory(src.category).label ? src.title : '',
    date: src?.date || defaultExpenseDate(trip, selected),
    payer: src?.payer || members[0],
    split: split.length ? split : members,
    receiptBlobKey: src?.receiptBlobKey,
  };
}

function ExpenseForm({ trip, original, prefill, fromAI: aiPrefill }: { trip: Trip; original: Expense | null; prefill?: Partial<Expense>; fromAI: boolean }) {
  const ui = useUI;
  const upsertExpense = useData((st) => st.upsertExpense);
  const deleteExpense = useData((st) => st.deleteExpense);
  const days = useMemo(() => tripDays(trip), [trip]);
  const members = trip.members.length ? trip.members : ['我'];
  const multi = members.length > 1;

  const [initial] = useState<Draft>(() => initialDraft(trip, original ?? prefill ?? null, ui.getState().selectedDate));
  const [draft, setDraft] = useState<Draft>(initial);
  const [otherDate, setOtherDate] = useState(() => !days.includes(initial.date));
  const [amountErr, setAmountErr] = useState<string | null>(null);
  const [askDiscard, setAskDiscard] = useState(false);
  const [armedDelete, setArmedDelete] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const amountId = useId();

  // 這次開表單才新增的照片（含「拍收據」帶進來的）；沒存檔就要清掉
  const fresh = useRef<Set<string>>(new Set(!original && prefill?.receiptBlobKey ? [prefill.receiptBlobKey] : []));
  const fromAI = !original && aiPrefill;

  useEffect(() => {
    if (!armedDelete) return;
    const t = setTimeout(() => setArmedDelete(false), DELETE_WINDOW_MS);
    return () => clearTimeout(t);
  }, [armedDelete]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    if (askDiscard) setAskDiscard(false);
  };

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial) || fresh.current.size > 0;
  const amount = parseAmount(draft.amount);
  const converted = amount != null ? toHome(trip, amount, draft.currency) : null;
  const rateKnown = hasRate(trip, draft.currency);
  const cat = expenseCategory(draft.category);
  const sharers = draft.split.length ? draft.split.length : members.length;

  /** 清掉不再使用的照片（keep 以外、這次新增的） */
  const dropFresh = (keep?: string) => {
    for (const k of fresh.current) if (k !== keep) void blobStore.remove(k).catch(() => undefined);
    fresh.current.clear();
  };

  const close = () => {
    if (dirty && !askDiscard) {
      void haptic('warning');
      setAskDiscard(true);
      return;
    }
    dropFresh();
    ui.getState().closeSheet();
  };

  const save = () => {
    if (amount == null) {
      setAmountErr(draft.amount.trim() ? '金額看起來不對，只要輸入數字，例如 1280。' : '先輸入金額，例如 1280。');
      void haptic('error');
      document.getElementById(amountId)?.focus();
      return;
    }
    const patch: Partial<Expense> & Pick<Expense, 'amount'> = {
      ...(original ? { id: original.id } : {}),
      amount,
      currency: draft.currency,
      category: draft.category,
      title: draft.title.trim() || cat.label,
      date: draft.date || defaultExpenseDate(trip, null),
      payer: multi ? draft.payer : members[0],
      split: multi ? normalizeSplit(members, draft.split) : [],
      receiptBlobKey: draft.receiptBlobKey,
    };
    upsertExpense(trip.id, patch);
    // 舊收據被換掉或移除：刪掉舊照片
    if (original?.receiptBlobKey && original.receiptBlobKey !== draft.receiptBlobKey) void blobStore.remove(original.receiptBlobKey).catch(() => undefined);
    dropFresh(draft.receiptBlobKey);
    void haptic('success');
    const st = ui.getState();
    st.toast(original ? '已儲存變更' : '已記帳', 'good');
    st.closeSheet();
  };

  const remove = () => {
    if (!original) return;
    if (!armedDelete) {
      void haptic('warning');
      setArmedDelete(true);
      return;
    }
    deleteExpense(trip.id, original.id);
    if (original.receiptBlobKey) void blobStore.remove(original.receiptBlobKey).catch(() => undefined);
    dropFresh();
    void haptic('success');
    const st = ui.getState();
    st.toast(`已刪除「${original.title || expenseCategory(original.category).label}」`);
    st.closeSheet();
  };

  // 不鎖按鈕：iOS Safari 取消選照片時不一定會通知，鎖住會讓按鈕永遠按不了
  const attach = async () => {
    try {
      const blob = await pickImage();
      if (!blob) return;
      const key = await blobStore.put(blob);
      // 換照片：前一張若是這次新增的，直接清掉
      const prev = draft.receiptBlobKey;
      if (prev && fresh.current.has(prev)) {
        void blobStore.remove(prev).catch(() => undefined);
        fresh.current.delete(prev);
      }
      fresh.current.add(key);
      set('receiptBlobKey', key);
      setExpanded(false);
      void haptic('success');
    } catch {
      ui.getState().toast('照片存不進手機，可能是儲存空間不足。清出一些空間後再試一次。', 'bad');
    }
  };

  const detach = () => {
    const prev = draft.receiptBlobKey;
    if (prev && fresh.current.has(prev)) {
      void blobStore.remove(prev).catch(() => undefined);
      fresh.current.delete(prev);
    }
    set('receiptBlobKey', undefined);
    setExpanded(false);
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

  const dayLabel = (d: ISODate) => {
    const n = dayNumber(trip, d);
    return n != null ? `第 ${n} 天 · ${fmtDayHead(d)}` : fmtDayHead(d);
  };

  const footer = askDiscard ? (
    <div className={s.discard}>
      <div className={s.discardText}>{original ? '還沒儲存，要放棄這些變更嗎？' : '還沒記帳，要放棄這一筆嗎？'}</div>
      <div className={s.footSplit}>
        <Button variant="ghost" onClick={() => setAskDiscard(false)}>
          繼續編輯
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            dropFresh();
            ui.getState().closeSheet();
          }}
        >
          {original ? '放棄變更' : '放棄這筆'}
        </Button>
      </div>
    </div>
  ) : (
    <div className={s.footRow}>
      {original && (
        <Button variant="danger" icon={armedDelete ? 'warning' : 'trash'} onClick={remove} aria-live="polite">
          {armedDelete ? '再按一次刪除' : '刪除這筆'}
        </Button>
      )}
      <Button variant="go" block icon="check" onClick={save}>
        儲存
      </Button>
    </div>
  );

  return (
    <Sheet eyebrow={original ? '編輯花費' : dayLabel(draft.date)} title={original ? original.title || cat.label : '記一筆'} footer={footer} onClose={close}>
      <form className={s.form} onSubmit={onSubmit} onKeyDown={onKeyDown} noValidate>
        {fromAI && (
          <Note>
            <span className={s.noteRow}>
              <Icon name="spark" size={15} />
              已由 AI 辨識，請確認金額
            </span>
          </Note>
        )}

        <div className={`${s.amountCard} ${amountErr ? s.amountBad : ''}`}>
          <label htmlFor={amountId} className={s.fieldLabel}>
            金額
          </label>
          <div className={s.amountRow}>
            <input
              id={amountId}
              className={`serif num ${s.amountInput}`}
              inputMode="decimal"
              enterKeyHint="done"
              autoComplete="off"
              placeholder="0"
              autoFocus={!original && !prefill?.amount}
              aria-invalid={!!amountErr}
              aria-describedby={`${amountId}-hint`}
              value={draft.amount}
              onChange={(e) => {
                set('amount', sanitizeAmountInput(e.target.value));
                if (amountErr) setAmountErr(null);
              }}
            />
            <select className={s.curSelect} aria-label="幣別" value={draft.currency} onChange={(e) => set('currency', e.target.value)}>
              {currencyOptions(trip, draft.currency).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div id={`${amountId}-hint`} className={s.amountHint} aria-live="polite">
            {amountErr ? (
              <span className={s.err}>{amountErr}</span>
            ) : !rateKnown ? (
              <span className={s.warnText}>
                <Icon name="warning" size={13} stroke={2.2} />
                此幣別未設定匯率，以 1:1 計
              </span>
            ) : draft.currency !== trip.homeCurrency ? (
              <span className="num">
                ≈ <b>{converted != null ? fmtMoney(converted) : '0'}</b> {trip.homeCurrency}
                <span className={s.rateNote}>
                  {' '}
                  · 1 {trip.localCurrency} = {fmtRate(trip.rate)}
                </span>
              </span>
            ) : (
              <span>以 {trip.homeCurrency} 記帳，不用換算</span>
            )}
          </div>
        </div>

        <div className={s.fieldGroup} role="group" aria-label="分類">
          <span className={s.fieldLabel}>分類</span>
          <Picker<ExpenseCategory>
            ariaLabel="分類"
            options={categoryOptions}
            value={draft.category}
            onChange={(v) => set('category', (Array.isArray(v) ? v[0] : v) ?? 'other')}
          />
        </div>

        <TextInput
          label="項目"
          placeholder="例如：拉麵、車票、伴手禮"
          hint={`可以留空，會用分類名稱「${cat.label}」。`}
          value={draft.title}
          enterKeyHint="done"
          autoComplete="off"
          maxLength={80}
          onChange={(e) => set('title', e.target.value)}
        />

        {days.length > 0 && (
          <Select
            label="日期"
            value={otherDate ? OTHER : draft.date}
            onChange={(e) => {
              const v = e.target.value;
              if (v === OTHER) setOtherDate(true);
              else {
                setOtherDate(false);
                set('date', v);
              }
            }}
          >
            {days.map((d) => (
              <option key={d} value={d}>
                {dayLabel(d)}
              </option>
            ))}
            <option value={OTHER}>其他日期…</option>
          </Select>
        )}
        {(otherDate || !days.length) && (
          <TextInput
            label={days.length ? '自訂日期' : '日期'}
            type="date"
            value={draft.date}
            hint={days.length ? '例如出發前先訂的飯店、車票。' : undefined}
            onChange={(e) => e.target.value && set('date', e.target.value)}
          />
        )}

        {multi && (
          <div className={s.fieldGroup} role="group" aria-label="誰付的">
            <span className={s.fieldLabel}>誰付的</span>
            <Picker<string>
              ariaLabel="誰付的"
              options={[...new Set([...members, ...(members.includes(draft.payer) ? [] : [draft.payer])])].map((m) => ({ key: m, label: m }))}
              value={draft.payer}
              onChange={(v) => set('payer', (Array.isArray(v) ? v[0] : v) ?? members[0])}
            />
          </div>
        )}

        {multi && (
          <div className={s.fieldGroup} role="group" aria-label="誰分攤">
            <span className={s.fieldLabel}>
              誰分攤
              {draft.split.length > 0 && draft.split.length < members.length ? null : <span className={s.labelAside}>全員</span>}
            </span>
            <Picker<string>
              multi
              ariaLabel="誰分攤"
              options={members.map((m) => ({ key: m, label: m }))}
              value={draft.split}
              onChange={(v) => set('split', Array.isArray(v) ? v : [v])}
            />
            <span className={s.hint}>
              {draft.split.length === 0
                ? '沒選人時視為全員分攤。'
                : converted != null
                  ? `每人 ≈ ${fmtMoney(converted / sharers)} ${trip.homeCurrency}`
                  : `${sharers} 人平分`}
            </span>
          </div>
        )}

        <Receipt
          blobKey={draft.receiptBlobKey}
          expanded={expanded}
          onToggle={() => setExpanded((x) => !x)}
          onPick={() => void attach()}
          onRemove={detach}
        />
      </form>
    </Sheet>
  );
}

function Receipt({
  blobKey,
  expanded,
  onToggle,
  onPick,
  onRemove,
}: {
  blobKey: string | undefined;
  expanded: boolean;
  onToggle: () => void;
  onPick: () => void;
  onRemove: () => void;
}) {
  const url = useBlobUrl(blobKey);
  if (!blobKey)
    return (
      <div className={s.fieldGroup}>
        <span className={s.fieldLabel}>收據</span>
        <Button variant="ghost" icon="camera" block onClick={onPick}>
          加入收據照片
        </Button>
      </div>
    );
  return (
    <div className={s.fieldGroup}>
      <span className={s.fieldLabel}>收據</span>
      <div className={s.receipt}>
        <button type="button" className={s.thumb} onClick={onToggle} aria-label={expanded ? '縮小收據照片' : '放大收據照片'} aria-expanded={expanded}>
          {url ? <img src={url} alt="收據照片" /> : <Spinner />}
        </button>
        <div className={s.receiptText}>
          <b>已附上收據</b>
          <span>點照片可以放大查看</span>
        </div>
        <div className={s.receiptBtns}>
          <Button variant="ghost" size="sm" onClick={onPick} className={s.tall}>
            換一張
          </Button>
          <Button variant="plain" size="sm" onClick={onRemove} className={s.tall}>
            移除
          </Button>
        </div>
      </div>
      {expanded && url && (
        <button type="button" className={s.receiptBig} onClick={onToggle} aria-label="縮小收據照片">
          <img src={url} alt="收據照片（放大）" />
        </button>
      )}
    </div>
  );
}
