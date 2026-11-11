import OpenAI from 'openai';
import { db, now } from '../db.js';
import { env, writeEnvKeyToDisk } from '../env.js';
import { newId, sha256 } from '../lib/ids.js';
import type { LlmConfigPublic, LlmProvider, ModelInfo, ShaderStyle } from '../types.js';

export interface LlmRuntimeConfig {
  provider: LlmProvider;
  openrouterKey: string;
  xaiKey: string;
  customBaseUrl: string;
  customApiKey: string;
  defaultModel: string;
  shaderStyle: ShaderStyle;
}

function maskKey(k: string): string {
  if (!k) return '';
  if (k.length <= 10) return '••••••••';
  return `${k.slice(0, 6)}••••${k.slice(-4)}`;
}

export function getLlmConfig(): LlmRuntimeConfig {
  const row = db.prepare('SELECT * FROM llm_settings WHERE id = 1').get() as any;
  const openrouterKey = (row?.openrouter_key || env.openrouterKey || '').trim();
  const xaiKey = (row?.xai_key || env.xaiKey || '').trim();
  const customBaseUrl = (row?.custom_base_url || env.customBaseUrl || '').trim();
  const customApiKey = (row?.custom_api_key || env.customApiKey || '').trim();

  let provider: LlmProvider = (row?.provider as LlmProvider) || env.llmProvider || 'openrouter';
  if (!row?.provider) {
    if (openrouterKey) provider = 'openrouter';
    else if (customBaseUrl) provider = 'custom';
    else if (xaiKey) provider = 'xai';
  }

  const defaultFallback =
    provider === 'xai'
      ? env.xaiModel || 'grok-4.7'
      : provider === 'custom'
        ? env.customModel || 'gpt-4o'
        : env.openrouterModel || 'anthropic/claude-3.7-sonnet';

  const defaultModel = (row?.default_model || defaultFallback).trim();
  const shaderStyle: ShaderStyle = (row?.shader_style as ShaderStyle) || 'aurora';

  return {
    provider,
    openrouterKey,
    xaiKey,
    customBaseUrl,
    customApiKey,
    defaultModel,
    shaderStyle,
  };
}

export function getPublicLlmConfig(): LlmConfigPublic {
  const cfg = getLlmConfig();
  const isConfigured =
    (cfg.provider === 'openrouter' && Boolean(cfg.openrouterKey)) ||
    (cfg.provider === 'custom' && Boolean(cfg.customBaseUrl)) ||
    (cfg.provider === 'xai' && Boolean(cfg.xaiKey));

  return {
    provider: cfg.provider,
    defaultModel: cfg.defaultModel,
    customBaseUrl: cfg.customBaseUrl,
    shaderStyle: cfg.shaderStyle,
    hasOpenrouterKey: Boolean(cfg.openrouterKey),
    openrouterKeyHint: maskKey(cfg.openrouterKey),
    hasCustomKey: Boolean(cfg.customApiKey),
    customKeyHint: maskKey(cfg.customApiKey),
    hasXaiKey: Boolean(cfg.xaiKey),
    xaiKeyHint: maskKey(cfg.xaiKey),
    hasComposioKey: Boolean(env.composioKey),
    composioKeyHint: maskKey(env.composioKey),
    hasOrgoKey: Boolean(env.orgoKey),
    orgoKeyHint: maskKey(env.orgoKey),
    isConfigured,
  };
}

