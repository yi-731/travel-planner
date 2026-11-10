/**
 * 「更多」分頁：目前行程卡（點一下開行程設定）＋分組清單（封面、資料、App）＋刪除行程。
 * 切換／新增行程在頂部的行程選單；景點推薦、天氣、排程檢查在各自的分頁，這裡不重複放。
 * 沒有任何行程時也會顯示（AppShell 不擋這一頁）：只留建立／匯入／還原與 App 設定。
 *
 * 動作實作在 ./actions.ts；純邏輯（格式、驗證、備份）在 ./model.ts、./backup.ts（有測試）。
 */
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { Trip } from '@/domain/types';
import { haptic, isNative, isStandalonePWA, platform } from '@/platform';
import { aiReady } from '@/services/ai';
import { useActiveTrip, useData } from '@/store/data';
import { useUI } from '@/store/ui';
import { Button, Icon, ListGroup, ListRow, Orb, PageHead, Pill, Spinner, useBlobUrl } from '@/ui';
import {
  applyRestore,
  deleteTripWithPhotos,
  errorText,
  exportBackup,
  exportExcel,
  pickBackupFile,
  pickCoverImage,
  readBackupFile,
  removeCover,
  setCover,
  type ExportResult,
} from './actions';
import { restorePlan, type ParsedBackup } from './backup';
import { InstallGuide } from './InstallGuide';
import { fmtSyncTime, platformLabel, tripDateSummary } from './model';
import s from './more.module.css';

const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) || '1.0.0';
const CONFIRM_MS = 4000;
const EASE = [0.2, 0.8, 0.2, 1] as const;
const HAS_CJK = /[぀-ヿ㐀-鿿가-힯]/;

/** aiReady() 可能還在實作中（會丟錯）；退回直接看金鑰 */
function safeAiReady(key: string): boolean {
  try {
    return aiReady();
  } catch {
    return !!key.trim();
  }
}

const exportToast = (r: ExportResult, what: string) => (r === 'downloaded' ? `已下載${what}` : `已匯出${what}`);

/** 依序淡入（系統開啟「減少動態效果」時不播放） */
function useEnter() {
  const reduce = useReducedMotion();
  return (i: number) =>
    reduce ? {} : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.4, delay: 0.02 + i * 0.05, ease: EASE } };
}

/** 背景工作：同一個 key 同時只跑一次；失敗顯示中文錯誤 */
function useRunner() {
  const setBusy = useUI((st) => st.setBusy);
  const toast = useUI((st) => st.toast);
  return async (key: string, fn: () => Promise<void>) => {
    if (useUI.getState().busy[key]) return;
    setBusy(key, true);
    try {
      await fn();
    } catch (e) {
      void haptic('error');
      toast(errorText(e, '沒有完成，請再試一次。'), 'bad');
    } finally {
      setBusy(key, false);
    }
  };
}

