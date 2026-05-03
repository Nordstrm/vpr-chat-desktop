# VPR Chat — Desktop Wrapper

Standalone Electron wrapper for **VPR Chat** (https://vprchat.lovable.app).
This repo only contains the wrapper + branded NSIS installer — the web app itself
is loaded over HTTPS from the live deployment, so no React/source code lives here.

## How to ship a new version

1. Edit `electron/main.cjs` / `preload.cjs` / `scripts/installer.nsi` as needed.
2. Bump `version` in `package.json` **and** `VERSIONBUILD` in `scripts/installer.nsi`.
3. Commit & push:
   ```bash
   git commit -am "Release v1.0.2"
   git tag v1.0.2
   git push && git push --tags
   ```
4. GitHub Actions builds `VPR-Chat-Setup-<version>.exe` on a Windows runner
   and attaches it (plus `latest.json`) to a GitHub Release.
5. Download both files from the Release page and upload them to the
   **Lovable Cloud storage buckets**:
   - `app-downloads` — used by the public `/download` page
   - `desktop-updates` — used by the in-app updater (overwrite `latest.json`)

That's it. New users get the new installer; existing users see the
"Update available" button light up in Settings.

## Local development

```bash
npm install
npm start          # launches Electron pointing at https://vprchat.lovable.app
```

## File overview

| Path | Purpose |
|------|---------|
| `electron/main.cjs` | Main process: window, IPC, manual updater, screen-share picker |
| `electron/preload.cjs` | Bridges IPC to the web app via `window.vpr` |
| `scripts/installer.nsi` | Branded NSIS installer (welcome page, sidebar, header) |
| `scripts/latest.json.template` | Reference shape for the update manifest |
| `build/icon.ico` | App + installer icon |
| `build/installer-sidebar.bmp` | 164×314 welcome/finish artwork |
| `build/installer-header.bmp` | 150×57 header strip on every wizard page |
| `.github/workflows/build.yml` | CI: builds the .exe on every push/tag |

## Manual build (Windows only)

```bash
npm install
npm start          # launches Electron pointing at https://vprchat.lovable.app
```