export function saveLlmConfig(patch: {
  provider?: LlmProvider;
  openrouterKey?: string;
  xaiKey?: string;
  customBaseUrl?: string;
  customApiKey?: string;
  defaultModel?: string;
  shaderStyle?: ShaderStyle;
  composioKey?: string;
  orgoKey?: string;
}): LlmConfigPublic {
  if (patch.composioKey !== undefined && patch.composioKey.trim()) {
    writeEnvKeyToDisk('COMPOSIO_API_KEY', patch.composioKey.trim());
  }
  if (patch.orgoKey !== undefined && patch.orgoKey.trim()) {
    writeEnvKeyToDisk('ORGO_API_KEY', patch.orgoKey.trim());
  }
  const cur = db.prepare('SELECT * FROM llm_settings WHERE id = 1').get() as any;
  const nextProvider = patch.provider ?? cur?.provider ?? env.llmProvider ?? 'openrouter';
  const nextOrKey = patch.openrouterKey !== undefined ? patch.openrouterKey.trim() : (cur?.openrouter_key ?? '');
  const nextXaiKey = patch.xaiKey !== undefined ? patch.xaiKey.trim() : (cur?.xai_key ?? '');
  const nextCustomUrl = patch.customBaseUrl !== undefined ? patch.customBaseUrl.trim() : (cur?.custom_base_url ?? '');
  const nextCustomKey = patch.customApiKey !== undefined ? patch.customApiKey.trim() : (cur?.custom_api_key ?? '');
  const nextModel = patch.defaultModel !== undefined ? patch.defaultModel.trim() : (cur?.default_model ?? '');
  const nextShader = patch.shaderStyle ?? cur?.shader_style ?? 'aurora';

  db.prepare(`
    INSERT INTO llm_settings (id, provider, openrouter_key, xai_key, custom_base_url, custom_api_key, default_model, shader_style, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      provider = excluded.provider,
      openrouter_key = excluded.openrouter_key,
      xai_key = excluded.xai_key,
      custom_base_url = excluded.custom_base_url,
      custom_api_key = excluded.custom_api_key,
      default_model = excluded.default_model,
      shader_style = excluded.shader_style,
      updated_at = excluded.updated_at
  `).run(nextProvider, nextOrKey, nextXaiKey, nextCustomUrl, nextCustomKey, nextModel, nextShader, now());

  return getPublicLlmConfig();
}

export const CURATED_MODELS: ModelInfo[] = [
  {
    id: 'thinkingmachines/inkling-2-small:free',
    name: 'Inkling 2 Small (Free)',
    provider: 'Thinking Machines',
    contextLength: 131072,
    vision: false,
    tools: true,
    featured: true,
    badge: 'Free · Deep CoT Agent',
  },
  {
    id: 'deepseek/deepseek-chat-v3-0324:free',
    name: 'DeepSeek V3 0324 (Free)',
    provider: 'DeepSeek',
    contextLength: 163840,
    vision: false,
    tools: true,
    featured: true,
    badge: 'Free · Instant Fast',
  },
  {
    id: 'meta-llama/llama-4-maverick:free',
    name: 'Llama 4 Maverick (Free)',
    provider: 'Meta',
    contextLength: 256000,
    vision: true,
    tools: true,
    featured: true,
    badge: 'Free · Fast Multimodal',
  },
  {
    id: 'google/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'Google',
    contextLength: 1048576,
    vision: true,
    tools: true,
    featured: true,
    badge: 'Ultra Fast · 1M Context',
  },
  {
    id: 'anthropic/claude-3.7-sonnet',
    name: 'Claude 3.7 Sonnet',
    provider: 'Anthropic',
    contextLength: 200000,
    vision: true,
    tools: true,
    featured: true,
    badge: 'Recommended · Agentic',
  },
  {
    id: 'anthropic/claude-sonnet-4',
    name: 'Claude Sonnet 4',
    provider: 'Anthropic',
    contextLength: 200000,
    vision: true,
    tools: true,
    featured: true,
    badge: 'Flagship Coding',
  },
  {
    id: 'google/gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'Google',
    contextLength: 1048576,
    vision: true,
    tools: true,
    featured: true,
    badge: '1M Context · Deep Reasoning',
  },
  {
    id: 'google/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'Google',
    contextLength: 1048576,
    vision: true,
    tools: true,
    featured: true,
    badge: 'Ultra Fast · Multimodal',
  },
  {
    id: 'openai/gpt-4.1',
    name: 'GPT-4.1',
    provider: 'OpenAI',
    contextLength: 1047576,
    vision: true,
    tools: true,
    featured: true,
    badge: '1M Context · Tool Mastery',
  },
  {
    id: 'openai/gpt-4.1-mini',
    name: 'GPT-4.1 Mini',
    provider: 'OpenAI',
    contextLength: 1047576,
    vision: true,
    tools: true,
    featured: true,
    badge: 'Fast & Low Cost',
  },
  {
    id: 'openai/o4-mini',
    name: 'OpenAI o4-mini',
    provider: 'OpenAI',
    contextLength: 200000,
    vision: true,
    tools: true,
    featured: true,
    badge: 'Reasoning',
  },
  {
    id: 'x-ai/grok-3-beta',
    name: 'Grok 3',
    provider: 'xAI (OpenRouter)',
    contextLength: 131072,
    vision: true,
    tools: true,
    featured: true,
    badge: 'xAI Flagship',
  },
  {
    id: 'deepseek/deepseek-chat-v3-0324',
    name: 'DeepSeek V3 (0324)',
    provider: 'DeepSeek',
    contextLength: 163840,
    vision: false,
    tools: true,
    featured: true,
    badge: 'Open Weights Value',
  },
  {
    id: 'deepseek/deepseek-r1',
    name: 'DeepSeek R1',
    provider: 'DeepSeek',
    contextLength: 163840,
    vision: false,
    tools: true,
    featured: true,
    badge: 'Open Reasoning',
  },
  {
    id: 'meta-llama/llama-4-maverick',
    name: 'Llama 4 Maverick',
    provider: 'Meta',
    contextLength: 1048576,
    vision: true,
    tools: true,
    featured: true,
    badge: 'MoE Multimodal',
  },
  {
    id: 'qwen/qwen3-235b-a22b',
    name: 'Qwen 3 235B A22B',
    provider: 'Qwen',
    contextLength: 131072,
    vision: false,
    tools: true,
    featured: true,
    badge: 'Hybrid Thinking',
  },
];

