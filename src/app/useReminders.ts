/**
 * 出發提醒（原生 App 才有）：把目前行程「之後、有時間、還沒完成」的行程點排成 iPhone 本機通知。
 * - 提醒時間 = 抵達時間 − 設定的提前分鐘數；若算得出「最晚出發時間」（前一站到這站的交通），改用它往前推。
 * - 行程時間是當地時間：用浮動時間排程（不綁時區），人在台灣先排好，到了國外也會照當地時鐘提醒。
 * - 行程點或設定改變後 1 秒重新排程；內容沒變就不重排（行程任何欄位變動都會產生新物件）。
 * - 網頁版不做任何事（Safari 不支援背景通知）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { fromMinutes, toMinutes } from '@/domain/dates';
import { daySegments } from '@/domain/schedule';
import type { Trip } from '@/domain/types';
import { isNative, onReminderTap, scheduleReminders, type Reminder, type WallClock } from '@/platform';
import { useActiveTrip, useData } from '@/store/data';
import { useUI } from '@/store/ui';

const DEBOUNCE_MS = 1000;
/** 記錄「目前手機上有我們排的通知」，關閉提醒時才知道要不要清掉（避免沒必要地跳出權限詢問） */
const FLAG_KEY = 'tp:reminders-scheduled';

/** 穩定的通知 id：同一行程的同一站每次都一樣（32 位元 FNV-1a，正整數，iOS／Android 都能用） */
export function reminderId(tripId: string, itemId: string): number {
  const s = `${tripId}:${itemId}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 0x7fffffff || 1;
}

/**
 * 'YYYY-MM-DD' 當天 0 點起算的分鐘數 → 牆上時間（負值或超過 1440 會跨日）。
 * 行程上的時間是「當地時間」，不綁時區：交給 iOS 用浮動時間排程，到哪個時區就照那裡的時鐘響。
 */
export function wallClockAt(date: string, minutes: number): WallClock | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(date);
  if (!m || !Number.isFinite(minutes)) return null;
  // 用 UTC 計算只是為了跨日進位，不代表時區
  const u = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 0, Math.round(minutes)));
  return { year: u.getUTCFullYear(), month: u.getUTCMonth() + 1, day: u.getUTCDate(), hour: u.getUTCHours(), minute: u.getUTCMinutes() };
}

/** 牆上時間 → 以手機目前時區換算的時間點（只用來略過已過去的提醒、排序） */
const wallToDate = (w: WallClock) => new Date(w.year, w.month - 1, w.day, w.hour, w.minute);

/** 依行程產生提醒清單（純函式，依提醒時間排序） */
export function buildReminders(trip: Trip, leadMin: number, now: number = Date.now()): Reminder[] {
  const lead = Math.max(0, Number.isFinite(leadMin) ? leadMin : 0);
  const candidates = trip.items.filter((it) => !it.done && it.date && toMinutes(it.time) != null);

  // 每一站的「最晚出發時間」（由前一站的交通時間推算）
  const leaveByOf = new Map<string, number>();
  for (const date of new Set(candidates.map((it) => it.date as string)))
    for (const seg of daySegments(trip, date)) if (seg.leaveBy != null) leaveByOf.set(seg.to.id, seg.leaveBy);

  const out: Reminder[] = [];
  for (const it of candidates) {
    const arrive = toMinutes(it.time) as number;
    const leaveBy = leaveByOf.get(it.id);
    const departAt = leaveBy != null && leaveBy >= 0 && leaveBy < arrive ? leaveBy : null;
    const wall = wallClockAt(it.date as string, (departAt ?? arrive) - lead);
    if (!wall) continue;
    const at = wallToDate(wall);
    if (at.getTime() <= now) continue;
    const time = fromMinutes(arrive);
    out.push({
      id: reminderId(trip.id, it.id),
      title: `出發提醒：${it.title.trim() || '下一站'}`,
      body: departAt != null ? `${time} 抵達 · 最晚 ${fromMinutes(departAt)} 出發 · 點開導航` : `${time} 抵達 · 點開導航`,
      at,
      wall,
      extra: { tripId: trip.id, itemId: it.id },
    });
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

function readFlag(): boolean {
  try {
    return localStorage.getItem(FLAG_KEY) === '1';
  } catch {
    return false;
  }
}
function writeFlag(on: boolean) {
  try {
    if (on) localStorage.setItem(FLAG_KEY, '1');
    else localStorage.removeItem(FLAG_KEY);
  } catch {
    /* 無痕模式等情況略過 */
  }
}

/** 在 App 最外層呼叫一次 */
export function useReminders(): void {
  const hydrated = useData((s) => s.hydrated);
  const enabled = useData((s) => s.settings.reminders);
  const leadMin = useData((s) => s.settings.reminderLeadMin);
  const trip = useActiveTrip();

  // 點通知 → 切到那個行程並打開該站詳情（可一鍵導航）
  useEffect(
    () =>
      onReminderTap(({ tripId, itemId }) => {
        const data = useData.getState();
        if (!data.trips[tripId]) return;
        data.setActiveTrip(tripId);
        const ui = useUI.getState();
        ui.setTab('home');
        ui.closeAllSheets();
        ui.openSheet({ name: 'place', itemId });
      }),
    [],
  );

  // 回到前景時重算一次：移除已過的提醒、補上原本超過通知數量上限的
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!isNative) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') setTick((t) => t + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const reminders = useMemo(
    () => (isNative && hydrated && enabled && trip ? buildReminders(trip, leadMin) : []),
    // tick 不在函式內使用：只是讓「現在時間」重新計算
    [hydrated, enabled, trip, leadMin, tick],
  );
  const signature = useMemo(
    () => reminders.map((r) => `${r.id}@${r.wall ? Object.values(r.wall).join('-') : r.at.getTime()}|${r.title}|${r.body}`).join('\n'),
    [reminders],
  );
  const latest = useRef(reminders);
  latest.current = reminders;

  /** 上次成功排程的內容；null = 還沒排過 */
  const lastScheduled = useRef<string | null>(null);
  /** 排程一次只跑一個（每次都是「全部取消再重排」，交錯執行會留下舊提醒） */
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  /** 使用者剛打開開關 → 排好後告訴他結果 */
  const prevEnabled = useRef<boolean | null>(null);
  const announce = useRef(false);
  useEffect(() => {
    if (!hydrated) return;
    if (prevEnabled.current === false && enabled) announce.current = true;
    prevEnabled.current = enabled;
  }, [hydrated, enabled]);

  useEffect(() => {
    if (!isNative || !hydrated) return;
    // 關閉提醒且手機上沒有我們排的通知：什麼都不用做（不要觸發權限詢問）
    if (!enabled && !readFlag()) {
      lastScheduled.current = 'off';
      return;
    }
    const key = enabled ? `on\n${signature}` : 'off';
    if (key === lastScheduled.current) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      const list = enabled ? latest.current : [];
      const run = queue.current.then(() => scheduleReminders(list));
      queue.current = run.catch(() => false);
      const ok = await run.catch(() => false);
      if (cancelled) return;
      const { toast } = useUI.getState();
      if (ok) {
        lastScheduled.current = key;
        writeFlag(list.length > 0);
        if (enabled && announce.current) {
          announce.current = false;
          const n = Math.min(list.length, 60);
          toast(n ? `已排好 ${n} 則出發提醒` : '出發提醒已開啟，之後有時間的行程會提醒你', 'good');
        }
        return;
      }
      if (!enabled) {
        // 清不掉（通常是通知權限已被關閉）也就不會再跳通知，不用打擾使用者
        writeFlag(false);
        lastScheduled.current = 'off';
        return;
      }
      // 排不了：多半是沒有通知權限。把開關切回關閉，讓畫面和實際狀況一致
      announce.current = false;
      useData.getState().updateSettings({ reminders: false });
      toast('沒有通知權限。請到 iPhone 設定 → 旅途手帳 → 通知 開啟後再試', 'bad');
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [hydrated, enabled, signature]);
}
