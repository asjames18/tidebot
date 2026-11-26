# Approval policy

> **Last verified:** 2026-11-26 · **Owner:** asjames18 (maintainer)
> Audited against `main` — `server/src/agent/tools.ts` (`policyFor`, `TOOLS`),
> `server/src/composio.ts` (`isReadOnlySlug`, `innerToolSlugs`),
> `server/src/agent/loop.ts` (`processCalls`, `resolveApproval`),
> `server/src/routes.ts` (policies endpoints), and
> `web/src/components/config/AppSettings.tsx` (`PermissionsSection`).
> See also: [Architecture](ARCHITECTURE.md#approvals).

## How the firewall works

Before the agent loop runs any tool call, it asks `policyFor(userId, toolName, args)`
for a decision:

| Decision | What happens |
| --- | --- |
| `allow` | The call runs immediately. |
| `ask` | The turn pauses and an approval card appears (`Allow Once`, `Always Allow`, `Don't allow`). The pending calls are saved in `pending_turns`; the turn resumes when the user answers. A new user message closes a pending approval as expired. |
| `block` | The call is refused. The model is told "The user declined this action. Do not retry it." |

Choosing **Always Allow** on a card stores a per-user policy row
(`policies`: `user_id`, `tool`, `mode = 'always_allow'`). **Settings → Permissions**
lists saved policies; **Ask again** deletes a row and the tool goes back to its
default. The policy key is the built-in tool name, or the Composio slug for a
Composio call.

## Built-in tools

Only three built-ins ask by default. Everything else runs without an approval
step — including several tools that change state (see Findings below).

| Tool | Default | Effect |
| --- | --- | --- |
| `shell` | ask | Runs a command, locally in Bubblewrap or on the Orgo computer. |
| `create_routine` | ask | Creates a scheduled routine. |
| `create_event_routine` | ask | Creates a routine triggered by an app event. |
| `web_search` | allow | Read-only web search (DuckDuckGo). |
| `fetch_webpage` | allow | Read-only fetch, SSRF-guarded. |
| `list_files` | allow | Lists the bot's Library workspace. |
| `read_file` | allow | Reads a workspace file (40k chars max). |
| `recall` | allow | Reads saved memories. |
| `list_event_triggers` | allow | Lists available Composio event triggers. |
| `list_routines` | allow | Lists routines. |
| `list_subagents` | allow | Lists subagents. |
| `computer_screenshot` | allow | Reads the Orgo screen (pixels only, no input). Orgo-only. |
| `stay_silent` | allow | No-op; ends the turn. |
| `computer_click`, `computer_type`, `computer_key`, `computer_scroll`, `computer_drag` | allow | Act on the operator's Orgo desktop: clicks, keystrokes, scrolling, dragging. Orgo-only. |
| `open_browser` | allow | Opens a URL in Chrome on the Orgo desktop. Orgo-only. |
| `save_file` | allow | Writes a file to the bot's workspace (and syncs it to the Orgo computer when connected). |
| `publish_preview` | allow | Serves an existing workspace file at a session-gated preview URL. |
| `remember` | allow | Saves a memory. |
| `set_checkins` | allow | Changes proactive check-in settings. |
| `update_routine` | allow | Rewrites a routine (name, prompt, schedule, enabled). |
| `delete_routine` | allow | Deletes a routine and its event trigger. |
| `create_task`, `update_task` | allow | Creates / updates a task. |
| `send_to_bot` | allow | Sends a message to another bot — starts its turn. |
| `spawn_subagent` | allow | Creates a subagent and sends it a goal. |
| `message_subagent` | allow | Sends a follow-up to a subagent. |
| `stop_subagent` | allow | Interrupts and deletes a subagent. |
| `create_group` | allow | Creates a group chat with bots. |
| `post_to_group` | allow | Posts into a group chat — triggers its bots. |
| `draft_message` | allow | Shows the user a draft card. Nothing is sent until the user sends it. |
| `ask_user` | allow | Shows the user a question card; ends the turn. |
| `request_app_connection` | allow | Shows the user a connect card. The connection itself is a user action. |

Orgo-only tools (`computer_*`, `open_browser`) are only offered to the model when
`ORGO_API_KEY` is configured.

## Composio tools (connected apps)

Composio calls are classified by the **slug name**, not by what the app actually
does:

- `COMPOSIO_SEARCH_TOOLS` and `COMPOSIO_GET_TOOL_SCHEMAS` always run — they only
  discover tools, they take no app action.
- Every other Composio call is broken into inner slugs
  (`COMPOSIO_MULTI_EXECUTE_TOOL` reads them from the `tools` / `tool_calls` /
  `toolCalls` / `actions` argument; any other name is its own slug).
- A slug is treated as read-only when it matches
  `_(GET|LIST|SEARCH|FETCH|FIND|READ|RETRIEVE|QUERY|LOOKUP|CHECK|DESCRIBE|VIEW|COUNT)(_|$)`
  (case-insensitive) — read-only slugs run automatically, everything else asks
  first.
- A per-slug user policy overrides the default (`blocked`, `always_allow`,
  `needs_approval`). A blocked slug refuses the whole call; if any slug in a
  multi-execute needs approval, the whole call asks.
- A Composio call whose slugs cannot be extracted fails closed: it asks.

## Findings (audit, 2026-11-26)

1. **The README overstates the firewall.** `README.md` says "state-mutating
   actions pause the turn" — only `shell`, `create_routine`, and
   `create_event_routine` ask by default. `ARCHITECTURE.md` §Approvals states it
   correctly. The README line is left untouched here because it sits next to
   PR #2's open README hunk; correct it once #2 lands.
2. **`update_routine` / `delete_routine` are ungated while `create_routine`
   asks.** A model can silently rewrite a routine (including disabling it) or
   delete it outright without the user ever seeing a card. Recommend gating
   them the same way as creation — needs a maintainer decision, not changed
   here.
3. **Computer tools act on the operator's own desktop without approval.**
   `computer_click`, `computer_type`, `computer_key`, `computer_scroll`,
   `computer_drag`, and `open_browser` click, type, and open things on the
   Orgo computer with no approval step. They only exist when Orgo is
   connected, but the trust assumption deserves an explicit decision: gate
   them, or document that enabling Orgo means the model may drive the
   desktop freely.
4. **The Composio read-only test is a name regex, not a capability check.**
   A slug that pairs a read verb with a write action (e.g.
   `…_GET_…_DELETE`) would be misread as read-only; a genuinely read-only
   tool whose verb is not in the list (e.g. `DOWNLOAD`, `EXPORT`) asks
   unnecessarily. Mitigations in place: unknown names fail closed to ask,
   and per-slug policies override the default.
5. **`blocked` ("Never allowed") has no button.** `policyFor` supports it and
   Settings displays it, but nothing in the UI creates a blocked policy —
   "Don't allow" on a card denies once only. A user who wants a tool never
   allowed has no way to say so today.

## What this audit did not verify

- No Composio key was available in this environment, so the Composio side was
  verified against the classification code and the slug regex, not against a
  live tool catalog. Composio's slug inventory can change; re-check the regex
  against real slugs whenever the catalog changes.
- This was a static review of the policy code plus regression tests pinning
  `policyFor` decisions (`tests/approval-policy.test.mjs`). It is not a
  runtime fuzz of the approval path.