let cachedRemoteModels: { at: number; models: ModelInfo[] } | null = null;

export async function fetchModelsCatalog(): Promise<{ curated: ModelInfo[]; remote: ModelInfo[] }> {
  if (cachedRemoteModels && Date.now() - cachedRemoteModels.at < 10 * 60_000) {
    return { curated: CURATED_MODELS, remote: cachedRemoteModels.models };
  }
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { data?: any[] };
    const list: ModelInfo[] = (data.data ?? []).slice(0, 250).map((m: any) => {
      const id = String(m.id ?? '');
      const prov = id.includes('/') ? id.split('/')[0] : 'OpenRouter';
      return {
        id,
        name: String(m.name ?? id),
        provider: prov.charAt(0).toUpperCase() + prov.slice(1),
        contextLength: Number(m.context_length ?? 128000),
        pricing: m.pricing ? { prompt: String(m.pricing.prompt ?? '0'), completion: String(m.pricing.completion ?? '0') } : undefined,
        vision: Boolean(m.architecture?.modality?.includes('image')),
        tools: true,
      };
    });
    cachedRemoteModels = { at: Date.now(), models: list };
    return { curated: CURATED_MODELS, remote: list };
  } catch {
    return { curated: CURATED_MODELS, remote: [] };
  }
}

function getClient(cfg: LlmRuntimeConfig): { client: OpenAI; baseURL: string; apiKey: string } {
  if (cfg.provider === 'xai') {
    const apiKey = cfg.xaiKey;
    const baseURL = 'https://api.x.ai/v1';
    return {
      client: new OpenAI({ apiKey: apiKey || 'unconfigured', baseURL, timeout: 360_000 }),
      baseURL,
      apiKey,
    };
  }
  if (cfg.provider === 'custom') {
    const baseURL = cfg.customBaseUrl || 'http://localhost:11434/v1';
    const apiKey = cfg.customApiKey || 'custom-local-key';
    return {
      client: new OpenAI({ apiKey, baseURL, timeout: 360_000 }),
      baseURL,
      apiKey: cfg.customBaseUrl ? apiKey : '',
    };
  }
  // Default: OpenRouter (uses recognized agentic harness headers so agent-only models like thinkingmachines/inkling-2-small:free are unlocked)
  const baseURL = 'https://openrouter.ai/api/v1';
  const apiKey = cfg.openrouterKey;
  return {
    client: new OpenAI({
      apiKey: apiKey || 'unconfigured',
      baseURL,
      timeout: 360_000,
      defaultHeaders: {
        'HTTP-Referer': 'https://cline.bot',
        'X-Title': 'Cline',
      },
    }),
    baseURL,
    apiKey,
  };
}

function normalizeModelId(m: string): string {
  const clean = m.trim();
  if (clean === 'thinkingmachines/inkling-small' || clean === 'thinkingmachines/inkling-2-small') {
    return 'thinkingmachines/inkling-2-small:free';
  }
  return clean;
}

/** Resolve the effective model ID for a bot given the current runtime config. */
export function resolveBotModel(botRow: any, cfg = getLlmConfig()): string {
  const override = normalizeModelId(String(botRow?.model ?? ''));
  if (override) return override;
  return normalizeModelId(cfg.defaultModel);
}

