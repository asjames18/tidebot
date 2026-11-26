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

## Data and updates

Compose stores the SQLite database, Library files, and studio settings in the `tidebot-data` named volume. Changes saved in TideBot's Settings take precedence over the corresponding environment values in the Compose `.env`. Keep `.env` private.

For a consistent backup, stop the service and back up the entire data volume along with `.env`. The source-checkout setup keeps its database and Library under `data/` by default. Back up data before rebuilding with a newer checkout. Run only one server process against the same SQLite database.
