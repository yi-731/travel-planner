/**
 * AI 助理（Anthropic Claude API，使用者自備 API 金鑰，只存在裝置上）。
 * 用官方 @anthropic-ai/sdk（瀏覽器模式）＋結構化輸出（output_config.format = json_schema）。
 *
 * 結構：
 *   1. 設定與錯誤（AIError、aiErrorMessage、aiReady）
 *   2. 送出請求（askJSON：模型參數、refusal 備援、錯誤對應）
 *   3. 各功能：checkDay / recommendPlaces / packingAdvice / scanReceipt / testConnection
 *      每個功能 = 提示詞（buildXxxPrompt）＋ JSON schema ＋ zod 驗證 ＋ 整理（normalizeXxx）
 * 提示詞與整理函式都是純函式並有匯出，方便在 ai.test.ts 測試與日後調整。
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { AI_MODELS, DEFAULT_AI_MODEL, expenseCategory, itemType } from '@/domain/constants';
import { fmtMD, parseISODate, tripDays, weekday } from '@/domain/dates';
import { haversineKm, itemsOfDay } from '@/domain/schedule';
import type { DailyWeather, DayCheck, ExpenseCategory, ISODate, Item, SegmentEstimate, Trip, WeatherCache } from '@/domain/types';
import { blobToBase64 } from '@/platform';
import { useData } from '@/store/data';
import { abortError, isAbort } from './net';

/* ------------------------------------------------------------------ */
/* 1. 錯誤與設定                                                        */
/* ------------------------------------------------------------------ */

export type AIErrorCode =
  | 'no_key' | 'auth' | 'forbidden' | 'billing' | 'rate_limited' | 'overloaded' | 'network' | 'refused' | 'bad_output' | 'unknown';
export class AIError extends Error {
  constructor(public code: AIErrorCode, message: string) {
    super(message);
  }
}

/** 各錯誤代碼的預設中文說明（AIError 沒帶訊息時使用） */
export const AI_ERROR_MESSAGES: Record<AIErrorCode, string> = {
  no_key: '還沒有設定 AI 金鑰，請到 更多 → App 設定 貼上你的 Anthropic API 金鑰。',
  auth: 'API 金鑰無效，請到 更多 → App 設定 重新貼上。',
  forbidden: 'Anthropic 不允許這把金鑰使用這個模型（可能是權限或所在地區限制），請到 Anthropic 後台確認，或到 更多 → App 設定 換一個模型。',
  billing: 'Anthropic 帳戶餘額不足或付款有問題，請到 Anthropic 後台的帳單頁面確認付款方式或儲值後再試。',
  rate_limited: 'AI 使用量暫時達到上限，請等一分鐘再試一次。',
  overloaded: 'AI 服務目前很忙，請稍後再試一次。',
  network: '連不上 AI 服務，請確認網路連線後再試一次。',
  refused: 'AI 無法處理這個請求，換個說法再試一次。',
  bad_output: 'AI 回覆的內容不完整，請再試一次。',
  unknown: 'AI 暫時無法使用，請稍後再試一次。',
};

const isAbortLike = (e: unknown) => e instanceof Anthropic.APIUserAbortError || isAbort(e);

/** 從任意錯誤物件讀出 HTTP 狀態碼（SDK 錯誤或帶 status 的物件） */
function statusOf(e: unknown): number | undefined {
  if (e && typeof e === 'object' && 'status' in e) {
    const s = (e as { status: unknown }).status;
    if (typeof s === 'number') return s;
  }
  return undefined;
}

const TIMEOUT_TEXT = 'AI 回應太久沒有完成，請確認網路後再試一次。';
const SPEND_LIMIT_TEXT =
  'Anthropic 帳戶本月的 API 用量已達方案上限，要到下個月 1 日才會恢復；如需提早使用，請到 Anthropic 後台申請提高用量等級。';
const ON_HOLD_TEXT = '這個 Anthropic 帳戶目前被停用，請到 Anthropic 後台查看說明。';
const BAD_REQUEST_TEXT = 'AI 服務無法處理這次請求。若一直發生，請到 Anthropic 後台確認帳戶還有餘額，或到 更多 → App 設定 換一個模型。';

/**
 * 把 SDK／連線錯誤轉成 AIError；使用者取消則回傳 name === 'AbortError' 的錯誤（呼叫端可靜默略過）。
 * 先判斷子類別再判斷父類別（APIUserAbortError、APIConnectionError 都繼承 APIError；
 * EnforcedSpendLimitReachedError 繼承 RateLimitError、OrganizationOnHoldError 繼承 BadRequestError）。
 * 重試沒用的（餘額、用量上限、權限）要講清楚，不要說「稍後再試」。
 */
