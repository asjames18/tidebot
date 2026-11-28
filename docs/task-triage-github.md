# Task guide: triage my GitHub inbox every morning

> **Last verified:** 2026-11-26 · **Owner:** asjames18 (maintainer)

An Operator that lists your overnight GitHub notifications and open issues
each morning and drafts a short triage summary — what needs a reply, what
needs a decision, and what is just FYI. It reads only. It never comments,
closes, assigns, or merges anything without your approval.

This is one of the Phase 6.1 end-to-end task guides. It was written against
the shipped code: the Composio GitHub toolkit as documented in
`docs/xai-and-composio.md`, the read-vs-state-changing approval policy in
`server/src/agent/tools.ts` (`policyFor`) and `server/src/composio.ts`
(`isReadOnlySlug`), the `create_routine` tool, and the template flow in
`web/src/components/modals/CreateBotModal.tsx`. The Composio tool names
below were checked against the GitHub toolkit reference
(https://docs.composio.dev/toolkits/github, toolkit version 20261116_01).

## The rule first

Triage is a read-only job, and TideBot's approval policy already treats it
that way. A Composio tool whose slug contains `_LIST_`, `_GET_`, `_SEARCH_`,
or a similar read verb is auto-allowed (`isReadOnlySlug` in
`server/src/composio.ts`); anything that changes state — commenting,
closing, assigning, creating an issue — defaults to `needs_approval` and
shows you an approval card first (`policyFor` in
`server/src/agent/tools.ts`).

So the Operator can list your notifications and issues every morning
without bothering you, and it cannot act on any of them until you say so.
If an Operator ever offers to close an issue or reply to a thread on its
own, say no — that is not how this guide works, and it is not how the
approval policy behaves.

## Build it

Create a bot from the **Inbox & Calendar** template (Clara, Executive
Assistant, Personal assistant mode). It already carries the right stance —
"Triage email, preps meeting briefs, and keeps your calendar organized" —
and you extend it for GitHub triage.

In the create modal, fill in:

- **Role label** (max 60 characters): `GitHub Triage Assistant`
- **Description** (max 500 characters): `Lists overnight GitHub
  notifications and open issues each morning and drafts a short triage
  summary. Reads only — nothing is commented, closed, or assigned without
  your approval.`
- **Instructions** (max 8,000 characters) — paste this in, then make it
  yours:

```text
You triage my GitHub inbox every morning.

When I ask for triage, or when the morning routine runs:
1. List my notifications with GITHUB_LIST_NOTIFICATIONS, with `since` set
   to yesterday morning (ISO 8601) so the list covers overnight only. Keep
   `per_page` at 50 or below.
2. For each repository I care about, list its open issues with
   GITHUB_LIST_REPOSITORY_ISSUES (`owner` + `repo`, `state` open,
   `since` yesterday morning). Note that this list includes pull requests
   too — say so when an item is a PR, do not count it twice.
3. Group everything into three buckets: NEEDS A REPLY (someone is waiting
   on me), NEEDS A DECISION (I have to choose something), and FYI (I just
   need to know). One line per item: repository, number, title, and the
   link. Put the smallest bucket first if it is empty — say so plainly.
4. If anything is unclear — which repositories count as "mine", whether a
   thread is actually waiting on me — ask me with a short multiple-choice
   question before summarizing. Do not guess.
5. Offer to track the top items: say "want me to create tasks for the top
   three?" and only call create_task (one per item, title only) after I
   say yes.
6. Never comment, close, assign, label, or merge anything yourself. Those
   are state-changing tools and need my approval on the card first.
7. If there is nothing new, end the turn quietly with stay_silent. A
   quiet morning is a good result, not an error.

If GitHub is not connected yet, ask me to connect it with
request_app_connection (toolkit `github`) instead of guessing at tools.
If GITHUB_LIST_NOTIFICATIONS fails with a token-type error, fall back to
GITHUB_LIST_REPOSITORY_ISSUES per repository — that path only needs repo
access — and tell me the notifications call failed so I know the summary
may miss mentions outside those repos.
```

- **Working mode:** Personal assistant. Your GitHub inbox is yours; a
  Teammate bot works in shared rooms instead.
- **Bot model:** leave it on Studio default unless you have a reason to
  change it.

Save the Operator, then tell it something durable in chat, for example:
"Remember: the repos I care about are tidebot, melanatedintech, and
dumb-money-hub. Treat anything in tidebot as highest priority." It stores
that with `remember`, and future triage uses it without being asked again.

## Connect GitHub first

The Operator can only read GitHub through a connected Composio account.
Ask it to connect GitHub (it calls `request_app_connection` with the
`github` toolkit slug) and follow the connect card. GitHub supports
Composio-managed OAuth, and the default auth config requests the
`notifications` scope among others (`repo`, `user`, `gist`, `project`,
`workflow`, `codespace`) — see `docs/xai-and-composio.md`.

Two things to know about that connection:

- **If the connection expires**, the Operator gets a `reconnect` card
  (`composio.connected_account.expired`). Reconnect from the card; until
  you do, triage fails loudly instead of silently reporting an empty
  inbox. An empty result and a failed connection are different things —
  the Operator should say which one it saw.
- **If your repositories live in an organization**, an organization owner
  may need to approve the app before it can reach the organization's
  private resources. If triage works for personal repos but an org repo
  comes back empty or errors, that approval is the first thing to check.

## Use it

Copy-pasteable prompts that work as written:

```text
Triage my GitHub inbox from overnight.
```

```text
What's waiting on me in tidebot this morning?
```

```text
Summarize the new issues in melanatedintech from the last 24 hours and
tell me which ones need a decision from me.
```

What happens next, step by step:

1. The Operator lists notifications since yesterday morning, then open
   issues per repository you named. Both calls are read-only, so no
   approval card appears for the listing itself.
2. It groups the results into NEEDS A REPLY / NEEDS A DECISION / FYI and
   posts the summary in chat, one line per item with repository, number,
   title, and link.
3. If a bucket is ambiguous it asks first with `ask_user` — a short
   multiple-choice question card, at most six options. Answering it is a
   normal chat message; the Operator continues from there.
4. Say "create tasks for the top three" and it calls `create_task` once
   per item. Say "mark those done" later and it closes them with
   `update_task` (state `done`).

To make it automatic, ask the Operator to set up a morning routine — for
example: "Create a routine called GitHub morning triage that runs
weekdays at 8:00 and follows my triage instructions." That is
`create_routine` with a 5-field cron schedule (`0 8 * * 1-5` for weekdays
at 8:00); creating the routine itself asks for your approval once, and
routines must be at least 15 minutes apart. On a quiet morning the
routine ends with `stay_silent` and you hear nothing.

## What it cannot do

- **It cannot read notifications if the token type is wrong.** The
  Composio reference is explicit: `GITHUB_LIST_NOTIFICATIONS` requires a
  classic personal access token with `notifications` or `repo` scope and
  does not work with GitHub App tokens or fine-grained personal access
  tokens. If that call errors, the guide's fallback is per-repository
  `GITHUB_LIST_REPOSITORY_ISSUES` — which is why the instructions tell
  the Operator to say so rather than present a partial list as complete.
- **It cannot see repositories the connected account cannot reach.**
  Private repos in an organization that has not approved the app, and
  repos under a different GitHub account, are invisible to it. Connect
  the right account, or name the repos it should check and watch for the
  empty-result warning above.
- **It cannot mark notifications read or close anything on its own.**
  Triage here is a summary, not an action. Commenting, closing, and
  assigning are state-changing tools that need your approval on the card
  first — and marking a thread read is a write, not a read, so it needs
  the same approval.
- **It cannot triage what GitHub does not return.** Notifications are
  capped at 50 per page and issues at 100 per page. If your overnight
  volume is larger than that, the summary covers the first page only and
  the Operator should say so. `GITHUB_LIST_REPOSITORY_ISSUES` also
  returns pull requests mixed in with issues — the instructions tell the
  Operator to label them, but a repo with heavy PR traffic will dominate
  the list.
- **It does not watch GitHub continuously.** This guide is a morning
  summary, not a live feed. A mention that arrives at 10:00 waits until
  tomorrow's run unless you ask for triage in chat. If you want
  event-driven runs, that is an event routine (`create_event_routine`
  with a `GITHUB_PULL_REQUEST_EVENT` trigger) — a different guide.

## See also

- [Approval policy](approval-policy.md) — why listing runs free and
  commenting asks first.
- [Composio: xAI and connected apps](xai-and-composio.md) — the GitHub
  toolkit, managed OAuth, scopes, and the reconnect flow.
- [Your first PR](first-pr.md) — how to contribute a change like this one.
