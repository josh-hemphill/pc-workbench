# Per-user settings and desktop executables

The same local app settings file works with the source checkout and the standalone application. It is stored in the current user's profile, outside the repository and executable. Storage and port settings are read at startup; restart after changes. The Settings page exposes validated settings fields and their locations, not arbitrary file contents. User appearance is stored independently in `user-settings.json` and applies immediately after saving.

## Windows x64

Local app settings: `%APPDATA%\pc-workbench\config.json`.
User preferences: `%APPDATA%\pc-workbench\user-settings.json`.
Desktop WebView cache: `%LOCALAPPDATA%\pc-workbench\cache`.
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

`dataDir` is required; `version: 1` is optional for existing files and written by the Settings UI; `port` is optional and defaults to 3001. A relative data directory resolves against the settings file's directory. `~/` refers to the current user's home. Environment variable names inside JSON are not interpolated; use a literal path or generate the file with PowerShell.

Build the server executable with `pnpm build && pnpm package:sea`, or the experimental native-window executable with `pnpm build:desktop && pnpm package:desktop`. On Windows x64 these produce `bin/pc-workbench-node-win32-x64.exe` and `bin/pc-workbench-desktop-win32-x64.exe`. Each embeds Node, the frontend and JavaScript dependencies; an installed Node runtime is not needed to run it. The desktop variant additionally extracts its verified native addon into the private cache. WebView2 Runtime and the Visual C++ x64 runtime are prerequisites for the Windows native window.

The API binds only to loopback and retains workspace locking and revision checks. The WebviewJS host asks the Vue application before closing, blocks foreign navigation/popups, then shuts down the backend and releases SQLite. Linux native checks pass; Windows/macOS native GUI behavior still needs validation. See [desktop limitations](DESKTOP-LIMITATIONS.md).

The WebviewJS host creates its browser context using the resolved private cache directory. Settings, cache and workspace data stay outside the executable. Replacing the application executable updates code without moving the database or settings. Packages are unsigned and do not install system WebView prerequisites.

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
- `BENCH_USER_SETTINGS_FILE` independently selects a user preferences file (an absent file starts with defaults).
- `BENCH_CACHE_DIR` selects an absolute private cache directory. Windows also honors `WEBVIEW2_USER_DATA_FOLDER`.

Settings validation still runs when environment overrides are present. The development Vite proxy reads the same resolved API port; restart both development services after a port change. Use permissions appropriate to your user: on Linux/macOS, `chmod 600 config.json`; on Windows, keep the file under your private profile directory or restrict its ACL if using a shared custom location. File permissions and storage access follow the operating system's account permissions.

## User preferences and Settings UI

`user-settings.json` defaults to the same OS settings directory as `config.json`. Selecting a custom `BENCH_CONFIG_FILE` does not relocate user preferences; use `BENCH_USER_SETTINGS_FILE` explicitly when needed. Its versioned structure is:

```json
{
  "version": 1,
  "appearance": {
    "theme": "system",
    "palette": "bench",
    "customColors": {}
  }
}
```

`palette` supports `bench`, `slate` and `graphite`. Optional custom colors are keyed by palette, then `light`/`dark`, then color role, with six-digit hex values. Settings validates all fields. Unsupported versions and malformed or unreadable files fail without overwriting them. Writes replace files atomically with private file permissions and independent revision checks; separate workspace processes cannot silently overwrite each other’s settings.

Open **Settings → User settings · Appearance** to preview/edit colors and apply or cancel them. Saved preferences belong to the OS user running the local server, not a browser login or workspace. The header mode selector saves immediately when no preview is active. Browser localStorage is no longer an authority for appearance. The old SQLite `theme` value is retained only for an explicit **Import legacy appearance** offer when there is no user preferences file; opening a portable workspace never applies it automatically.

**App settings · Storage & runtime** displays the active workspace, user/app settings paths, cache directory and API port, with override indicators. Its input fields show saved values. **Validate & preview** checks the destination without opening or creating a workspace. **Save for next launch** writes only app configuration. A pending-restart message shows the next effective values; current records stay in the current directory. Environment overrides remain authoritative, so remove them to use saved values. Validation cannot guarantee a destination will stay accessible or unlocked until restart; ordinary startup validation still applies.

Settings files must be outside the workspace, distinct from one another, and outside disposable cache storage. Symlink aliases are checked when validating locations; saves through a settings-file symlink are rejected rather than replacing the link. The WebviewJS host uses the reported cache location; ordinary browsers retain browser/OS-managed caches. No user preferences, absolute local paths, ports or caches are included in workspace JSON/CSV exports or restored from workspace backups. Future settings that affect operational workspace behavior should be stored and backed up with the workspace.

## Existing data and backups

Changing `dataDir` selects a different workspace; it does not move or merge existing data. Export a JSON backup from **Data & imports**, configure the destination and restart, then preview/restore the backup. CSV import/export remains available for every collection.

For a filesystem move, stop the server first and copy the entire data directory, including recovery backups. Never copy a live SQLite database without its associated WAL state. Keep an independent backup before changing storage locations. This workflow is designed for local storage and one running instance per workspace.

## Startup lock errors

An active `.server-lock.json` prevents opening the same workspace twice. A lock left after a crash is recovered when its PID no longer exists. On Windows, access-related failures from the initial process check fall back to a read-only PID enumeration through the system PowerShell; this does not require permission to terminate the recorded process. Settings-file locks use the same check.

If ownership still cannot be verified, startup reports the PID, underlying error and full lock path. Stop other workbench instances and retry. For a lock left by a stopped server or copied workspace, verify the recorded process has exited before removing only that lock file. Use the reported path: user configuration can select a workspace outside the checkout. Uncertain or running owners remain blocked, and a lock replaced during the lookup is retained for a retry.

## Build standalone executables

Install Node.js 26.12 or a later Node 26 release and pnpm 12.14.0:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm package:sea
pnpm test:sea
```

The server output is `bin/pc-workbench-node-<platform>-<arch>` (`.exe` on Windows), with a `.json` manifest recording size, SHA-256 and runtime requirements. Launch it and open `http://127.0.0.1:3001`, or the configured port. It embeds the frontend and serves it without external files. Ctrl+C stops the server. `pnpm start` runs the same bundled server through an installed Node runtime.

For the experimental WebviewJS native window:

```sh
pnpm build:desktop
pnpm package:desktop
pnpm test:desktop-package
```

Output: `bin/pc-workbench-desktop-<platform>-<arch>` (`.exe` on Windows), plus its `.json` manifest. The package smoke test is headless; it verifies addon extraction, embedded assets, API writes, restart persistence and shutdown, rather than native rendering. Launch the executable directly to open the window. `pnpm dev:desktop` runs the source host after `pnpm build:web`.

Build on the target OS and architecture. SEA packages the current Node binary and does not cross-compile. CI produces Linux, Windows and macOS artifacts. Release signing, notarization, installer/bootstrapper and updater integration remain future work; the former ZIP/IExpress distribution is retired. See [desktop prototype commands](DESKTOP_PROTOTYPES.md) and [Linux prerequisites/native checks](WEBVIEWJS_LINUX_SETUP.md).
