# Contributing to TideBot

Thanks for helping make TideBot better! This guide covers what you need to know to contribute confidently. For the architectural map and invariants the codebase relies on, read [AGENTS.md](AGENTS.md) first — it explains how the server, web studio, and desktop app fit together. New here? Start with the [Your first PR walkthrough](docs/first-pr.md), which carries one tiny example change from branch to merge.

## Ways to contribute

- **Code**: bug fixes, new Operator tools, provider integrations, desktop packaging improvements.
- **Docs**: clearer setup steps, model cookbook entries (OpenRouter / Ollama / vLLM configs that work), architecture diagrams.
- **Extensions**: step-by-step tutorials in `docs/` — start with [Add a built-in tool](docs/extend-add-tool.md).
- **UI/UX**: shader presets, keyboard flow improvements, accessibility.
- **Triage**: reproducing issues, confirming fixes, labeling.

## Development setup

Prerequisites: **Node.js ≥ 22.22.3** and npm. No other services required — data lives in a local SQLite database.

```bash
git clone https://github.com/asjames18/tidebot.git
cd tidebot
npm install
cp .env.example .env   # add keys, or configure later in the web UI
npm run dev -w server  # Terminal 1 — http://localhost:8787
npm run dev -w web     # Terminal 2 — http://localhost:5173
```

The full walkthrough, including every environment variable, is in the README's [Quick Start](README.md#-quick-start).

## Branching & commits

- Branch from `main`: `feat/<short-name>` for features, `fix/<short-name>` for fixes, `docs/<topic>` for documentation.
- Keep commits focused; use clear, imperative messages (e.g. `fix(desktop): quote electron-builder config flag on Windows`).

## Verification checklist (run before every PR)

```bash
npm run typecheck   # both server and web workspaces
npm run build       # production build must succeed
npm test            # node --test suites
```

If you touched the desktop app: build it locally (`npm run build` inside `desktop/`) and launch the packaged app at least once.

### Known local-only test skips

Two tests skip cleanly in environments where they cannot pass, by design — do not chase them as failures:

- `tests/env-persist.test.mjs` skips its read-only-directory test when run as root (the `isRoot` check): root bypasses read-only directory permissions, so the failure the test guards against cannot reproduce there.
- `tests/desktop-git-review.test.mjs` skips its content-filter test when the sandbox's git wrapper (`hatch-git`) is on `PATH`: the wrapper strips filter config before git reads it, so a filter set in a fixture can never be observed by the guard under test.

Both skips are detected at runtime; the rest of each file still runs. If you see either skip in a local run, that is expected — not a regression.

## Pull requests

1. Fill in the PR template (what changed, why, how to verify).
2. Ensure CI is green — the release workflow builds Linux, macOS, and Windows on every push to `main`.
3. Never commit secrets, `.env` files, or SQLite `.db` files. The `.env.example` file documents every supported variable.
4. Small PRs win: one logical change per PR is reviewed and merged fastest.

## Reporting bugs

Open a GitHub issue and include: TideBot version (or commit), OS, what you expected vs. what happened, and console/server logs with any secrets redacted. For security issues, see [SECURITY.md](SECURITY.md) — please don't open public issues for those.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE) that covers the project.
