# Changelog

All notable changes to TideBot are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
from the 1.0.0 stable release forward. Until that stable release is cut,
releases are `1.0.0-dev.N` prereleases published on every push to `main`;
every release from 1.0.0 on gets human-written notes here, not just a version bump.

Contributors: update this file in the same pull request as any user-visible
behavior change. One line per change, grouped under `Added`, `Changed`,
`Fixed`, or `Security`, with the pull-request number.

## [Unreleased]

### Added

- Docker self-host path: `Dockerfile`, `docker-compose.yml`, and `.dockerignore`
  with a persistent `tidebot-data` volume, plus `docs/self-host.md` (#3).
- Desktop auto-update controls, with a manual-download fallback when a Mac
  build cannot install; the Mac updater no longer loops on "Reconnecting" (#7).
- Agent environment setup: Operators can declare the setup a workspace needs
  before their first run (#88).
- Model cookbook (`docs/model-cookbook.md`): tested OpenRouter / Ollama / vLLM
  configurations by job, with exact model IDs
  ([#41](https://github.com/asjames18/tidebot/pull/41)).
- Issue templates (bug, feature, docs) and a pull-request template
  (`.github/ISSUE_TEMPLATE/`, `.github/PULL_REQUEST_TEMPLATE.md`).
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

- Restored 20 merged pull requests accidentally overwritten by the #122 merge
  commit, including the desktop Details-panel focus return and the
  create-Operator template-preservation fixes (#138).
- Secrets keys persist across restarts instead of being lost when the server
  reloads its environment (#133, #127).
- History repair and memory consolidation hardening for long conversations
  (#132, #126).
- Voice, VNC relay, workspace, subagent, rooms, and retry hardening: error
  logs redacted, call ownership enforced, workspace symlinks contained,
  subagent/model ownership aligned, and retry/abort headers handled
  (#124, #123, #117, #115, #114, #112, #111, #110).
- Approval cards are keyboard-navigable with visible focus and
  screen-reader labels (#93).
- README Quick Start verified verbatim against a clean checkout (#106).
- A corrupt `.secret-key` file now fails loudly instead of silently
  orphaning encrypted keys
  ([#59](https://github.com/asjames18/tidebot/pull/59), closes
  [#36](https://github.com/asjames18/tidebot/issues/36)).
- GrokBot naming cleanup across the codebase
  ([#25](https://github.com/asjames18/tidebot/pull/25)).
- Sandbox probe refusal behavior
  ([#26](https://github.com/asjames18/tidebot/pull/26)).

### Security

- Voice and computer-use paths: STT languages normalized, error logs
  redacted, and call ownership enforced (#124, #123).
