/**
 * 匯入與同步：三種來源（Google 試算表／檔案／貼上）→ 預覽 → 建立新行程、以試算表為準更新或附加。
 * 已連結 Google 試算表的行程，最上方是「立即同步」。
 *
 * 讀取與辨識都在 services/（sheets.ts、importer.ts），這裡只負責流程與畫面；
 * 寫入 store 一律用 replaceTrip（applyImport 回傳的是新的 Trip）。
 */
import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { Trip } from '@/domain/types';
import { enrichNewTrip } from '@/features/trips/enrich';
import { exportFile, haptic, pickFile } from '@/platform';
import { templateXlsx } from '@/services/exporter';
import { applyImport, interpretSheets, readPastedText, readSpreadsheetFile, type ImportMode, type ImportResult, type RawSheets } from '@/services/importer';
import { fetchGoogleSheet } from '@/services/sheets';
import { newTrip, useActiveTrip, useData } from '@/store';
import { useUI } from '@/store/ui';
import { Button, Icon, Note, Orb, Picker, Sheet, Spinner, TextArea, TextInput, type PickOption } from '@/ui';
import { FormatHelp } from './FormatHelp';
import { ImportPreview, type CreateOptions } from './ImportPreview';
import { countsText, errorText, fmtSynced, newTripDraft, removedCount, resolveNewTrip, shortName, type NewTripDraft } from './model';
import s from './importer.module.css';

type Source = 'google' | 'file' | 'paste';
type Where = Source | 'sync' | 'apply' | 'template';

const SOURCES: PickOption<Source>[] = [
  { key: 'google', label: 'Google 試算表' },
  { key: 'file', label: '檔案' },
  { key: 'paste', label: '貼上' },
];

const FALLBACK: Record<Where, string> = {
  google: '讀不到這份試算表。請確認網址正確，並已開放「知道連結的任何人」檢視，再試一次。',
  sync: '同步沒有完成，行程沒有變動。請確認網路連線與試算表共用設定後再試一次。',
  file: '讀不到這個檔案。請確認是 Excel（.xlsx）或 CSV 檔後再選一次。',
  paste: '辨識不出貼上的內容。請從試算表選取含第一列欄位名稱的範圍，複製後再貼上。',
  apply: '匯入時發生問題，行程沒有變動。請再試一次。',
  template: '範本沒有產生成功。請稍後再試一次。',
};

const ACCEPT = '.xlsx,.csv,.tsv,.txt';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface PreviewState {
  id: number;
  /** 預覽用：不套用目前行程的出發日（「第幾天」保留，讓使用者填新行程的出發日） */
  result: ImportResult;
  /** 建立新行程用：沒寫幣別的記帳，等填好城市、按下建立時再決定幣別 */
  newTrip: NewTripDraft;
  /** 更新／附加到目前行程用：依目前行程的出發日換算「第幾天」、推算年份 */
  forTrip: ImportResult | null;
  source: Source;
  label: string;
  /** Google 試算表網址（來源是 Google 時，套用後存到行程，之後可一鍵同步） */
  url?: string;
}

let previewSeq = 1;

