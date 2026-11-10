import Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Item, Trip } from '@/domain/types';

// 不連真正的 API：設定從假的 store 讀，網路用假的 fetch
const settings = { anthropicApiKey: '', aiModel: 'claude-opus-5-5' };
vi.mock('@/store/data', () => ({ useData: { getState: () => ({ settings }) } }));
// 大於 4 KB 的「照片」回傳超過 API 上限的 base64
vi.mock('@/platform', () => ({ blobToBase64: async (b: Blob) => (b.size > 4096 ? 'A'.repeat(5 * 1024 * 1024 + 4) : 'QUJD') }));

const ai = await import('./ai');
const { AIError } = ai;

function mkItem(p: Partial<Item> & Pick<Item, 'title'>): Item {
  return { id: p.title, date: '2026-11-21', type: 'sight', done: false, createdAt: 0, updatedAt: 0, ...p };
}

function mkTrip(items: Item[]): Trip {
  return {
    id: 't1', name: '京阪奈五日', city: 'KYOTO',
    cityGeo: { lat: 35, lng: 135.7, label: '京都', countryCode: 'JP' },
    startDate: '2026-11-21', endDate: '2026-11-25', localCurrency: 'JPY', homeCurrency: 'TWD', rate: 0.21,
    members: ['我'], items, expenses: [], cover: { kind: 'orb' }, ai: { dayChecks: {} }, createdAt: 0, updatedAt: 0,
  };
}

const day = [
  mkItem({ title: '伏見稻荷大社', time: '07:30', address: '京都市伏見区深草藪之内町68', durationMin: 120 }),
  mkItem({ title: '錦市場', time: '11:00', type: 'food', durationMin: 90 }),
  mkItem({ title: '嵐山竹林小徑', time: '14:00', durationMin: 60 }),
];

const hdrs = () => new Headers({ 'content-type': 'application/json' });

describe('提示詞', () => {
  it('排程檢查：含城市、星期、段數與行程 JSON', () => {
    const p = ai.buildDayCheckPrompt(mkTrip(day), '2026-11-21', day);
    expect(p).toContain('京都（JP）');
    expect(p).toContain('2026-11-21（週六）・Day 1');
    expect(p).toContain('剛好 2 筆');
    expect(p).toContain('"title":"伏見稻荷大社"');
    expect(p).toContain('"durationMin":120');
    expect(p).toContain('"type":"餐廳"');
    expect(p).toContain('週六');
  });

  it('推薦：列出當天行程點、已排清單與需求', () => {
    const trip = mkTrip([...day, mkItem({ title: '大阪城', date: '2026-11-23' })]);
    const p = ai.buildRecommendPrompt(trip, '2026-11-21', '  雨天備案 ');
    expect(p).toContain('- 07:30 伏見稻荷大社（京都市伏見区深草藪之内町68）');
    expect(p).toContain('不要重複推薦）：伏見稻荷大社、錦市場、嵐山竹林小徑、大阪城');
    expect(p).toContain('旅客的需求：雨天備案');
    expect(p).toContain('以 JPY 表示');
    expect(p).not.toContain('天氣');
  });

  it('推薦：有天氣快取時附上當天天氣；沒有需求時用預設', () => {
    const trip = mkTrip(day);
    trip.weather = { fetchedAt: 0, lat: 35, lng: 135.7, days: [{ date: '2026-11-21', code: 61, tMax: 14.4, tMin: 7.6, rainProb: 80, kind: 'forecast' }] };
    const p = ai.buildRecommendPrompt(trip, '2026-11-21', '');
    expect(p).toContain('天氣預報：最高 14°C，最低 8°C，降雨機率 80%，WMO 天氣代碼 61');
    expect(p).toContain('旅客的需求：順路、值得加入這天的地點');
  });

  it('穿搭：每日天氣一行，區分預報與歷年平均', () => {
    const p = ai.buildPackingPrompt(mkTrip(day), [
      { date: '2026-11-21', code: 3, tMax: 16, tMin: 8, rainProb: 20, kind: 'forecast' },
      { date: '2026-11-22', code: 61, tMax: 15, tMin: 9, rainMm: 2.34, kind: 'climate' },
    ]);
    expect(p).toContain('11/21（六）［預報］最高 16°C，最低 8°C，降雨機率 20%');
    expect(p).toContain('11/22（日）［歷年同期平均］最高 15°C，最低 9°C，雨量 2.3 mm');
    expect(p).toContain('剛好兩句話');
  });

  it('收據：帶入當地貨幣與分類選項', () => {
    const p = ai.buildReceiptPrompt(mkTrip([]));
    expect(p).toContain('當地貨幣是 JPY');
    expect(p).toContain('ticket（門票）');
    expect(p).toContain('YYYY-MM-DD');
  });
});

