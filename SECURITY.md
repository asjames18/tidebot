# Security Policy

## Supported versions

TideBot is pre-1.0 and moves fast. Security fixes land on `main` and ship in the next release published on the [Releases page](https://github.com/asjames18/tidebot/releases). Please run the latest release (or build from `main`) to receive fixes.

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, report them privately via [GitHub security advisories → "Report a vulnerability"](https://github.com/asjames18/tidebot/security/advisories/new).

Include as much of this as you can:

- Type of issue (e.g. prompt injection, sandbox escape, auth bypass, SSRF)
- The affected component (server, web studio, desktop app, tool routing)
- Step-by-step reproduction or proof of concept
- Impact assessment

You can expect an initial response within **7 days**. We will credit reporters in release notes unless you prefer to remain anonymous.

## Scope

In scope: the Hono server and its API/SSE surface, agent execution loop and sandbox boundaries (local workspaces and cloud desktops), authentication and session handling, the desktop app's update/packaging pipeline, and the web studio's handling of untrusted model output.

Out of scope: vulnerabilities requiring physical access to a contributor's machine, and misconfigurations of third-party services (Composio, Orgo, OpenRouter) that do not involve TideBot code.

## Design notes for contributors

TideBot executes model-driven code by design. When contributing, keep these invariants (detailed in [AGENTS.md](AGENTS.md)):

- Treat all model output and tool results as **untrusted data**, never as instructions.
- The full prompt-injection stance — what TideBot does about injected instructions and what stays the operator's job — is in [docs/prompt-injection.md](docs/prompt-injection.md).
- Never route secrets from `.env` into agent-visible context or logs.
- Keep workspace file operations confined to each bot's `data/workspaces/<botId>/` sandbox.