export function toAIError(e: unknown): Error {
  if (e instanceof AIError) return e;
  if (isAbortLike(e)) return abortError();
  const err = (code: AIErrorCode, message = AI_ERROR_MESSAGES[code]) => new AIError(code, message);

  if (e instanceof Anthropic.AuthenticationError) return err('auth');
  // 本月用量上限：SDK 不一定產生子類別，也看 error_code
  if (e instanceof Anthropic.EnforcedSpendLimitReachedError || (e instanceof Anthropic.APIError && e.errorCode === 'enforced_spend_limit_reached')) {
    return err('billing', SPEND_LIMIT_TEXT);
  }
  // 402（SDK 沒有專屬類別）或 billing_error：餘額或付款問題
  if (e instanceof Anthropic.APIError && (e.status === 402 || e.type === 'billing_error')) return err('billing');
  if (e instanceof Anthropic.PermissionDeniedError) return err('forbidden');
  if (e instanceof Anthropic.RateLimitError) return err('rate_limited');
  if (e instanceof Anthropic.InternalServerError) return err('overloaded'); // 含 OverloadedError（529）與其他 5xx
  if (e instanceof Anthropic.APIConnectionError) {
    // 含 APIConnectionTimeoutError
    return e instanceof Anthropic.APIConnectionTimeoutError ? err('network', TIMEOUT_TEXT) : err('network');
  }
  if (e instanceof Anthropic.NotFoundError) return err('unknown', '找不到這個 AI 模型，請到 更多 → App 設定 換一個模型再試。');
  // 帳戶因信任與安全原因被停用（不是餘額問題）
  if (e instanceof Anthropic.OrganizationOnHoldError) return err('forbidden', ON_HOLD_TEXT);
  if (e instanceof Anthropic.BadRequestError) return err('unknown', BAD_REQUEST_TEXT);

  // 串流途中的錯誤事件沒有狀態碼，只有錯誤類型
  if (e instanceof Anthropic.APIError && e.status == null) {
    switch (e.type) {
      case 'overloaded_error':
      case 'api_error':
        return err('overloaded');
      case 'rate_limit_error':
        return err('rate_limited');
      case 'authentication_error':
        return err('auth');
      case 'permission_error':
        return err('forbidden');
      case 'timeout_error':
        return err('network', TIMEOUT_TEXT);
      case 'invalid_request_error':
        return err('unknown', BAD_REQUEST_TEXT);
    }
  }

  // 不是 SDK 類別（例如被包裝過）時，用狀態碼判斷
  const status = statusOf(e);
  if (status === 401) return err('auth');
  if (status === 402) return err('billing');
  if (status === 403) return err('forbidden');
  if (status === 429) return err('rate_limited');
  if (status === 529 || (status != null && status >= 500)) return err('overloaded');
  if (e instanceof TypeError) return err('network'); // fetch 失敗
  return err('unknown');
}

/** 給使用者看的中文錯誤訊息 */
export function aiErrorMessage(e: unknown): string {
  if (isAbortLike(e)) return '已取消。';
  if (e instanceof AIError) return e.message || AI_ERROR_MESSAGES[e.code];
  if (e instanceof Anthropic.AnthropicError || statusOf(e) != null) return toAIError(e).message;
  // 本檔自己丟出的中文 Error（例如「這天至少要有 2 個行程點」）
  if (e instanceof Error && /[㐀-鿿]/.test(e.message)) return e.message;
  return AI_ERROR_MESSAGES.unknown;
}

/** 已設定 API 金鑰（不代表金鑰一定有效；有效性用 testConnection 檢查） */
export function aiReady(): boolean {
  return !!useData.getState().settings.anthropicApiKey?.trim();
}

/** 設定頁可選的模型；其他值（舊版或手動改壞）一律用預設模型 */
export function resolveModel(id: string | undefined | null): string {
  return id && AI_MODELS.some((m) => m.id === id) ? id : DEFAULT_AI_MODEL;
}

/** Opus 5.5 / Sonnet 5.5 支援伺服器端 refusal 備援；Haiku 5.5 不支援（加了也沒用） */
export const supportsFallback = (model: string) => model === 'claude-opus-5-5' || model === 'claude-sonnet-5-5';
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01' as const;

/* ------------------------------------------------------------------ */
/* 2. 送出請求                                                          */
/* ------------------------------------------------------------------ */

/**
 * max_tokens 同時涵蓋思考與輸出（這幾個模型的思考無法關閉，長的一天光思考就可能用掉大半）。
 * 平常只依實際用量計費；但被截斷的回覆已經用滿 max_tokens，整份照算，所以要給足空間。
 * 請求一律用串流，max_tokens 大也不會碰到 HTTP 逾時。
 */
