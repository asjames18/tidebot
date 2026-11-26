# Plugin boundary: what contributors can rely on

TideBot is MIT-licensed and built to be built on. This page is the contract
for anyone extending it — a built-in tool, an API client, a template, a
script, or an integration. It says what is stable, what is internal, and how
a breaking change is announced.

**Stable** means we will not break it without the deprecation process in
"How breaking changes are announced" below. **Internal** means it may change
in any release; building on it means tracking `main`. If you need something
stable that is not listed here, open an issue or a Discussion — do not
silently depend on an internal.

> **Last verified:** 2026-11-26 · **Owner:** asjames18 (maintainer).
> Every claim below was checked against the code on `main` on that date.

## Stable API surface

### 1. The HTTP API

The routes under `/api`, implemented in `server/src/routes.ts`,
`server/src/routes-config.ts`, `server/src/routes-rooms.ts`,
`server/src/routes-proactive.ts`, and `server/src/voice.ts`, and exposed
through the typed clients `web/src/lib/api.ts` (`api`) and
`web/src/lib/configApi.ts` (`configApi`). The typed client is the contract:
if a route is not reachable through `api` or `configApi`, treat it as
internal even if it answers today.

- Auth is a session cookie on every route except `/api/health` (which
  returns exactly `{ ok: true }`) and the `/api/auth/*` and
  `/api/apps/callback` entry points.
- There is no `/v1` prefix. The API is versioned by the TideBot release
  that ships it; breaking changes follow the policy below.
- Groups: auth and invites, bots and their rows/runs/messages, approvals
  and cards, routines, tasks, memories, search, projects, rooms,
  check-ins, Composio apps, computer (Orgo) state, LLM configuration,
  releases, and system status.

### 2. Built-in tool names and parameters

The 36 tools in `TOOLS` in `server/src/agent/tools.ts` — `web_search`,
`fetch_webpage`, `list_files`, `read_file`, `draft_message`,
`computer_screenshot`, `computer_click`, `computer_type`, `computer_key`,
`computer_scroll`, `computer_drag`, `open_browser`, `save_file`,
`publish_preview`, `shell`, `remember`, `recall`, `create_routine`,
`list_event_triggers`, `create_event_routine`, `stay_silent`,
`set_checkins`, `list_routines`, `update_routine`, `delete_routine`,
`create_task`, `update_task`, `send_to_bot`, `spawn_subagent`,
`list_subagents`, `message_subagent`, `stop_subagent`, `create_group`,
`post_to_group`, `ask_user`, `request_app_connection`.

Stable for each tool: its **name**, its JSON Schema **parameters**, and its
**approval behavior** (which tools ask before acting — see `policyFor` in
`server/src/agent/tools.ts`). The implementation behind a tool, the
`ToolCtx` it receives, and the `ToolResult` shape are internal. The
`computer_*` tools (plus `open_browser`) are only offered when an Orgo key
is configured — `functionSchemas()` in the same file prunes them otherwise,
so local-only installs never see them.

### 3. Model providers

The provider ids in `LlmProvider` in `server/src/agent/llm.ts`:
`openrouter`, `custom` (any OpenAI-compatible base URL), and `xai`. The
curated model list (`CURATED_MODELS` in the same file) grows over time;
entries are added, not silently swapped — a model id that disappears from
the list keeps working if the provider still serves it, and a provider
renaming or retiring a model is handled gracefully, not by breaking saved
Operators. The environment variables in `.env.example` are stable names:
`LLM_PROVIDER`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `LLM_BASE_URL`,
`LLM_API_KEY`, `LLM_MODEL`, `XAI_API_KEY`, `XAI_MODEL`. Their values are
secrets — never log them, never commit them.

### 4. Transcript export

`GET /api/bots/:id/export` returns a Markdown transcript of one Operator:
a `# name — label` header, an export timestamp, a `Model:` line when a
model is set, then message rows and `Tool:` lines for tool calls, served
as an attachment. The Markdown-transcript shape is stable; individual row
rendering may gain fields. This is a transcript export, not an Operator
definition export — exporting and importing an Operator as a file is
planned work (Phase 3.1), not a format that exists today. Do not build
against a format that does not exist yet.

### 5. Documented CLI commands

`npm run doctor` (health check: Node version, database writability,
sandbox status, which provider keys are configured — never the keys) and
`npm run backup` (one-click local-state backup with verification; `.env`
excluded by default). Both are documented in `docs/self-host.md` and are
stable commands; their human-readable output text is not.

### 6. Data locations

Where TideBot keeps things does not move without notice:
`data/grokbot.db`, `data/workspaces/<botId>/`, and the settings/key
locations documented in `docs/self-host.md` (including the desktop
per-OS data folders and the TideBot menu → Open Data Folder path). The
SQLite **schema inside** `grokbot.db` is internal — migrations run
automatically at startup, and the file is yours to back up, not to query
against in production code.

### 7. WebGL shader preset names

Preset names in the `ShaderStyle` union are user-visible in the studio
picker and saved in Operator settings, so adding a preset is safe but
renaming or removing one changes saved settings — it follows the
deprecation process below.

## Internal — may change without notice

- **Server internals:** the SQLite schema in `server/src/db.ts`, the turn
  machinery in `server/src/agent/loop.ts`, helpers in `server/src/store.ts`,
  the `Row` / `CardBody` variants in `server/src/types.ts`, and the
  Server-Sent Events payload shapes on `/api/events`. The web client owns
  the SSE contract; do not parse the stream yourself.
- **Web internals:** the component tree under `web/src/components/`, CSS
  class names, and the state shapes in `web/src/store.ts` and
  `web/src/configStore.ts`.
- **Desktop internals:** `desktop/main.cjs`, IPC channels, and the
  updater manifest shape (`latest-mac.yml` and friends are consumed by
  `electron-updater`; their format follows electron-builder, not TideBot).
- **Composio toolkit slugs:** governed by Composio, not TideBot. A slug's
  read-only classification and approval policy may change; see
  `isReadOnlySlug` in `server/src/composio.ts` for the current rule.
- **Log formats, test fixtures, and scripts** other than the documented
  CLIs in §5. `scripts/mobile-audit.mjs` and friends are maintainer
  tooling, not public API.

## What counts as breaking

Breaking: removing or renaming an endpoint, a built-in tool, a provider
id, or a response field; requiring auth where none was needed; changing
the transcript export format incompatibly; renaming a shader preset or a
documented `.env` variable.

Not breaking: adding endpoints, tools, providers, presets, or response
fields; adding optional parameters; fixing behavior to match the docs.

## How breaking changes are announced

1. Every breaking change is announced in the **GitHub release notes** of
   the release that carries it, with a migration note. There is no
   `CHANGELOG.md` yet — release notes are the channel until one lands.
2. A deprecated surface keeps working for **at least one further release**
   after the announcement: at least one further `v1.0.0-dev.*` release
   during the current prerelease series, and at least one stable release
   after stable 1.0 ships. The deprecated surface is removed only after
   that window.
3. **Security fixes may break a surface immediately** — for example, if a
   stable endpoint turns out to leak data. That is announced in the
   release notes too, with the reason stated plainly.
4. This policy itself changes only by maintainer decision. The maintainer
   is Antonio (asjames18); contested changes are decided by him, not by
   vote.

## See also

- `AGENTS.md` §4 — how to add a tool, an endpoint, a provider, or a shader preset.
- `docs/ARCHITECTURE.md` — the system map this boundary sits on.
- `docs/self-host.md` — data locations, backup/restore, and the documented CLIs.
