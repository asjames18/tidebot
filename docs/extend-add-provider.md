# Tutorial: add a model provider

> **Last verified:** 2026-11-26 · **Owner:** asjames18 (maintainer)

Add a model provider an Operator can stream from. You will add `groq` — a fast
OpenAI-compatible inference service — and finish with passing tests and a live
try in the studio. No keys committed, no network calls in the tests.

This is tutorial 3 of 4 in the Phase 4 extension series: built-in tool, API
endpoint, model provider, WebGL shader preset.

## Before you start: do you need a new provider?

Groq already works today through the **Custom Endpoint** card (paste
`https://api.groq.com/openai/v1` as the base URL). Add a first-class provider
when the service deserves its own card, its own key field, and its own default
model — so users pick it in one click instead of pasting a URL. If the service
is a one-off for a single user, Custom Endpoint is the right answer and this
tutorial is not needed.

## How providers work

Three modes exist today (`server/src/agent/llm.ts`, `LlmProvider` in
`server/src/types.ts`): `openrouter`, `custom`, and `xai`. The shape of a new
provider depends on which API it speaks:

- **Chat Completions (`/v1/chat/completions`)** — the generic path. `getClient()`
  returns an OpenAI client pointed at the provider's base URL, and
  `streamModelTurn()` Path B handles streaming, tool calls, and the
  tool-rejected retry (a 400/404, or the `Cannot use tools with stream` 500,
  retries once without tools and without the `reasoning` field). Most new
  providers are this shape: a `getClient()` branch plus config plumbing, and
  nothing else. Groq is the worked example below.
- **Responses API (`/v1/responses`)** — the xAI shape. `streamModelTurn()` Path A
  and `requestText()` each have a dedicated branch. If your provider only
  speaks a Responses-style API, copy the `xai` branches in both functions and
  adapt the request body; the rest of this tutorial (type, env, storage,
  config, UI, test) is identical.

Config lives in one SQLite row (`llm_settings`, `id = 1`) with `.env` fallback:
`getLlmConfig()` reads the row, decrypts the stored keys, and falls back to
`env.*`. Keys are stored encrypted (`encryptSecret`) and only masked hints
(`maskKey`: first 6 + `••••` + last 4) ever leave the server.

## Step 1 — Type and env

In `server/src/types.ts`, add the provider to the union and its key fields to
the public config (the studio reads these to render the "Active: …" chip):

```ts
export type LlmProvider = 'openrouter' | 'custom' | 'xai' | 'groq';
```

```ts
  hasXaiKey: boolean;
  xaiKeyHint: string;
  hasGroqKey: boolean;
  groqKeyHint: string;
```

In `server/src/env.ts`, add the key/model accessors, extend the
`llmProvider` fallback chain (appended last so existing precedence is
unchanged), and the `providers` flag used by the health check:

```ts
  get llmProvider(): 'openrouter' | 'custom' | 'xai' | 'groq' {
    const orKey = opt('OPENROUTER_API_KEY');
    const cUrl = opt('LLM_BASE_URL');
    const xKey = opt('XAI_API_KEY');
    const gKey = opt('GROQ_API_KEY');
    return opt('LLM_PROVIDER', orKey ? 'openrouter' : cUrl ? 'custom' : xKey ? 'xai' : gKey ? 'groq' : 'openrouter') as 'openrouter' | 'custom' | 'xai' | 'groq';
  },
```

```ts
  get xaiKey() { return opt('XAI_API_KEY'); },
  get xaiModel() { return opt('XAI_MODEL', 'grok-4.7'); },
  get groqKey() { return opt('GROQ_API_KEY'); },
  get groqModel() { return opt('GROQ_MODEL', 'llama-3.3-70b-versatile'); },
```

```ts
      openrouter: Boolean(opt('OPENROUTER_API_KEY')),
      custom: Boolean(opt('LLM_BASE_URL')),
      xai: Boolean(opt('XAI_API_KEY')),
      groq: Boolean(opt('GROQ_API_KEY')),
```

Document the new variables in `.env.example`, after the xAI lines:

```
GROQ_API_KEY=
GROQ_MODEL=llama-3.3-70b-versatile
```

## Step 2 — Storage

In `server/src/db.ts`, add the column to the `llm_settings` table and to the
idempotent migration list. The migration call must come **after** the
`CREATE TABLE` block — `addColumn()` runs `PRAGMA table_info` immediately, so
placing it with the other `addColumn()` calls higher in the file fails on a
fresh database with `no such table: llm_settings`:

