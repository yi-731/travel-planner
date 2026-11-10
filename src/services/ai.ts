/**
 * AI 助理（Anthropic Claude API，使用者自備 API 金鑰，只存在裝置上）。
 * 用官方 @anthropic-ai/sdk（瀏覽器模式）＋結構化輸出（output_config.format = json_schema）。
 *
 * 結構：
 *   1. 設定與錯誤（AIError、aiErrorMessage、aiReady）
 *   2. 送出請求（askJSON：模型參數、refusal 備援、錯誤對應）
 *   2b. 用量與預算（每次回應依實際 token 數記進 trip.ai.usage；超過本趟上限就不再送出）
 *   3. 各功能：checkDay / recommendPlaces / packingAdvice / scanReceipt / resolvePlaces / testConnection
 *      每個功能 = 提示詞（buildXxxPrompt）＋ JSON schema ＋ zod 驗證 ＋ 整理（normalizeXxx）
 * 提示詞與整理函式都是純函式並有匯出，方便在 ai.test.ts 測試與日後調整。
 *
 * 費用：每個帶行程的功能都記在 trip.ai.usage.byFeature[功能]（dayCheck / recommend / packing / receipt / places），
 * 單價在 domain/constants.ts 的 AI_PRICES；testConnection 不記也不擋。
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  AI_CACHE_READ_FACTOR,
  AI_CACHE_WRITE_FACTOR,
  AI_FEATURE_TOKENS,
  AI_MODELS,
  AI_PLACES_MIN_TWD,
  AI_PRICES,
  DEFAULT_AI_MODEL,
  expenseCategory,
  itemType,
  USD_TWD_FALLBACK,
  type AIFeature,
} from '@/domain/constants';
import { fmtMD, parseISODate, tripDays, weekday } from '@/domain/dates';
import { rateFor } from '@/domain/money';
import { haversineKm, itemsOfDay } from '@/domain/schedule';
import type { AIUsage, DailyWeather, DayCheck, ExpenseCategory, ISODate, Item, SegmentEstimate, Settings, Trip, WeatherCache } from '@/domain/types';
import { blobToBase64 } from '@/platform';
import { useData } from '@/store/data';
import { abortError, isAbort } from './net';

/* ------------------------------------------------------------------ */
/* 1. 錯誤與設定                                                        */
/* ------------------------------------------------------------------ */

export type AIErrorCode =
  | 'no_key' | 'auth' | 'forbidden' | 'billing' | 'rate_limited' | 'overloaded' | 'network' | 'refused' | 'bad_output' | 'budget' | 'unknown';
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
  budget: '本趟 AI 花費已達上限，可到 更多 → App 設定 調高上限',
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
/**
 * 中途失敗（逾時、取消、連線中斷）時估計已生成的輸出 token：每秒這麼多個（偏高估，預算才不會少算），最多到 max_tokens。
 * 串流只在最後的 message_delta 回報輸出 token 數，思考內容也看不到，所以只能用經過的時間估。
 */
const PARTIAL_OUTPUT_TPS = 80;

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
  /** 記在哪一趟、哪個功能（送出前檢查本趟預算，收到回應後記下費用）；不帶就不記也不擋 */
  usage?: { tripId: string; feature: AIFeature };
  /** 整個請求最多等多久（毫秒，預設 DEADLINE_MS）；輸出很長的功能（地點辨識）給久一點 */
  deadlineMs?: number;
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

