# Composio playbook: Google Calendar

> **Last verified:** 2026-11-26 · **Owner:** asjames18 (maintainer)
> Grounded in `server/src/composio.ts`, `server/src/agent/tools.ts` (`policyFor`),
> `server/src/agent/loop.ts`, `server/src/routes.ts`, `docs/xai-and-composio.md`
> (Part B), and `docs/approval-policy.md`. Google Calendar tool slugs checked
> against Composio's Google Calendar toolkit reference
> (https://docs.composio.dev/toolkits/googlecalendar and
> https://composio.dev/toolkits/googlecalendar — 47 tools, 6 triggers as of
> 2026-11-26). See also: [XAI & Composio](xai-and-composio.md),
> [Approval policy](approval-policy.md).

This is the second of two worked Composio playbooks the plan calls for (Phase
4.2): how to wire a toolkit into an Operator, handle its approval policy, and
write the example prompt. Gmail is example one (see
`docs/composio-playbook-gmail.md` once it lands — it is a draft PR at the time
of writing, so it is not linked here).

## What Google Calendar gives an Operator

Once Google Calendar is connected, the Operator can read the connected
account's calendars, check availability, create and change events, manage
attendees, and react to calendar changes on a schedule. Everything runs
through Composio: TideBot never sees the Google password or OAuth tokens, and
Composio refreshes the connection automatically.

Two things Google Calendar is **not** in TideBot:

- It is not TideBot's sign-in. Sign-in uses a separate Composio-managed Gmail
  connection only to read the Google profile email (`startGoogleLogin` /
  `googleProfile` in `server/src/composio.ts`). The Operator's Calendar
  connection is a different connection, made after sign-in.
- It is not a per-Operator switch. There is no per-bot toolkit toggle on
  `main`: every turn offers the whole session's Composio tools to every
  Operator of that user (`server/src/agent/loop.ts` appends
  `composioTools(userId)` to the tool list). You scope Calendar by writing it
  into the Operator's instructions (step 2 below), not by flipping a switch.

## Prerequisites

- A studio administrator has saved a Composio API key (`COMPOSIO_API_KEY` in
  `.env`, or Settings → Connected apps). Without it, connecting returns 503
  (`POST /api/apps/:slug/connect`) and the Operator gets no Composio tools at
  all (`composioTools()` returns `[]`).