describe('請求參數', () => {
  it('只送 effort 與 json_schema，不送 temperature / thinking', () => {
    const body = ai.buildRequest('claude-opus-5-5', { system: 's', content: 'hi', schema: { type: 'object' }, effort: 'medium' });
    expect(body.output_config).toEqual({ effort: 'medium', format: { type: 'json_schema', schema: { type: 'object' } } });
    expect(body.max_tokens).toBeGreaterThanOrEqual(16000);
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('top_p');
    expect(body).not.toHaveProperty('thinking');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('只有 Opus / Sonnet 5.5 用伺服器端備援；未知模型改用預設', () => {
    expect(ai.supportsFallback('claude-opus-5-5')).toBe(true);
    expect(ai.supportsFallback('claude-sonnet-5-5')).toBe(true);
    expect(ai.supportsFallback('claude-haiku-5-5')).toBe(false);
    expect(ai.resolveModel('claude-haiku-5-5')).toBe('claude-haiku-5-5');
    expect(ai.resolveModel('claude-3-opus-20240229')).toBe('claude-opus-5-5');
    expect(ai.resolveModel('')).toBe('claude-opus-5-5');
  });

  it('收據圖片格式看檔頭判斷，不看 blob.type', async () => {
    const blob = (bytes: number[] | string, type = '') => new Blob([typeof bytes === 'string' ? bytes : new Uint8Array(bytes)], { type });
    expect(await ai.sniffImageType(blob([0xff, 0xd8, 0xff, 0xe0, 0, 0], 'image/heic'))).toBe('image/jpeg');
    expect(await ai.sniffImageType(blob([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(await ai.sniffImageType(blob('GIF89a'))).toBe('image/gif');
    expect(await ai.sniffImageType(blob('RIFF\u0000\u0000\u0000\u0000WEBPVP8 '))).toBe('image/webp');
    expect(await ai.sniffImageType(blob('\u0000\u0000\u0000\u0018ftypheic', 'image/jpeg'))).toBeNull();
    expect(await ai.sniffImageType(blob(''))).toBeNull();
  });
});

describe('讀取結構化回覆', () => {
  const S = z.object({ a: z.number() });
  const text = (t: string) => ({ type: 'text', text: t });

  it('略過思考區塊，解析第一個文字區塊', () => {
    expect(ai.readStructured({ stop_reason: 'end_turn', content: [{ type: 'thinking' }, text('{"a":1}'), text('{"a":2}')] }, S)).toEqual({ a: 1 });
  });

  it('有備援模型時取最後一個 fallback 區塊之後的文字', () => {
    const res = { stop_reason: 'end_turn', content: [text('{"a":'), { type: 'fallback' }, text('{"a":3}')] };
    expect(ai.readStructured(res, S)).toEqual({ a: 3 });
  });

  it('拒絕與截斷的說明可以依功能換掉', () => {
    const msg = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return e instanceof AIError ? e.message : 'other';
      }
      return 'none';
    };
    expect(msg(() => ai.readStructured({ stop_reason: 'refusal', content: [] }, S))).toBe(ai.AI_ERROR_MESSAGES.refused);
    expect(msg(() => ai.readStructured({ stop_reason: 'refusal', content: [] }, S, { refused: '換張照片' }))).toBe('換張照片');
    expect(msg(() => ai.readStructured({ stop_reason: 'max_tokens', content: [] }, S))).toBe('AI 回覆太長被截斷了，請再試一次。');
    expect(msg(() => ai.readStructured({ stop_reason: 'max_tokens', content: [] }, S, { truncated: '減少行程點' }))).toBe('減少行程點');
  });

  it('拒絕 → refused；截斷、壞 JSON、格式不符 → bad_output', () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return e instanceof AIError ? e.code : 'other';
      }
      return 'none';
    };
    expect(code(() => ai.readStructured({ stop_reason: 'refusal', content: [text('{"a":1}')] }, S))).toBe('refused');
    expect(code(() => ai.readStructured({ stop_reason: 'max_tokens', content: [text('{"a":')] }, S))).toBe('bad_output');
    expect(code(() => ai.readStructured({ stop_reason: 'end_turn', content: [text('not json')] }, S))).toBe('bad_output');
    expect(code(() => ai.readStructured({ stop_reason: 'end_turn', content: [text('{"a":"x"}')] }, S))).toBe('bad_output');
    expect(code(() => ai.readStructured({ stop_reason: 'end_turn', content: [] }, S))).toBe('bad_output');
  });
});

describe('整理 AI 回覆', () => {
  it('排程檢查：段數補齊、分鐘取整並限制範圍、提醒最多 4 則', () => {
    const out = ai.normalizeDayCheck(
      { segments: [{ minutes: 34.6, mode: ' 電車 ', tip: ' 京阪本線 → JR 奈良線 ' }], warnings: ['a', ' ', 'b', 'c', 'd', 'e'], summary: '  順暢 ' },
      day,
    );
    expect(out.segments).toHaveLength(2);
    expect(out.segments[0]).toEqual({ minutes: 35, mode: '電車', tip: '京阪本線 → JR 奈良線' });
    expect(out.segments[1]).toMatchObject({ minutes: 20, mode: '未估算' });
    expect(out.warnings).toEqual(['a', 'b', 'c', 'd']);
    expect(out.summary).toBe('順暢');
  });

  it('排程檢查：多的段落截掉；0 分與空 tip 處理', () => {
    const seg = { minutes: 0, mode: '', tip: '' };
    const out = ai.normalizeDayCheck({ segments: [seg, seg, seg, seg], warnings: [], summary: '' }, day);
    expect(out.segments).toEqual([{ minutes: 1, mode: '移動' }, { minutes: 1, mode: '移動' }]);
    expect(out).not.toHaveProperty('summary');
  });

  it('排程檢查：缺的段落有座標時用距離粗估', () => {
    const a = mkItem({ title: 'A', geo: { lat: 35, lng: 135.7, source: 'manual' } });
    const b = mkItem({ title: 'B', geo: { lat: 35.05, lng: 135.7, source: 'manual' } });
    const out = ai.normalizeDayCheck({ segments: [], warnings: [], summary: '' }, [a, b]);
    expect(out.segments[0].minutes).toBeGreaterThan(5);
    expect(out.segments[0].minutes).toBeLessThan(30);
  });

  it('推薦：排除已排地點與重複，最多 5 個，空欄位不輸出', () => {
    type T = 'sight' | 'food' | 'shop' | 'other';
    const p = (name: string, nameZh: string, type: T = 'food') => ({ name, nameZh, type, why: '近', bestTime: '', price: '¥500' });
    const out = ai.normalizeRecommendations(
      {
        places: [
          p('錦市場', '錦市場'),
          p('伏見稲荷大社', '伏見稻荷大社'),
          p('中村藤吉 本店', '中村藤吉本店'),
          p('中村藤吉本店', '中村藤吉'),
          p('', ''),
          p('% Arabica 嵐山', '% Arabica 嵐山咖啡'),
          p('天龍寺', '天龍寺', 'sight'),
          p('二寧坂', '二寧坂', 'shop'),
          p('祇園', '祇園', 'other'),
          p('六角堂', '六角堂', 'sight'),
        ],
      },
      { items: day },
    );
    // 伏見稲荷大社的中文名和已排的「伏見稻荷大社」相同 → 排除
    expect(out.map((r) => r.name)).toEqual(['中村藤吉 本店', '% Arabica 嵐山', '天龍寺', '二寧坂', '祇園']);
    expect(out[0]).not.toHaveProperty('bestTime');
    expect(out[0].price).toBe('¥500');
  });

  it('收據：幣別預設當地貨幣、日期格式檢查、金額 0 視為看不出來', () => {
    const trip = { localCurrency: 'JPY' };
    expect(ai.normalizeReceipt({ amount: 1280.004, currency: 'jpy', title: ' セブン-イレブン ', category: 'food', date: '2026-11-21' }, trip)).toEqual({
      amount: 1280, currency: 'JPY', title: 'セブン-イレブン', category: 'food', date: '2026-11-21',
    });
    expect(ai.normalizeReceipt({ amount: 5, currency: '円', title: '', category: 'other', date: '2026-02-31' }, trip)).toEqual({
      amount: 5, currency: 'JPY', title: '收據', category: 'other',
    });
    expect(() => ai.normalizeReceipt({ amount: 0, currency: 'JPY', title: 'x', category: 'food', date: '' }, trip)).toThrow(AIError);
  });

  it('穿搭：tips 去重、最多 5 則；沒有文字視為失敗', () => {
    expect(ai.normalizePacking({ text: ' 涼。帶外套。 ', tips: ['傘', '傘', '外套', '', '鞋', '帽', '圍巾', '手套'] })).toEqual({
      text: '涼。帶外套。', tips: ['傘', '外套', '鞋', '帽', '圍巾'],
    });
    expect(() => ai.normalizePacking({ text: '', tips: [] })).toThrow(AIError);
  });
});

describe('錯誤對應', () => {
  const code = (e: unknown) => {
    const r = ai.toAIError(e);
    return r instanceof AIError ? r.code : r.name;
  };

  it('SDK 錯誤類別 → 代碼', () => {
    expect(code(new Anthropic.AuthenticationError(401, { error: { type: 'authentication_error' } }, 'x', hdrs()))).toBe('auth');
    expect(code(new Anthropic.PermissionDeniedError(403, undefined, 'x', hdrs()))).toBe('forbidden');
    expect(code(new Anthropic.RateLimitError(429, undefined, 'x', hdrs()))).toBe('rate_limited');
    expect(code(new Anthropic.InternalServerError(500, undefined, 'x', hdrs()))).toBe('overloaded');
    expect(code(Anthropic.APIError.generate(529, { error: { type: 'overloaded_error' } }, 'x', hdrs()))).toBe('overloaded');
    expect(code(new Anthropic.APIConnectionError({ message: 'down' }))).toBe('network');
    expect(code(new Anthropic.APIConnectionTimeoutError())).toBe('network');
    expect(code(new Anthropic.BadRequestError(400, undefined, 'x', hdrs()))).toBe('unknown');
  });

  it('餘額不足（402）與本月用量上限 → billing，不說「稍後再試」', () => {
    const spend = { type: 'error', error: { type: 'rate_limit_error', message: 'x', details: { error_code: 'enforced_spend_limit_reached' } } };
    expect(code(Anthropic.APIError.generate(402, { type: 'error', error: { type: 'billing_error', message: 'x' } }, 'x', new Headers()))).toBe('billing');
    expect(code(Anthropic.APIError.generate(429, spend, 'x', new Headers()))).toBe('billing');
    expect(code(new Anthropic.EnforcedSpendLimitReachedError(429, spend, 'x', new Headers()))).toBe('billing');
    expect(code(Anthropic.APIError.generate(429, { type: 'error', error: { type: 'rate_limit_error', message: 'x' } }, 'x', new Headers()))).toBe('rate_limited');
    expect(code({ status: 402 })).toBe('billing');
    expect(ai.aiErrorMessage(Anthropic.APIError.generate(429, spend, 'x', new Headers()))).toContain('下個月 1 日');
    expect(ai.aiErrorMessage({ status: 402 })).toContain('帳單');
  });

  it('403 不說金鑰無效；帳戶停用另外說明；400 不說「拒絕」', () => {
    expect(ai.aiErrorMessage(new Anthropic.PermissionDeniedError(403, undefined, 'x', hdrs()))).toContain('不允許這把金鑰');
    expect(code(new Anthropic.OrganizationOnHoldError(400, undefined, 'x', hdrs()))).toBe('forbidden');
    expect(ai.aiErrorMessage(new Anthropic.OrganizationOnHoldError(400, undefined, 'x', hdrs()))).toContain('停用');
    const bad = ai.aiErrorMessage(new Anthropic.BadRequestError(400, undefined, 'x', hdrs()));
    expect(bad).not.toContain('拒絕');
    expect(bad).toContain('餘額');
  });

  it('串流途中的錯誤事件（沒有狀態碼）依錯誤類型判斷', () => {
    const mid = (type: string) => new Anthropic.APIError(undefined, { type: 'error', error: { type, message: 'x' } }, undefined, new Headers());
    expect(code(mid('overloaded_error'))).toBe('overloaded');
    expect(code(mid('api_error'))).toBe('overloaded');
    expect(code(mid('rate_limit_error'))).toBe('rate_limited');
    expect(code(mid('billing_error'))).toBe('billing');
  });

  it('取消 → AbortError（不是 AIError）', () => {
    expect(code(new Anthropic.APIUserAbortError())).toBe('AbortError');
    expect(ai.aiErrorMessage(new Anthropic.APIUserAbortError())).toBe('已取消。');
  });

  it('非 SDK 物件依狀態碼判斷', () => {
    expect(code({ status: 529 })).toBe('overloaded');
    expect(code({ status: 503 })).toBe('overloaded');
    expect(code({ status: 401 })).toBe('auth');
    expect(code({ status: 429 })).toBe('rate_limited');
    expect(code(new TypeError('Failed to fetch'))).toBe('network');
    expect(code('???')).toBe('unknown');
  });

  it('中文訊息', () => {
    expect(ai.aiErrorMessage(new Anthropic.AuthenticationError(401, undefined, 'x', hdrs()))).toBe('API 金鑰無效，請到 更多 → App 設定 重新貼上。');
    expect(ai.aiErrorMessage(new AIError('no_key', ''))).toContain('App 設定');
    expect(ai.aiErrorMessage({ status: 429 })).toContain('一分鐘');
    expect(ai.aiErrorMessage(new Error('這天至少要有 2 個行程點'))).toBe('這天至少要有 2 個行程點');
    expect(ai.aiErrorMessage(new Error('Something broke'))).toBe(ai.AI_ERROR_MESSAGES.unknown);
  });
});

describe('完整流程（假的 fetch）', () => {
  let keyN = 0;
  let calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];

  type Msg = { stop_reason: string; content: { type: string; text?: string }[] } & Record<string, unknown>;
  /** 完整的回覆 → 串流事件（SSE） */
  function sse(msg: Msg): string {
    const ev: [string, unknown][] = [['message_start', { type: 'message_start', message: { ...msg, content: [], stop_reason: null } }]];
    msg.content.forEach((b, index) => {
      if (b.type === 'text') {
        ev.push(['content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } }]);
        ev.push(['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: b.text } }]);
      } else if (b.type === 'thinking') {
        ev.push(['content_block_start', { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } }]);
        ev.push(['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: 's' } }]);
      } else {
        ev.push(['content_block_start', { type: 'content_block_start', index, content_block: b }]);
      }
      ev.push(['content_block_stop', { type: 'content_block_stop', index }]);
    });
    ev.push(['message_delta', { type: 'message_delta', delta: { stop_reason: msg.stop_reason, stop_sequence: null }, usage: { output_tokens: 1 } }]);
    ev.push(['message_stop', { type: 'message_stop' }]);
    return ev.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
  }

  function mockApi(reply: (body: Record<string, unknown>, n: number) => { status?: number; json: unknown }) {
    calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        calls.push({ url: String(input), headers: new Headers(init?.headers), body });
        const r = reply(body, calls.length);
        const status = r.status ?? 200;
        if (body.stream && status === 200) return new Response(sse(r.json as Msg), { status, headers: { 'content-type': 'text/event-stream' } });
        return new Response(JSON.stringify(r.json), { status, headers: { 'content-type': 'application/json' } });
      }),
    );
  }
  const message = (text: string, stop_reason = 'end_turn') => ({
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason, stop_sequence: null,
    content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text }],
    usage: { input_tokens: 1, output_tokens: 1 },
  });

  beforeEach(() => {
    settings.anthropicApiKey = `sk-ant-test-${++keyN}`; // 每個測試用新金鑰 → 新的 client（吃到新的 fetch）
    settings.aiModel = 'claude-opus-5-5';
  });
  afterEach(() => vi.unstubAllGlobals());

  it('沒有金鑰 → no_key，不連線', async () => {
    settings.anthropicApiKey = '  ';
    mockApi(() => ({ json: {} }));
    expect(ai.aiReady()).toBe(false);
    await expect(ai.checkDay(mkTrip(day), '2026-11-21')).rejects.toMatchObject({ code: 'no_key' });
    expect(calls).toHaveLength(0);
  });

  it('少於 2 站直接回報中文錯誤', async () => {
    mockApi(() => ({ json: {} }));
    await expect(ai.checkDay(mkTrip(day.slice(0, 1)), '2026-11-21')).rejects.toThrow('至少要有 2 個行程點');
    expect(calls).toHaveLength(0);
  });

  it('Opus：送 beta 備援標頭與 fallbacks: default，回傳 DayCheck', async () => {
    mockApi(() => ({ json: message(JSON.stringify({ segments: [{ minutes: 35, mode: '電車', tip: 'JR 奈良線' }, { minutes: 40, mode: '電車', tip: '嵐電' }], warnings: [], summary: 'OK' })) }));
    const res = await ai.checkDay(mkTrip(day), '2026-11-21');
    expect(res.itemIds).toEqual(['伏見稻荷大社', '錦市場', '嵐山竹林小徑']);
    expect(res.segments.map((s) => s.minutes)).toEqual([35, 40]);
    expect(res.summary).toBe('OK');
    const c = calls[0];
    expect(c.url).toContain('/v1/messages');
    expect(c.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(c.headers.get('authorization')).toBe(`Bearer ${settings.anthropicApiKey}`);
    expect(c.body).toMatchObject({ model: 'claude-opus-5-5', stream: true, fallbacks: 'default', output_config: { effort: 'medium', format: { type: 'json_schema' } } });
    expect(c.body).not.toHaveProperty('temperature');
    expect(c.body).not.toHaveProperty('thinking');
    expect(c.body).not.toHaveProperty('betas');
  });

  it('伺服器改用備援模型：取最後一個 fallback 區塊之後的文字', async () => {
    const out = JSON.stringify({ text: '涼。帶外套。', tips: ['外套'] });
    mockApi(() => ({
      json: {
        ...message(''),
        content: [{ type: 'text', text: '{"text":' }, { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-5' } }, { type: 'text', text: out }],
      },
    }));
    const trip = mkTrip(day);
    const r = await ai.packingAdvice(trip, { fetchedAt: 0, lat: 35, lng: 135.7, days: [{ date: '2026-11-21', code: 3, tMax: 16, tMin: 8, kind: 'forecast' }] });
    expect(r).toEqual({ text: '涼。帶外套。', tips: ['外套'] });
  });

  it('帳戶沒開放備援 beta：自動改送一般請求，之後也不再送 beta', async () => {
    const ok = message(JSON.stringify({ segments: [{ minutes: 35, mode: '電車', tip: '' }, { minutes: 40, mode: '電車', tip: '' }], warnings: [], summary: 'OK' }));
    const betaError = { type: 'error', error: { type: 'invalid_request_error', message: 'Unexpected value(s) `server-side-fallback-2026-07-01` for the `anthropic-beta` header.' } };
    mockApi((_b, n) => (n === 1 ? { status: 400, json: betaError } : { json: ok }));
    const res = await ai.checkDay(mkTrip(day), '2026-11-21');
    expect(res.summary).toBe('OK');
    expect(calls).toHaveLength(2);
    expect(calls[1].headers.get('anthropic-beta')).toBeNull();
    expect(calls[1].body).not.toHaveProperty('fallbacks');
    await ai.checkDay(mkTrip(day), '2026-11-21');
    expect(calls).toHaveLength(3);
    expect(calls[2].headers.get('anthropic-beta')).toBeNull();
  });

  it('各功能的拒絕／截斷說明', async () => {
    // 同一把金鑰共用 client（與 fetch），所以用第幾次請求決定回覆
    mockApi((_b, n) => ({ json: n === 2 ? message('{"segments":', 'max_tokens') : message('', 'refusal') }));
    await expect(ai.checkDay(mkTrip(day), '2026-11-21')).rejects.toMatchObject({ code: 'refused', message: expect.stringContaining('無法檢查這天的行程') });
    await expect(ai.checkDay(mkTrip(day), '2026-11-21')).rejects.toMatchObject({ code: 'bad_output', message: expect.stringContaining('減少這天的行程點') });
    const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });
    await expect(ai.scanReceipt(mkTrip(day), jpeg)).rejects.toMatchObject({ code: 'refused', message: expect.stringContaining('手動輸入') });
  });

  it('生成太久：整體期限到了就停止，說明是太久沒完成（不是「已取消」）', async () => {
    vi.useFakeTimers();
    try {
      calls = [];
      // 標頭馬上回來，但內容一直沒有送完
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          calls.push({ url: String(input), headers: new Headers(init?.headers), body: {} });
          const body = new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(new TextEncoder().encode(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { ...message(''), content: [], stop_reason: null } })}\n\n`));
              init?.signal?.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
            },
          });
          return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
        }),
      );
      const p = ai.recommendPlaces(mkTrip(day), '2026-11-21', '');
      const done = expect(p).rejects.toMatchObject({ code: 'network', message: expect.stringContaining('太久') });
      await vi.advanceTimersByTimeAsync(301_000);
      await done;
      expect(calls).toHaveLength(1); // 已經開始生成的請求不會被重送
    } finally {
      vi.useRealTimers();
    }
  });

  it('Haiku：不送備援；拒絕 → refused', async () => {
    settings.aiModel = 'claude-haiku-5-5';
    mockApi(() => ({ json: message('', 'refusal') }));
    await expect(ai.recommendPlaces(mkTrip(day), '2026-11-21', '咖啡廳')).rejects.toMatchObject({ code: 'refused' });
    expect(calls[0].headers.get('anthropic-beta')).toBeNull();
    expect(calls[0].body).not.toHaveProperty('fallbacks');
    expect(calls[0].body.model).toBe('claude-haiku-5-5');
  });

  it('推薦：不認得的類型改成 other，已排的地點被排除', async () => {
    const places = [
      { name: 'Bar K6', nameZh: 'K6 酒吧', type: 'bar', why: '近先斗町', bestTime: '21:00 後', price: '¥2,000' },
      { name: '錦市場', nameZh: '錦市場', type: 'food', why: '', bestTime: '', price: '' },
    ];
    mockApi(() => ({ json: message(JSON.stringify({ places })) }));
    const r = await ai.recommendPlaces(mkTrip(day), '2026-11-21', '夜景');
    expect(r).toEqual([{ name: 'Bar K6', nameZh: 'K6 酒吧', type: 'other', why: '近先斗町', bestTime: '21:00 後', price: '¥2,000' }]);
  });

  it('401 → auth（不重試）', async () => {
    mockApi(() => ({ status: 401, json: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }));
    await expect(ai.testConnection()).rejects.toMatchObject({ code: 'auth' });
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ max_tokens: 16, output_config: { effort: 'low' } });
  });

  it('收據：HEIC 或太大的照片在送出前就擋下', async () => {
    mockApi(() => ({ json: message('{}') }));
    const heic = new Blob([new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode('ftypheic')])], { type: 'image/jpeg' });
    await expect(ai.scanReceipt(mkTrip(day), heic)).rejects.toMatchObject({ code: 'bad_output', message: expect.stringContaining('HEIC') });
    const big = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), new Uint8Array(8000)], { type: 'image/jpeg' });
    await expect(ai.scanReceipt(mkTrip(day), big)).rejects.toMatchObject({ code: 'bad_output', message: expect.stringContaining('太大') });
    expect(calls).toHaveLength(0);
  });

  it('收據：圖片放在文字前、effort low、格式依檔頭', async () => {
    mockApi(() => ({ json: message(JSON.stringify({ amount: 1520, currency: 'JPY', title: 'ローソン', category: 'food', date: '' })) }));
    const r = await ai.scanReceipt(mkTrip(day), new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: '' }));
    expect(r).toEqual({ amount: 1520, currency: 'JPY', title: 'ローソン', category: 'food' });
    const content = (calls[0].body.messages as { content: { type: string; source?: { media_type: string; data: string } }[] }[])[0].content;
    expect(content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } });
    expect(content[1].type).toBe('text');
    expect(calls[0].body).toMatchObject({ output_config: { effort: 'low' } });
  });

  it('取消請求 → AbortError', async () => {
    mockApi(() => ({ json: message('{}') }));
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(ai.recommendPlaces(mkTrip(day), '2026-11-21', '', ctrl.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