const MAX_TOKENS = 16_000;
/**
 * 到收到回應標頭為止的逾時（毫秒）。串流時伺服器幾秒內就回標頭，
 * 所以 SDK 的自動重試（2 次）只涵蓋還沒開始生成的失敗（連線錯誤、429、5xx），不會重跑生成到一半的請求。
 */
const TIMEOUT_MS = 120_000;
/** 整個請求（含生成）最多等多久；串流沒有閒置逾時，超過就中止，避免一直轉圈 */
const DEADLINE_MS = 300_000;

const SYSTEM_BASE =
  '你是「旅途手帳」App 裡的旅遊助理，熟悉各國城市的交通、景點、餐廳與營業習慣。' +
  '只根據一般知識回答，不確定時保守估計，不要編造評分、評論數、排名或不存在的地點。' +
  '所有文字欄位一律使用繁體中文（台灣用語），簡短具體，不使用表情符號。';

let cachedClient: { key: string; client: Anthropic } | null = null;
function getClient(apiKey: string): Anthropic {
  if (cachedClient?.key !== apiKey) {
    cachedClient = { key: apiKey, client: new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, timeout: TIMEOUT_MS }) };
  }
  return cachedClient.client;
}

function readSettings(): { apiKey: string; model: string } {
  const s = useData.getState().settings;
  const apiKey = s.anthropicApiKey?.trim() ?? '';
  if (!apiKey) throw new AIError('no_key', AI_ERROR_MESSAGES.no_key);
  return { apiKey, model: resolveModel(s.aiModel) };
}

type Effort = 'low' | 'medium';
type UserContent = string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam>;

export interface AskSpec {
  system: string;
  content: UserContent;
  /** JSON schema（additionalProperties: false ＋ required） */
  schema: Record<string, unknown>;
  effort: Effort;
  maxTokens?: number;
  /** AI 拒絕時給使用者看的話（依功能說明能怎麼做；預設請使用者換個說法） */
  refusedMessage?: string;
  /** 回覆太長被截斷時給使用者看的話 */
  truncatedMessage?: string;
}

/**
 * 組出請求本體（純函式，測試用）。
 * 注意：這幾個模型不可送 temperature / top_p / top_k、thinking.disabled、budget_tokens（會 400），
 * 也不支援助理預填；思考預設是自動調整，用 effort 控制深度。
 */
export function buildRequest(model: string, spec: AskSpec) {
  return {
    model,
    max_tokens: spec.maxTokens ?? MAX_TOKENS,
    system: spec.system,
    messages: [{ role: 'user' as const, content: spec.content }],
    output_config: { effort: spec.effort, format: { type: 'json_schema' as const, schema: spec.schema } },
  };
}

/** 回應裡我們需要的最小形狀（一般與 beta 回應都符合） */
export interface ResponseLike {
  stop_reason: string | null;
  content: ReadonlyArray<{ type: string; text?: string }>;
}

/** 取出最終的文字：略過思考區塊；若發生模型備援，只取最後一個 fallback 區塊之後的文字 */
export function finalText(content: ResponseLike['content']): string {
  let start = 0;
  content.forEach((b, i) => {
    if (b.type === 'fallback') start = i + 1;
  });
  const first = content.slice(start).find((b) => b.type === 'text' && typeof b.text === 'string');
  return first?.text?.trim() ?? '';
}

const TRUNCATED_TEXT = 'AI 回覆太長被截斷了，請再試一次。';

/** 檢查停止原因 → 解析 JSON → zod 驗證；任何一步失敗都丟 AIError。messages 依功能換掉拒絕／截斷時的說明 */
export function readStructured<T>(res: ResponseLike, schema: z.ZodType<T>, messages: { refused?: string; truncated?: string } = {}): T {
  if (res.stop_reason === 'refusal') throw new AIError('refused', messages.refused || AI_ERROR_MESSAGES.refused);
  if (res.stop_reason === 'max_tokens') throw new AIError('bad_output', messages.truncated || TRUNCATED_TEXT);
  const text = finalText(res.content);
  if (!text) throw new AIError('bad_output', AI_ERROR_MESSAGES.bad_output);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AIError('bad_output', AI_ERROR_MESSAGES.bad_output);
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new AIError('bad_output', AI_ERROR_MESSAGES.bad_output);
  return parsed.data;
}

/** 帳戶不能用備援 beta 的金鑰（記下來，之後直接送一般請求） */
const noFallbackKeys = new Set<string>();

