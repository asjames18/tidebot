# Self-host TideBot

Run TideBot on a computer you already own or a separate server. The server holds the accounts, bots, files, and routine schedules, so their work can continue after you close the desktop client.

## Start the server

1. Make a copy of `.env.example` named `.env`. Set `STUDIO_EMAIL` and a strong `STUDIO_PASSWORD` for your first sign-in. Set `APP_URL` and `SERVER_URL` to `http://127.0.0.1:8787` for the initial same-computer setup. Keep `DEV_LOGIN=0`.
2. With Docker and the Compose plugin, run `docker compose up --build -d` from the checkout. Open `http://127.0.0.1:8787` on the same computer.
3. Sign in and connect your model from **Settings → Setup**. Use **Settings → Account** to invite other people.

You can also run the checkout with Node.js 22.22.3 or newer. Run `npm ci`, `npm run build`, and `npm start` from the root. Run it under your system's service manager if it needs to stay up after your terminal closes.

## Connect your devices

In TideBot Desktop, select **Change Server** from the application menu, or press **⌘⇧K** on Mac or **Ctrl+Shift+K** on Windows and Linux. Enter your instance's base address under **Existing server**, select **Check and connect**, and sign in on that server. Use **This computer** to return to the bundled installation.

For access from a phone or another computer, give the instance an HTTPS address through a reverse proxy or private network. Keep the Compose port bound to loopback and have the proxy reach it there. Set `APP_URL` and `SERVER_URL` in `.env` to that same HTTPS base address, then recreate the service. Desktop accepts HTTP on loopback for same-computer testing. A phone opens the HTTPS address in its browser.

On your phone, sign in to that instance with the same TideBot account to see your bots, conversations, runs, and files. Use your browser's home-screen or install option if it is available. TideBot's server and model endpoint must stay reachable for replies and scheduled runs. For example, an Ollama address on `127.0.0.1` is local to the computer running the TideBot server.

You can self-host on hardware you already own. System requirements (OS versions, RAM, disk, Node version, Bubblewrap on Linux) are listed in the README under Quick Start → Prerequisites. Hosting and model providers may have separate costs or usage limits. TideBot can use a supported free model when one is available, or a local model that runs on your own hardware.

## Where your data lives

TideBot keeps everything on your own machine — there is no cloud copy. The database holds your accounts, Operators, conversations, routines, and model settings; each Operator's files live in its own workspace folder next to it. Provider keys live in the `.env` file, never in the database.

| Install | Database | Operator workspaces | Settings / keys |
| --- | --- | --- | --- |
| Desktop app | `<data folder>/data/grokbot.db` | `<data folder>/data/workspaces/<botId>/` | `<data folder>/.env`, `<data folder>/desktop-settings.json` |
| Source checkout | `<checkout>/data/grokbot.db` | `<checkout>/data/workspaces/<botId>/` | `<checkout>/.env` |
| Docker Compose | `tidebot-data` volume, `/data/grokbot.db` | `tidebot-data` volume, `/data/workspaces/<botId>/` | `tidebot-data` volume, `/data/studio.env` |

The desktop data folder is `~/Library/Application Support/TideBot` on macOS, `%APPDATA%\TideBot` on Windows, and `~/.config/TideBot` on Linux. In the desktop app, open it from the **TideBot menu → Open Data Folder**. Changes saved in TideBot's Settings take precedence over the corresponding values in `.env`. Keep `.env` (or `studio.env`) private — it holds your provider keys.

### Back up and restore

Stop the server first, then copy the whole data folder (desktop / source) or volume (Docker) together with the `.env` file. The database runs in WAL mode, so a copy taken while the server is running can be inconsistent — copy `grokbot.db` together with its `grokbot.db-wal` and `grokbot.db-shm` files, or stop the server and copy `grokbot.db` alone. Run only one server process against the same database.

Docker backup, from the checkout directory:

```sh
docker compose down
docker run --rm -v tidebot-data:/data -v "$PWD":/backup alpine tar czf /backup/tidebot-data-backup.tar.gz -C /data .
```

To restore, put the files back in the same locations and start the server again. Back up before rebuilding with a newer checkout or updating the desktop app.

### Move to a new machine

1. Install TideBot on the new machine the same way (desktop app, source checkout, or Docker).
2. Stop the server on both machines.
3. Copy the data folder (desktop / source) or restore the volume backup (Docker), plus the `.env` file, into the same location on the new machine.
4. Start the server and sign in with your existing account — your Operators, conversations, and files come with it.

### Uninstall / clean slate

Uninstalling the desktop app removes the app but leaves your data behind. To start over completely, delete the data folder for your install: the desktop data folder above, `<checkout>/data/` plus `<checkout>/.env` for a source install, or `docker compose down -v` for Docker — the `-v` flag deletes the `tidebot-data` volume and everything in it, so back up first if you want to keep anything.

## Troubleshooting

### Shell commands are refused: "Bubblewrap isolation is unavailable"

**Symptom:** on Linux, asking a bot to run a shell command returns `Shell disabled: Bubblewrap isolation is unavailable. Command was not run.` The command never runs — TideBot refuses rather than running it unsandboxed (`server/src/lib/sandbox.ts`, `runShell`).

**Fix:** install Bubblewrap from your distro's official repository. The package is named `bubblewrap` on all three:

- Debian / Ubuntu: `sudo apt install bubblewrap`
- Fedora: `sudo dnf install bubblewrap`
- Arch Linux: `sudo pacman -S bubblewrap`

Restart the server after installing — the server checks for Bubblewrap once when it starts, so an install after startup is not picked up until then. Then verify: `bwrap --version` should print a version, and `npm run doctor` should report `sandbox: bubblewrap installed (<path>)`. The real check is asking a bot to run any shell command — if it returns output instead of the refusal above, the fix worked.

**Still refused after installing?** The binary is found, but the isolation probe (`server/src/lib/sandbox.ts`, `probeBwrap`) also has to pass — it needs unprivileged user namespaces to work on your system. If your distro restricts them, the refusal stays until that is allowed; check your distro's documentation for unprivileged user namespaces.