/** Convert stored Responses-API `llm_items` into standard OpenAI Chat Completions `messages`. */
export function itemsToChatMessages(system: string, items: any[]): any[] {
  const messages: any[] = [{ role: 'system', content: system }];

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it) continue;

    if (it.type === 'reasoning' || it.type === 'compaction' || it.type === 'web_search_call' || it.type === 'x_search_call') {
      continue;
    }

    if (it.type === 'function_call') {
      // Group consecutive function_call items into one assistant message with tool_calls
      const toolCalls: any[] = [];
      let j = i;
      while (j < items.length && items[j]?.type === 'function_call') {
        const fc = items[j];
        toolCalls.push({
          id: fc.call_id || `call_${j}`,
          type: 'function',
          function: {
            name: fc.name,
            arguments: typeof fc.arguments === 'string' ? fc.arguments : JSON.stringify(fc.arguments ?? {}),
          },
        });
        j++;
      }
      i = j - 1;
      // If the previous message in `messages` is an assistant text message without tool_calls, attach to it
      const prev = messages[messages.length - 1];
      if (prev && prev.role === 'assistant' && !prev.tool_calls) {
        prev.tool_calls = toolCalls;
      } else {
        messages.push({ role: 'assistant', content: '', tool_calls: toolCalls });
      }
      continue;
    }

    if (it.type === 'function_call_output') {
      let textOut = '';
      const images: string[] = [];
      if (typeof it.output === 'string') {
        textOut = it.output;
      } else if (Array.isArray(it.output)) {
        const parts: string[] = [];
        for (const p of it.output) {
          if (p?.type === 'input_text' && p.text) parts.push(p.text);
          else if (p?.type === 'input_image' && p.image_url) images.push(p.image_url);
        }
        textOut = parts.join('\n') || 'Done.';
      } else {
        textOut = JSON.stringify(it.output ?? '');
      }

      messages.push({
        role: 'tool',
        tool_call_id: it.call_id,
        content: textOut,
      });

      // If this tool output included a screenshot image, attach it in a user content message right after all consecutive tool outputs
      if (images.length > 0) {
        // Peek ahead: if next item is also function_call_output, wait or queue; usually screenshot tools run one at a time
        const nextIsToolOut = items[i + 1]?.type === 'function_call_output';
        if (!nextIsToolOut) {
          messages.push({
            role: 'user',
            content: [
              { type: 'text', text: `[Screenshot from tool ${it.call_id}]` },
              ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
            ],
          });
        }
      }
      continue;
    }

    if (it.role === 'user') {
      if (typeof it.content === 'string') {
        messages.push({ role: 'user', content: it.content });
      } else if (Array.isArray(it.content)) {
        const parts = it.content.map((c: any) => {
          if (c?.type === 'input_image') return { type: 'image_url', image_url: { url: c.image_url } };
          return { type: 'text', text: String(c?.text ?? '') };
        });
        messages.push({ role: 'user', content: parts });
      }
      continue;
    }

    if (it.type === 'message' || it.role === 'assistant') {
      let text = '';
      if (typeof it.content === 'string') text = it.content;
      else if (Array.isArray(it.content)) {
        text = it.content.map((c: any) => c?.text ?? '').join('');
      }
      if (text) {
        messages.push({ role: 'assistant', content: text });
      }
    }
  }

  return messages;
}

/** Convert flat Responses-API function schemas into OpenAI Chat Completions `tools` array. */
export function toChatCompletionTools(tools: any[]): any[] {
  const out: any[] = [];
  for (const t of tools) {
    if (!t) continue;
    // Skip xAI-proprietary server tool markers since we have our own `web_search` function tool in TOOLS
    if (t.type === 'web_search' || t.type === 'x_search') continue;
    if (t.type === 'function' && t.function) {
      out.push(t);
    } else if (t.type === 'function' && t.name) {
      out.push({
        type: 'function',
        function: {
          name: t.name,
          description: t.description ?? '',
          parameters: t.parameters ?? { type: 'object', properties: {} },
        },
      });
    }
  }
  return out;
}

export interface StreamTurnCallbacks {
  onTextDelta: (delta: string) => void;
  onReasoningDelta?: (delta: string) => void;
  onActivity?: (kind: 'searching_web' | 'working', detail?: string) => void;
  onMessageDone?: (citations?: { url: string; title?: string }[]) => void;
}

