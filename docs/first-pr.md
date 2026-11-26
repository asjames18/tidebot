# Your first PR to TideBot

> **Last verified:** 2026-11-26 · **Owner:** asjames18 (maintainer)

A complete, tiny example change carried from branch to merge — so a skilled
stranger can go from finding this repo to a merged pull request in one sitting.
If you already know GitHub flow, skip to [The worked example](#the-worked-example);
the rest of this page is the exact commands and checks this repo uses.

See also: [CONTRIBUTING.md](../CONTRIBUTING.md) (the rules this walkthrough
follows) · [AGENTS.md](../AGENTS.md) (the architectural map — read it before
touching server, web, or desktop code).

## Pick something small

Good first changes in this repo:

- A docs fix you spotted yourself — a stale model name, a broken link, a
  setup step that no longer matches the code.
- An issue labeled [`good first issue`](https://github.com/asjames18/tidebot/labels/good%20first%20issue)
  or [`help wanted`](https://github.com/asjames18/tidebot/labels/help%20wanted).
  (Heads-up, honest status as of 2026-11-26: both labels exist, but no open
  issue currently carries either one — the stocking work is still open. If
  the list is empty, a small docs fix you found yourself is a fine first PR,
  and filing the issue you fixed is welcome too.)
- A test for a failure mode you can reproduce with fixtures or mocks only —
  never a real model key, a live provider call, or a real account action.

One logical change per PR. If your fix touches two unrelated things, split it
into two PRs. Small PRs are reviewed and merged fastest here.

Questions that are not a code change go in
[GitHub Discussions](https://github.com/asjames18/tidebot/discussions), not
in a PR. Security issues go through the private path in
[SECURITY.md](../SECURITY.md) — never open a public issue for those.

## The worked example

The example below is a one-line docs fix: correcting a stale figure in a guide.
Substitute the change you actually made — the commands, the branch name, the
PR template, and the checks are the same for any small change.

### 1. Fork, clone, branch

You cannot push a branch directly to `asjames18/tidebot` unless you have write
access, so fork the repo on GitHub first, then clone **your fork**:

```bash
git clone https://github.com/<your-username>/tidebot.git
cd tidebot
git remote add upstream https://github.com/asjames18/tidebot.git
git fetch upstream
git checkout -b docs/fix-stale-figure upstream/main
```

Branch names here are `feat/<short-name>` for features, `fix/<short-name>`
for fixes, and `docs/<topic>` for documentation — see CONTRIBUTING.md.

### 2. Set up and make the change

```bash
npm install
cp .env.example .env   # add keys, or configure later in the web UI
```

Prerequisites: **Node.js ≥ 22.22.3** and npm. No other services are required —
data lives in a local SQLite database. The full setup, including every
environment variable, is in the README's
[Quick Start](../README.md#-quick-start).

Make your edit — one file, one idea. For this example, a single corrected
line in a docs guide. Then check `git status` shows only the file you meant
to change.

### 3. Run the verification checklist before every PR

```bash
npm run typecheck   # both server and web workspaces
npm run build       # production build must succeed
npm test            # node --test suites
```

All three must pass. If you touched the desktop app, also build it locally
(`npm run build` inside `desktop/`) and launch the packaged app at least once.
Do not open a PR with a red check you plan to fix later — the rule here is
no "merge now, fix CI later."

Never stage secrets, `.env` files, or SQLite `.db` files. If `git status`
shows one, unstage it and check `.gitignore` before going further.

### 4. Commit and push

```bash
git add docs/<the-guide-you-fixed>.md
git commit -m "docs: correct stale figure in <guide>"
git push -u origin docs/fix-stale-figure
```

Clear, imperative commit messages, e.g.
`fix(desktop): quote electron-builder config flag on Windows`.

### 5. Open the PR

Open the PR from your branch against `asjames18/tidebot:main`. GitHub shows
the repo's PR template — fill it in. For this example it looks like:

```markdown
## What does this PR change?

Corrects a stale figure in the Orgo builder guide (1,000+ → 1,500+ app
integrations, matching the README and the Composio catalog).

## How was it verified?

- [x] `npm run typecheck` passes
- [x] `npm run build` passes
- [x] `npm test` passes (or explains why it's skipped)
- [x] Tested manually in the browser/desktop (describe below)

Docs-only change; read the corrected line in the rendered guide. No
behavior change, no new tests needed.
```

Tick the checklist honestly — including the "no secrets, `.env` files or
SQLite `.db` files are staged" line and the "small, focused diff" line. If
your change fixes an issue, link it with `Fixes #123` so the issue closes
on merge.

Draft PRs are welcome while work is in progress; mark the PR ready for
review when the checks are green and the description is filled in.

## What happens after you open it

**CI runs on every PR to `main`.** The `CI` workflow has two jobs you will
see as checks:

- **Typecheck, build & test** — `npm run typecheck`, `npm run build`,
  `npm test` on Ubuntu with Node.js 22.22.3.
- **Self-hosted Compose smoke test** — builds the Docker Compose stack,
  creates an account, and verifies the account and data survive a restart.

A green tick on both is the baseline for review. If a job fails, click into
it, read the failing step's log, fix it on your branch, and push again — the
checks re-run automatically. (The desktop package verification workflow only
runs on maintainer branches and manual dispatch, so don't wait for it on a
fork PR.)

**Review sounds like this.** Reviewers here leave numbered findings with the
severity up front, e.g. a real review on PR #2:

> 1. REBASE NEEDED — `.github/workflows/desktop-qa.yml` is added on both
> sides … so it conflicts on merge.
> 2. Confirm [a specific default flip] is intended.
> 3. PR description still the template — needs what/why before review.

Expect questions before approval, especially "is this intended?" on behavior
changes and "how was this verified?" on anything user-facing. Answer in the
thread; if a finding is right, fix it with a new commit on the same branch
and say what changed. If you disagree, say why — a contested change is
decided by the maintainer, not by re-arguing in the thread.

**Merge is the maintainer's call.** Only the maintainer merges — do not merge
your own PR, even if the checks are green. When it merges, your commit lands
on `main` and the issue you linked closes automatically. By opening the PR
you agree your contribution is licensed under the project's
[MIT License](../LICENSE).

After merge, delete your branch (GitHub offers a button) and pull
`upstream/main` before starting the next change.
