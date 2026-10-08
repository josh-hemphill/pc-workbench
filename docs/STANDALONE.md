# Per-user settings and desktop executables

The same settings file works with the source checkout and the standalone application. It is stored in the current user's profile, outside the repository and executable. Settings are read at startup; restart after changes. The application never serves this file over HTTP.

## Windows x64

Settings: `%APPDATA%\pc-workbench\config.json`.
Standalone default data: `%LOCALAPPDATA%\pc-workbench\data`.

Create a settings file using PowerShell:

```powershell
$benchConfigDir = Join-Path $env:APPDATA 'pc-workbench'
New-Item -ItemType Directory -Force $benchConfigDir | Out-Null
@{ dataDir = 'D:\PCWorkbench\data'; port = 3001 } |
  ConvertTo-Json |
  Set-Content -Encoding utf8 (Join-Path $benchConfigDir 'config.json')
```

Equivalent JSON (backslashes must be escaped):

```json
{
  "dataDir": "D:\\PCWorkbench\\data",
  "port": 3001
}
```

`dataDir` is required; `port` is optional and defaults to 3001. A relative data directory resolves against the settings file's directory. `~/` refers to the current user's home. Environment variable names inside JSON are not interpolated; use a literal path or generate the file with PowerShell.

Launch `pc-workbench-desktop-win-x64.exe`. It opens the application in an Electron desktop window and starts its local server automatically, with no separate browser or console window. Chromium, Electron, Node, native SQLite support, server dependencies and the built frontend are included; users need neither Node, pnpm nor WebView2. Closing the last window shuts down the server and closes SQLite. Unsaved drafts prompt before closing. A second launch focuses the existing window. The server binds only to `127.0.0.1`, preserves local-origin restrictions, and uses the existing workspace lock and revision checks.

The portable launcher extracts its bundled runtime into a temporary directory while running. Settings and data stay in the configured user directories. The sandboxed renderer has no Node integration, preload bridge or operating-system permissions. External pages cannot replace the application window. To open an HTTPS manufacturer/documentation link, right-click it and choose **Open link in browser**; popup windows are blocked.

The separate `pc-workbench-win-x64.exe` is still available as a headless server. It prints a localhost URL to open in your browser and stops with Ctrl+C. `pnpm package:server:windows` builds only this server; `pnpm package:windows` builds the full desktop package.

Replace the executable to update the program. Settings and data stay in their separate directories. The executable is unsigned; signing Windows distributions requires your own signing certificate.

## Other runtime locations

| Platform | User settings | Standalone default data |
|---|---|---|
| Linux | `$XDG_CONFIG_HOME/pc-workbench/config.json`, otherwise `~/.config/pc-workbench/config.json` | `$XDG_DATA_HOME/pc-workbench`, otherwise `~/.local/share/pc-workbench` |
| macOS | `~/Library/Application Support/pc-workbench/config.json` | `~/Library/Application Support/pc-workbench/data` |
| Windows | `%APPDATA%\pc-workbench\config.json` | `%LOCALAPPDATA%\pc-workbench\data` |

An absent standard settings file uses the defaults. Source development retains the repository's `data/` default when no user settings exist. A malformed or unreadable settings file stops startup instead of silently opening a fresh workspace. Unknown settings, empty paths and invalid ports are rejected. An explicitly selected missing settings file also stops startup.

Overrides:

- `BENCH_CONFIG_FILE` selects a different settings file.
- `BENCH_DATA_DIR` overrides its data directory.
- `PORT` overrides its port.

Settings validation still runs when environment overrides are present. In development, changing the API port also requires changing the Vite proxy. Use permissions appropriate to your user: on Linux/macOS, `chmod 600 config.json`; on Windows, keep the file under your private profile directory or restrict its ACL if using a shared custom location. File permissions and storage access follow the operating system's account permissions.

## Existing data and backups

Changing `dataDir` selects a different workspace; it does not move or merge existing data. Export a JSON backup from **Data & imports**, configure the destination and restart, then preview/restore the backup. CSV import/export remains available for every collection.

For a filesystem move, stop the server first and copy the entire data directory, including recovery backups. Never copy a live SQLite database without its associated WAL state. Keep an independent backup before changing storage locations. This workflow is designed for local storage and one running instance per workspace.

## Build a Windows executable

On a development machine with Node.js 24+ and the pinned pnpm:

```sh
pnpm install --frozen-lockfile
pnpm package:windows
```

Output: `bin/pc-workbench-desktop-win-x64.exe`, a `.sha256` checksum and a `.build.json` manifest. The manifest records the embedded server checksum and Electron version. The server executable is also retained at `bin/pc-workbench-win-x64.exe`. Generated binaries and packaging intermediates are ignored by Git. A Windows cross-build downloads the official Node binary matching the build host's exact Node version and checks its SHA-256 against Node's published checksum list. Network access is needed for that download and for Electron/NSIS packaging tools. A native Windows x64 build reuses the running Node binary. The frontend is embedded as Node SEA assets, and Node's native SQLite module remains a runtime builtin.

`pnpm package:standalone` builds the headless server for the current host. SEA snapshots and code caches are disabled so the Windows x64 bundle can be prepared on a matching-version Linux build host. Other cross-platform builds are not supported. macOS host builds additionally require `codesign` for ad-hoc signing.

The SEA packaging interface is experimental in Node 24. Linux smoke tests verify the bundled server, embedded frontend, SQLite writes/restarts, CSV export, JSON readiness, private shutdown commands, parent disconnection and startup failures. Desktop policy tests verify local navigation, external-link restrictions and confirmed child-process shutdown. A Windows executable built on Linux must also receive a Windows launch test before distribution; a PE-format/injection check cannot establish Windows runtime behavior.