/**
 * Unified streaming model turn that supports:
 *  - OpenRouter (`/v1/chat/completions`)
 *  - Custom OpenAI-compatible endpoints (`/v1/chat/completions`)
 *  - xAI Responses API (`/v1/responses`)
 */
export async function streamModelTurn(opts: {
  userId: string;
  bot: any;
  system: string;
  history: any[];
  tools: any[];
  signal: AbortSignal;
  callbacks: StreamTurnCallbacks;
}): Promise<{ output: any[]; inputTokens?: number; isLocalFallback?: boolean; localReply?: string }> {
  const cfg = getLlmConfig();
  const model = resolveBotModel(opts.bot, cfg);
  const { client, apiKey } = getClient(cfg);

  if (!apiKey) {
    const lastUser = [...opts.history].reverse().find((m: any) => m?.role === 'user');
    const userText = typeof lastUser?.content === 'string' ? lastUser.content : '';
    const providerLabel = cfg.provider === 'openrouter' ? 'OpenRouter' : cfg.provider === 'custom' ? 'Custom BYOM Endpoint' : 'xAI';
    const reply =
      `I'm **${opts.bot.name}**${opts.bot.label ? ` (${opts.bot.label})` : ''}, ready on **TideOS**.\n\n` +
      (userText ? `> ${userText.slice(0, 240).replace(/\n/g, '\n> ')}\n\n` : '') +
      `No API key is configured for **${providerLabel}** (\`${model}\`) yet. Click the **Model / BYOM pill** in the top bar or open **Settings → Models & OpenRouter** to paste your \`OPENROUTER_API_KEY\` (or custom endpoint) and start streaming live responses immediately—no server restart required.`;
    return {
      isLocalFallback: true,
      localReply: reply,
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: reply }] }],
    };
  }

  // Path A: Native xAI Responses API when provider === 'xai'
  if (cfg.provider === 'xai') {
    const input = [{ role: 'system', content: opts.system }, ...opts.history];
    const xaiTools = opts.tools.filter((t) => !(t.type === 'function' && t.name === 'web_search'));
    const body: any = {
      model,
      input,
      tools: xaiTools,
      reasoning: { effort: opts.bot.effort ?? 'medium' },
      store: false,
      include: ['reasoning.encrypted_content'],
      prompt_cache_key: `tideos:${opts.bot.id}:${opts.bot.generation}`,
      safety_identifier: sha256(opts.userId).slice(0, 32),
      stream: true,
    };
    const stream: any = await client.responses.create(body, { signal: opts.signal });
    let final: any = null;
    for await (const ev of stream as AsyncIterable<any>) {
      switch (ev.type) {
        case 'response.output_text.delta':
          opts.callbacks.onTextDelta(ev.delta);
          break;
        case 'response.output_item.added':
          if (ev.item?.type === 'web_search_call') opts.callbacks.onActivity?.('searching_web');
          if (ev.item?.type === 'x_search_call') opts.callbacks.onActivity?.('searching_web', 'X');
          if (ev.item?.type === 'message') opts.callbacks.onActivity?.('working');
          break;
        case 'response.output_item.done':
          if (ev.item?.type === 'message') {
            const citations = (ev.item.content ?? []).flatMap((c: any) =>
              (c.annotations ?? []).filter((a: any) => a.url).map((a: any) => ({ url: a.url, title: a.title })),
            );
            opts.callbacks.onMessageDone?.(citations.length ? citations : undefined);
          }
          break;
        case 'response.completed':
        case 'response.incomplete':
          final = ev.response;
          break;
        case 'response.failed':
        case 'error':
          throw new Error(ev.response?.error?.message ?? ev.message ?? 'model error');
      }
    }
    if (!final) throw new Error('model stream ended without a response');
    return { output: final.output ?? [], inputTokens: final.usage?.input_tokens };
  }

  // Path B: OpenRouter & Custom OpenAI-Compatible Chat Completions API
  const messages = itemsToChatMessages(opts.system, opts.history);
  const chatTools = toChatCompletionTools(opts.tools);

  const effort = opts.bot.effort === 'xhigh' ? 'high' : opts.bot.effort === 'low' ? 'minimal' : (opts.bot.effort ?? 'low');
  const reqBody: any = {
    model,
    messages,
    stream: true,
    reasoning: { effort },
  };
  if (chatTools.length) {
    reqBody.tools = chatTools;
  }

  let stream: AsyncIterable<any>;
  try {
    stream = (await client.chat.completions.create(reqBody, { signal: opts.signal })) as unknown as AsyncIterable<any>;
  } catch (e: any) {
    // Fallback if model doesn't support tool calling or rejected a Composio tool schema
    if ((e?.status === 400 || e?.status === 404) && reqBody.tools?.length) {
      console.warn('[llm] retrying chat.completions without external tools:', e?.message);
      delete reqBody.tools;
      delete reqBody.reasoning;
      stream = (await client.chat.completions.create(reqBody, { signal: opts.signal })) as unknown as AsyncIterable<any>;
    } else {
      throw e;
    }
  }

  let fullText = '';
  let fullReasoning = '';
  const toolCallsByIndex = new Map<number, { id: string; name: string; arguments: string }>();
  let inputTokens: number | undefined;

  for await (const chunk of stream) {
    if (chunk?.usage?.prompt_tokens) {
      inputTokens = chunk.usage.prompt_tokens;
    }
    const delta = chunk?.choices?.[0]?.delta;
    if (!delta) continue;

    const rDelta = delta.reasoning ?? delta.reasoning_content;
    if (typeof rDelta === 'string' && rDelta.length > 0) {
      fullReasoning += rDelta;
      opts.callbacks.onReasoningDelta?.(rDelta);
    }

    if (typeof delta.content === 'string' && delta.content.length > 0) {
      fullText += delta.content;
      opts.callbacks.onTextDelta(delta.content);
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        const existing = toolCallsByIndex.get(idx) ?? {
          id: tc.id || newId('call'),
          name: '',
          arguments: '',
        };
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.name += tc.function.name;
        if (tc.function?.arguments) existing.arguments += tc.function.arguments;
        toolCallsByIndex.set(idx, existing);
      }
    }
  }

  const output: any[] = [];
  if (!fullText.trim() && !toolCallsByIndex.size && fullReasoning.trim()) {
    fullText = fullReasoning.trim();
    opts.callbacks.onTextDelta(fullText);
  }
  if (fullText.trim().length > 0) {
    opts.callbacks.onMessageDone?.();
    output.push({
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: fullText }],
    });
  }

  for (const [, tc] of [...toolCallsByIndex.entries()].sort((a, b) => a[0] - b[0])) {
    if (!tc.name) continue;
    output.push({
      type: 'function_call',
      call_id: tc.id || newId('call'),
      name: tc.name,
      arguments: tc.arguments || '{}',
    });
  }

  return { output, inputTokens };
}

