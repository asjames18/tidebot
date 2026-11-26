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

You can self-host on hardware you already own. Hosting and model providers may have separate costs or usage limits. TideBot can use a supported free model when one is available, or a local model that runs on your own hardware.

## Data and updates

Compose stores the SQLite database, Library files, and studio settings in the `tidebot-data` named volume. Changes saved in TideBot's Settings take precedence over the corresponding environment values in the Compose `.env`. Keep `.env` private.

For a consistent backup, stop the service and back up the entire data volume along with `.env`. The source-checkout setup keeps its database and Library under `data/` by default. Back up data before rebuilding with a newer checkout. Run only one server process against the same SQLite database.

### Back up and restore with `npm run backup`

Stop the server first, then run `npm run backup` from the checkout (or `node scripts/backup.mjs --data-dir <dir> --out <dir>` for a Docker volume or desktop data folder). It copies the whole data directory — database, workspaces, settings — into `backups/tidebot-<timestamp>/`, then verifies the copy: file inventory, SQLite header, and `PRAGMA integrity_check` on the copied database. `.env` is excluded by default; add `--include-env` only if you deliberately want keys in the backup, and store that backup somewhere private.

To restore: stop the server, copy the backup's `data/` contents back over the data directory (and `.env` back to the install root if you included it), run `node scripts/backup.mjs --verify <data dir>`, then start the server. The restore path is covered by an automated test (`tests/backup.test.mjs`) that backs up a fixture install, copies it back, and reads the database — an untested backup is a hope, not a feature.