```ts
  xai_key TEXT NOT NULL DEFAULT '',
  groq_key TEXT NOT NULL DEFAULT '',
  custom_base_url TEXT NOT NULL DEFAULT '',
```

```ts
// The CREATE TABLE above already has groq_key; this keeps pre-existing
// databases (created before the column existed) working.
addColumn('llm_settings', 'groq_key', "TEXT NOT NULL DEFAULT ''");
```

## Step 3 — Config and client

All of this is in `server/src/agent/llm.ts`.

Add the key to `LlmRuntimeConfig`, and to the personal-model early return
(which is OpenRouter-only, so the new key is empty there):

```ts
export interface LlmRuntimeConfig {
  provider: LlmProvider;
  openrouterKey: string;
  xaiKey: string;
  groqKey: string;
  customBaseUrl: string;
```

```ts
  if (personal) return {
    provider: 'openrouter', openrouterKey: personal.key, xaiKey: '', groqKey: '',
    customBaseUrl: '', customApiKey: '', defaultModel: personal.model, shaderStyle,
  };
```

In `getLlmConfig()`, read the key (stored row first, `.env` second — same as
the other providers), add the key to the no-row auto-detect chain, give the
provider its default model, and return the key:

```ts
  const groqKey = decryptSecret(secretsDir(), (row?.groq_key || '').trim()) || (env.groqKey || '').trim();
```

```ts
  if (!row?.provider) {
    if (openrouterKey) provider = 'openrouter';
    else if (customBaseUrl) provider = 'custom';
    else if (xaiKey) provider = 'xai';
    else if (groqKey) provider = 'groq';
  }
```

```ts
  const defaultFallback =
    provider === 'xai'
      ? env.xaiModel || 'grok-4.7'
      : provider === 'groq'
        ? env.groqModel || 'llama-3.3-70b-versatile'
        : provider === 'custom'
          ? env.customModel || 'gpt-4o'
          : env.openrouterModel;
```

```ts
  return {
    provider,
    openrouterKey,
    xaiKey,
    groqKey,
    customBaseUrl,
    customApiKey,
    defaultModel: provider === 'openrouter' ? normalizeOpenRouterModel(defaultModel) : defaultModel,
    shaderStyle,
  };
```

In `getPublicLlmConfig()`, add the provider to `isConfigured` and expose the
masked hint:

```ts
  const isConfigured =
    (cfg.provider === 'openrouter' && Boolean(cfg.openrouterKey)) ||
    (cfg.provider === 'custom' && Boolean(cfg.customBaseUrl)) ||
    (cfg.provider === 'xai' && Boolean(cfg.xaiKey)) ||
    (cfg.provider === 'groq' && Boolean(cfg.groqKey));
```

```ts
    hasXaiKey: Boolean(cfg.xaiKey),
    xaiKeyHint: showKeyHints ? maskKey(cfg.xaiKey) : '',
    hasGroqKey: Boolean(cfg.groqKey),
    groqKeyHint: showKeyHints ? maskKey(cfg.groqKey) : '',
```

In `saveLlmConfig()`, accept the key in the patch, persist it encrypted, and
include the column in the upsert (column list, value list, and `ON CONFLICT`
list must all stay in the same order):

```ts
export function saveLlmConfig(patch: {
  provider?: LlmProvider;
  openrouterKey?: string;
  xaiKey?: string;
  groqKey?: string;
  customBaseUrl?: string;
```

```ts
  const nextGroqKey = patch.groqKey !== undefined ? patch.groqKey.trim() : (cur?.groq_key ?? '');
```

