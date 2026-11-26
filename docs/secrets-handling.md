# Secrets handling

> **Last verified:** 2026-11-26 · **Owner:** asjames18 (maintainer)

How TideBot stores, reloads, logs, and exports secrets — and what was found
when the whole pass was reviewed together (Phase 5.2 of the development plan).

## Where secrets live

| Secret | Stored | At rest |
| --- | --- | --- |
| OpenRouter / xAI / custom LLM keys (UI) | SQLite `llm_settings`, `personal_models` | AES-256-GCM, `enc:v1:` prefix (`server/src/lib/secrets.ts`); key in `.secret-key`, mode 0600, beside the DB |
| Composio / Orgo keys (UI) | `.env` (`COMPOSIO_API_KEY`, `ORGO_API_KEY`) | **Plaintext** — see issue #34 |
| Studio password / session secret | `.env` (`STUDIO_PASSWORD`, `SESSION_SECRET`) | Plaintext, mode 0600; never returned by any API |
| Provider keys from the operator's own `.env` | `.env` | Plaintext, mode 0600; read as fallback when the DB has no key |

## `.env` hot-reload

`server/src/env.ts` re-reads `.env` on every access, keyed on file `mtimeMs`,
so saving a key in the UI takes effect without a restart. Fixed
2026-11-26: a key **deleted** from `.env` used to stay live until restart —
only `STUDIO_ADMIN_EMAIL` was cleared on reload, and `opt()` falls back to
`process.env`. Reload now clears every key the file used to provide but no
longer does (only when `process.env` still holds the file's old value, so a
value set another way — Docker env, shell — is not clobbered). Regression
tests: `tests/env-reload.test.mjs`.

## Atomic writes

`updateEnvFile` (`server/src/lib/envFile.ts`) rewrites `.env` via a unique
temp file in the same directory (mode 0600), `fsync`, then rename — a crash
or disk-full error leaves the previous file intact, and failures propagate
instead of pretending the key saved. Regression tests:
`tests/env-persist.test.mjs`. Every UI key save goes through this path
(`writeEnvKeyToDisk`).

## What the API returns

`GET /api/llm/config` returns `LlmConfigPublic`: booleans plus masked hints
(first 6 + last 4 characters, `maskKey` in `server/src/agent/llm.ts`). Full
keys are never sent to the browser. `GET /api/health?detail=1` reports only
whether each provider key is configured, never the key.

## Logs

No key material was observed in any log during this review, and
`checkConnection` already redacts known keys from provider error messages.
But there is no central redaction helper, and three sites log raw
error/response bodies that could carry secret values — see issue #35.

## Exports and backups

- `GET /bots/:id/export` exports a Markdown transcript only — no keys, no
  settings, no `.env` content.
- `npm run backup` (`scripts/backup.mjs`) copies the data directory but
  **excludes `.env` by default** (`--include-env` only with a loud warning),
  so a backup never carries plaintext keys — and a restore does not restore
  them either; re-enter Composio/Orgo keys after a restore (see issue #34).

## Open findings

- #34 — Composio/Orgo keys stored plaintext in `.env` (LLM keys are encrypted).
- #35 — No central log redaction; three sites log raw error/response bodies.
- #36 — A corrupt `.secret-key` silently orphans every encrypted DB key
  after restart (fresh in-memory key is never persisted).

## See also

- [Architecture](ARCHITECTURE.md) — approvals and sandbox invariants
- [Approval policy](approval-policy.md) — the approval firewall audit
- [Network egress](network-egress.md) — every outbound call TideBot makes
- [Self-hosting](self-host.md) — backup, restore, and data locations