/** 一次取樣的用量（usage.iterations 的一筆：一般回覆是 message，伺服器改用備援模型重跑的是 fallback_message） */
export interface IterationUsageLike {
  type: string;
  model?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** 回應的 usage（一般與 beta 回應都符合）；output_tokens 已包含思考 */
export interface UsageLike {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  /** beta 回應才有：每次取樣（含被拒絕後改用備援模型重跑）的用量；有的話以它為準 */
  iterations?: ReadonlyArray<IterationUsageLike> | null;
}

/** 回應裡我們需要的最小形狀（一般與 beta 回應都符合） */
export interface ResponseLike {
  stop_reason: string | null;
  content: ReadonlyArray<{ type: string; text?: string }>;
  usage?: UsageLike | null;
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

/** 串流進行到哪裡（請求中途失敗時，用來記下已經開始生成、會被計費的用量） */
export interface StreamProgress {
  /** 目前這次回覆的用量（message_start 時有輸入 token；message_delta 後才有完整的輸出 token） */
  usage: () => UsageLike | null | undefined;
  /** 收到回應標頭（開始生成）的時間 */
  startedAt: number | null;
}

/**
 * 請求中途失敗時的用量估計（純函式）：還沒開始生成（沒有 message_start）回傳 null，不記；
 * 開始生成了：輸入 token 照回報的，輸出 token 取回報值與「經過秒數 × PARTIAL_OUTPUT_TPS」較大者，最多 max_tokens。
 */
export function partialUsage(usage: UsageLike | null | undefined, startedAt: number | null, maxTokens: number, now: number = Date.now()): UsageLike | null {
  if (!usage) return null;
  const secs = startedAt != null ? Math.max(0, now - startedAt) / 1000 : 0;
  const estimate = Math.min(maxTokens, Math.round(secs * PARTIAL_OUTPUT_TPS));
  return { ...usage, output_tokens: Math.max(tok(usage.output_tokens), estimate) };
}

/** 用串流送出、等完整回覆（標頭幾秒內就到，長時間生成不會被逾時切斷又重送） */
async function sendRequest(
  client: Anthropic,
  apiKey: string,
  model: string,
  body: ReturnType<typeof buildRequest>,
  signal: AbortSignal,
  progress?: StreamProgress,
): Promise<ResponseLike> {
  const started = () => {
    if (progress && progress.startedAt == null) progress.startedAt = Date.now();
  };
  if (supportsFallback(model) && !noFallbackKeys.has(apiKey)) {
    try {
      // 被安全機制拒絕時，由伺服器自動改用建議的備援模型重跑（同一次請求內完成）
      const stream = client.beta.messages.stream({ ...body, betas: [FALLBACK_BETA], fallbacks: 'default' }, { signal });
      if (progress) {
        progress.usage = () => stream.currentMessage?.usage;
        stream.on('connect', started);
      }
      return await stream.finalMessage();
    } catch (e) {
      if (!isFallbackUnavailable(e)) throw e;
      // 帳戶還沒開放這個 beta：改送一般請求（這種 400 在生成前就回來，不會重複計費）
      noFallbackKeys.add(apiKey);
      if (progress) progress.startedAt = null;
    }
  }
  const stream = client.messages.stream(body, { signal });
  if (progress) {
    progress.usage = () => stream.currentMessage?.usage;
    stream.on('connect', started);
  }
  return stream.finalMessage();
}

async function askJSON<T>(spec: AskSpec, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  const { apiKey, model } = readSettings();
  if (spec.usage) assertBudget(spec.usage.tripId);
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
  }, spec.deadlineMs ?? DEADLINE_MS);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const progress: StreamProgress = { usage: () => null, startedAt: null };
  let res: ResponseLike;
  try {
    res = await sendRequest(client, apiKey, model, body, ctrl.signal, progress);
  } catch (e) {
    // 已經開始生成才失敗（逾時、取消、App 進背景串流被切斷）：Anthropic 照樣計費，記下估計的用量，本趟預算才不會少算
    if (spec.usage) {
      let u: UsageLike | null = null;
      try {
        u = partialUsage(progress.usage(), progress.startedAt, body.max_tokens);
      } catch {
        u = null;
      }
      if (u) recordUsage(spec.usage.tripId, spec.usage.feature, model, u);
    }
    if (signal?.aborted) throw abortError();
    if (timedOut) throw new AIError('network', TIMEOUT_TEXT);
    throw toAIError(e);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
  // 拒絕、截斷的回覆一樣會計費：先記帳再檢查內容
  if (spec.usage) recordUsage(spec.usage.tripId, spec.usage.feature, model, res.usage);
  return readStructured(res, schema, { refused: spec.refusedMessage, truncated: spec.truncatedMessage });
}

/* ------------------------------------------------------------------ */
/* 2b. 用量與預算                                                        */
/* ------------------------------------------------------------------ */

type Price = { input: number; output: number };
const priceOf = (model: string | null | undefined): Price | undefined => (model && Object.hasOwn(AI_PRICES, model) ? AI_PRICES[model] : undefined);
const tok = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

/**
 * 一次回應的費用（美元）與 token 數。單價見 AI_PRICES（每百萬 token），快取讀取 10%、寫入 125%。
 * 有 usage.iterations（beta 回應）時以它為準：伺服器端備援會把被拒絕的嘗試與備援模型的重跑分開列出，
 * 頂層 usage 只算最後那一次。每一筆都保守地用「要求的模型」和「實際模型」兩者較貴的單價計。
 * inputTokens 含快取讀寫；outputTokens 含思考。
 */
export function usageCostUsd(requestedModel: string, usage: UsageLike | null | undefined): { usd: number; inputTokens: number; outputTokens: number } {
  const base = priceOf(requestedModel) ?? priceOf(DEFAULT_AI_MODEL) ?? { input: 4, output: 20 };
  const entries: IterationUsageLike[] = usage?.iterations?.length ? [...usage.iterations] : usage ? [{ ...usage, type: 'message', model: null }] : [];
  let usd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  for (const e of entries) {
    const own = priceOf(e.model);
    const p = own ? { input: Math.max(base.input, own.input), output: Math.max(base.output, own.output) } : base;
    const input = tok(e.input_tokens);
    const read = tok(e.cache_read_input_tokens);
    const write = tok(e.cache_creation_input_tokens);
    const output = tok(e.output_tokens);
    usd += (input * p.input + read * p.input * AI_CACHE_READ_FACTOR + write * p.input * AI_CACHE_WRITE_FACTOR + output * p.output) / 1_000_000;
    inputTokens += input + read + write;
    outputTokens += output;
  }
  return { usd, inputTokens, outputTokens };
}

/** 1 美元 = ? 新台幣：用行程的匯率（本國貨幣不是台幣時用兩個匯率相除），沒有或不合理就用 32 */
export function usdToTwd(trip: Pick<Trip, 'homeCurrency' | 'localCurrency' | 'rate' | 'rates'>): number {
  try {
    const usd = rateFor(trip, 'USD');
    const twd = rateFor(trip, 'TWD');
    const r = usd != null && twd != null && twd > 0 ? usd / twd : NaN;
    // 當地貨幣是美元、但還沒抓到匯率時 rate 是 1：不合理的數字一律不用
    return Number.isFinite(r) && r >= 15 && r <= 60 ? r : USD_TWD_FALLBACK;
  } catch {
    return USD_TWD_FALLBACK;
  }
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** 把一次回應的用量加進本趟累計（純函式；不修改傳入物件） */
export function addUsage(prev: AIUsage | undefined, feature: string, costTwd: number, inputTokens: number, outputTokens: number): AIUsage {
  const p: AIUsage = prev ?? { costTwd: 0, calls: 0, inputTokens: 0, outputTokens: 0, byFeature: {} };
  const c = Number.isFinite(costTwd) && costTwd > 0 ? costTwd : 0;
  const by = { ...(p.byFeature ?? {}) };
  by[feature] = round4((by[feature] ?? 0) + c);
  return {
    costTwd: round4((p.costTwd || 0) + c),
    calls: (p.calls || 0) + 1,
    inputTokens: (p.inputTokens || 0) + tok(inputTokens),
    outputTokens: (p.outputTokens || 0) + tok(outputTokens),
    byFeature: by,
  };
}

/** 記下一次回應的費用到 trip.ai.usage；回傳這次的新台幣金額。記帳失敗不影響功能本身。 */
function recordUsage(tripId: string, feature: AIFeature, model: string, usage: UsageLike | null | undefined): number {
  try {
    const st = useData.getState();
    const trip = st.trips?.[tripId];
    if (!trip) return 0;
    const c = usageCostUsd(model, usage);
    const twd = c.usd * usdToTwd(trip);
    st.mutateTrip(tripId, (d) => {
      d.ai = { ...d.ai, dayChecks: d.ai?.dayChecks ?? {}, usage: addUsage(d.ai?.usage, feature, twd, c.inputTokens, c.outputTokens) };
    });
    return twd;
  } catch {
    return 0;
  }
}

/** 設定裡的每趟上限（新台幣）；壞掉的值用預設 200，0 = 不限制 */
export function budgetLimit(settings: Partial<Pick<Settings, 'aiTripBudgetTwd'>> | undefined): number {
  const v = settings?.aiTripBudgetTwd;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 200;
}

/** 本趟 AI 已用金額與上限（新台幣）；limit 0 = 不限制（remaining 為 Infinity，exceeded 永遠 false） */
export function aiBudget(trip: Pick<Trip, 'ai'>): { used: number; limit: number; remaining: number; exceeded: boolean } {
  const raw = trip.ai?.usage?.costTwd;
  const used = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 0;
  const limit = budgetLimit(useData.getState().settings);
  if (!limit) return { used, limit: 0, remaining: Infinity, exceeded: false };
  return { used, limit, remaining: Math.max(0, limit - used), exceeded: used >= limit };
}

/** 「本趟 AI 花費已達上限 NT$200，可到 更多 → App 設定 調高上限」 */
export const budgetMessage = (limit: number) => `本趟 AI 花費已達上限 NT$${limit}，可到 更多 → App 設定 調高上限`;

/** 送出前用 store 裡最新的行程檢查預算（呼叫端傳進來的 trip 可能是舊的） */
function assertBudget(tripId: string): void {
  const trip = useData.getState().trips?.[tripId];
  if (!trip) return;
  const b = aiBudget(trip);
  if (b.exceeded) throw new AIError('budget', budgetMessage(b.limit));
}

/** 設定頁：某功能用某模型一次大約多少錢（新台幣，低～高；依 AI_FEATURE_TOKENS 的典型用量） */
export function estimateFeatureTwd(model: string, feature: AIFeature, usdTwd: number = USD_TWD_FALLBACK): [number, number] {
  const t = AI_FEATURE_TOKENS[feature];
  const cost = (output: number) => usageCostUsd(resolveModel(model), { input_tokens: t.input, output_tokens: output }).usd * usdTwd;
  return [cost(t.output[0]), cost(t.output[1])];
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
      usage: { tripId: trip.id, feature: 'dayCheck' },
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
      usage: { tripId: trip.id, feature: 'recommend' },
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
      usage: { tripId: trip.id, feature: 'packing' },
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
  assertBudget(trip.id);
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
      usage: { tripId: trip.id, feature: 'receipt' },
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

/* ------------------------------------------------------------------ */
/* 3f. 地點辨識（每天的城市＋每一站的導航目的地）                          */
/* ------------------------------------------------------------------ */

export interface ResolvedPlaces {
  days: Record<ISODate, { city: string; cityEn: string; region?: string; countryCode?: string }>;
  items: Record<string, { name: string; query: string; navigable: boolean }>;
}

/** 一次請求最多送幾個行程點（太多會被截斷，整份白付） */
export const PLACES_CHUNK = 60;
/** 地點辨識的回覆上限：60 站的輸出加思考約 6K–14K token，留一點餘裕（最壞約 NT$13） */
const PLACES_MAX_TOKENS = 20_000;
/** 地點辨識一批最多等多久（毫秒） */
const PLACES_DEADLINE_MS = 540_000;

export interface PlacesChunk {
  /** 這批要判斷城市的日期（這批行程點所在的日期；整趟辨識時第一批另含沒有行程點的日子） */
  dates: ISODate[];
  items: Item[];
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 整趟的日期：行程日期範圍＋days 裡有的日期（排序） */
function allDates(trip: Pick<Trip, 'startDate' | 'endDate' | 'items' | 'days'>): ISODate[] {
  return [...new Set([...tripDays(trip), ...Object.keys(trip.days ?? {})])].filter((d) => ISO_RE.test(d)).sort();
}

/**
 * 把要辨識的行程點分批（純函式）：依日期排，沒有日期的放最後；每批最多 size 個。
 * 這批已經三分之二滿、下一天又放不下時換下一批（同一天留在一起），否則補滿（少送一次請求；每批都帶各自日期的背景）。
 * itemIds 指定只辨識哪些（例如同步後新增的）；不給 = 整趟。使用者手動設定過導航目的地的（place.source = manual）不送。
 * 整趟辨識時，沒有行程點但有日期列的日子放進第一批，一起判斷城市（天氣用）。
 */
export function buildPlacesChunks(trip: Trip, itemIds?: readonly string[] | null, size: number = PLACES_CHUNK): PlacesChunk[] {
  const want = itemIds ? new Set(itemIds) : null;
  const targets = trip.items.filter((it) => it.place?.source !== 'manual' && (!want || want.has(it.id)));
  const groups = new Map<string, Item[]>();
  for (const it of targets) {
    const k = it.date && ISO_RE.test(it.date) ? it.date : '';
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }
  const order = [...groups.keys()].sort((a, b) => (a === b ? 0 : a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  const datesOf = (list: Item[]) => [...new Set(list.map((it) => it.date).filter((d): d is ISODate => !!d && ISO_RE.test(d)))].sort();

  const chunks: PlacesChunk[] = [];
  let cur: Item[] = [];
  const flush = () => {
    if (cur.length) chunks.push({ dates: datesOf(cur), items: cur });
    cur = [];
  };
  const max = Math.max(1, size);
  for (const k of order) {
    let list = groups.get(k) ?? [];
    // 這天放不下、而且這批已經夠滿（三分之二）：換下一批，讓同一天留在一起；不然就補滿這批（少送一次請求）
    if (cur.length && cur.length + list.length > max && list.length <= max && cur.length >= (max * 2) / 3) flush();
    while (list.length) {
      const room = max - cur.length;
      cur.push(...list.slice(0, room));
      list = list.slice(room);
      if (cur.length >= max) flush();
    }
  }
  flush();

  if (!want) {
    const covered = new Set(chunks.flatMap((c) => c.dates));
    const extra = allDates(trip).filter((d) => {
      const m = trip.days?.[d];
      return !covered.has(d) && !!m && m.source !== 'manual' && !!(m.label?.trim() || m.city?.trim());
    });
    if (extra.length) {
      if (chunks.length) chunks[0] = { ...chunks[0], dates: [...chunks[0].dates, ...extra].sort() };
      else chunks.push({ dates: extra, items: [] });
    }
  }
  return chunks;
}

/** 某天的城市：當天有寫就用，否則沿用前面最近一天，再沒有用行程城市 */
function cityOn(trip: Pick<Trip, 'days' | 'city' | 'cityGeo'>, date: ISODate): string {
  const days = trip.days ?? {};
  const own = days[date]?.city?.trim();
  if (own) return own;
  const prev = Object.keys(days)
    .filter((k) => k < date && days[k]?.city?.trim())
    .sort()
    .pop();
  return (prev ? days[prev]?.city?.trim() : '') || trip.city.trim() || trip.cityGeo?.label?.split(/[，,]/)[0]?.trim() || '';
}

const md = (d: ISODate) => `${fmtMD(d)}（${weekday(d)}）`;

/** 整趟每天一行（日期列原文；沒有就用城市與住宿），讓 AI 看得出整趟路線 */
function tripOverview(trip: Trip): string[] {
  const days = trip.days ?? {};
  return allDates(trip)
    .map((d) => {
      const m = days[d];
      const text = m?.label?.trim() || [m?.city?.trim(), m?.lodging?.trim() ? `住 ${m.lodging.trim()}` : ''].filter(Boolean).join('｜');
      return text ? `- ${d} ${md(d)}${clean(text, 80)}` : null;
    })
    .filter((x): x is string => !!x)
    .slice(0, 45);
}

export function buildPlacesPrompt(trip: Trip, chunk: PlacesChunk, part: { index: number; total: number } = { index: 1, total: 1 }): string {
  const days = chunk.dates.map((d) => ({
    date: d,
    weekday: `週${weekday(d)}`,
    label: clean(trip.days?.[d]?.label, 120) || undefined,
    city: clean(cityOn(trip, d), 40) || undefined,
    lodging: clean(trip.days?.[d]?.lodging, 80) || undefined,
  }));
  const items = chunk.items.map((it) => ({
    id: it.id,
    date: it.date ?? undefined,
    time: it.time,
    tag: clean(it.tag, 20) || itemType(it.type).label,
    title: clean(it.title, 80),
    address: clean(it.address, 120) || undefined,
    route: it.route && (it.route.from || it.route.to) ? `${clean(it.route.from, 60)} → ${clean(it.route.to, 60)}` : undefined,
    transit: clean(it.transit, 60) || undefined,
    note: clean(it.note, 80) || undefined,
  }));
  const overview = tripOverview(trip);
  return [
    `旅程：${clean(trip.name, 60)}`,
    `行程城市：${placeLabel(trip)}`,
    trip.startDate ? `旅程日期：${trip.startDate} 到 ${trip.endDate ?? trip.startDate}` : null,
    overview.length ? `整趟每天的安排（試算表的日期列）：\n${overview.join('\n')}` : null,
    part.total > 1 ? `行程點很多，分 ${part.total} 批送出，這是第 ${part.index} 批。` : null,
    '',
    '這批的日期（label 是日期列原文；city 是目前的判斷，可能不對；lodging 是當天住宿）：',
    JSON.stringify(days),
    '',
    `這批的行程點，共 ${items.length} 個（同一天依試算表順序；tag 是旅客自己寫的分類，address 是試算表「地點／交通」欄，route 是「起點 → 終點」，transit 是交通方式與時間，note 是備註；排在晚上行程後面的 0:45 這類時間是過了午夜，仍算同一天）：`,
    JSON.stringify(items),
    '',
    '請完成：',
    days.length ? `1. days：上面每個日期各一筆（共 ${days.length} 筆）。` : '1. days：這批沒有日期，給空陣列。',
    '   - city：這天白天主要待的城市，用台灣通用的繁體中文譯名（例如「西雅圖」「波特蘭」）；移動日填抵達的城市；從住宿地出發的一日遊填一日遊的目的地（例如住京都、去奈良一日遊填「奈良」）',
    '   - cityEn：城市的英文名（例如 Seattle、Portland、Nara）',
    '   - region：州、省或都道府縣的英文名（例如 Washington、Oregon、Kyoto）；沒有就填空字串',
    '   - countryCode：ISO 3166-1 二碼國碼（例如 US、JP、TW）',
    `2. items：上面每個行程點各一筆（共 ${items.length} 筆），id 照抄。`,
    '   - name：簡短好認的地點名稱，保留原文店名或地名，去掉 ★ ◇ 等記號與括號裡的補充說明（例如「Hotel Zephyr Seattle」「Pike Place Market」）',
    '   - query：在 Google 地圖搜尋用的字串。用當地語言或英文（當地不是中文地區時不要用中文），格式「地點名稱, 街道地址（知道才寫）, 城市, 州或省, 國家」，例如「Pike Place Market, 85 Pike St, Seattle, WA, USA」。判斷方式：',
    '     - 景點、餐廳、商店、活動：那個地點本身；地點欄只寫「看台」「停車場」「大廳」等泛稱時，依標題、tag 和前後行程點判斷是哪個場館或飯店的哪裡',
    '     - 交通（Uber、開車、步行、搭車前往某處）：目的地',
    '     - 搭飛機、火車、巴士出發：出發的機場或車站（例如 route 是 SEA → PDX 就填 Seattle-Tacoma International Airport）；抵達、入境：抵達的機場或車站',
    '     - 回飯店、入住、在住宿休息：當天的住宿（lodging）',
    '     - 一定要帶城市、州或省與國家：很多名稱在別的城市也有（例如 Paris 在美國德州也有同名城市）',
    '   - navigable：這一站要不要出門去某個地方。起床、打包、整理行李、在房間休息之類不用移動的事填 false（query 仍填當天住宿）；其他填 true',
    '不確定街道地址就只寫地點名稱、城市、州或省與國家，不要編造地址或不存在的地點。',
  ]
    .filter((x): x is string => x != null)
    .join('\n');
}

const PLACES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['days', 'items'],
  properties: {
    days: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['date', 'city', 'cityEn', 'region', 'countryCode'],
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD，照抄' },
          city: { type: 'string', description: '城市的繁體中文譯名' },
          cityEn: { type: 'string', description: '城市英文名' },
          region: { type: 'string', description: '州／省英文名，沒有填空字串' },
          countryCode: { type: 'string', description: 'ISO 3166-1 二碼國碼' },
        },
      },
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name', 'query', 'navigable'],
        properties: {
          id: { type: 'string', description: '行程點 id，照抄' },
          name: { type: 'string', description: '簡短的地點名稱' },
          query: { type: 'string', description: 'Google 地圖搜尋字串（當地語言或英文，含城市、州或省、國家）' },
          navigable: { type: 'boolean', description: '要不要出門去某個地方' },
        },
      },
    },
  },
} as const;

/** 先只檢查外層；每一筆分開驗證，壞掉的那筆略過就好（不讓一筆拖垮整批） */
const PlacesOut = z.object({ days: z.array(z.unknown()), items: z.array(z.unknown()) });
export type PlacesOutput = z.infer<typeof PlacesOut>;
const PlaceDayOut = z.object({ date: z.string(), city: z.string(), cityEn: z.string().catch(''), region: z.string().catch(''), countryCode: z.string().catch('') });
const PlaceItemOut = z.object({ id: z.string(), name: z.string().catch(''), query: z.string(), navigable: z.boolean().catch(true) });

const stripMarks = (s: string) => s.replace(/[★☆◇◆⚠️]/g, ' ');
const trimCommas = (s: string) => s.replace(/^[\s,，]+|[\s,，]+$/g, '');

/** 整理 AI 回覆（純函式）：只留這批問到的日期與 id，每個日期／id 只取第一筆，空的查詢略過 */
export function normalizePlaces(raw: PlacesOutput, chunk: PlacesChunk): ResolvedPlaces {
  const dates = new Set(chunk.dates);
  const byId = new Map(chunk.items.map((it) => [it.id, it]));
  const out: ResolvedPlaces = { days: {}, items: {} };
  for (const r of raw.days) {
    const p = PlaceDayOut.safeParse(r);
    if (!p.success) continue;
    const date = p.data.date.trim();
    if (!dates.has(date) || out.days[date]) continue;
    const city = clean(stripMarks(p.data.city), 40);
    const cityEn = clean(p.data.cityEn, 60);
    if (!city && !cityEn) continue;
    const region = clean(p.data.region, 60);
    const cc = p.data.countryCode.trim().toUpperCase();
    out.days[date] = { city: city || cityEn, cityEn, ...(region ? { region } : {}), ...(/^[A-Z]{2}$/.test(cc) ? { countryCode: cc } : {}) };
  }
  for (const r of raw.items) {
    const p = PlaceItemOut.safeParse(r);
    if (!p.success) continue;
    const it = byId.get(p.data.id.trim());
    if (!it || out.items[it.id]) continue;
    const query = trimCommas(clean(stripMarks(p.data.query), 200));
    if (!query) continue;
    const name = clean(stripMarks(p.data.name), 80) || clean(stripMarks(it.title), 80) || query;
    out.items[it.id] = { name, query, navigable: p.data.navigable };
  }
  return out;
}

export interface ResolvePlacesOptions {
  /** 只辨識這些行程點（不給 = 整趟） */
  itemIds?: readonly string[] | null;
  signal?: AbortSignal;
  /** 每一批完成就呼叫（後面的批次失敗時，前面已付費的結果不會浪費）；可以是 async */
  onChunk?: (part: ResolvedPlaces, done: number, total: number) => void | Promise<void>;
}

const PLACES_SYSTEM =
  SYSTEM_BASE +
  ' 你正在把旅客試算表裡的行程整理成每天所在的城市，以及每一站可以直接在 Google 地圖導航的目的地。' +
  '例外：query、cityEn、region 用當地語言或英文；name 保留原文店名或地名。';

/** 地點辨識，可指定行程點與逐批回報（runResolvePlaces 用） */
export async function resolvePlacesFor(trip: Trip, opts: ResolvePlacesOptions = {}): Promise<ResolvedPlaces> {
  readSettings();
  const b = aiBudget(useData.getState().trips?.[trip.id] ?? trip);
  if (b.exceeded) throw new AIError('budget', budgetMessage(b.limit));
  if (b.limit && b.remaining < AI_PLACES_MIN_TWD) {
    throw new AIError(
      'budget',
      `本趟 AI 花費只剩 NT$${Math.floor(b.remaining)}，不夠辨識地點（約需 NT$${AI_PLACES_MIN_TWD}），可到 更多 → App 設定 調高上限`,
    );
  }
  const chunks = buildPlacesChunks(trip, opts.itemIds);
  if (!chunks.length) throw new Error('這趟旅程還沒有需要辨識的行程點。');

  const all: ResolvedPlaces = { days: {}, items: {} };
  for (let i = 0; i < chunks.length; i++) {
    if (opts.signal?.aborted) throw abortError();
    const raw = await askJSON(
      {
        system: PLACES_SYSTEM,
        content: buildPlacesPrompt(trip, chunks[i], { index: i + 1, total: chunks.length }),
        schema: PLACES_SCHEMA,
        effort: 'medium',
        maxTokens: PLACES_MAX_TOKENS,
        // 每批最多 2 萬 token 的輸出，慢的時候會超過一般的 5 分鐘
        deadlineMs: PLACES_DEADLINE_MS,
        refusedMessage: 'AI 這次無法辨識地點，導航會先用試算表的地點欄，之後可以再試一次。',
        truncatedMessage: 'AI 回覆太長被截斷了，請再試一次。',
        usage: { tripId: trip.id, feature: 'places' },
      },
      PlacesOut,
      opts.signal,
    );
    const part = normalizePlaces(raw, chunks[i]);
    for (const [d, v] of Object.entries(part.days)) all.days[d] ??= v;
    Object.assign(all.items, part.items);
    await opts.onChunk?.(part, i + 1, chunks.length);
  }
  return all;
}

/** AI 讀整趟行程，判斷每天城市與每站真正的導航目的地（行程很長時分批送，每批 60 站以內） */
export async function resolvePlaces(trip: Trip, signal?: AbortSignal): Promise<ResolvedPlaces> {
  return resolvePlacesFor(trip, { signal });
}

/** 這次地點辨識大約多少錢（新台幣，低～高）：每批依行程點數比例估，至少算三分之一批 */
export function estimatePlacesTwd(trip: Trip, model: string, itemIds?: readonly string[] | null): [number, number] {
  const [lo, hi] = estimateFeatureTwd(model, 'places', usdToTwd(trip));
  const chunks = buildPlacesChunks(trip, itemIds);
  const f = chunks.reduce((s, c) => s + Math.max(1 / 3, c.items.length / PLACES_CHUNK), 0);
  return [lo * f, hi * f];
}