- Google Calendar is in Composio's managed-OAuth catalog (`managedAuth: true`
  in the fallback catalog, `server/src/composio.ts`), so no own Google OAuth
  app is needed to start. The managed consent screen shows Composio's app,
  not TideBot's, and the default managed config requests full calendar access
  (`https://www.googleapis.com/auth/calendar` and
  `https://www.googleapis.com/auth/calendar.events`). If you want TideBot's
  name on the consent screen, a dedicated quota, or narrower scopes (for
  example `calendar.events.readonly`, which reads events but cannot create or
  change them), register your own Google OAuth app and auth config instead —
  see [XAI & Composio](xai-and-composio.md#b2-auth-flows).

## Step 1: Connect Google Calendar

Either path ends at the same hosted Connect Link.

**From Settings (you do it):** Settings → Connected apps → Browse & Connect
Apps → Google Calendar → sign in with Google and approve the consent screen.
That calls `POST /api/apps/googlecalendar/connect`, which runs
`session.authorize('googlecalendar', { callbackUrl })` and returns the
`redirectUrl`. On return, `/api/apps/callback` checks a signed, 10-minute
state token and flips the connection to active.

**From chat (the Operator asks):** the Operator has a built-in
`request_app_connection` tool (`toolkit: 'googlecalendar'`). It shows a
connect card; when you finish the flow, the card flips to "connected" and the
Operator is told to continue with what it was doing.

## Step 2: Tell the Operator what Calendar is for

Because every connected toolkit is offered to every Operator, the
instructions are the scope. Put the job, the boundaries, and the approval
expectation in the Operator's instructions (Bot settings → Instructions).
Example:

> You are my scheduling Operator. Google Calendar is connected for this job
> only. Book meetings on my primary calendar, always check free slots before
> booking, and never delete or move an event without asking me first. Times
> are in America/New_York — pass the IANA timezone name, never "EST". If an
> event already has attendees, tell me before changing it.

Keep the wording tight: the instructions travel with every turn, and the
Operator only sees the Calendar tools it discovers through the session's meta
tools (`COMPOSIO_SEARCH_TOOLS`, `COMPOSIO_GET_TOOL_SCHEMAS`).

## The tools, and what asks first

Approval is decided by `policyFor` (`server/src/agent/tools.ts`) on the tool
**slug name**, not on what the app does. A slug is read-only when it matches
`_(GET|LIST|SEARCH|FETCH|FIND|READ|RETRIEVE|QUERY|LOOKUP|CHECK|DESCRIBE|VIEW|COUNT)(_|$)`:

| Tool | What it does | Approval |
| --- | --- | --- |
| `GOOGLECALENDAR_LIST_CALENDARS` | All calendars in the account, with IDs and access roles | Runs automatically |
| `GOOGLECALENDAR_EVENTS_LIST` | Events in one calendar for a time range (`calendarId`, `timeMin`, `timeMax`) | Runs automatically |
| `GOOGLECALENDAR_EVENTS_LIST_ALL_CALENDARS` | Events across calendars, deduplicated, for a time range | Runs automatically |
| `GOOGLECALENDAR_FIND_EVENT` | Search events by text, time range, and event type (`query`, `timeMin`, `timeMax`) | Runs automatically |
| `GOOGLECALENDAR_FIND_FREE_SLOTS` | Free/busy slots for the people and time you give it | Runs automatically |
| `GOOGLECALENDAR_EVENTS_GET` | One event by its `event_id` | Runs automatically |
| `GOOGLECALENDAR_GET_CURRENT_DATE_TIME` | Current time with timezone — use it instead of guessing "now" | Runs automatically |
| `GOOGLECALENDAR_COLORS_GET` | The calendar color palette | Runs automatically |
| `GOOGLECALENDAR_SETTINGS_GET` | One account setting | Runs automatically |
| `GOOGLECALENDAR_SETTINGS_LIST` | All account settings | Runs automatically |
| `GOOGLECALENDAR_LIST_SETTINGS` | Settings, list form | Runs automatically |
| `GOOGLECALENDAR_ACL_LIST` | Sharing rules on a calendar | Runs automatically |
| `GOOGLECALENDAR_ACL_GET` | One sharing rule | Runs automatically |
| `GOOGLECALENDAR_CALENDAR_LIST_GET` | One entry from the calendar list | Runs automatically |
| `GOOGLECALENDAR_EVENTS_INSTANCES` | Instances of one recurring event — read-only in effect, but the slug has no read verb in it, so it asks | **Asks first** |
| `GOOGLECALENDAR_CREATE_EVENT` | Creates a timed or all-day event (`start_datetime`, `timezone`, `summary`, `attendees`, `event_duration_hour`/`event_duration_minutes`) — **no conflict checking** | **Asks first** |
| `GOOGLECALENDAR_UPDATE_EVENT` | Full replacement of an event (unspecified optional fields are cleared) | **Asks first** |
| `GOOGLECALENDAR_PATCH_EVENT` | Partial update; an `attendees` list you pass replaces the whole list | **Asks first** |
| `GOOGLECALENDAR_DELETE_EVENT` | Deletes one event (`calendar_id`, `event_id`) | **Asks first** |
| `GOOGLECALENDAR_QUICK_ADD` | Creates an event from natural-language text | **Asks first** |
| `GOOGLECALENDAR_EVENTS_IMPORT` | Imports an event as a private copy | **Asks first** |
| `GOOGLECALENDAR_EVENTS_MOVE` | Moves an event to another calendar | **Asks first** |
| `GOOGLECALENDAR_REMOVE_ATTENDEE` | Removes one attendee by email | **Asks first** |
| `GOOGLECALENDAR_BATCH_EVENTS` | Up to 1000 event mutations in one call, with per-item results | **Asks first** |
| `GOOGLECALENDAR_CLEAR_CALENDAR` | Deletes **all** events on a primary calendar — the destructive one; never let an Operator call it on a loose instruction | **Asks first** |

"Asks first" means the turn pauses and an approval card appears (Allow Once
/ Always Allow / Don't allow). Choosing **Always Allow** stores a per-slug
policy row; **Settings → Permissions** lists saved policies, and **Ask again**
deletes one. A blocked slug refuses the whole call, and if any slug inside a
`COMPOSIO_MULTI_EXECUTE_TOOL` call needs approval, the whole call asks. A
call whose slugs cannot be extracted fails closed: it asks.

Two honest edges, both from the audit in `docs/approval-policy.md`:

- The read-only test is a name regex, not a capability check.
  `GOOGLECALENDAR_EVENTS_INSTANCES` only reads, but it asks because
  `INSTANCES` is not in the verb list. If a slug's default worries you, set a
  per-slug policy.
- Parameter names change when Composio versions the toolkit. The names in
  this doc match the toolkit reference as of 2026-11-26; if a call fails on
  a parameter, the live schema wins — have the Operator run
  `COMPOSIO_GET_TOOL_SCHEMAS` for that slug instead of guessing.

## Worked example 1: morning briefing

Copy-pasteable Operator instructions (pairs with the step-2 example above):

> Every weekday at 8:00, run the morning briefing:
> 1. `GOOGLECALENDAR_GET_CURRENT_DATE_TIME` so "today" is the real date,
>    not a guess.
> 2. `GOOGLECALENDAR_EVENTS_LIST_ALL_CALENDARS` for today, 00:00 to 23:59.
> 3. Save the briefing with `save_file` as `briefing-YYYY-MM-DD.md`: time,
>    title, attendees, location, and one line on what each meeting is for.
>    Flag back-to-back meetings and any meeting with no description.
> 4. Show me the briefing with the built-in `draft_message` tool and stop.
>    Do not create, move, or delete anything.
>
> If Calendar is not connected, use `request_app_connection` with toolkit
> `googlecalendar` and stop until I connect it.

Set it up as a routine (`create_routine`, cron `0 8 * * 1-5`) — creating the
routine itself asks for approval once, by design.

## Worked example 2: book a meeting, change nothing silently

This is the safe default for any Operator that books on your behalf:

> When I ask you to book a meeting:
> 1. Find the people first: if I give you names, not emails, resolve them
>    with the Gmail toolkit (`GMAIL_SEARCH_PEOPLE`) before touching the
>    calendar.
> 2. `GOOGLECALENDAR_FIND_FREE_SLOTS` for the people and the window I gave
>    you. `GOOGLECALENDAR_CREATE_EVENT` does **no** conflict checking, so
>    this step is the check — never skip it.
> 3. Create the event with `GOOGLECALENDAR_CREATE_EVENT` (`calendar_id`
>    `primary` unless I name another calendar, `start_datetime` in ISO 8601,
>    `timezone` as the IANA name, `summary`, `attendees` as email addresses,
>    `description` for the agenda). It attaches a Meet link by default
>    (`create_meeting_room`); say so in the confirmation.
> 4. Show me what you booked with the built-in `draft_message` tool and
>    stop. If the slot I asked for is taken, offer the nearest free slot
>    instead of booking over it.
>
> Never use `GOOGLECALENDAR_UPDATE_EVENT` for a small change — it replaces
> the whole event. Use `GOOGLECALENDAR_PATCH_EVENT`, and remember that
> passing `attendees` replaces the entire attendee list: read the event
> first, then pass the full list back. Never call
> `GOOGLECALENDAR_CLEAR_CALENDAR` or `GOOGLECALENDAR_BATCH_EVENTS` unless I
> name the exact events in the same message.

Note the two kinds of "draft" here: a **calendar event** is real the moment
it is created (the invite goes out); a **TideBot draft card**
(`draft_message`) is just text shown in chat. The worked flow creates the
event only after the free-slots check and the approval card, then shows the
result in chat for review — there is no draft-event state in between.

## Event routine: act on calendar changes

The toolkit lists 6 triggers. Their slugs are not hard-coded here because
they are only visible in the live catalog — discover them at runtime with the
built-in `list_event_triggers` tool (`toolkit: 'googlecalendar'`), then pass
the slug you need to `create_event_routine`
(`server/src/triggers.ts`). The routine's prompt receives the event payload,
so write it to use the event's own fields:

> When a calendar event changes: read the changed event with
> `GOOGLECALENDAR_EVENTS_GET`, then tell me what changed — title, old time
> vs new time, who was added or removed. Do not move or delete anything.

## Reconnect

Connections expire. The common cases:

- **Google test-mode expiry.** While the Google OAuth app is in Testing,
  Google generally expires authorizations after seven days — reconnect.
- **Scopes changed.** If the auth config's scopes change after connecting,
  reconnect so the account grants the new access.
- **Refresh failed.** Composio moves the account to `EXPIRED` and sends a
  `composio.connected_account.expired` event to the project webhook.

The fix in TideBot is the same every time: disconnect, then connect again.
Disconnect is `DELETE /api/apps/googlecalendar` (`api.disconnect('googlecalendar')` in the
web client, `disconnect()` in `server/src/composio.ts`) — it deletes every
connected Google Calendar account for your user and clears the cached session. Then
run step 1 again. There is no "refresh" button; a fresh connect flow is the
refresh.

## Limits

- **47 tools, 6 triggers.** Composio's Google Calendar toolkit is bigger than
  the table above — the table lists the tools this playbook verified. The rest
  are discoverable at runtime (`COMPOSIO_SEARCH_TOOLS`); do not hard-code a
  slug you have not seen in the live catalog, because toolkits are
  versioned and slugs change.
- **No per-Operator toolkit switch.** Scoping is by instructions (step 2),
  and every connected toolkit is offered to every Operator. An Operator
  told to ignore Calendar will still see its tools in the list.
- **Calendar calls leave the machine.** Calls go through Composio's backend
  to Google. Do not paste secrets or credentials into event descriptions,
  and keep the managed-auth scope in mind: full calendar access by default,
  `calendar.events.readonly` if you bring your own OAuth app.
- **Creating, moving, and deleting are always a human decision.** The
  approval firewall is the backstop, not the plan: the Operator's
  instructions should say "check first, ask before changing" even though
  `GOOGLECALENDAR_CREATE_EVENT` asks first anyway — and
  `GOOGLECALENDAR_CLEAR_CALENDAR` wipes a whole calendar in one call, so it
  deserves an explicit "never" in the instructions, not just the card.
