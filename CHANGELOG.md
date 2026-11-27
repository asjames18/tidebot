# Changelog

All notable changes to TideBot are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
from 1.0 forward: every stable release gets human-written notes here, not just
a version bump, and every installer ships with a SHA-256 checksum
(see the [releases page](https://github.com/asjames18/tidebot/releases)).

> **Status: no stable 1.0.0 yet.** Development builds are published
> automatically on every push to `main` as prereleases (`v1.0.0-dev.N`).
> This changelog starts with the 1.0 development line: the
> `[Unreleased]` section below covers work merged since the development-plan
> baseline (November 25, 2026). Earlier history lives in the git log and the
> dev prerelease notes. When stable 1.0.0 is cut, this section becomes its
> release entry, dated, with the freeze scope linked from the release notes.

Contributors: update this file in the same pull request as any user-visible
behavior change. One line per change, grouped under `Added`, `Changed`,
`Fixed`, or `Security`, with the pull-request number.

## [Unreleased]

### Added

- Model cookbook with tested OpenRouter / Ollama / vLLM configurations by job
  (coding, research, reasoning, free-tier starter), each with exact model IDs
  and known limits (`docs/model-cookbook.md`) ([#41](https://github.com/asjames18/tidebot/pull/41)).
- Four extension tutorials, each ending in a runnable result: add a built-in
  tool ([#28](https://github.com/asjames18/tidebot/pull/28)), add an API
  endpoint ([#29](https://github.com/asjames18/tidebot/pull/29)), add a model
  provider ([#30](https://github.com/asjames18/tidebot/pull/30)), and add a
  WebGL shader preset ([#31](https://github.com/asjames18/tidebot/pull/31)).
- "Your first PR" walkthrough carrying a real, tiny example change from
  branch to merge, including what CI feedback looks like
  ([#27](https://github.com/asjames18/tidebot/pull/27)).
- Approval firewall audit published as a policy table
  (`docs/approval-policy.md`), with regression tests pinning the read vs.
  state-changing classification
  ([#33](https://github.com/asjames18/tidebot/pull/33)).
- Secrets-handling review published (`docs/secrets-handling.md`): `.env`
  hot-reload and atomic writes, UI key storage, log redaction, and the
  export-excludes-keys default, reviewed as one pass
  ([#37](https://github.com/asjames18/tidebot/pull/37)).
- Central `redactSecrets` log helper, with the four flagged log sites routed
  through it so keys never reach the logs
  ([#38](https://github.com/asjames18/tidebot/pull/38)).
- Regression tests pinning the `studioAdmin` gate on the Composio/Orgo admin
  routes ([#39](https://github.com/asjames18/tidebot/pull/39)).
- Details badge: active runs and pending approvals stay visible from chat
  ([#57](https://github.com/asjames18/tidebot/pull/57), closes
  part of [#5](https://github.com/asjames18/tidebot/issues/5)).
- Sidebar per-bot pending-approval counts
  ([#58](https://github.com/asjames18/tidebot/pull/58), closes
  part of [#5](https://github.com/asjames18/tidebot/issues/5)).
- System requirements (OS versions, RAM, disk, Node version, Bubblewrap
  requirement on Linux) published in the README
  ([#13](https://github.com/asjames18/tidebot/pull/13)).
- Governance docs linked from the README
  ([#14](https://github.com/asjames18/tidebot/pull/14)).

### Changed

- Dependabot now runs on a weekly cadence for npm dependencies
  ([#18](https://github.com/asjames18/tidebot/pull/18)).
- The two local-only test failures are skipped cleanly instead of failing
  outside their environment
  ([#32](https://github.com/asjames18/tidebot/pull/32)).

### Fixed

- A corrupt `.secret-key` file now fails loudly instead of silently
  orphaning encrypted keys
  ([#59](https://github.com/asjames18/tidebot/pull/59), closes
  [#36](https://github.com/asjames18/tidebot/issues/36)).
- GrokBot naming cleanup across the codebase
  ([#25](https://github.com/asjames18/tidebot/pull/25)).
- Sandbox probe refusal behavior
  ([#26](https://github.com/asjames18/tidebot/pull/26)).
