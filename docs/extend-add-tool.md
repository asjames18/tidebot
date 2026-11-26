# Tutorial: add a built-in tool

> **Last verified:** 2026-11-26 · **Owner:** asjames18 (maintainer)

Add a tool an Operator can call in chat. You will add `word_count` — a small, pure
tool that counts words, characters, and lines in a piece of text — and finish with a
passing test and a live try in the studio. No keys, no network, no new dependencies.

This is tutorial 1 of 4 in the Phase 4 extension series: built-in tool, API endpoint,
model provider, WebGL shader preset.

## How tools work

Three parts, and only the first one is yours to write:

1. **One entry in the `TOOLS` array** in `server/src/agent/tools.ts`. That entry is
   the whole definition: name, description, JSON Schema parameters, activity, label,
   and the `impl` function that does the work.
2. **Automatic exposure.** `functionSchemas()` in the same file turns every `TOOLS`
   entry into a function schema the model sees. There is no separate registration
   step — adding the entry is enough for the model to start calling it.
3. **Automatic dispatch.** When the model calls the tool, the agent loop looks it up
   in `toolMap` and runs `impl(args, ctx)` (`server/src/agent/loop.ts`). The activity
   shown in the UI comes from your entry via `activityFor()`, so no UI change is
   needed for a plain tool.

Approvals: `policyFor()` allows built-in tools by default. The only built-ins that
ask the user first are `shell`, `create_routine`, and `create_event_routine`
(`APPROVAL_GATED_BUILTINS` in `tools.ts`). If your tool changes state outside the
workspace or runs commands, it belongs in that gated set — say so in your PR.

## Step 1 — Add the tool

In `server/src/agent/tools.ts`, add one entry to the `TOOLS` array, after the
`fetch_webpage` entry:

```ts
  {
    name: 'word_count',
    description:
      'Count the words, characters, and lines in a piece of text. Use it when the user asks how long something is.',
    parameters: obj({ text: { type: 'string', description: 'The text to measure' } }, ['text']),
    activity: 'working',
    label: 'Counting words',
    impl: async (a) => {
      const text = String(a.text ?? '');
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      const lines = text ? text.split('\n').length : 0;
      return {
        output: JSON.stringify({ words, characters: text.length, lines }),
        summary: `${words} word(s), ${text.length} character(s)`,
      };
    },
  },
```

Notes on each field:

- `name` — snake_case, unique across `TOOLS`. The model calls it by this name.
- `description` — this is what the model reads when deciding whether to call the
  tool. Write it as a when-to-use instruction, not a marketing line.
- `parameters` — JSON Schema, built with the file's `obj()` helper. The second
  argument lists required fields. Keep the schema tight: every parameter the model
  must supply, nothing it has to guess.
- `activity` — an `ActivityKind` from `server/src/types.ts` (`working`,
  `searching_web`, `reading_web`, `running_commands`, and the rest). It drives the
  "Operator is…" indicator while the tool runs.
- `label` — short present-tense phrase for the same indicator, e.g. "Counting words".
- `impl` — `(args, ctx) => Promise<{ output, summary?, endTurn? }>`. `args` is the
  model's parsed arguments; `ctx` carries `userId`, `botId`, `enqueueBotMessage`,
  and `depth`. `output` is what the model sees next — keep it small. `summary` is
  the one-liner shown in the chat timeline. `endTurn: true` stops the turn after
  the tool (used by tools that ask the user something, like `ask_user`).

## Step 2 — Add a test

Create `tests/word-count.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { functionSchemas, toolMap } from '../server/dist/agent/tools.js';

const ctx = { userId: 'u1', botId: 'b1', enqueueBotMessage: () => {}, depth: 0 };

test('word_count is exposed to the model', () => {
  const schema = functionSchemas().find((s) => s.name === 'word_count');
  assert.ok(schema, 'word_count missing from functionSchemas()');
  assert.deepEqual(schema.parameters.required, ['text']);
});

test('word_count counts words, characters, and lines', async () => {
  const tool = toolMap.get('word_count');
  assert.ok(tool);
  const r = await tool.impl({ text: 'hello world' }, ctx);
  assert.deepEqual(JSON.parse(r.output), { words: 2, characters: 11, lines: 1 });
  const multi = await tool.impl({ text: 'one\ntwo\nthree' }, ctx);
  assert.deepEqual(JSON.parse(multi.output), { words: 3, characters: 13, lines: 3 });
  const empty = await tool.impl({ text: '' }, ctx);
  assert.deepEqual(JSON.parse(empty.output), { words: 0, characters: 0, lines: 0 });
});
```

Then wire it in: append `tests/word-count.test.mjs` to `tests/node-tests.txt`
(one file per line; `npm test` runs that list with `node --test`). The test imports from
`server/dist/`, so it runs after the build step in `npm test` — same pattern as
`tests/security.test.mjs`. Importing the tools module opens the local dev database
(`data/grokbot.db`), the same database the dev server uses, creating it on first
import if missing. The test itself writes no rows — it only calls the tool's
pure `impl`.

## Step 3 — Verify

```bash
npm run typecheck   # both server and web workspaces
npm run build       # production build must succeed
npm test            # includes the new word-count tests
```

All three must pass before you open a PR (see the verification checklist in
`CONTRIBUTING.md`).

## Step 4 — Try it live

```bash
npm run dev -w server   # Terminal 1 — http://localhost:8787
npm run dev -w web      # Terminal 2 — http://localhost:5173
```

Open the studio, pick any Operator, and ask: "How many words are in: The quick
brown fox jumps over the lazy dog?" The Operator should call `word_count` and
answer 9 words, 44 characters, 1 line. If it answers from its own counting
instead, ask again with "use the word_count tool" — and if it still will not call
it, your description is probably too vague about when to use it.

## Rules that keep tools safe

- **Never return secrets.** Tool output goes to the model and into chat history.
  Keys, tokens, and credentials never belong in an `output`.
- **Files stay inside the workspace.** Use `localWorkspaceDir(ctx.botId)` and
  `resolveWithinWorkspace()` (see `read_file` / `save_file`) — never a raw user
  path, never `..` out of the workspace.
- **Network goes through the guards.** Fetch through `readWebSource()` or the
  SSRF-guarded `safeFetch()` in `server/src/lib/ssrf.ts` — never a bare `fetch()`
  of a model-supplied URL.
- **State-changing tools need approval.** If your tool writes outside the
  workspace, sends something, or runs a shell command, gate it: add it to
  `APPROVAL_GATED_BUILTINS` or route it through the approval flow in
  `server/src/agent/loop.ts`, and call it out in the PR.
- **Keep `output` small.** Long outputs eat the model's context. Summarize, slice
  (`read_file` caps at 40,000 characters), or return a count and offer detail on
  request.
- **One tool, one job.** If the description needs the word "and" twice, it is
  probably two tools.

## See also

- `AGENTS.md` §4 — the short version of this tutorial (tool, endpoint, and the
  architectural map around them).
- `CONTRIBUTING.md` — branching, verification checklist, and PR process.
- `docs/ARCHITECTURE.md` §3.3 — agent loop, sandbox strategy, and the approval
  firewall this tutorial plugs into.