/** Non-streaming helper for memory consolidation, history summarization, and connection testing. */
export async function completeText(opts: {
  system: string;
  user: string;
  jsonMode?: boolean;
  maxTokens?: number;
}): Promise<string> {
  const cfg = getLlmConfig();
  const { client, apiKey } = getClient(cfg);
  if (!apiKey) throw new Error('No LLM API key configured');

  if (cfg.provider === 'xai') {
    const res: any = await client.responses.create({
      model: cfg.defaultModel,
      input: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
      store: false,
    } as any);
    return String(res.output_text ?? '').trim();
  }

  const res: any = await client.chat.completions.create({
    model: cfg.defaultModel,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens, reasoning: { effort: 'low' } } : {}),
    ...(opts.jsonMode ? { response_format: { type: 'json_object' } } : {}),
  } as any);
  const msg = res.choices?.[0]?.message;
  const content = String(msg?.content ?? '').trim();
  if (content) return content;
  const reasoning = String(msg?.reasoning ?? msg?.reasoning_content ?? '').trim();
  return reasoning ? reasoning.slice(-200) : 'Online and ready.';
}

export async function testLlmConnection(): Promise<{ ok: boolean; model: string; provider: string; latencyMs: number; reply?: string; error?: string }> {
  const cfg = getLlmConfig();
  const t0 = Date.now();
  try {
    const reply = await completeText({
      system: 'Reply with a short confirmation (under 12 words) stating you are online.',
      user: 'Ping from TideOS.',
      maxTokens: 256,
    });
    return {
      ok: true,
      model: cfg.defaultModel,
      provider: cfg.provider,
      latencyMs: Date.now() - t0,
      reply,
    };
  } catch (e: any) {
    return {
      ok: false,
      model: cfg.defaultModel,
      provider: cfg.provider,
      latencyMs: Date.now() - t0,
      error: String(e?.message ?? e),
    };
  }
}