export default function MoreView() {
  const trip = useActiveTrip();
  const enter = useEnter();
  return (
    <div className={s.more}>
      <motion.div {...enter(0)}>
        <PageHead title="更多" />
      </motion.div>
      {trip ? <TripSections trip={trip} /> : <NoTripSections />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 有行程                                                               */
/* ------------------------------------------------------------------ */

function TripSections({ trip }: { trip: Trip }) {
  const enter = useEnter();
  const openSheet = useUI((st) => st.openSheet);
  const toast = useUI((st) => st.toast);
  const busy = useUI((st) => st.busy);
  const run = useRunner();

  const hasCover = trip.cover.kind === 'image' && !!trip.cover.blobKey;
  const coverUrl = useBlobUrl(hasCover ? trip.cover.blobKey : null);
  const spin = (key: string) => (busy[key] ? <Spinner /> : undefined);

  const sheetSub = trip.sheetUrl
    ? `Google 試算表 · ${trip.sheetSyncedAt ? `上次同步 ${fmtSyncTime(trip.sheetSyncedAt)}` : '尚未同步'}`
    : 'Excel、CSV 或 Google 試算表連結';

  /** 選照片要在點按當下開（iOS 取消選照片時不一定會通知，不能先鎖住按鈕再等） */
  const chooseCover = async () => {
    if (useUI.getState().busy['more:cover']) return;
    const blob = await pickCoverImage();
    if (!blob) return;
    void run('more:cover', async () => {
      await setCover(trip.id, blob);
      void haptic('success');
      toast('已更換封面', 'good');
    });
  };

  return (
    <>
      <motion.div {...enter(1)}>
        <TripCard trip={trip} coverUrl={coverUrl} onOpen={() => openSheet({ name: 'tripSettings' })} />
      </motion.div>

      <motion.div {...enter(2)}>
        <ListGroup>
          <ListRow
            icon="image"
            title="封面照片"
            subtitle={hasCover ? '已設定 · 點一下換一張' : '用一張照片當首頁封面'}
            end={busy['more:cover'] ? <Spinner /> : coverUrl ? <span className={s.thumb} style={{ backgroundImage: `url(${coverUrl})` }} /> : undefined}
            onClick={() => void chooseCover()}
          />
          {hasCover && (
            <ListRow
              icon="trash"
              iconColor="var(--bad)"
              title={<span className={s.badText}>移除封面</span>}
              chevron={false}
              onClick={() =>
                void run('more:cover', async () => {
                  await removeCover(trip.id);
                  toast('已移除封面，改回日落光球');
                })
              }
            />
          )}
        </ListGroup>
      </motion.div>

      <motion.div {...enter(3)}>
        <ListGroup title="資料">
          <ListRow icon="refresh" title="試算表匯入與同步" subtitle={sheetSub} onClick={() => openSheet({ name: 'import' })} />
          <ListRow
            icon="sheet"
            title="匯出 Excel"
            subtitle="行程與記帳兩個工作表，可再匯入"
            chevron={false}
            end={spin('more:xlsx')}
            onClick={() =>
              void run('more:xlsx', async () => {
                const r = await exportExcel(trip);
                if (r !== 'cancelled') {
                  void haptic('success');
                  toast(exportToast(r, ' Excel 檔'), 'good');
                }
              })
            }
          />
          <BackupRows />
        </ListGroup>
      </motion.div>

      <motion.div {...enter(4)}>
        <AppGroup />
      </motion.div>

      <motion.div {...enter(5)}>
        <DangerZone trip={trip} />
      </motion.div>
    </>
  );
}

/** 目前行程卡：封面照片（或日落光球）＋霧面玻璃，點一下開行程設定 */
function TripCard({ trip, coverUrl, onOpen }: { trip: Trip; coverUrl: string | null; onOpen: () => void }) {
  const big = trip.city.trim() || trip.name;
  const cjk = HAS_CJK.test(big);
  const meta = `${tripDateSummary(trip)} · ${trip.members.length} 位旅伴`;
  return (
    <button
      type="button"
      className={`${s.tripCard} ${coverUrl ? s.hasCover : ''}`}
      onClick={() => {
        void haptic('light');
        onOpen();
      }}
      aria-label={`編輯行程設定：${trip.name}`}
    >
      {coverUrl ? (
        <span className={s.coverImg} style={{ backgroundImage: `url(${coverUrl})` }} aria-hidden />
      ) : (
        <>
          <Orb size={250} halo hue={trip.cover.hue} style={{ right: -40, top: -70 }} />
          <Orb size={210} hue={trip.cover.hue} style={{ right: -20, top: -50 }} />
        </>
      )}
      <span className={s.glass}>
        <span className={s.glassText}>
          <span className={s.cardEyebrow}>
            <span className="eyebrow">目前行程</span>
            {trip.isExample && <span className={s.badge}>範例</span>}
            {trip.routeCode && <span className={`num ${s.route}`}>{trip.routeCode}</span>}
          </span>
          <span className={cjk ? s.cityCjk : `serif ${s.city}`} lang={cjk ? 'zh-Hant' : undefined}>
            {big}
          </span>
          <span className={`num ${s.cardMeta}`}>{meta}</span>
        </span>
        <span className={s.goPill} aria-hidden>
          編輯
          <span className={s.goDot}>
            <Icon name="arrow" size={15} stroke={2.4} />
          </span>
        </span>
      </span>
    </button>
  );
}

/** 備份全部資料／從備份還原（還原前先確認） */
function BackupRows() {
  const busy = useUI((st) => st.busy);
  const toast = useUI((st) => st.toast);
  const trips = useData((st) => st.trips);
  const run = useRunner();
  const [pending, setPending] = useState<ParsedBackup | null>(null);
  const plan = pending ? restorePlan(trips, pending.trips) : null;
  const tripCount = Object.keys(trips).length;

  /** 選檔要在點按當下開（iOS 取消選檔時不一定會通知，不能先鎖住按鈕再等） */
  const chooseBackup = async () => {
    if (useUI.getState().busy['more:restore']) return;
    const file = await pickBackupFile();
    if (!file) return;
    void run('more:restore', async () => {
      const parsed = await readBackupFile(file);
      void haptic('light');
      setPending(parsed);
    });
  };

  return (
    <>
      {tripCount > 0 && (
        <ListRow
          icon="download"
          title="備份全部資料"
          subtitle="所有行程與設定（不含照片與金鑰）"
          chevron={false}
          end={busy['more:backup'] ? <Spinner /> : undefined}
          onClick={() =>
            void run('more:backup', async () => {
              const { result, count } = await exportBackup();
              if (result !== 'cancelled') {
                void haptic('success');
                toast(result === 'downloaded' ? `已下載備份檔（${count} 個行程）` : `已備份 ${count} 個行程`, 'good');
              }
            })
          }
        />
      )}
      <ListRow
        icon="upload"
        title="從備份還原"
        subtitle="選擇備份檔，相同行程會被取代"
        chevron={false}
        end={busy['more:restore'] ? <Spinner /> : undefined}
        onClick={() => void chooseBackup()}
      />
      <AnimatePresence initial={false}>
        {pending && plan && (
          <motion.div key="restore" className={s.inlinePanel} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28, ease: EASE }}>
            <div className={s.inlineIn}>
              <b className={s.inlineTitle}>
                還原 <span className="num">{pending.trips.length}</span> 個行程？
              </b>
              <p className={s.inlineBody}>
                {pending.exportedAt ? `備份時間 ${fmtSyncTime(pending.exportedAt)}。` : ''}
                {plan.replaced ? `其中 ${plan.replaced} 個和手機上的行程相同，會改成備份裡的版本；` : ''}
                {plan.added ? `${plan.added} 個是新的。` : '沒有新的行程。'}
                {pending.skipped ? `有 ${pending.skipped} 筆資料讀不懂，會略過。` : ''}
              </p>
              <div className="row">
                <Button
                  variant="go"
                  size="sm"
                  icon="check"
                  onClick={() => {
                    const n = applyRestore(pending.trips);
                    setPending(null);
                    void haptic('success');
                    toast(`已還原 ${n} 個行程`, 'good');
                  }}
                >
                  還原 {pending.trips.length} 個行程
                </Button>
                <Button variant="plain" size="sm" onClick={() => setPending(null)}>
                  取消
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/** AI 助理（未設定金鑰時）、App 設定、安裝到主畫面、關於 */
function AppGroup() {
  const openSheet = useUI((st) => st.openSheet);
  const apiKey = useData((st) => st.settings.anthropicApiKey);
  const ready = safeAiReady(apiKey ?? '');
  const [installOpen, setInstallOpen] = useState(false);
  const standalone = isStandalonePWA();
  const canInstall = platform === 'web' && !standalone;
  const where = canInstall ? '網頁版 · 資料只存在這個瀏覽器' : `${platformLabel(isNative, standalone)} · 資料只存在這支手機`;
  return (
    <ListGroup title="App">
      {!ready && (
        <ListRow
          icon="spark"
          iconColor="var(--accent)"
          title="AI 助理"
          subtitle="排程檢查、景點推薦、穿搭建議會用到，貼上金鑰就能用"
          end={<Pill style={{ background: 'var(--accent-soft)', color: 'var(--accent-text)' }}>未設定</Pill>}
          onClick={() => openSheet({ name: 'appSettings' })}
        />
      )}
      <ListRow
        icon="gear"
        title="App 設定"
        subtitle={ready ? '外觀、AI 金鑰、預設幣別、提醒' : '外觀、預設幣別、提醒'}
        onClick={() => openSheet({ name: 'appSettings' })}
      />
      {canInstall && (
        <>
          <ListRow
            icon="share"
            title="安裝到 iPhone 主畫面"
            subtitle="免費，像 App 一樣全螢幕、可離線"
            chevron={false}
            end={<Icon name="chevronDown" size={16} className={`${s.caret} ${installOpen ? s.caretOpen : ''}`} />}
            onClick={() => setInstallOpen((v) => !v)}
          />
          <AnimatePresence initial={false}>
            {installOpen && (
              <motion.div key="install" className={s.inlinePanel} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }}>
                <InstallGuide />
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
      <ListRow icon="info" title={`旅途手帳 v${APP_VERSION}`} subtitle={where} />
    </ListGroup>
  );
}

/** 刪除此行程：按兩次才會刪（第一次按下後 4 秒內再按一次） */
function DangerZone({ trip }: { trip: Trip }) {
  const toast = useUI((st) => st.toast);
  const setTab = useUI((st) => st.setTab);
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const onPress = () => {
    if (!armed) {
      void haptic('warning');
      setArmed(true);
      timer.current = setTimeout(() => setArmed(false), CONFIRM_MS);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    const name = deleteTripWithPhotos(trip.id);
    void haptic('success');
    toast(name ? `已刪除「${name}」` : '已刪除行程');
    setTab('home');
  };

  return (
    <section className={s.danger} aria-label="刪除行程">
      <Button variant="danger" block icon="trash" className={armed ? s.dangerArmed : undefined} onClick={onPress}>
        {armed ? '再按一次，永久刪除' : '刪除此行程'}
      </Button>
      <p className={s.dangerHint} aria-live="polite">
        {armed ? `「${trip.name}」的行程點與記帳會一起刪除，無法復原。` : '刪除前可以先用「備份全部資料」存一份。'}
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 沒有行程                                                             */
/* ------------------------------------------------------------------ */

function NoTripSections() {
  const enter = useEnter();
  const openSheet = useUI((st) => st.openSheet);
  return (
    <>
      <motion.div {...enter(1)}>
        <div className={s.emptyCard}>
          <Orb size={230} halo style={{ right: -60, top: -80 }} />
          <Orb size={200} style={{ right: -48, top: -70 }} />
          <div className={s.emptyGlass}>
            <b className={s.emptyTitle}>還沒有行程</b>
            <span className={s.emptyBody}>建立第一趟旅程，或匯入排好的試算表。</span>
            <div className="row">
              <Button variant="go" icon="plus" onClick={() => openSheet({ name: 'newTrip' })}>
                建立新行程
              </Button>
              <Button variant="ghost" onClick={() => openSheet({ name: 'import' })}>
                匯入試算表
              </Button>
            </div>
          </div>
        </div>
      </motion.div>
      <motion.div {...enter(2)}>
        <ListGroup title="資料">
          <ListRow icon="refresh" title="試算表匯入與同步" subtitle="Excel、CSV 或 Google 試算表連結" onClick={() => openSheet({ name: 'import' })} />
          <BackupRows />
        </ListGroup>
      </motion.div>
      <motion.div {...enter(3)}>
        <AppGroup />
      </motion.div>
    </>
  );
}

