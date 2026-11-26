# Model cookbook

Tested model configurations by job: which model to pick in TideBot for
coding, research, reasoning, a free-tier start, or a fully local setup —
with the exact model IDs to paste in.

Last verified: 2026-11-26 against `main`. Every OpenRouter model ID and
context length below is copied from the shipped curated list in
`server/src/agent/llm.ts` (`CURATED_MODELS`); the xAI default and the
local-model entries come from `.env.example` and `docs/local-model.md`.
Nothing here was live-benchmarked — these are the configurations the
code ships and supports, not speed or quality rankings. If a model ID
stops working, the live catalog in Settings → Models (fetched from
OpenRouter) is the source of truth; availability, rate limits, and
retirement of any OpenRouter model are the provider's call.

Owner: maintainers — update this file when `CURATED_MODELS` changes.

## How to switch models

- **In the UI (recommended):** Settings → Models. Pick a provider
  (`openrouter`, `custom`, or `xai`), paste the key, set the default
  model, and press the test-connection button — it saves the pending
  inputs first, then reports the model, latency, and a short reply
  (`POST /api/llm/test`).
- **Per Operator:** an Operator can set its own model, which wins over
  the default (`resolveBotModel` in `server/src/agent/llm.ts`). Use this
  to give a coding Operator a flagship model while a triage Operator
  runs a free one.
- **In `.env`:** `LLM_PROVIDER=openrouter|custom|xai`,
  `OPENROUTER_API_KEY` (`sk-or-v1-…`), `OPENROUTER_MODEL`
  (default `openrouter/free`), `LLM_BASE_URL` + `LLM_MODEL` for a
  custom endpoint, `XAI_API_KEY` + `XAI_MODEL` (default `grok-4.7`).
  If `LLM_PROVIDER` is unset, TideBot picks from what is configured:
  an OpenRouter key means OpenRouter, a custom base URL means custom,
  an xAI key means xAI. Keys saved in the UI hot-reload without a
  restart, and Settings values take precedence over `.env`.

## Free-tier starter

Start here if you have no paid key. These cost nothing on OpenRouter;
you still need a free OpenRouter account and key.

| Model ID | Context | Vision | Notes |
| --- | --- | --- | --- |
| `openrouter/free` | 200,000 | No | The default. Routes to an available free model. |
| `deepseek/deepseek-chat-v3-0324:free` | 163,840 | No | Fast general chat. |
| `meta-llama/llama-4-maverick:free` | 256,000 | Yes | The only free curated model with vision. |
| `baidu/ernie-5.5-flash-preview:free` | 128,000 | No | Fast; preview model, expect it to change. |

Free models are best-effort: OpenRouter may rate-limit them, restrict
them, or retire them without warning. If a free model fails, the test
button in Settings → Models says so immediately — switch to another row
in this table or to the paid pick below. You pay nothing to TideBot;
your provider bills you directly, so check the provider's own pricing
before using any paid model.

## Coding

| Model ID | Context | Vision | Notes |
| --- | --- | --- | --- |
| `anthropic/claude-sonnet-4` | 200,000 | Yes | Flagship coding pick in the shipped list. |
| `anthropic/claude-3.7-sonnet` | 200,000 | Yes | Agentic pick; strong on multi-step tool use. |
| `openai/gpt-4.1` | 1,047,576 | Yes | 1M context; good for large codebases. |
| `qwen/qwen3-235b-a22b` | 131,072 | No | Open-weights option with hybrid thinking. |
| `openai/gpt-4.1-mini` | 1,047,576 | Yes | Fast and low-cost for routine edits. |

## Research (long context)

| Model ID | Context | Vision | Notes |
| --- | --- | --- | --- |
| `google/gemini-2.5-pro` | 1,048,576 | Yes | 1M context; deep-reasoning pick. |
| `google/gemini-2.5-flash` | 1,048,576 | Yes | Same 1M context, faster and cheaper. |
| `meta-llama/llama-4-maverick` | 1,048,576 | Yes | Paid version of the free Maverick; 1M context. |
| `openai/gpt-4.1` | 1,047,576 | Yes | 1M context with strong tool use. |

