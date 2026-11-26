# Network egress: every call TideBot makes off your machine

TideBot is local-first and makes **no analytics, crash-reporting, or
telemetry calls**. Nothing phones home. The table below is the complete list
of outbound network calls the shipped code makes, what each one sends, and
how to avoid it. If a call is not listed here, the code does not make it.

Last verified: 2026-11-26, against main `aa2c668`. Re-check this page at
every stable release — a new integration must add its row here first.

## What never leaves the machine

- The SQLite database (`data/grokbot.db`), workspaces, Library files, and
  settings stay on your computer. Keys are stored locally (`.env` or the
  Settings store) and are never printed in logs or diagnostics — `npm run
  doctor` reports only whether each key is configured, never its value.
- The web studio talks only to your own TideBot server (relative `/api`
  calls). It loads no fonts, scripts, or trackers from a CDN.
- No analytics, crash-reporting, or telemetry endpoints were found in the
  code at this revision (`server/src`, `web/src`, `desktop/`).

## Outbound calls

| Destination | When it happens | What is sent | How to avoid it |
|---|---|---|---|
| `https://openrouter.ai/api/v1` | Every model call while the provider is OpenRouter (the default). | Your prompts, the model ID, and your OpenRouter key. | Switch provider to xAI or a local model in Settings → Models. |
| `https://openrouter.ai/api/v1/models` | When the studio lists available models; cached 10 minutes, fails soft to the built-in curated list. | No key, no prompts — just a model-catalog fetch. | Use the curated list; the call never blocks the app. |
| `https://api.x.ai/v1` | Every model call while the provider is xAI; also voice sessions/STT and memory compaction when xAI is the provider. | Your prompts / voice audio, the model ID, and your xAI key. | Switch provider to OpenRouter or a local model. |
| Your custom provider URL (default `http://localhost:11434/v1`, i.e. Ollama) | Every model call while the provider is Custom. | Your prompts and the key you configured, to the host you entered. | Point it at a local Ollama instance and nothing leaves the machine at all. |
| `https://api.composio.dev` (Composio SDK) and `https://backend.composio.dev/api/v3.1` (Composio REST) | Only when a Composio key is configured: listing connections, running a connected app's tool, starting an OAuth connect. | Your Composio key and the tool arguments for the app you connected. | Don't set a Composio key; connected-app tools are unavailable without it. |
| `https://www.orgo.ai/api` | Only when an Orgo key is configured: creating and managing cloud desktops. | Your Orgo key and the desktop lifecycle request. Your browser also connects directly to the Orgo-assigned desktop address for the noVNC Watch / Take Control view. | Don't set an Orgo key; local-only users never see Orgo-only tools. |
| `https://api.github.com/repos/asjames18/tidebot/releases` | The server checks for a newer release so the studio can show a dismissible "what's new" notice. Anonymous, cached 30 minutes, 5-second timeout, fails soft. | No key, no personal data — just the request for the latest release. | It never blocks the app; there is no setting to disable it yet. |
| `https://github.com/asjames18/tidebot/releases` | The desktop app's updater (electron-updater, GitHub provider) checks this repo for update manifests and downloads. Only when the update check runs; dev-channel prereleases only if enabled in settings. | No key, no personal data. | Turn off automatic update checks in the desktop settings. |
| `https://html.duckduckgo.com/html` | Only when an Operator runs the `web_search` tool. | The search query, nothing else. | Don't give Operators the web_search tool, or don't ask for searches. |
| Any `https://` URL you or an Operator asks for | Only when an Operator runs the `fetch_webpage` tool. Fetches go through `safeFetch`, which blocks private and loopback addresses. | The URL and a browser-like User-Agent. | Don't give Operators the fetch_webpage tool, or don't ask for fetches. |
| `https://gmail.googleapis.com/gmail/v1/users/me/profile` | Only when Gmail is connected through Composio, to read the account's email address for display. The request is proxied through Composio. | The Composio session for your connected Gmail account. | Don't connect Gmail. |
| `https://logos.composio.dev/api` | The web studio loads connected-app logos in your browser when it renders app cards. | No key, no personal data — just the logo request. | Logos are cosmetic; the app works without them. |

## Links the UI shows but does not call

These appear as links or placeholder text; TideBot makes no request to
them unless you click or type them yourself:

- `https://openrouter.ai/keys` — the "get an OpenRouter key" link in Settings.
- `https://app.composio.dev` — the Composio connect page opened when you
  connect an app.
- `https://api.openai.com/v1` — shown only as placeholder example text in
  the custom-provider field; it is not a default and is never called
  unless you enter it as your provider URL.
- `https://tidebot.example.com` — example text in a desktop error message
  ("Enter a full server address, such as …"); not a real host.

## Local traffic (not egress, listed so it is not mistaken for it)

- Server ↔ browser/desktop: `http://127.0.0.1:8787` by default, or the
  HTTPS address you give your own instance through a reverse proxy.
  That address is yours — TideBot runs no hosted relay.
- Shell tool: runs locally inside the Bubblewrap sandbox on Linux; it
  makes no network call of its own.
