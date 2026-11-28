# Task guide: watch a folder and summarize changes

> **Last verified:** 2026-11-26 · **Owner:** asjames18 (maintainer)

An Operator that watches a folder and posts a summary of what changed — new
files, edited files, and deleted files — so you can keep an eye on a
drop-folder without opening it yourself.

This is one of the Phase 6.1 end-to-end task guides. It was written against
the shipped code: `list_files`, `read_file`, `save_file`,
`remember`/`recall`, and `create_routine` in `server/src/agent/tools.ts`,
the schedule rules in `server/src/routines.ts`, and the template flow in
`web/src/components/modals/CreateBotModal.tsx`.

## The rule first

There is no live file watcher. TideBot cannot push you a notice the moment
a file changes — there is no filesystem event trigger
(`list_event_triggers` only covers connected apps such as Gmail or Slack),
so the Operator checks on a schedule and compares what it sees against a
snapshot it remembered last time.

- `list_files` returns the top-level files in the bot's Library only — name,
  size, whether it is a folder, and `modifiedAt` (the file's modification
  time). Files inside subfolders are not listed, and hidden (dot-prefixed)
  files are skipped.
- `read_file` reads one file from the Library, first 40,000 characters only,
  and only files at the top level — it cannot open a file inside a
  subfolder.
- A routine runs at most every 15 minutes (`MIN_ROUTINE_INTERVAL_MS` in
  `server/src/routines.ts`), and a bot can have at most 25 routines. A
  change is therefore noticed at the next run after it happens, never
  instantly.
- `create_routine` asks for your approval before the schedule is created —
  see `docs/approval-policy.md`. The first run is your chance to check the
  schedule and the prompt before it goes live.

The watched folder is the bot's Library: `data/workspaces/<botId>/` next to
the database (see `docs/self-host.md`). Files get there three ways: the
Operator saves them with `save_file`, you create them in the Library tab
(Details panel → Library → new file), or you copy them straight into that
folder on disk. There is no upload button in the Library tab.

## Build it

Create a bot from the **Research** template (Atlas, Research Analyst). It
already carries the right stance for this job — "Lead with key findings and
sources. Use concise bullet points" — and you extend it into a watcher.

In the create modal, fill in:

- **Role label** (max 60 characters): `Folder Watcher`
- **Description** (max 500 characters): `Watches my Library folder on a
  schedule and summarizes what changed — new, edited, and deleted files.
  Reports only; it never edits the files it watches.`
- **Instructions** (max 8,000 characters) — paste this in, then make it
  yours:

```text
You watch the files in my Library and tell me what changed.

When I ask you to start watching, or when a routine run starts:
1. Call list_files to see the Library as it is right now.
2. Call recall with "folder snapshot" to find the snapshot you saved last
   time — the list of file names with their sizes and modified times.
3. Compare the two lists. New files, files whose size or modified time
   changed, and files that were in the snapshot but are gone now are all
   changes. If this is the first run and there is no snapshot yet, say so
   and save one — do not report every file as new.
4. For each new or edited file, call read_file and summarize what it is
   and what changed, in a few bullet points. Skip files you cannot read
   (folders, files over the 40,000-character read limit — say so and
   summarize from the name and size instead).
5. Post the summary in chat: what is new, what changed, what is gone.
   Lead with the most important change. If nothing changed, use
   stay_silent — no message is better than a "nothing happened" ping.
6. Save the new snapshot with remember, starting with the words "folder
   snapshot", listing each file with its size and modified time. This is
   what the next run compares against — do not skip it.

Rules:
- Never edit, rename, or delete a file in the Library. You report only.
- The Library listing is top-level only. Do not claim a subfolder is
  unchanged — you cannot see inside it with list_files. If I ask about a
  subfolder, say that plainly instead of guessing.
- A file that appeared and disappeared between two runs is one you never
  saw. Say that when I ask — do not pretend the record is complete.
```

- **Working mode:** Personal assistant. The Library belongs to one bot;
  a Teammate bot works in shared rooms instead.
- **Bot model:** leave it on Studio default unless you have a reason to
  change it.

Save the Operator, then tell it in chat to start watching — for example:

> Watch this folder every 30 minutes on weekdays and tell me what changed.

It will ask for your approval to create the routine (a 5-field cron
expression, e.g. `*/30 * * * *` for every 30 minutes, or
`0 8,12,17 * * 1-5` for 8:00, 12:00, and 17:00 on weekdays, in the timezone
you give it). Approve it, and the first run saves the baseline snapshot.

To check it is working: save a file into the Library (ask the Operator, or
create one in the Library tab), wait for the next run, and the summary
should name it. Then edit the file and delete another one — the following
run should report the edit and the deletion.

## What it can and cannot do when a change is missed

This is the honest part. The watcher compares snapshots; it does not keep
a log of every event. That shapes what "missed" means:

- **A missed run only delays detection.** If the server was down, the
  routine was disabled, or the model call failed, the next run still sees
  every file that is still different from the snapshot. The summary arrives
  late, not wrong.
- **A file created and deleted between two runs is never seen.** Nothing
  in the snapshot ever recorded it, and no event fired when it appeared.
  If you need a complete record, the polling watcher is the wrong tool —
  say so rather than claiming coverage you do not have.
- **A file changed twice between runs shows only its latest state.** The
  Operator summarizes the current content, not the intermediate version.
  The same applies to a file edited and then restored: if size and
  modification time match the snapshot again, the round trip is invisible.
- **Modification time is the only change signal.** A file whose content
  changed but whose modification time was preserved (for example copied
  with timestamps kept) looks unchanged and is missed. A file whose
  modification time was touched without changing the content (`touch`)
  looks changed and is reported as a false positive.
- **Subfolders are blind spots.** `list_files` lists the top level only
  and `read_file` cannot open a file inside a subfolder. The Operator can
  look deeper with the `shell` tool (`ls -R` in the workspace), but that
  asks for your approval on every run and is not part of this guide's
  routine — treat anything inside a subfolder as unwatched unless you
  set that up separately.
- **Large files are summarized from the outside.** `read_file` stops at
  40,000 characters, so a big file's summary covers its beginning only.
  The guide's instructions tell the Operator to say so rather than
  present a partial read as the whole file.
- **A lost snapshot means re-baselining.** The snapshot lives in
  `remember`/`recall`, which is a keyword search returning at most 20
  memories. If the snapshot memory is deleted or the Operator cannot
  find it, the next run treats everything as new — the fix is to tell it
  to save a fresh baseline, not to trust that first noisy summary.

If any of these limits matter for your folder — for example you need to
catch every version of a file, or watch a nested folder — do not stretch
this guide to cover it. The watcher is a periodic summary, not an audit
log.