/** 400 是因為帳戶沒有開放備援 beta（anthropic-beta 標頭或 fallbacks 參數不被接受） */
function isFallbackUnavailable(e: unknown): boolean {
  if (!(e instanceof Anthropic.BadRequestError)) return false;
  if (e.errorCode === 'organization_not_enrolled_in_beta') return true;
  const m = e.apiMessage ?? '';
  return m.includes(FALLBACK_BETA) || /anthropic-beta|\bfallbacks\b/i.test(m);
}

/** 用串流送出、等完整回覆（標頭幾秒內就到，長時間生成不會被逾時切斷又重送） */
async function sendRequest(client: Anthropic, apiKey: string, model: string, body: ReturnType<typeof buildRequest>, signal: AbortSignal): Promise<ResponseLike> {
  if (supportsFallback(model) && !noFallbackKeys.has(apiKey)) {
    try {
      // 被安全機制拒絕時，由伺服器自動改用建議的備援模型重跑（同一次請求內完成）
      return await client.beta.messages.stream({ ...body, betas: [FALLBACK_BETA], fallbacks: 'default' }, { signal }).finalMessage();
    } catch (e) {
      if (!isFallbackUnavailable(e)) throw e;
      // 帳戶還沒開放這個 beta：改送一般請求（這種 400 在生成前就回來，不會重複計費）
      noFallbackKeys.add(apiKey);
    }
  }
  return client.messages.stream(body, { signal }).finalMessage();
}

async function askJSON<T>(spec: AskSpec, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  const { apiKey, model } = readSettings();
  if (signal?.aborted) throw abortError();
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new AIError('network', '目前沒有網路連線，連上網路後再試一次。');
  const client = getClient(apiKey);
  const body = buildRequest(model, spec);
  // 整體期限＋呼叫端的取消（不用 AbortSignal.any，舊版 iOS 沒有）
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, DEADLINE_MS);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  let res: ResponseLike;
  try {
    res = await sendRequest(client, apiKey, model, body, ctrl.signal);
  } catch (e) {
    if (signal?.aborted) throw abortError();
    if (timedOut) throw new AIError('network', TIMEOUT_TEXT);
    throw toAIError(e);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
  return readStructured(res, schema, { refused: spec.refusedMessage, truncated: spec.truncatedMessage });
}

/* ------------------------------------------------------------------ */
/* 共用：行程脈絡                                                        */
/* ------------------------------------------------------------------ */

/** 「京都（JP）」：優先用定位到的中文城市名 */
export function placeLabel(trip: Pick<Trip, 'city' | 'cityGeo'>): string {
  const name = trip.cityGeo?.label?.trim() || trip.city.trim() || '未設定城市';
  const cc = trip.cityGeo?.countryCode?.trim();
  return cc ? `${name}（${cc}）` : name;
}

/** 「2026-11-21（週六）・Day 2」 */
export function dayLabel(trip: Pick<Trip, 'startDate' | 'endDate' | 'items'>, date: ISODate): string {
  if (!date) return '日期未定';
  const n = tripDays(trip).indexOf(date);
  return `${date}（週${weekday(date)}）${n >= 0 ? `・Day ${n + 1}` : ''}`;
}

const clean = (s: string | undefined | null, max = 200) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/* ------------------------------------------------------------------ */
/* 3a. 排程檢查                                                          */
/* ------------------------------------------------------------------ */

export function buildDayCheckPrompt(trip: Trip, date: ISODate, items: Item[]): string {
  const rows = items.map((it, i) => ({
    no: i + 1,
    time: it.time,
    title: clean(it.title, 80),
    type: itemType(it.type).label,
    address: clean(it.address, 120) || undefined,
    durationMin: it.durationMin,
  }));
  const n = items.length;
  return [
    `旅程：${clean(trip.name, 60)}`,
    `城市：${placeLabel(trip)}`,
    `日期：${dayLabel(trip, date)}`,
    `當天行程（依時間排序，共 ${n} 站；durationMin 是預計停留分鐘數）：`,
    JSON.stringify(rows),
    '',
    '請完成：',
    `1. segments：剛好 ${n - 1} 筆，第 k 筆是第 k 站到第 k+1 站的「移動」。minutes 只算交通時間（整數分鐘，不含停留）；mode 用當地最常見的方式（例如：步行、電車、地鐵、公車、計程車、開車）；tip 一句話，寫路線、線名或上下車站名。`,
    `2. warnings：最多 4 則真正需要注意的事，例如：依停留時間與移動時間來看轉乘太趕、營業時間或公休日（這天是週${weekday(date)}，依一般知識）、通勤尖峰、路線繞回頭、空檔太長。沒有問題就給空陣列。每則一句話，提到對應的地點名稱。`,
    '3. summary：一句話總評這天的安排。',
  ].join('\n');
}

