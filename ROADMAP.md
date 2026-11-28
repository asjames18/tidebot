# TideBot roadmap

A public summary of where TideBot is headed and what is done. This is a living
document: update it when a phase closes, not when work merely starts. The
detailed plan behind it lives with the maintainers; this file is the version
contributors plan around.

**Last updated:** November 28, 2026. Development builds are prereleases
(`v1.0.0-dev.*`); there is no stable 1.0 yet.

## How to read this

- **Shipped** — on `main`, verified.
- **In progress** — work is underway, in draft pull requests or under review.
- **Not started** — planned, no work yet.
- **Blocked** — needs a maintainer decision before work can proceed.
- **Locked** — deliberately out of scope until its gate is explicitly passed.

Phases 1–6 run in parallel tracks but close in order: Phase 2 is not done while
Phase 1's stable release and signed builds are still missing, because a new
user's first install is where both phases meet.

## Phase 1 — Open-source foundation: make the public repo trustworthy

**Status: in progress.** TideBot is public under the MIT license with
`CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `AGENTS.md`, and
`THIRD_PARTY_NOTICES.md` in place. Issue templates (bug, feature, docs) and a
pull-request template are live.

- **Ship stable 1.0** (in progress) — cut `v1.0.0` as the first stable release;
  freeze a 1.0 scope in writing (what is in, what is explicitly out, linked
  from the release notes); publish full release notes with highlights,
  upgrade notes, known limitations, and SHA-256 checksums for every installer
  (Windows `.exe`, macOS arm64 + Intel `.dmg`, Linux `.AppImage` + `.deb`).
  Verify all five pinned assets download cleanly before announcing. Adopt
  semantic versioning and a `CHANGELOG.md` from 1.0 forward; every later
  release gets human-written notes, not just a version bump.
- **Sign the builds** (blocked) — Windows code-signing certificate and Apple
  Developer ID (sign + notarize both macOS builds) so SmartScreen and
  Gatekeeper stop warning. Needs a maintainer decision: certificates cost
  money and live outside the repo. Once signing lands, the bypass
  instructions come out of the README and landing page in the same release.
  The signing process is documented for maintainers (where certs live, how
  CI uses them, renewal dates) without ever committing a certificate or
  password.
- **Repo health** (in progress) — branch protection is on in its light form:
  force pushes and branch deletion are blocked, including for admins.
  Required status checks and a pull-request requirement are not yet enabled;
  turning them on is a maintainer call, since the landing-page loop commits
  directly to `main`. Dependabot runs weekly for npm dependencies. Still to
  decide and document, in one paragraph: the trademark / naming position —
  the code is MIT; what may forks call themselves?

**Closes when:** v1.0.0 stable is live with complete, checksummed assets;
Windows and macOS builds are signed; branch protection and CI are enforced on
`main`; and this roadmap is published (this file).

## Phase 2 — Self-host experience: make running it yourself effortless

**Status: in progress.** Two install paths work today: the desktop app
(one download, one install) and building from source (Node.js 22.22.3+).
The third path, containers, exists: a maintained `Dockerfile` + `compose.yml`, documented in [Self-host TideBot](docs/self-host.md) — cold-testing, a published image per release, and a "Run with Docker" README section are still to do.

- **Install paths** — desktop path: one download, one install, first launch
  opens the guided setup; test the full flow cold on Windows, macOS (both
  chips), and Linux, and time it. Target: under 10 minutes to first Operator.
  Source path: verify the README Quick Start verbatim on a clean machine and
  fix every step that needs tribal knowledge. Docker path (in progress): a maintained Dockerfile + `compose.yml` are on main with docs/self-host.md; still to do: cold-test on a clean machine, an image published per release, and a "Run with Docker" README section. Document minimum and
  recommended system requirements in the README and on the landing-page
  download section. Add a one-line health check reporting Node version,
  database writability, sandbox status, and which provider keys are
  configured — without printing the keys.
- **First-run and configuration** (in progress) — a guided first-run wizard
  in the web studio: (1) choose a model provider, (2) paste a key or point
  at Ollama, (3) test the connection live, (4) create a first Operator from
  a template, (5) run a sample task. Skippable, resumable, no account
  creation. Settings → Models stays as the full-power alternative, with keys
  saved in the UI and keys in `.env` kept in sync via hot-reload. Starter
  Operator templates (blocked — the picks are a maintainer decision) and a
  model cookbook of tested OpenRouter / Ollama / vLLM configurations by job.
  Every error on the setup path names the provider, the likely cause, and
  the next step — never a raw stack trace in the UI.
- **Updates, backup, and data ownership** (in progress) — desktop
  auto-update with a "What's new" view tied to `CHANGELOG.md`; a server
  self-host update guide (`git pull` + `npm install` + `npm run build` +
  restart, migrations automatic, pre-update backup by default); one-click
  export/backup of full local state (keys excluded by default, explicit
  opt-in warning) with a tested restore — an untested backup is a hope, not
  a feature; data locations documented (`data/grokbot.db`,
  `data/workspaces/<botId>/`) so an install can move to a new machine; an
  uninstall / clean-slate note per platform (see
  [`docs/self-host.md`](docs/self-host.md)).

**Closes when:** a cold tester on each OS reaches a working Operator via
desktop and via Docker without help; backup-and-restore has been demonstrated
end to end; and system requirements are published in the README and on the
site.

## Phase 3 — Core product: deepen what makes TideBot different

**Status: in progress.** Depth and reliability over new surface area; every
item is justified by a real user task, an issue, or a Discussion thread.

- **Operators and the agent loop** — harden the serial per-Operator turn
  queue under load (long tasks, interrupted turns, queued messages) with
  regression tests for each failure mode found; Operator templates v2
  (duplicate, export, import an Operator as a file — the unit contributors
  will share); multi-Operator rooms with visible delegation trails so a user
  can always answer "which agent did this, and why?"; memory quality pass —
  idle consolidation and history compaction get user-visible controls (view,
  edit, forget), so long-term memory never feels like a black box.
- **BYOM engine** — provider matrix kept current (OpenRouter, custom
  OpenAI-compatible, xAI) with a tested model list, per-Operator overrides,
  and graceful handling when a provider renames or retires a model; per-Operator
  / per-task token and cost visibility where the provider reports it; a
  documented, tested Ollama-only configuration that does useful work with no
  cloud key at all; reasoning drawer and telemetry kept fast and collapsible.
- **Tools, integrations, and routines** (in progress) — audit all 12+ built-in
  tools for consistent summaries, error states, and approval behavior;
  Composio marketplace depth on the toolkits people actually connect, with
  connection health ("this app needs reconnecting") and scoped-credential
  explanations in plain language; approval cards that show exactly what will
  happen, to which external system, with Allow Once / Always Allow / Deny —
  and Always Allow reviewable and revocable in Settings (see
  [`docs/approval-policy.md`](docs/approval-policy.md)); routines with run
  history, dry-run / test-fire, and failure notifications; Orgo cloud
  desktops with session lifecycle, cost-aware idle timeouts, and the noVNC
  Watch / Take Control flow tested end to end — local-only users never see
  Orgo-only tools.
- **Studio experience** — performance budget held (WebGL shaders capped,
  smooth transcript streaming, instant ⌘K search); accessibility pass
  (keyboard-only core flows, visible focus, contrast in both themes,
  screen-reader labels on approval cards); a presentable local activity /
  audit log view that exports cleanly.

**Closes when (reviewed monthly):** no P0 loop/sandbox bugs open, template
import/export shipped, routine run history shipped, and the Ollama-only
configuration documented and tested.

## Phase 4 — Contributor engine: open for people to build on it

**Status: in progress.** A skilled stranger should be able to go from finding
the repo to a merged pull request in a weekend, and want to come back.

- **On-ramps** — at least 10 good first issues stocked at all times, plus 5
  help wanted items; `CONTRIBUTING.md` verified end to end on a clean
  machine (setup, branch naming, verification checklist, desktop extra
  step), with the fresh-contributor setup time published; a "Your first PR"
  walkthrough with a real, tiny example change; `AGENTS.md` kept current
  with every architectural change.
- **Extension points** (in progress) — documented, worked examples for
  adding a built-in tool, adding an API endpoint, adding a model provider,
  and adding a WebGL shader preset, each ending in a runnable result; an
  Operator template gallery (in-repo folder + index, submissions by PR,
  curated monthly); a Composio playbook with two fully worked examples; the
  plugin boundary written down (what is stable API surface, what is internal,
  how breaking changes are announced); the extension docs dogfooded cold by
  someone who did not write them, friction filed as issues.
- **Review, recognition, and governance** — a public review service level
  (first response within 2 business days); contributors credited visibly
  (release notes by name, all-contributors section in the README);
  lightweight governance (who merges, how contested changes are decided,
  how merge rights are earned) linked from `CONTRIBUTING.md`; a monthly
  contributor update; secrets scanning in CI, a hard rule against committing
  `.env` / `.db` files, and dependency review for new packages.

**Closes when:** 10+ good first issues are stocked, the four extension
tutorials are published and cold-tested, the review SLA has held for a full
month, and at least three external contributors have merged PRs.

## Phase 5 — Quality, security, and trust

**Status: in progress.** TideBot agents execute code and call real business
apps with real credentials. That demands proof, not promises. The current
posture is strong — sandboxed workspaces, an approval firewall, model output
treated as untrusted, zero telemetry — and this phase makes each claim
testable.

- **Testing and release quality** — the full gate stays green on every merge
  (`npm run typecheck`, `npm run build`, `npm test`); end-to-end smoke tests
  for the five golden paths (fresh setup, first Operator task, Composio
  approval flow, routine firing, backup/restore), run against release
  candidates, not just `main`; a manual QA pass on the packaged desktop app
  for every stable release; a simple quality signal published in release
  notes (tests passing, known issues count, what was fixed).
- **Security** — sandbox proof: the Bubblewrap isolation check stays
  fail-closed (TideBot refuses unsandboxed shell execution) with a test
  proving refusal when isolation is unavailable; approval firewall audit
  re-verified against the current codebase and published as
  [`docs/approval-policy.md`](docs/approval-policy.md); secrets handling
  reviewed as one pass (`.env` hot-reload and atomic writes, UI key storage,
  log redaction, export-excludes-keys default); `SECURITY.md`'s private
  reporting path followed in practice; one external security review of the
  agent loop, sandbox, and approval model before the hosted gate (blocked —
  needs a maintainer budget decision); the prompt-injection stance documented
  for users — model output and fetched web content are untrusted data, with
  honest limits on what TideBot does about it.
- **Privacy** — the zero-telemetry promise stays literal: no analytics, no
  phone-home, no crash reporting that leaves the machine without explicit
  opt-in. A network-egress note in the docs lists every outbound call
  TideBot makes and why (model providers, Composio, Orgo, update checks). A
  privacy page on the landing site in plain language, linked from the footer,
  re-checked at every stable release.

**Closes when (ongoing, reviewed at every stable release):** golden-path
smoke tests run on release candidates, the approval/sandbox audit is
published, and the egress note matches the shipped code.

## Phase 6 — Docs, site, and community

**Status: in progress.** Docs for the app live here. The landing page
(`website/`) is owned by a separate loop — app work does not touch it, and
landing-page items below are that loop's lane.

- **Documentation** (in progress) — the docs set completed and cross-linked
  (Architecture, Local Models, Orgo guide, xAI + Composio guide), each with
  a last-verified date and an owner; task guides, not just reference
  ("Triage my GitHub inbox every morning", "Draft my follow-ups", "Watch a
  folder and summarize changes"); a troubleshooting guide built from real
  issues (SmartScreen/Gatekeeper until signing lands, Bubblewrap missing,
  provider key errors, Composio reconnects).
- **Landing page — close the proof gaps** (site loop's lane) — system
  requirements and per-platform notes at the download buttons; an FAQ
  (What does it cost? Where does my data go? What computer do I need? Is
  there a hosted version? Do I need to code?); one real demo video, a
  genuine task in the real studio, under 3 minutes; a proof strip with one
  concrete outcome per persona; a "What ships next" teaser linked to this
  roadmap; housekeeping (the Cloudflare "Always Use HTTPS" redirect, repo
  `website/` as source of truth, download pins verified complete before
  publishing).
- **Community and distribution** — GitHub Discussions tended weekly, with a
  monthly "what shipped / what's next" post; a show-and-tell channel for
  Operator templates and routines; launch moments planned, not improvised
  (stable 1.0 announcement, a Product Hunt / Hacker News–ready one-pager);
  "Built by Melanated in Tech" attribution kept consistent across site,
  repo, and app.

**Closes when:** FAQ + requirements are live on the download section, the
real demo is published, the HTTPS redirect is on, and Discussions show a
month of answered questions and one shipped community template.

## Phases 7–9 — Hosted TideBot: LOCKED

These phases are **not started and not to be started** by any contributor
loop. They unlock only after Phases 1–6 exit criteria pass **and** the
maintainer gives an explicit go.

- **Phase 7 — Hosted readiness gate:** a written go / no-go decision.
- **Phase 8 — Hosted build:** multi-tenant hosted TideBot on the same core.
  No tenancy, no billing/Stripe, no pricing work before the gate.
- **Phase 9 — Hosted launch & ops:** paid memberships, support, sustainable
  operations. No beta, no pre-sales before the gate.

## Contributing to the roadmap

If a phase's status above is wrong, or a phase's exit criteria have been met,
open a pull request against this file with the evidence. Small, verifiable
claims beat sweeping rewrites — same as the code.
