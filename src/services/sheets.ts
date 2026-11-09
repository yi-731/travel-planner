/**
 * Google 試算表同步：試算表需設為「知道連結的任何人都可以檢視」。
 * 透過 gviz CSV 端點讀取（支援 CORS，免登入、免金鑰）：
 *   https://docs.google.com/spreadsheets/d/{ID}/gviz/tq?tqx=out:csv&sheet={工作表名稱}
 * 注意：指定的工作表不存在時，gviz 會回傳第一個工作表，所以內容和第一個相同的要丟掉。
 */
import { parseDelimited, type RawSheets } from './importer';

/** 第一個工作表以外，會嘗試讀取的記帳工作表名稱 */
const EXPENSE_SHEET_NAMES = ['記帳', '花費', '支出'];
const TIMEOUT_MS = 15_000;

const SHARE_HINT = '請在 Google 試算表按「共用」，把「一般存取權」改成「知道連結的任何人」、角色選「檢視者」，再同步一次。';
const MSG = {
  invalid: '這不是 Google 試算表的網址。請從試算表上方的網址列複製完整網址（docs.google.com/spreadsheets/d/…）再貼上。',
  published: '「發布到網路」產生的連結無法同步。請改貼試算表本身的網址（docs.google.com/spreadsheets/d/…/edit），並開啟連結共用。',
  notShared: `讀不到這份試算表，可能還沒開放共用或網址有誤。${SHARE_HINT}`,
  offline: '目前沒有網路連線。連上網路後再同步一次。',
  unreachable: `連不上這份試算表。如果網路正常，通常是試算表還沒開放共用：${SHARE_HINT}`,
  timeout: 'Google 試算表太久沒有回應。請確認網路連線後再試一次。',
  tooMany: 'Google 暫時拒絕讀取（同步太頻繁）。請等一分鐘再試。',
  server: (status: number) => `Google 試算表暫時無法回應（錯誤 ${status}）。請稍後再試。`,
};

/** 從試算表網址取出 ID；「發布到網路」的 /d/e/… 連結不支援，回傳 null */
export function parseSheetId(url: string): string | null {
  const s = (url ?? '').trim();
  if (!s) return null;
  if (/\/spreadsheets\/(?:u\/\d+\/)?d\/e\//.test(s)) return null;
  const m = /\/spreadsheets\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{20,})/.exec(s);
  if (m) return m[1];
  // 舊格式：…/ccc?key=ID、drive.google.com/open?id=ID
  const old = /google\.com\/.*[?&](?:key|id)=([A-Za-z0-9_-]{20,})/.exec(s);
  if (old) return old[1];
  // 直接貼 ID
  if (/^[A-Za-z0-9_-]{30,}$/.test(s)) return s;
  return null;
}

const csvUrl = (id: string, sheet?: string) =>
  `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/gviz/tq?tqx=out:csv${sheet ? `&sheet=${encodeURIComponent(sheet)}` : ''}`;

/** 讀一個 CSV；失敗時丟出可以直接顯示給使用者的中文錯誤 */
async function fetchCsv(url: string): Promise<string> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'omit', cache: 'no-store', signal: ctrl?.signal });
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') throw new Error(MSG.timeout);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error(MSG.offline);
    // 未共用的試算表會轉址到登入頁，瀏覽器因 CORS 擋下，這裡只會看到網路錯誤
    throw new Error(MSG.unreachable);
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (res.status === 404 || res.status === 401 || res.status === 403) throw new Error(MSG.notShared);
  if (res.status === 429) throw new Error(MSG.tooMany);
  if (!res.ok) throw new Error(MSG.server(res.status));
  const type = res.headers.get('content-type') ?? '';
  const text = await res.text();
  if (/text\/html/i.test(type) || /^\s*<(!doctype|html)/i.test(text)) throw new Error(MSG.notShared);
  return text;
}

/** 讀第一個工作表＋名為「記帳」「花費」「支出」的工作表（若存在） */
export async function fetchGoogleSheet(url: string): Promise<RawSheets> {
  const id = parseSheetId(url);
  if (!id) throw new Error(/\/d\/e\//.test(url ?? '') ? MSG.published : MSG.invalid);

  // 同時送出，省下來回等待的時間；第一個工作表失敗就直接回報錯誤
  const firstP = fetchCsv(csvUrl(id));
  const extrasP = Promise.allSettled(EXPENSE_SHEET_NAMES.map((name) => fetchCsv(csvUrl(id, name))));
  const first = await firstP;
  const sheets: RawSheets = { 行程: parseDelimited(first) };

  const extras = await extrasP;
  const seen = new Set([first]);
  extras.forEach((r, k) => {
    if (r.status !== 'fulfilled' || seen.has(r.value)) return; // 不存在（回傳第一個工作表）或讀取失敗
    seen.add(r.value);
    sheets[EXPENSE_SHEET_NAMES[k]] = parseDelimited(r.value);
  });
  return sheets;
}