export default function ImportSheet() {
  const trip = useActiveTrip();
  const [source, setSource] = useState<Source>('google');
  const [url, setUrl] = useState(trip?.sheetUrl ?? '');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<Where | null>(null);
  const [error, setError] = useState<{ where: Where; text: string } | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [syncWarnings, setSyncWarnings] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const previewRef = useRef<HTMLElement>(null);
  // 同一時間只做一件事（讀取、同步、套用…）；用 ref 才不會讀到舊的 state
  const busyRef = useRef(false);
  const anyBusy = busy !== null;
  // 關掉這頁後，還在跑的同步不要再動到其他頁
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // 新的預覽出現時捲到預覽卡
  useEffect(() => {
    if (!preview) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const id = requestAnimationFrame(() => previewRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }));
    return () => cancelAnimationFrame(id);
  }, [preview?.id]);

  const errorFor = (w: Where) => (error?.where === w ? error.text : null);

  async function run(where: Where, fn: () => Promise<void> | void) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(where);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError({ where, text: errorText(e, FALLBACK[where]) });
      void haptic('error');
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  /** 原始工作表 → 辨識 → 顯示預覽 */
  function interpret(raw: RawSheets, src: Source, label: string, name: string, sheetUrl?: string) {
    const st = useData.getState();
    const cur = trip ? st.trips[trip.id] : null;
    const parseNew = (local: string | undefined) => interpretSheets(raw, { name, startDate: null, localCurrency: local });
    const result = parseNew(cur?.localCurrency);
    const draft = newTripDraft(parseNew, st.settings.defaultHomeCurrency, cur?.localCurrency);
    const forTrip = cur ? interpretSheets(raw, { name, startDate: cur.startDate, localCurrency: cur.localCurrency }) : null;
    setPreview({ id: previewSeq++, result, newTrip: draft, forTrip, source: src, label, url: sheetUrl });
    void haptic(result.items.length || result.expenses.length ? 'success' : 'warning');
  }

  /* ---------- 三種來源 ---------- */

  const readGoogle = () => {
    if (busyRef.current) return;
    const u = url.trim();
    if (!u) {
      setError({ where: 'google', text: '請先貼上 Google 試算表的網址（docs.google.com/spreadsheets/d/…）。' });
      return;
    }
    void run('google', async () => {
      const raw = await fetchGoogleSheet(u);
      interpret(raw, 'google', 'Google 試算表', '', u);
    });
  };

  const readFile = (file: File) =>
    run('file', async () => {
      const raw = await readSpreadsheetFile(file);
      interpret(raw, 'file', file.name, file.name);
    });

  const chooseFile = async () => {
    // pickFile 要在點擊的同一個事件裡呼叫（iOS 才會開檔案選擇器）
    const file = await pickFile(ACCEPT);
    if (file) await readFile(file);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void readFile(file);
  };

  const readPaste = (value: string) => {
    if (busyRef.current) return;
    if (!value.trim()) {
      setError({ where: 'paste', text: '請先貼上從試算表複製的內容。' });
      return;
    }
    void run('paste', () => interpret(readPastedText(value), 'paste', '貼上的內容', ''));
  };

  /* ---------- 立即同步 ---------- */

  const syncNow = () => {
    if (!trip?.sheetUrl) return;
    const tripId = trip.id;
    const u = trip.sheetUrl;
    void run('sync', async () => {
      setSyncWarnings(null);
      const raw = await fetchGoogleSheet(u);
      const cur = useData.getState().trips[tripId];
      if (!cur) throw new Error('找不到這趟旅程，可能已經被刪除。');
      const result = interpretSheets(raw, { name: cur.name, startDate: cur.startDate, localCurrency: cur.localCurrency });
      if (!result.items.length) {
        throw new Error(
          result.expenses.length
            ? '試算表裡沒有讀到行程點，為了避免清空目前的行程，這次沒有同步。請確認第一個工作表有「日期」「行程」等欄位。'
            : `${result.warnings[0] ?? '試算表裡沒有可以同步的資料。'}目前的行程沒有變動。`,
        );
      }
      const next: Trip = { ...applyImport(cur, result, 'replace'), sheetUrl: u, sheetSyncedAt: Date.now() };
      useData.getState().replaceTrip(next);
      const removed = removedCount(cur, next);
      void haptic('success');
      const ui = useUI.getState();
      ui.toast(`已同步 ${countsText(result, '、')}${removed ? `，移除 ${removed} 個行程點` : ''}`, 'good');
      // 同步途中關掉了這頁：結果照樣存好、提示照樣顯示，但不要關掉之後打開的其他頁
      if (!alive.current) return;
      if (result.warnings.length) setSyncWarnings(result.warnings);
      else ui.closeAllSheets();
    });
  };

  /* ---------- 套用預覽 ---------- */

  function finish(message: string) {
    void haptic('success');
    const ui = useUI.getState();
    ui.selectDate(null);
    ui.closeAllSheets();
    ui.setTab('plan');
    ui.toast(message, 'good');
  }

  const withSheet = (t: Trip, p: PreviewState): Trip => (p.source === 'google' && p.url ? { ...t, sheetUrl: p.url, sheetSyncedAt: Date.now() } : t);

  const createNew = (o: CreateOptions) => {
    const p = preview;
    if (!p) return;
    void run('apply', () => {
      const st = useData.getState();
      // 當地貨幣：試算表寫明的幣別 → 城市的貨幣 → 目前行程的；沒寫幣別的記帳跟著它
      const { localCurrency, result } = resolveNewTrip(p.newTrip, o.city);
      const base = newTrip({ name: o.name, city: o.city, startDate: o.startDate, localCurrency }, st.settings);
      const t = withSheet(applyImport(base, result, 'new'), p);
      st.replaceTrip(t);
      st.setActiveTrip(t.id);
      enrichNewTrip(t.id);
      finish(`已建立「${shortName(t.name, 12)}」：${countsText(result, '、')}`);
    });
  };

  const merge = (mode: Exclude<ImportMode, 'new'>) => {
    const p = preview;
    if (!p || !trip) return;
    void run('apply', () => {
      const st = useData.getState();
      const cur = st.trips[trip.id];
      if (!cur) throw new Error('找不到這趟旅程，可能已經被刪除。');
      const r = p.forTrip ?? p.result;
      const t = withSheet(applyImport(cur, r, mode), p);
      st.replaceTrip(t);
      finish(mode === 'replace' ? `已依試算表更新：${countsText(r, '、')}` : `已附加 ${countsText(r, '、')}`);
    });
  };

  /* ---------- 範本 ---------- */

  const downloadTemplate = () =>
    run('template', async () => {
      const blob = await templateXlsx();
      const r = await exportFile({ name: '旅遊行程範本.xlsx', mime: XLSX_MIME, data: blob });
      if (r === 'downloaded') useUI.getState().toast('已下載範本，填好後從「檔案」匯入');
    });

  const showPreview = preview && preview.source === source;
  const linked = !!trip?.sheetUrl;

  return (
    <Sheet eyebrow="試算表" title="匯入與同步">
      {linked && trip && (
        <section className={s.sync} aria-label="Google 試算表同步">
          <Orb size={240} halo style={{ right: -90, top: -110 }} />
          <Orb size={150} style={{ right: -44, top: -66 }} />
          <div className={s.syncGlass}>
            <span className={`eyebrow ${s.syncEyebrow}`}>已連結試算表</span>
            <div className={s.syncWhen}>
              <span className={s.syncLabel}>{trip.sheetSyncedAt ? '上次同步' : '尚未同步'}</span>
              {trip.sheetSyncedAt && <span className={`serif num ${s.syncTime}`}>{fmtSynced(trip.sheetSyncedAt)}</span>}
            </div>
            <Button variant="go" block icon="refresh" disabled={anyBusy} onClick={syncNow}>
              {busy === 'sync' ? '同步中…' : '立即同步（以試算表為準）'}
            </Button>
            <p className={s.syncHint}>用試算表內容更新「{shortName(trip.name, 12)}」的行程點；完成狀態與地圖位置會保留。</p>
          </div>
        </section>
      )}
      {errorFor('sync') && (
        <Note tone="bad">
          <strong>同步沒有完成</strong>
          {errorFor('sync')}
        </Note>
      )}
      {syncWarnings && (
        <Note tone="warn">
          <strong>已同步，但有幾件事要留意</strong>
          <ul className={s.warnList}>
            {syncWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Note>
      )}

      <div className={s.sources}>
        {linked && <div className={s.divider}>或從其他來源匯入</div>}
        <Picker
          ariaLabel="匯入來源"
          options={SOURCES}
          value={source}
          onChange={(v) => {
            setSource(v as Source);
            setError(null);
          }}
        />
      </div>

      {source === 'google' && (
        <div className={s.section}>
          <TextInput
            label="試算表網址"
            type="url"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            placeholder="https://docs.google.com/spreadsheets/d/…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') readGoogle();
            }}
          />
          <Note tone="info">
            <span className={s.noteHead}>
              <Icon name="users" size={15} />
              先開放檢視權限
            </span>
            <span>在 Google 試算表按「共用」→ 一般存取權：知道連結的任何人 → 檢視者。</span>
          </Note>
          <Button variant={linked ? 'ghost' : 'go'} block disabled={anyBusy} onClick={readGoogle}>
            {busy === 'google' ? '讀取中…' : '讀取'}
          </Button>
          {errorFor('google') && (
            <Note tone="bad">
              <strong>讀取失敗</strong>
              {errorFor('google')}
            </Note>
          )}
        </div>
      )}

      {source === 'file' && (
        <div className={s.section}>
          <button
            type="button"
            className={`${s.drop} ${dragging ? s.dragging : ''}`}
            disabled={anyBusy}
            onClick={() => {
              void haptic('light');
              void chooseFile();
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <span className={s.dropIcon}>{busy === 'file' ? <Spinner /> : <Icon name="upload" size={22} stroke={2.2} />}</span>
            <span className={s.dropTitle}>{busy === 'file' ? '讀取中…' : '選擇 Excel 或 CSV 檔'}</span>
            <span className={s.dropSub}>支援 .xlsx、.csv、.tsv，可從「檔案」App 或 iCloud 雲碟選取</span>
          </button>
          {errorFor('file') && (
            <Note tone="bad">
              <strong>讀取失敗</strong>
              {errorFor('file')}
            </Note>
          )}
        </div>
      )}

      {source === 'paste' && (
        <div className={s.section}>
          <TextArea
            label="貼上試算表內容"
            rows={6}
            placeholder={'在試算表選取範圍（含第一列欄位名稱）→ 複製 → 貼在這裡'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              // 原本是空的：貼上後自動辨識
              if (text.trim()) return;
              const pasted = e.clipboardData.getData('text');
              if (!pasted.trim()) return;
              e.preventDefault();
              setText(pasted);
              readPaste(pasted);
            }}
          />
          <Button variant="go" block disabled={anyBusy} onClick={() => readPaste(text)}>
            辨識
          </Button>
          {errorFor('paste') && (
            <Note tone="bad">
              <strong>辨識失敗</strong>
              {errorFor('paste')}
            </Note>
          )}
        </div>
      )}

      {showPreview && (
        <ImportPreview
          key={preview.id}
          ref={previewRef}
          result={preview.result}
          newTrip={preview.newTrip}
          forTrip={preview.forTrip}
          sourceLabel={preview.label}
          trip={trip}
          error={errorFor('apply')}
          busy={anyBusy}
          onCreate={createNew}
          onMerge={merge}
        />
      )}

      <div className={s.helpArea}>
        <FormatHelp />
        <Button variant="ghost" block icon="download" disabled={anyBusy} onClick={() => void downloadTemplate()}>
          {busy === 'template' ? '產生範本中…' : '下載空白範本'}
        </Button>
        {errorFor('template') && <Note tone="bad">{errorFor('template')}</Note>}
      </div>
    </Sheet>
  );
}
