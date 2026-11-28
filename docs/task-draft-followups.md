# Task guide: draft my follow-ups

> **Last verified:** 2026-11-26 · **Owner:** asjames18 (maintainer)

An Operator that drafts follow-up messages from your recent conversations and
open tasks — so nobody you owe a reply to slips through the week. It drafts
only. Nothing is ever sent without your approval.

This is one of the Phase 6.1 end-to-end task guides. It was written against
the shipped code: `draft_message`, `ask_user`, `remember`/`recall`, and
`create_task`/`update_task` in `server/src/agent/tools.ts`, and the template
flow in `web/src/components/modals/CreateBotModal.tsx`.

## The rule first

`draft_message` only presents a draft card in the chat. It cannot send
anything on its own — see `docs/approval-policy.md`:

> `draft_message` | allow | Shows the user a draft card. Nothing is sent
> until the user sends it.

Each draft card shows the channel, the recipient, the subject (email), and
the full text, with three actions: **Copy**, **Discard**, and **Send**.

- **Send** marks the card sent and hands the approved draft back to the
  Operator with a note to proceed — the Operator then sends it through the
  connected app (Gmail or Slack via Composio). If that app is not connected,
  the Operator asks you to connect it first, or you just copy the text and
  send it yourself.
- **Discard** throws the draft away. Nothing was sent.
- **Copy** puts the text on your clipboard so you can paste it anywhere.

If an Operator ever offers to send a follow-up without showing you a draft
card first, say no — that is not how this guide works, and it is not how
`draft_message` behaves.

## Build it

Create a bot from the **Inbox & Calendar** template (Clara, Executive
Assistant, Personal assistant mode). It already carries the right stance —
"Always ask before sending external emails or rescheduling meetings" — and
you extend it for follow-ups.

In the create modal, fill in:

- **Role label** (max 60 characters): `Follow-up Assistant`
- **Description** (max 500 characters): `Drafts follow-up messages from
  recent conversations and open tasks. Drafts only — nothing is sent without
  your approval.`
- **Instructions** (max 8,000 characters) — paste this in, then make it
  yours:

```text
You draft follow-up messages from my recent conversations and open tasks.

When I ask for follow-ups:
1. Look back over our recent conversations and the tasks you have created
   for me. Work out who I owe a reply to, what I promised, and what has
   gone quiet.
2. If anything is unclear — who the message is for, which channel, how
   firm the tone should be — ask me with a short multiple-choice question
   before drafting. Do not guess the recipient.
3. Draft one message per person with draft_message (channel email, slack,
   or message). Keep each draft short, warm, and specific: name the thing
   we talked about, the next step, and a date if one was agreed.
4. Never send anything yourself. Every draft goes through the draft card
   in the chat, and I approve, copy, or discard each one.
5. When I approve a batch, mark the matching tasks done with update_task.

Remember lasting preferences with the remember tool — for example, how I
like to sign off, or people I always want a gentler tone with — so future
follow-ups match without me repeating myself.
```

- **Working mode:** Personal assistant. Follow-ups are your conversations;
  a Teammate bot works in shared rooms instead.
- **Bot model:** leave it on Studio default unless you have a reason to
  change it.

Save the Operator, then tell it something durable in chat, for example:
"Remember: I sign off work emails with 'Best, Antonio' and I never chase
anyone more than twice." It stores that with `remember`, and future
follow-ups use it without being asked again.

## Use it

Copy-pasteable prompts that work as written:

```text
Draft follow-ups for everyone I owe a reply to from this week.
```

```text
Who did I promise something to that I haven't sent yet? Draft one
follow-up per person, email where you can, message otherwise.
```

```text
Draft a short check-in to Maya about the proposal — friendly, no pressure,
and ask if Thursday still works.
```

What happens next, step by step:

1. The Operator re-reads your recent conversation history with it, searches
   its saved memories with `recall`, and looks at the tasks it has created
   for you. It consolidates durable facts into memory after conversations
   go idle, so preferences from last week are still there.
2. If the recipient or channel is ambiguous it asks first, with
   `ask_user` — a short multiple-choice question card, at most six options.
   Answering it is a normal chat message; the Operator continues from there.
3. One draft card appears per message. Review each one in the chat: **Copy**
   it, **Discard** it, or **Send** it (which hands the approved draft back
   to the Operator to send through the connected app).
4. Say "mark those done" and the Operator closes the matching tasks with
   `update_task` (state `done`).

## What it cannot do

- **It cannot see tasks another Operator created.** Tasks belong to the bot
  that created them. If a follow-up lives with a different Operator, ask
  that Operator, or tell this one about it in chat first.
- **It cannot read your email or Slack directly.** It works from what you
  told it in chat, its memories, and its tasks. If a thread lives only in
  Gmail, paste the relevant part into the chat (or connect Gmail via
  Composio and ask it to check — it will ask you to connect the app first).
- **It cannot send without a connected app.** The draft card's Send button
  approves the draft; the actual send goes through Gmail/Slack via
  Composio. No connection, no send — copy the text instead.
- **It does not chase people on its own.** There is no background
  follow-up job here. You ask, it drafts, you approve. If you want
  scheduled nudges, that is a routine (`create_routine`) — a different
  guide.

## See also

- [Approval policy](approval-policy.md) — what `draft_message` may and may
  not do.
- [Your first PR](first-pr.md) — how to contribute a change like this one.
- [Add a built-in tool](extend-add-tool.md) — how `draft_message` itself is
  implemented, if you want to extend what an Operator can draft with.
