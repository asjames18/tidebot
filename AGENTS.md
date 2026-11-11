# AGENTS.md — TideBot Architecture & Agent Engineering Guide

This document provides AI coding agents and human contributors with the architectural map, runtime invariants, and conventions required to safely extend **TideBot**.

---

## 1. System Overview

**TideBot** is a full-stack TypeScript monorepo (`npm` workspaces: `server` and `web`) implementing an autonomous multi-agent studio:
- **`server/` (`@grokbot/server`)**: Node.js + Hono HTTP/SSE server backed by `better-sqlite3` (`data/grokbot.db` in WAL mode). Owns the agent execution loop, multi-provider LLM streaming, Composio tool routing, local workspace sandboxes (`data/workspaces/<botId>/`), Orgo cloud Linux VMs, and cron/event scheduling.
- **`web/` (`@grokbot/web`)**: React 19 + TypeScript + Vite + Zustand single-page studio featuring the **Obsidian Glass** design system, a zero-dependency WebGL GLSL shader engine (`ShaderCanvas.tsx`), real-time SSE synchronization, and interactive tool/approval cards.

---

## 2. Core Commands

Always run typechecking and production builds from the repository root before finishing any task:

```bash
# Typecheck both server and web workspaces
npm run typecheck

# Build production bundles for web and server
npm run build

# Start development servers
npm run dev -w server   # http://localhost:8787
npm run dev -w web      # http://localhost:5173 (proxies /api to :8787)
```

---

## 3. Architectural Invariants & Key Modules

### 3.1 Environment & Live Hot-Reloading (`server/src/env.ts`)
- `env.ts` reads `.env` from the repository root and caches it by file `mtimeMs`.
- Accessing `env.openrouterKey`, `env.composioKey`, `env.orgoKey`, etc. automatically checks if `.env` was modified on disk and reloads it in-place without restarting the Node process.
- `writeEnvKeyToDisk(key, value)` updates `.env` in place when keys are saved via the UI.
- **Security Rule**: Never commit `.env` or `data/` (`*.db`, `workspaces/`).

### 3.2 Multi-Provider BYOM Engine (`server/src/agent/llm.ts`)
- Supports three provider modes stored in SQLite (`llm_settings` table, `id = 1`) with fallback to `.env`:
  1. `openrouter`: Uses `https://openrouter.ai/api/v1` via OpenAI Chat Completions streaming. Includes agentic harness headers (`HTTP-Referer: https://cline.bot`, `X-Title: Cline`) so gated agentic models (such as `thinkingmachines/inkling-2-small:free`) work seamlessly.
  2. `custom`: Connects to any OpenAI-compatible `/v1/chat/completions` endpoint (Ollama, LM Studio, vLLM, Groq, Together, OpenAI).
  3. `xai`: Uses xAI's native `/v1/responses` API.
- **Reasoning Traces**: `streamModelTurn()` extracts both `delta.reasoning` / `delta.reasoning_content` and `delta.content`, streaming reasoning tokens via `callbacks.onReasoningDelta` into `MessageBody.reasoning` so reasoning models provide immediate visual feedback in the UI.
- **Per-Operator Model Resolution**: `resolveBotModel(botRow)` checks `botRow.model` first and falls back to `llm_settings.default_model`.

### 3.3 Agent Loop & Tool Execution (`server/src/agent/loop.ts` & `server/src/agent/tools.ts`)
- **Serial Per-Operator Queue**: Each Operator (`botId`) runs turns sequentially via `enqueue(botId, trigger)` so concurrent user messages, cron routines, or inter-bot messages never corrupt conversation history.
- **Dual Sandbox Strategy**:
  - Local workspace directory: `localWorkspaceDir(botId)` resolves to `data/workspaces/<botId>/`.
  - `save_file`, `read_file`, and `list_files` always read/write to `localWorkspaceDir(botId)` immediately (zero latency), and mirror to the Orgo cloud VM only when `ORGO_API_KEY` is configured and the VM is running.
  - When `ORGO_API_KEY` is not set, the 7 X11 GUI-only tools (`ORGO_ONLY_TOOLS`) are pruned from `functionSchemas()` to save prompt tokens.
- **Approval Firewall (`policyFor`)**:
  - Built-in tools in `toolMap` are allowed by default.
  - External Composio tools are inspected via `innerToolSlugs()`. Read-only slugs (`_GET`, `_LIST`, `_SEARCH`, `_FETCH`, etc.) default to `always_allow`; state-changing slugs default to `needs_approval` and pause the turn (`pending_turns` table) until resolved via `POST /api/approvals/:id`.

### 3.4 Composio App Integrations (`server/src/composio.ts`)
- `getComposio()` lazily initializes `@composio/core` with `OpenAIResponsesProvider` and automatically invalidates `sessionCache` and `catalogCache` if `env.composioKey` changes.
- Categories returned from Composio v3.1 (`/toolkits`) are normalized to lowercase so frontend category pills match consistently.

### 3.5 Frontend State & Real-Time SSE (`web/src/store.ts` & `web/src/configStore.ts`)
- Shared types between backend and frontend live in `server/src/types.ts` and are imported in the frontend via `@shared/types`.
- Whenever you add a field to `Bot`, `RowBody`, `LlmConfigPublic`, or `ServerEvent` in `server/src/types.ts`, ensure both `server/src/store.ts` and the corresponding React components stay type-safe.
- `ShaderCanvas.tsx` is throttled to 30 FPS, `0.6x` resolution scaling, and pauses when off-screen or when the browser tab is hidden. Keep any new shader programs lightweight.

---

## 4. Adding New Capabilities

### Adding a New Built-in Agent Tool
1. Define the tool in `TOOLS` inside `server/src/agent/tools.ts` with a clear `name`, `description`, JSON Schema `parameters`, `activity` (`ActivityKind`), and `label`.
2. Return `{ output: string | any[], summary?: string, endTurn?: boolean }`.
3. If the tool renders an interactive UI card, call `appendRow(ctx.botId, 'card', ...)` and match one of the `CardBody` variants in `server/src/types.ts` and `web/src/components/cards/Cards.tsx`.

### Adding a New API Endpoint
1. Add core chat/bot/routine/task endpoints to `server/src/routes.ts` or settings/library/BYOM endpoints to `server/src/routes-config.ts`.
2. Add the typed client method to `web/src/lib/api.ts` or `web/src/lib/configApi.ts`.
3. Run `npm run typecheck && npm run build` to verify end-to-end type safety.
