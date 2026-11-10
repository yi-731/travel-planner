/**
 * 平台層：同一份程式在 iPhone 原生 App（Capacitor）與 PWA／瀏覽器都能跑。
 * 功能元件只呼叫這裡的函式，不要直接 import @capacitor/*。
 */
import { Capacitor } from '@capacitor/core';
import { useData } from '@/store/data';

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform(); // 'ios' | 'android' | 'web'

/** PWA 是否以「加入主畫面」方式開啟 */
export const isStandalonePWA = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

/** 觸覺回饋（原生 App 才有；iOS Safari 不支援震動，網頁版靜默略過） */
export async function haptic(kind: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' | 'selection' = 'light') {
  if (!isNative || !useData.getState().settings.haptics) return;
  try {
    const { Haptics, ImpactStyle, NotificationType } = await import('@capacitor/haptics');
    if (kind === 'selection') return void (await Haptics.selectionChanged());
    if (kind === 'success' || kind === 'warning' || kind === 'error') {
      const map = { success: NotificationType.Success, warning: NotificationType.Warning, error: NotificationType.Error } as const;
      return void (await Haptics.notification({ type: map[kind] }));
    }
    const style = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy }[kind];
    await Haptics.impact({ style });
  } catch {
    /* 不支援就略過 */
  }
}

export interface OutFile {
  name: string;
  mime: string;
  data: Blob | string;
}

/**
 * 輸出檔案：原生 App → 存到暫存再叫出分享選單（可存到「檔案」、AirDrop、LINE…）；
 * 網頁 → 支援 Web Share 檔案就分享，否則下載。
 */
export async function exportFile(file: OutFile): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const blob = typeof file.data === 'string' ? new Blob([file.data], { type: file.mime }) : file.data;
  if (isNative) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const base64 = await blobToBase64(blob);
    const res = await Filesystem.writeFile({ path: file.name, data: base64, directory: Directory.Cache });
    try {
      await Share.share({ title: file.name, files: [res.uri] });
      return 'shared';
    } catch {
      return 'cancelled';
    }
  }
  const f = new File([blob], file.name, { type: file.mime });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [f] })) {
    try {
      await nav.share({ files: [f], title: file.name });
      return 'shared';
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'downloaded';
}

/** 分享文字或連結 */
export async function shareText(text: string, url?: string): Promise<boolean> {
  try {
    if (isNative) {
      const { Share } = await import('@capacitor/share');
      await Share.share({ text, url });
      return true;
    }
    if (navigator.share) {
      await navigator.share({ text, url });
      return true;
    }
  } catch {
    return false;
  }
  try {
    await navigator.clipboard.writeText(url ? `${text}\n${url}` : text);
    return true;
  } catch {
    return false;
  }
}

/**
 * 選照片（收據、封面）。原生 App 會問「拍照／相簿」；網頁用檔案選擇器（iPhone 也會出現拍照選項）。
 * 回傳壓縮過的 JPEG（長邊 ≤ maxSide）。
 */
export async function pickImage(opts: { maxSide?: number; preferCamera?: boolean } = {}): Promise<Blob | null> {
  const maxSide = opts.maxSide ?? 1600;
  let file: Blob | null = null;
  if (isNative) {
    try {
      const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
      const photo = await Camera.getPhoto({
        resultType: CameraResultType.Uri,
        source: CameraSource.Prompt,
        quality: 85,
        promptLabelHeader: '選擇照片',
        promptLabelPhoto: '從相簿選擇',
        promptLabelPicture: '拍照',
        promptLabelCancel: '取消',
      });
      if (photo.webPath) file = await (await fetch(photo.webPath)).blob();
    } catch {
      return null;
    }
  } else {
    file = await new Promise<File | null>((resolve) => {
      const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
      if (opts.preferCamera) input.setAttribute('capture', 'environment');
      input.onchange = () => resolve(input.files?.[0] ?? null);
      input.addEventListener('cancel', () => resolve(null));
      input.click();
    });
  }
  return file ? downscaleImage(file, maxSide) : null;
}

/** 選一般檔案（試算表匯入） */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept });
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

export async function downscaleImage(blob: Blob, maxSide: number): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
    return await new Promise<Blob>((res) => canvas.toBlob((b) => res(b ?? blob), 'image/jpeg', 0.85));
  } catch {
    return blob;
  }
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** 目前位置（導航「附近」用）；拒絕或失敗回傳 null */
export async function currentPosition(): Promise<{ lat: number; lng: number } | null> {
  try {
    if (isNative) {
      const { Geolocation } = await import('@capacitor/geolocation');
      const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 8000 });
      return { lat: p.coords.latitude, lng: p.coords.longitude };
    }
    return await new Promise((resolve) =>
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => resolve(null),
        { timeout: 8000, maximumAge: 60_000 },
      ),
    );
  } catch {
    return null;
  }
}

export interface Reminder {
  id: number;
  title: string;
  body: string;
  at: Date;
  /** 點通知時帶回的資料（用來打開對應行程點） */
  extra?: { tripId: string; itemId: string };
}

/** 出發提醒：原生 App 用本機通知；網頁版不支援（回傳 false） */
export async function scheduleReminders(reminders: Reminder[]): Promise<boolean> {
  if (!isNative) return false;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const perm = await LocalNotifications.requestPermissions();
    if (perm.display !== 'granted') return false;
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
    const future = reminders.filter((r) => r.at.getTime() > Date.now()).slice(0, 60);
    if (future.length)
      await LocalNotifications.schedule({
        notifications: future.map((r) => ({ id: r.id, title: r.title, body: r.body, extra: r.extra, schedule: { at: r.at, allowWhileIdle: true } })),
      });
    return true;
  } catch {
    return false;
  }
}

/** 使用者點了出發提醒通知 → cb(extra)。回傳取消監聽的函式。網頁版不做事。 */
export function onReminderTap(cb: (extra: { tripId: string; itemId: string }) => void): () => void {
  if (!isNative) return () => {};
  let remove: (() => void) | null = null;
  let cancelled = false;
  void import('@capacitor/local-notifications').then(async ({ LocalNotifications }) => {
    const h = await LocalNotifications.addListener('localNotificationActionPerformed', (ev) => {
      const x = ev.notification.extra as { tripId?: unknown; itemId?: unknown } | undefined;
      if (x && typeof x.tripId === 'string' && typeof x.itemId === 'string') cb({ tripId: x.tripId, itemId: x.itemId });
    });
    if (cancelled) void h.remove();
    else remove = () => void h.remove();
  });
  return () => {
    cancelled = true;
    remove?.();
  };
}

/** 原生 App 狀態列配色跟著主題 */
export async function syncStatusBar(dark: boolean) {
  if (!isNative) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
  } catch {
    /* ignore */
  }
}

export async function hideSplash() {
  if (!isNative) return;
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide();
  } catch {
    /* ignore */
  }
}