const DAY_CHECK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['segments', 'warnings', 'summary'],
  properties: {
    segments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['minutes', 'mode', 'tip'],
        properties: {
          minutes: { type: 'integer', description: '交通時間（分鐘）' },
          mode: { type: 'string', description: '交通方式' },
          tip: { type: 'string', description: '路線或站名提示' },
        },
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
} as const;

const DayCheckOut = z.object({
  segments: z.array(z.object({ minutes: z.number(), mode: z.string(), tip: z.string() })),
  warnings: z.array(z.string()),
  summary: z.string(),
});
export type DayCheckOutput = z.infer<typeof DayCheckOut>;

/** 估不到的段落：有座標就用直線距離粗估，否則 20 分鐘 */
function guessMinutes(a?: Item, b?: Item): number {
  if (a?.geo && b?.geo) return Math.max(5, Math.round(((haversineKm(a.geo, b.geo) * 1.3) / 25) * 60));
  return 20;
}

/** 整理 AI 回覆：段落數固定為 items.length - 1（多的截掉、少的補粗估），分鐘數取整並限制範圍 */
export function normalizeDayCheck(raw: DayCheckOutput, items: Item[]): Pick<DayCheck, 'segments' | 'warnings' | 'summary'> {
  const need = Math.max(0, items.length - 1);
  const segments: SegmentEstimate[] = [];
  for (let k = 0; k < need; k++) {
    const s = raw.segments[k];
    if (!s) {
      segments.push({ minutes: guessMinutes(items[k], items[k + 1]), mode: '未估算', tip: '這段 AI 沒有估到，出發前請用地圖確認' });
      continue;
    }
    const m = Number.isFinite(s.minutes) ? Math.round(s.minutes) : guessMinutes(items[k], items[k + 1]);
    const tip = clean(s.tip, 120);
    segments.push({ minutes: Math.min(720, Math.max(1, m)), mode: clean(s.mode, 20) || '移動', ...(tip ? { tip } : {}) });
  }
  const warnings = raw.warnings.map((w) => clean(w, 160)).filter(Boolean).slice(0, 4);
  const summary = clean(raw.summary, 200);
  return { segments, warnings, ...(summary ? { summary } : {}) };
}

/** 檢查某天行程：估算相鄰兩站的移動時間、提醒太趕或營業時間問題 */
export async function checkDay(trip: Trip, date: ISODate, signal?: AbortSignal): Promise<DayCheck> {
  const items = itemsOfDay(trip, date);
  if (items.length < 2) throw new Error('這天至少要有 2 個行程點，才能檢查之間的移動時間。');
  const raw = await askJSON(
    {
      system: SYSTEM_BASE + ' 你正在幫旅客檢查一天的行程是否順暢。',
      content: buildDayCheckPrompt(trip, date, items),
      schema: DAY_CHECK_SCHEMA,
      effort: 'medium',
      refusedMessage: 'AI 這次無法檢查這天的行程，請稍後再試一次。',
      truncatedMessage: 'AI 回覆太長被截斷了，請減少這天的行程點再試一次。',
    },
    DayCheckOut,
    signal,
  );
  return { at: Date.now(), itemIds: items.map((i) => i.id), ...normalizeDayCheck(raw, items) };
}

/* ------------------------------------------------------------------ */
/* 3b. 地點推薦                                                          */
/* ------------------------------------------------------------------ */

export interface Recommendation {
  name: string;
  nameZh: string;
  type: 'sight' | 'food' | 'shop' | 'other';
  why: string;
  bestTime?: string;
  price?: string;
}

const REC_TYPES = ['sight', 'food', 'shop', 'other'] as const;

function weatherLine(trip: Trip, date: ISODate): string | null {
  const w = trip.weather?.days.find((d) => d.date === date);
  if (!w) return null;
  return `天氣${w.kind === 'climate' ? '（歷年同期平均）' : '預報'}：${describeWeather(w)}`;
}

