# TideBot Roadmap

TideBot is a self-hosted, open-source autonomous multi-agent studio: bring your own
model, connect the apps you already use, and supervise Operators while they do real
work. Every key, file, and log stays on your machine. There is no TideBot account
required to run it, no telemetry sent to Melanated in Tech, and no markup on your
model tokens.

This is the public summary of the full development plan. It says what is done,
what is next, and what is deliberately locked — so contributors plan around visible
priorities instead of guessing. Update this file when a phase closes; do not let it
go stale.

**Status as of November 25, 2026:** the app is live as a prerelease chain
(latest: `v1.0.0-dev.78`). There is **no stable 1.0 yet** and builds are
**unsigned**. Self-hosting works today via the desktop app, Docker, or building
from source.

Built by [Melanated in Tech](https://melanatedintech.com) · Repo:
[github.com/asjames18/tidebot](https://github.com/asjames18/tidebot) · Site:
[tidebot.melanatedintech.com](https://tidebot.melanatedintech.com)

## How to read this

- **Done** — shipped on `main` and verified.
- **In progress** — work is underway; see the linked PR or issue.
- **Not started** — planned, no work yet.
- **Blocked** — needs a decision or spend only the project owner can make.
- **Locked** — does not start until the Phase 7 gate passes.

Phases run in order and close in order: Phase 1 first, then 2, and so on. Phases
1–6 are the current work. Phases 7–9 are the hosted version and stay locked.

## Phase 1 — Open-source foundation

*Make the public repo trustworthy. Currently in progress.*

- [x] MIT license, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`,
      `THIRD_PARTY_NOTICES.md`, and `AGENTS.md` in place.
- [x] Issue templates (bug, feature) and a pull-request template.
- [ ] **Stable 1.0** — cut `v1.0.0` as the first stable (non-prerelease) release
      with complete, checksummed assets for all five installers
      (Windows `.exe`, macOS arm64 + Intel `.dmg`, Linux `.AppImage` + `.deb`),
      human-written release notes, and a `CHANGELOG.md` from 1.0 forward.
- [ ] **Signed builds** — Windows code-signing certificate and Apple Developer
      ID, so SmartScreen and Gatekeeper stop showing unknown-publisher warnings.
      Blocked: needs the owner's decision to buy the certificates.
- [ ] **Branch protection on `main`** — CI must pass (typecheck + build + test
      on Linux, macOS, Windows), no direct pushes, no force pushes.
      Not enabled yet (checked November 25, 2026).
- [ ] **Dependabot** (or equivalent) for npm dependencies, weekly cadence,
      with a maintainer rota so its PRs do not pile up.
- [x] **Public roadmap** — this file.
- [ ] Trademark / naming position in one paragraph: the code is MIT; what may
      forks call themselves?

**Phase 1 closes when:** stable 1.0 is live with complete, checksummed assets;
Windows and macOS builds are signed; branch protection and CI are enforced on
`main`; and this roadmap is published.

## Phase 2 — Self-host experience

*Make running it yourself effortless. In progress.*

- [x] Desktop install path (Windows, macOS arm64 + Intel, Linux) with
      auto-update; source path (clone, `npm install`, `npm start`).
- [x] Docker path started: `Dockerfile` + `compose.yml` in the repo.
- [ ] **First-run wizard** in the web studio: pick a model provider, paste a
      key or point at Ollama, test the connection live, create a first Operator
      from a template, run a sample task. Skippable, resumable, no account.
- [ ] **Starter Operator templates** (4–6: e.g. Chief of Staff, Inbox Triage,
      Repo Watcher, Researcher, Content Drafter) that work with only an
      OpenRouter key. Template picks need the owner's decision.
- [ ] **Model cookbook**: tested OpenRouter / Ollama / vLLM configurations by
      job, with exact model IDs and known limits.
- [ ] **Health check** (`npm run doctor` or richer `/api/health`): Node
      version, database writability, sandbox status, which provider keys are
      configured — without printing the keys. Today `/api/health` only answers
      `{ ok: true }`.
- [ ] **Backup / export / restore**: one-click export of local state (keys
      excluded by default) with a tested restore, and a server self-host update
      guide with automatic migrations and a pre-update backup.
- [ ] System requirements (OS versions, RAM, disk, Node version, Bubblewrap
      requirement for local shell on Linux) published in the README.

**Phase 2 closes when:** a cold tester on each OS reaches a working Operator via
desktop and via Docker without help; backup-and-restore is demonstrated end to
end; and system requirements are published.

## Phase 3 — Core product depth

*Deepen what makes TideBot different. Ongoing.*

- [x] Desktop chat/phone simplification and the macOS updater fix (PR #7,
      merged November 25, 2026); follow-ups in flight as draft PRs #8–#10
      (macOS publish resilience, template-field preservation, details-panel
      focus return).
- [ ] Harden the serial per-Operator turn queue under load (long tasks,
      interrupted turns, queued messages) with regression tests.
- [ ] Operator templates v2: duplicate, export, and import an Operator as a
      file.
- [ ] Multi-Operator rooms: visible delegation trails for handoffs and
      subagents.
- [ ] Memory quality pass: user-visible controls for idle consolidation and
      history compaction (view, edit, forget).
- [ ] Cost visibility: per-Operator and per-task token / cost estimates where
      the provider reports them.
- [ ] Routines: run history, dry-run / test-fire button, failure notifications.
- [ ] Approval firewall UX: approval cards show exactly what will happen, to
      which external system, with Allow Once / Always Allow / Deny — and Always
      Allow is reviewable and revocable in Settings.
- [ ] Accessibility pass: keyboard-only completion of the core flows, visible
      focus, contrast in both themes, screen-reader labels on approval cards.
- [ ] Ollama-only configuration documented and tested — useful work with no
      cloud key at all.

**Phase 3 is reviewed monthly:** no P0 loop/sandbox bugs open, template
import/export shipped, routine run history shipped, Ollama-only configuration
documented and tested.

## Phase 4 — Contributor engine

*Open for people to build on it. Not started yet.*

- [ ] Label and stock at least 10 good first issues at all times, plus 5 help
      wanted items for experienced contributors.
- [ ] Verify `CONTRIBUTING.md` end to end on a clean machine and publish the
      fresh-contributor setup time.
- [ ] Four extension tutorials, each ending in a runnable result: adding a
      built-in tool, adding an API endpoint, adding a model provider, adding a
      WebGL shader preset — then cold-tested by someone who did not write them.
- [ ] Operator template gallery (in-repo folder + index); contributors submit
      templates by PR, curated monthly.
- [ ] Review service level: first response on a PR or issue within 2 business
      days, stated publicly and held for a full month.
- [ ] Secrets scanning in CI and dependency review for new packages.
- [ ] Lightweight governance in writing: who merges, how contested changes
      are decided, how a contributor earns merge rights.

**Phase 4 closes when:** 10+ good first issues are stocked, the four extension
tutorials are published and cold-tested, the review SLA has held for a full
month, and at least three external contributors have merged PRs.

## Phase 5 — Quality, security, and trust

*Proof, not promises. Ongoing.*

- [x] Sandboxed workspaces (Bubblewrap isolation, fail-closed), approval
      firewall for state-changing actions, model output treated as untrusted,
      zero telemetry.
- [ ] Golden-path smoke tests for the five core flows (fresh setup, first
      Operator task, Composio approval flow, routine firing, backup/restore),
      run against release candidates.
- [ ] Sandbox proof: a test that proves TideBot refuses unsandboxed shell
      execution when isolation is unavailable.
- [ ] Approval firewall audit published: the read vs. state-changing
      classification for Composio tools and default-approval tools, as a policy
      table in the docs.
- [ ] Secrets handling review as one pass: `.env` hot-reload and atomic writes,
      UI key storage, log redaction, export-excludes-keys default.
- [ ] Network-egress note in the docs listing every outbound call TideBot makes
      and why (model providers, Composio, Orgo, update checks) — the
      zero-telemetry promise, kept literal.
- [ ] Prompt-injection stance documented for users: what TideBot does about
      untrusted model output and fetched web content, and what remains the
      operator's responsibility.
- [ ] External security review of the agent loop, sandbox, and approval model
      before the hosted gate. Blocked: needs the owner's approval and budget.

**Phase 5 is reviewed at every stable release:** golden-path smoke tests run on
release candidates, the approval/sandbox audit is published, and the egress
note matches the shipped code.

## Phase 6 — Documentation, landing page, and community

*Turn attention into installs. In progress.*

- [x] Docs set in `docs/`: Architecture, Local Models (Ollama/vLLM), Orgo
      guide, xAI + Composio guide.
- [ ] Task guides, not just reference: end-to-end recipes ("Triage my GitHub
      inbox every morning", "Draft my follow-ups", "Watch a folder and
      summarize changes").
- [ ] Troubleshooting guide built from real issues: SmartScreen/Gatekeeper
      (until signing lands), Bubblewrap missing, provider key errors,
      Composio reconnects.
- [ ] Landing-page proof gaps (owned by the site loop, not this roadmap's
      work): FAQ, system requirements at the download buttons, HTTPS redirect,
      one real demo video of a genuine task start to approval to result.
- [ ] GitHub Discussions tended weekly; a monthly "what shipped / what's next"
      post.
- [ ] One community template shipped via the Phase 4 gallery.

**Phase 6 closes when:** FAQ + requirements are live on the download section,
the real demo is published, the HTTPS redirect is on, and Discussions show a
month of answered questions and one shipped community template.

## Phases 7–9 — Hosted TideBot (locked)

The hosted version — Melanated in Tech running TideBot for a membership /
subscription fee — does **not** start until the Phase 7 readiness gate passes
and the owner gives an explicit go. Until then: no tenancy, no billing, no
pricing page, no beta, no pre-sales. The waitlist keeps collecting emails;
that is all.

The gate requires: stable 1.0 shipped and signed, self-host exits met, support
load understood (top 20 real user issues documented), external security review
complete with no unresolved critical/high findings, a real demand signal
(waitlist, downloads, stars, and at least 10 structured interviews), honest
unit economics, and a named operator for hosted support.

A separate 30-day validation gate also applies to the app itself: the owner
dogfoods TideBot daily as his own agent, and on December 25, 2026 the call is
whether real outside users are self-hosting. If it is only him using it, app
work parks.