```ts
  db.prepare(`
    INSERT INTO llm_settings (id, provider, openrouter_key, xai_key, groq_key, custom_base_url, custom_api_key, default_model, shader_style, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      provider = excluded.provider,
      openrouter_key = excluded.openrouter_key,
      xai_key = excluded.xai_key,
      groq_key = excluded.groq_key,
      custom_base_url = excluded.custom_base_url,
      custom_api_key = excluded.custom_api_key,
      default_model = excluded.default_model,
      shader_style = excluded.shader_style,
      updated_at = excluded.updated_at
  `).run(nextProvider, encryptSecret(secretsDir(), nextOrKey), encryptSecret(secretsDir(), nextXaiKey), encryptSecret(secretsDir(), nextGroqKey), nextCustomUrl, encryptSecret(secretsDir(), nextCustomKey), nextModel, nextShader, now());
```

The client branch is the whole provider. Export `getClient()` so tests can pin
the base URL without a network call, then add the branch before the `xai`
branch (the default at the bottom stays OpenRouter):

```ts
export function getClient(cfg: LlmRuntimeConfig, connectionCheck = false): { client: OpenAI; baseURL: string; apiKey: string } {
  const options = connectionCheck ? { timeout: 15_000, maxRetries: 0 } : { timeout: 360_000 };
  if (cfg.provider === 'groq') {
    const apiKey = cfg.groqKey;
    const baseURL = 'https://api.groq.com/openai/v1';
    return {
      client: new OpenAI({ apiKey: apiKey || 'unconfigured', baseURL, ...options }),
      baseURL,
      apiKey,
    };
  }
```

No change is needed in `streamModelTurn()` or `requestText()`: both take the
Chat Completions path for any provider that is not `xai`. Only fix the
no-key fallback label so it names the provider:

```ts
    const providerLabel = cfg.provider === 'openrouter' ? 'OpenRouter' : cfg.provider === 'custom' ? 'Custom BYOM Endpoint' : cfg.provider === 'groq' ? 'Groq' : 'xAI';
```

## Step 4 — Save route and typed client

In `server/src/routes-config.ts`, pass the key through the existing save
handler (no new route — `PUT /llm/config` already accepts the patch):

```ts
    updated = saveLlmConfig({
    provider: body.provider,
    openrouterKey: body.openrouterKey,
    xaiKey: body.xaiKey,
    groqKey: body.groqKey,
    customBaseUrl: body.customBaseUrl,
```

In `web/src/lib/configApi.ts`, add the key to the `saveLlmConfig` payload
type so the studio can send it:

```ts
  saveLlmConfig: (p: Partial<{ provider: LlmProvider; openrouterKey: string; xaiKey: string; groqKey: string; customBaseUrl: string; customApiKey: string; defaultModel: string; shaderStyle: ShaderStyle; composioKey: string; orgoKey: string }>) =>
```

## Step 5 — Studio card

All of this is in `web/src/components/config/AppSettings.tsx`. Add state next
to the other key inputs:

```tsx
  const [xaiKey, setXaiKey] = useState('');
  const [groqKey, setGroqKey] = useState('');
```

Add a provider card after the xAI card. It mirrors the xAI card; the only
behavior is picking the provider and, when the current model looks like an
OpenRouter-style `vendor/model` id, switching the default to a Groq model:

```tsx
          <button
            type="button"
            className={`byom-provider-card${provider === 'groq' ? ' is-active' : ''}`}
            aria-pressed={provider === 'groq'}
            onClick={() => {
              if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                try { navigator.vibrate(8); } catch {}
              }
              blurMobileKeyboard();
              setProvider('groq');
              setStatusMsg(null);
              if (defaultModel.includes('/')) setDefaultModel('llama-3.3-70b-versatile');
            }}
          >
            <div className="byom-provider-card__top">
              <span className="byom-provider-card__title">Groq</span>
              <span className="tideos-pill">Chat Completions</span>
            </div>
            <div className="byom-provider-card__sub">
              Fast OpenAI-compatible inference at api.groq.com — no base URL to paste.
            </div>
          </button>
```

Add the key field after the xAI field, mirroring it (masked "Active: …" chip
included — the field is `type="password"` and the saved key is never rendered
back into the input):

```tsx
          {provider === 'groq' && (
            <div className="cfg-field">
              <label className="cfg-field__label">
                Groq API Key
                {llmConfig?.hasGroqKey && (
                  <span className="cfg-chip" style={{ marginLeft: 8 }}>Active: {llmConfig.groqKeyHint}</span>
                )}
              </label>
              <input
                type="password"
                className="cfg-input"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="off"
                enterKeyHint="next"
                placeholder={llmConfig?.hasGroqKey ? 'Paste new Groq key to replace saved key' : 'gsk_...'}
                value={groqKey}
                onChange={(e) => { setGroqKey(e.target.value); if (statusMsg) setStatusMsg(null); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    defaultModelRef.current?.focus();
                  }
                }}
              />
              <div className="cfg-field__hint">
                Get an API key at <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">console.groq.com/keys</a>. Stored locally in your TideBot SQLite database (or set <code className="cfg-code">GROQ_API_KEY</code> in <code className="cfg-code">.env</code>).
              </div>
            </div>
          )}
```

Wire the key into `save()` (send only when non-empty, clear the input after a
successful save, like the other keys) and into the `testConn()` dirty check so
Test Connection saves a freshly pasted key first:

```tsx
      if (openrouterKey.trim()) payload.openrouterKey = openrouterKey.trim();
      if (customApiKey.trim()) payload.customApiKey = customApiKey.trim();
      if (xaiKey.trim()) payload.xaiKey = xaiKey.trim();
      if (groqKey.trim()) payload.groqKey = groqKey.trim();
```

```tsx
      setOpenrouterKey('');
      setCustomApiKey('');
      setXaiKey('');
      setGroqKey('');
```

```tsx
      if (openrouterKey.trim() || customApiKey.trim() || xaiKey.trim() || groqKey.trim() || defaultModel !== llmConfig?.defaultModel || provider !== llmConfig?.provider || customBaseUrl.trim() !== (llmConfig?.customBaseUrl ?? '')) {
```

## Step 6 — Test

Create `tests/groq-provider.test.mjs`. It sets a throwaway `DB_PATH` before
importing the built server code, so it never touches live data, and it never
touches the network — `getClient()` only constructs the SDK client. The keys
in the test are fake (`gsk_test…`, `gsk_saved…`), never real credentials:

```js
// After `npm run build -w server`: node --test tests/groq-provider.test.mjs
// Pins the Groq provider added in docs/extend-add-provider.md: config resolution,
// the client branch (base URL + key, no network call), and save round-trip.
// Isolated from live data via DB_PATH; never touches the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const fixtures = await mkdtemp(path.join(tmpdir(), 'tidebot-groq-'));
process.env.DB_PATH = path.join(fixtures, 'test.db');
process.env.GROQ_API_KEY = 'gsk_testkey1234567890abcdef';
process.env.GROQ_MODEL = 'llama-3.3-70b-versatile';
test.after(() => rm(fixtures, { recursive: true, force: true }));

const { getLlmConfig, getPublicLlmConfig, getClient, saveLlmConfig } =
  await import('../server/dist/agent/llm.js');

test('getLlmConfig resolves the groq provider from env', () => {
  const cfg = getLlmConfig();
  assert.equal(cfg.provider, 'groq');
  assert.equal(cfg.groqKey, 'gsk_testkey1234567890abcdef');
  assert.equal(cfg.defaultModel, 'llama-3.3-70b-versatile');
});

test('getClient points groq at api.groq.com with the key', () => {
  const cfg = getLlmConfig();
  const { baseURL, apiKey } = getClient(cfg);
  assert.equal(baseURL, 'https://api.groq.com/openai/v1');
  assert.equal(apiKey, 'gsk_testkey1234567890abcdef');
});

test('getPublicLlmConfig reports groq configured with a masked hint', () => {
  const pub = getPublicLlmConfig();
  assert.equal(pub.provider, 'groq');
  assert.equal(pub.isConfigured, true);
  assert.equal(pub.hasGroqKey, true);
  assert.equal(pub.groqKeyHint, 'gsk_te••••cdef');
});

test('saveLlmConfig round-trips provider + groq key', () => {
  const updated = saveLlmConfig({ provider: 'groq', groqKey: 'gsk_savedkey0000000000000000', defaultModel: 'llama-3.1-8b-instant' });
  assert.equal(updated.provider, 'groq');
  assert.equal(updated.hasGroqKey, true);
  assert.equal(updated.defaultModel, 'llama-3.1-8b-instant');
  const cfg = getLlmConfig();
  assert.equal(cfg.provider, 'groq');
  assert.equal(cfg.groqKey, 'gsk_savedkey0000000000000000');
});
```

Append `tests/groq-provider.test.mjs` to `tests/node-tests.txt`
(one file per line), then run the gate:

```bash
npm run typecheck && npm run build && npm test
```

## Step 7 — Try it live

1. Start the server and studio (`npm run dev -w server`, `npm run dev -w web`).
2. Open Settings → Models & OpenRouter and pick the **Groq** card.
3. Paste a real Groq key (`gsk_…` from console.groq.com/keys) and save.
4. **Test Connection** — you should get a reply naming the Groq model and its
   latency. Then send a chat message and confirm it streams.

This step needs a real key and was not run in the sandbox (no key there); the
test in Step 6 pins everything that can be pinned without a network call.

## Checklist before your PR

- `npm run typecheck && npm run build && npm test` green (the two known
  failures on main — root-user env persistence and the sandbox git wrapper —
  are pre-existing; your new tests must pass).
- No key material in the PR: test keys are fake, `.env.example` carries names
  only, and `checkConnection()` redacts keys from error messages before they
  are returned.
- If the provider speaks a Responses-style API instead of Chat Completions,
  say so in the PR and show the `streamModelTurn()` / `requestText()` branches
  — that is a bigger change than this tutorial covers.
- Update `AGENTS.md` §4 with the new provider's touch points if you added any
  beyond this tutorial's list.