export function buildRecommendPrompt(trip: Trip, date: ISODate, query: string): string {
  const today = date ? itemsOfDay(trip, date) : [];
  const stops = today.map((it) => `${it.time ? `${it.time} ` : ''}${clean(it.title, 60)}${it.address ? `（${clean(it.address, 80)}）` : ''}`);
  const planned = [...new Set(trip.items.map((it) => clean(it.title, 40)).filter(Boolean))].slice(0, 80);
  const w = date ? weatherLine(trip, date) : null;
  const q = clean(query, 120);
  return [
    `旅程：${clean(trip.name, 60)}`,
    `城市：${placeLabel(trip)}`,
    `日期：${dayLabel(trip, date)}`,
    w,
    stops.length ? `這天的行程點：\n${stops.map((s) => `- ${s}`).join('\n')}` : '這天還沒有行程點，以城市中心或熱門區域為準。',
    `整趟已排的地點（不要重複推薦）：${planned.length ? planned.join('、') : '無'}`,
    `旅客的需求：${q || '順路、值得加入這天的地點'}`,
    '',
    '請推薦 5 個真實存在、知名且目前仍在營業的地點：靠近這天的行程點、順路好安排，而且不在上面已排的清單裡。',
    '- name：當地原文名稱（例如日文、韓文或英文原名），要能直接在 Google 地圖搜尋到',
    '- nameZh：繁體中文名稱（沒有通用譯名就意譯）',
    '- type：sight（景點）、food（餐廳、小吃、咖啡廳）、shop（購物）、other（其他）',
    '- why：一到兩句，說明推薦理由，並提到離哪個行程點近、怎麼過去',
    '- bestTime：建議前往的時段，例如「傍晚 17:00 後」',
    `- price：大概花費（以 ${trip.localCurrency} 表示，例如「¥1,000–2,000」；免費寫「免費」）`,
    '不要編造評分、評論數或排名。',
  ]
    .filter((x): x is string => x != null)
    .join('\n');
}

const RECOMMEND_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['places'],
  properties: {
    places: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'nameZh', 'type', 'why', 'bestTime', 'price'],
        properties: {
          name: { type: 'string', description: '當地原文名稱' },
          nameZh: { type: 'string', description: '繁體中文名稱' },
          type: { type: 'string', enum: [...REC_TYPES] },
          why: { type: 'string' },
          bestTime: { type: 'string' },
          price: { type: 'string' },
        },
      },
    },
  },
} as const;

const RecommendOut = z.object({
  places: z.array(
    z.object({
      name: z.string(),
      nameZh: z.string(),
      type: z.enum(REC_TYPES).catch('other'),
      why: z.string(),
      bestTime: z.string(),
      price: z.string(),
    }),
  ),
});
export type RecommendOutput = z.infer<typeof RecommendOut>;

/** 比對用：去空白、標點、大小寫 */
const keyOf = (s: string) => s.toLowerCase().replace(/[\s\-–—·・()（）'’"「」『』&,.!?/、。]/g, '');

/** 整理推薦：去掉空名稱、重複、已在行程中的地點，最多 5 個 */
export function normalizeRecommendations(raw: RecommendOutput, trip: Pick<Trip, 'items'>): Recommendation[] {
  const existing = new Set(trip.items.flatMap((it) => [keyOf(it.title), keyOf(it.address ?? '')]).filter(Boolean));
  const seen = new Set<string>();
  const out: Recommendation[] = [];
  for (const p of raw.places) {
    const name = clean(p.name, 80);
    const nameZh = clean(p.nameZh, 60);
    if (!name && !nameZh) continue;
    const keys = [keyOf(name), keyOf(nameZh)].filter(Boolean);
    if (keys.some((k) => existing.has(k) || seen.has(k))) continue;
    keys.forEach((k) => seen.add(k));
    const bestTime = clean(p.bestTime, 40);
    const price = clean(p.price, 40);
    out.push({
      name: name || nameZh,
      nameZh: nameZh || name,
      type: p.type,
      why: clean(p.why, 240),
      ...(bestTime ? { bestTime } : {}),
      ...(price ? { price } : {}),
    });
    if (out.length >= 5) break;
  }
  return out;
}

/** 依需求推薦附近地點 */
export async function recommendPlaces(trip: Trip, date: ISODate, query: string, signal?: AbortSignal): Promise<Recommendation[]> {
  const raw = await askJSON(
    {
      system: SYSTEM_BASE + ' 你正在幫旅客找順路可以加入行程的地點。',
      content: buildRecommendPrompt(trip, date, query),
      schema: RECOMMEND_SCHEMA,
      effort: 'medium',
      truncatedMessage: 'AI 回覆太長被截斷了，換個比較具體的需求再試一次。',
    },
    RecommendOut,
    signal,
  );
  const list = normalizeRecommendations(raw, trip);
  if (!list.length) throw new AIError('bad_output', 'AI 這次沒有找到新的地點，換個需求再試一次。');
  return list;
}

/* ------------------------------------------------------------------ */
/* 3c. 穿搭與攜帶建議                                                    */
/* ------------------------------------------------------------------ */

/** 「最高 18° 最低 9°，降雨機率 30%，WMO 天氣代碼 3」 */
export function describeWeather(w: DailyWeather): string {
  const parts = [`最高 ${Math.round(w.tMax)}°C`, `最低 ${Math.round(w.tMin)}°C`];
  if (w.rainProb != null) parts.push(`降雨機率 ${Math.round(w.rainProb)}%`);
  if (w.rainMm != null) parts.push(`雨量 ${Math.round(w.rainMm * 10) / 10} mm`);
  parts.push(`WMO 天氣代碼 ${w.code}`);
  return parts.join('，');
}

export function buildPackingPrompt(trip: Trip, days: DailyWeather[]): string {
  const lines = days.map((w) => `- ${fmtMD(w.date)}（${weekday(w.date)}）${w.kind === 'climate' ? '［歷年同期平均］' : '［預報］'}${describeWeather(w)}`);
  const types = [...new Set(trip.items.map((it) => itemType(it.type).label))];
  return [
    `旅程：${clean(trip.name, 60)}`,
    `城市：${placeLabel(trip)}`,
    `日期：${trip.startDate ?? days[0]?.date ?? ''} 到 ${trip.endDate ?? days[days.length - 1]?.date ?? ''}`,
    types.length ? `行程類型：${types.join('、')}` : null,
    '每日天氣：',
    ...lines,
    '',
    '請根據上面的實際天氣（不要另外假設）給旅客建議：',
    '- text：剛好兩句話。第一句總結這幾天的天氣（溫差、哪幾天可能下雨）；第二句說明怎麼穿。',
    '- tips：3 到 5 則要帶或要注意的東西，每則 12 個字以內，例如「折疊傘」「保暖外套」「好走的鞋」。',
  ]
    .filter((x): x is string => x != null)
    .join('\n');
}

const PACKING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'tips'],
  properties: {
    text: { type: 'string' },
    tips: { type: 'array', items: { type: 'string' } },
  },
} as const;