## Reasoning

| Model ID | Context | Vision | Notes |
| --- | --- | --- | --- |
| `openai/o4-mini` | 200,000 | Yes | Reasoning model; good for hard single problems. |
| `deepseek/deepseek-r1` | 163,840 | No | Open reasoning model. |
| `qwen/qwen3-235b-a22b` | 131,072 | No | Hybrid thinking modes. |
| `google/gemini-2.5-pro` | 1,048,576 | Yes | Reasoning plus a 1M context window. |

## Vision / multimodal

Any curated model with vision enabled can take images: the free
`meta-llama/llama-4-maverick:free`, `google/gemini-2.5-flash`,
`anthropic/claude-sonnet-4`, `openai/gpt-4.1`, and `x-ai/grok-3-beta`
(131,072 context). If a model has no vision flag, image input is not
supported — the failure will come from the provider, so pick a row
from this section instead.

## Local-only (no cloud key)

Set `LLM_PROVIDER=custom` and point at an OpenAI-compatible endpoint.
Keep the endpoint bound to loopback (`127.0.0.1`); never expose an
unauthenticated model server to fix a connection error.

| Setup | `LLM_BASE_URL` | `LLM_MODEL` | Notes |
| --- | --- | --- | --- |
| Ollama | `http://127.0.0.1:11434/v1` | The exact installed tag, e.g. `qwen3:8b` | Check installed tags first: `curl http://127.0.0.1:11434/api/tags`. An idle model loads on demand; no need to re-download. See `docs/local-model.md` for troubleshooting. |
| vLLM | Your vLLM server's `/v1` URL | The served model name | Same OpenAI-compatible pattern as Ollama. |
| llama-server | `http://127.0.0.1:19326/v1` | The `--alias` you started it with | Tested end to end: Qwen2.5-0.5B-Instruct (Q4_K_M) answered a chat prompt with no key. Full steps in `docs/local-model.md`. |

Tool calling depends on the model: small local models may not support
it. If the endpoint refuses tool definitions, TideBot retries as plain
streaming chat without tools — a successful reply then verifies chat,
not agent work. For real Operator work on a local model, prefer a
larger instruction-tuned model that advertises tool support.

## xAI (native)

- Via the native API: `LLM_PROVIDER=xai`, `XAI_API_KEY`, and
  `XAI_MODEL` (default `grok-4.7`). Uses xAI's `/v1/responses` API.
- Via OpenRouter: `x-ai/grok-3-beta` (131,072 context, vision, tools)
  is in the curated list — use it if you already have an OpenRouter
  key and no xAI key.

## Known limits

- **Model IDs change.** Providers rename and retire models; a curated
  ID that worked last month may 404 today. The live catalog in
  Settings → Models shows what OpenRouter currently offers.
- **Context lengths are as shipped.** The numbers above are the values
  in `CURATED_MODELS`; the provider's live limits rule.
- **Free is not guaranteed.** Free-tier availability, rate limits, and
  quotas are set by OpenRouter, not TideBot.
- **Costs are yours.** TideBot charges nothing; your model provider
  bills you. Paid rows above are listed for capability, not price —
  check the provider before running long jobs.
- **Local models vary.** Tool support, context size, and speed depend
  on the model and your hardware; the only locally verified run is the
  llama-server example linked above.

## Contributing entries

Contributors can add entries (see Phase 4 of the development plan):
keep the model ID exact, copy the context length and vision/tools
flags from the provider or from `CURATED_MODELS`, name the job it is
for, and say what you actually ran — model, provider, and what the
Operator did with it. If you add a model to the shipped curated list,
update this file in the same PR.
