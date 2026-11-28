# TideBot governance

One page: who decides what, and how that changes as the project grows.
Linked from [CONTRIBUTING.md](CONTRIBUTING.md).

> **Last verified:** 2026-11-26 · **Owner:** asjames18 (maintainer)

## Who merges

**Antonio James ([@asjames18](https://github.com/asjames18)) is the sole
maintainer today, and the only person who merges.** Every change lands
through a pull request with CI green (`npm run typecheck`, `npm run build`,
`npm test`) and maintainer review. Nobody merges their own PR — including
the maintainer's own agent-written work, which goes through draft PRs the
maintainer reviews and merges.

Branch protection is **not enabled** on `main` as of 2026-11-26, so this
rule currently runs on maintainer discipline, not on GitHub enforcement.
Turning protection on is a maintainer decision: the landing-page loop
commits directly to `main` for `website/`, so any rule has to keep that
path working.

## How a contested change is decided

1. Discuss it on the PR or issue, in the open, with the trade-offs stated.
2. If the discussion doesn't converge, the maintainer decides and records
   the decision on the PR — including when the decision is "no" or "not
   yet". A recorded "no" is a decision, not a dismissal: it can be
   revisited when the facts change.
3. Safety and security concerns can veto a change outright. A change that
   weakens the sandbox, the approval firewall, or secrets handling does
   not merge on a majority vote — see [SECURITY.md](SECURITY.md), and
   report security issues privately, never as a public issue.

There is no vote-counting. Reviewers' approvals are advice to the
maintainer, not a merge threshold.

## How a contributor earns merge rights

Merge rights are earned, not claimed, and granted by the maintainer:

- A track record of merged PRs that hold up — small, focused, verified
  changes, not one big splash.
- Useful reviews of other people's PRs and help with triage (reproducing
  issues, confirming fixes).
- Good judgement on the project's hard lines: no secrets in commits, no
  weakening of the sandbox or approval firewall, docs updated with
  behaviour changes.

Merge rights mean merging *other people's* approved PRs, never your own,
and never merging over a maintainer objection. The maintainer can revoke
merge rights at any time, and says so on the record when it happens. As
of 2026-11-26 no contributor outside the maintainer holds merge rights —
the two PRs merged so far (#3, #7) were both merged by the maintainer.

## Credit

Contributors are named in the release notes for the release their work
ships in. An all-contributors section in the README is planned; it does
not exist yet.

## What is not decided yet

- **Review service level:** no response-time promise is published yet.
  Setting one is a maintainer staffing decision — it is not claimed here.
- **Monthly contributor update:** planned (a Discussion thread: what
  shipped, what is next, which `help wanted` items matter most). Not
  running yet.

## Changing this document

Changes to governance go through a PR like anything else, and land only
by maintainer decision. If this page and the project's practice ever
disagree, the practice is the bug — file an issue.