const PackingOut = z.object({ text: z.string(), tips: z.array(z.string()) });

export function normalizePacking(raw: z.infer<typeof PackingOut>): { text: string; tips: string[] } {
  const text = clean(raw.text, 300);
  const tips = [...new Set(raw.tips.map((t) => clean(t, 30)).filter(Boolean))].slice(0, 5);
  if (!text) throw new AIError('bad_output', AI_ERROR_MESSAGES.bad_output);
  return { text, tips };
}

/** 依天氣預報給穿搭與攜帶建議 */
export async function packingAdvice(trip: Trip, weather: WeatherCache, signal?: AbortSignal): Promise<{ text: string; tips: string[] }> {
  const want = new Set(tripDays(trip));
  const days = weather.days.filter((d) => want.has(d.date)).sort((a, b) => a.date.localeCompare(b.date));
  const use = days.length ? days : weather.days.slice(0, 16);
  if (!use.length) throw new Error('還沒有這趟旅程的天氣資料，請先打開天氣頁更新後再試一次。');
  const raw = await askJSON(
    {
      system: SYSTEM_BASE + ' 你正在依天氣幫旅客準備穿搭與行李。',
      content: buildPackingPrompt(trip, use),
      schema: PACKING_SCHEMA,
      effort: 'medium',
      refusedMessage: 'AI 這次無法產生穿搭建議，請稍後再試一次。',
    },
    PackingOut,
    signal,
  );
  return normalizePacking(raw);
}

/* ------------------------------------------------------------------ */
/* 3d. 收據辨識                                                          */
/* ------------------------------------------------------------------ */

export interface ReceiptResult {
  amount: number;
  currency: string;
  title: string;
  category: ExpenseCategory;
  date?: ISODate;
}

const RECEIPT_CATEGORIES = ['food', 'transport', 'stay', 'ticket', 'shop', 'other'] as const;

export function buildReceiptPrompt(trip: Pick<Trip, 'city' | 'cityGeo' | 'localCurrency' | 'startDate' | 'endDate'>): string {
  return [
    `這是旅客在 ${placeLabel(trip)} 拍的收據或發票照片。旅程當地貨幣是 ${trip.localCurrency}${trip.startDate ? `，旅程日期 ${trip.startDate} 到 ${trip.endDate ?? trip.startDate}` : ''}。`,
    '請讀出：',
    '- amount：實際支付的總金額（含稅、扣掉折扣後），只寫數字；完全看不出金額就填 0',
    `- currency：ISO 4217 三碼幣別；收據上看不出來就填 ${trip.localCurrency}`,
    '- title：店名，沒有店名就寫主要品項（20 字以內，保留原文店名即可）',
    `- category：${RECEIPT_CATEGORIES.map((c) => `${c}（${expenseCategory(c).label}）`).join('、')}`,
    '- date：收據上的日期，格式 YYYY-MM-DD（日本年號等要換算成西元）；看不到就填空字串',
  ].join('\n');
}

const RECEIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['amount', 'currency', 'title', 'category', 'date'],
  properties: {
    amount: { type: 'number' },
    currency: { type: 'string' },
    title: { type: 'string' },
    category: { type: 'string', enum: [...RECEIPT_CATEGORIES] },
    date: { type: 'string' },
  },
} as const;

const ReceiptOut = z.object({
  amount: z.number(),
  currency: z.string(),
  title: z.string(),
  category: z.enum(RECEIPT_CATEGORIES).catch('other'),
  date: z.string(),
});
export type ReceiptOutput = z.infer<typeof ReceiptOut>;

export function normalizeReceipt(raw: ReceiptOutput, trip: Pick<Trip, 'localCurrency'>): ReceiptResult {
  if (!Number.isFinite(raw.amount) || raw.amount <= 0) {
    throw new AIError('bad_output', '看不出收據上的總金額，請拍清楚整張收據（光線充足、不要反光）再試一次。');
  }
  const cur = raw.currency.trim().toUpperCase();
  const d = raw.date.trim();
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(d) && parseISODate(d)?.getDate() === Number(d.slice(8, 10));
  return {
    amount: Math.round(raw.amount * 100) / 100,
    currency: /^[A-Z]{3}$/.test(cur) ? cur : trip.localCurrency,
    title: clean(raw.title, 40) || '收據',
    category: raw.category,
    ...(validDate ? { date: d } : {}),
  };
}

type ImageType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/**
 * 從檔頭判斷圖片格式（API 支援的四種；其他回傳 null）。
 * 不能相信 blob.type：縮圖失敗時拿到的是原檔，可能是 HEIC，或沒有標格式。
 */
export async function sniffImageType(image: Blob): Promise<ImageType | null> {
  const h = new Uint8Array(await image.slice(0, 12).arrayBuffer());
  const text = (a: number, b: number) => String.fromCharCode(...h.subarray(a, b));
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return 'image/jpeg';
  if (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) return 'image/png';
  if (text(0, 4) === 'GIF8') return 'image/gif';
  if (text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** API 每張圖片的上限（base64 後） */
const MAX_IMAGE_BASE64 = 5 * 1024 * 1024;
const RECEIPT_FALLBACK = '收據已附上，可以先手動填寫。';

/** 收據照片 → 金額、幣別、店名、分類 */
export async function scanReceipt(trip: Trip, image: Blob, signal?: AbortSignal): Promise<ReceiptResult> {
  readSettings(); // 沒金鑰時先擋下，不必讀圖
  // 先在本機擋下 API 一定會拒絕的照片（格式不對或太大），不浪費一次請求
  const mediaType = await sniffImageType(image);
  if (!mediaType) {
    throw new AIError('bad_output', `這張照片的格式無法辨識（例如 HEIC），請改用相機拍照，或選 JPEG／PNG 照片再試一次。${RECEIPT_FALLBACK}`);
  }
  const data = await blobToBase64(image);
  if (!data) throw new Error('讀不到這張照片，請重新選一張再試。');
  if (data.length > MAX_IMAGE_BASE64) {
    throw new AIError('bad_output', `這張照片太大，AI 無法辨識。請改用相機拍照，或選小一點的照片再試一次。${RECEIPT_FALLBACK}`);
  }
  const raw = await askJSON(
    {
      system: SYSTEM_BASE + ' 你正在從收據照片擷取記帳資料，數字要和照片上一致。',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
        { type: 'text', text: buildReceiptPrompt(trip) },
      ],
      schema: RECEIPT_SCHEMA,
      effort: 'low',
      refusedMessage: 'AI 無法辨識這張照片，請改拍清楚的收據，或直接在表單手動輸入。',
      truncatedMessage: 'AI 回覆不完整，請再試一次，或直接在表單手動輸入。',
    },
    ReceiptOut,
    signal,
  );
  return normalizeReceipt(raw, trip);
}

/* ------------------------------------------------------------------ */
/* 3e. 測試連線                                                          */
/* ------------------------------------------------------------------ */

/** 用最小請求測試金鑰是否可用（設定頁「測試連線」）。成功就 resolve，失敗丟出 AIError。 */
export async function testConnection(): Promise<void> {
  const { apiKey, model } = readSettings();
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new AIError('network', '目前沒有網路連線，連上網路後再試一次。');
  try {
    // 只要伺服器接受請求（HTTP 200）就代表金鑰、模型與帳戶都可用；不檢查回覆內容
    await getClient(apiKey).messages.create({
      model,
      max_tokens: 16,
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: '回覆「OK」。' }],
    });
  } catch (e) {
    throw toAIError(e);
  }
}
