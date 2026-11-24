# TideBot Desktop (Windows, macOS, Linux)

Native desktop packaging for **TideBot** using Electron, `electron-builder`, and `electron-updater` with automatic updates from GitHub Releases (`asjames18/tidebot`).

## How Auto-Updates Work

- **Development updates on every push to `main`**: Each push to `main` builds Windows (`.exe` NSIS), macOS (`.dmg` + `.zip` for `arm64` & `x64`), and Linux (`.AppImage` + `.deb`) installers and publishes a semver prerelease (`<version>-dev.<run_number>`) to GitHub Releases.
- **Stable releases on tags**: Pushing a git tag like `v1.1.0` publishes a stable GitHub Release.
- **In-app updater**: TideBot Desktop checks GitHub Releases on launch and every 2 hours. **Receive Development Updates (GitHub main)** is enabled by default and can be toggled in the app menu (`TideBot` on macOS, `File` on Windows/Linux).
- **User data**: Your SQLite database (`data/grokbot.db`), bot workspaces, and `.env` are stored in the OS user-data folder (`app.getPath('userData')`), so updates never overwrite your data.

## Enabling Automated Builds on GitHub

Copy `desktop/github-workflow/desktop-release.yml` into `.github/workflows/desktop-release.yml` and push it using a GitHub token (or the GitHub web UI) that has the `workflow` scope:

```bash
mkdir -p .github/workflows
cp desktop/github-workflow/desktop-release.yml .github/workflows/desktop-release.yml
git add .github/workflows/desktop-release.yml
git commit -m "ci: enable Windows, macOS, and Linux desktop releases"
git push origin main
```

Once enabled, every push to `main` automatically builds and publishes updated installers to **GitHub → Releases**.

## Building Locally

```bash
# 1. Build web & server from the repository root
npm run build

# 2. Install desktop dependencies
cd desktop
npm install

# 3. Launch in desktop development mode
npm start

# 4. Build an installer for your current OS (outputs to desktop/dist/)
npm run dist
```
