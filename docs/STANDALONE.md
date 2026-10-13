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

Run `deno task package:windows`, extract the entire `pc-workbench-win-x64.zip`, and launch `pc-workbench-win-x64.exe`. Keep its Deno runtime DLL beside the launcher. The Vue interface, Express backend and native SQLite execute inside one Deno application process. No Node sidecar, Node installation, pnpm or Electron is needed. WebView2 Runtime and Microsoft Visual C++ 2015–2022 Redistributable (x64) must already be installed on Windows.

The desktop application uses the existing workspace lock and revision checks and binds only to loopback. Closing its window stops the in-process server and closes SQLite with a bounded connection-drain period. **Save drafts before closing:** Deno 2.9.7's Windows native backend cannot guarantee an unsaved-draft prompt or native navigation/popup protections. See [desktop limitations](DESKTOP-LIMITATIONS.md).

Windows desktop sets `WEBVIEW2_USER_DATA_FOLDER` before creating its window, so its browser cache stays in the user profile instead of beside the launcher. An existing `WEBVIEW2_USER_DATA_FOLDER` override is honored (and takes precedence over `BENCH_CACHE_DIR`). The cache must remain outside the workspace and must not contain settings files. Replacing the whole application directory updates code; settings and database stay in their configured locations. The desktop package is unsigned and does not install WebView2.

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

Settings files must be outside the workspace, distinct from one another, and outside disposable cache storage. Symlink aliases are checked when validating locations; saves through a settings-file symlink are rejected rather than replacing the link. Windows WebView uses the reported cache location; other desktop platforms and ordinary browsers retain browser/OS-managed caches. No user preferences, absolute local paths, ports or caches are included in workspace JSON/CSV exports or restored from workspace backups. Future settings that affect operational workspace behavior should be stored and backed up with the workspace.

## Existing data and backups

Changing `dataDir` selects a different workspace; it does not move or merge existing data. Export a JSON backup from **Data & imports**, configure the destination and restart, then preview/restore the backup. CSV import/export remains available for every collection.

For a filesystem move, stop the server first and copy the entire data directory, including recovery backups. Never copy a live SQLite database without its associated WAL state. Keep an independent backup before changing storage locations. This workflow is designed for local storage and one running instance per workspace.

## Build a Windows desktop package

Install Deno 2.9.7; no Node toolchain is required:

```sh
deno install --frozen
deno task package:windows
```

Output: `bin/pc-workbench-win-x64.zip` plus `.sha256` and `.build.json`. The manifest records runtime files and `nodeSidecar:false`. Packaging cross-builds the native WebView launcher/runtime DLL and embeds the used backend dependencies and Vue assets. Generated bundles, executables and build intermediates are ignored by Git. Unix build hosts need `zip`; Windows hosts use PowerShell's native ZIP command.

To distribute one executable, run `deno task package:windows:single` on Windows x64. It uses built-in IExpress and outputs `bin/pc-workbench-win-x64-single.exe` with checksum/manifest files. Only the EXE is required to launch: it extracts the original launcher and DLL into a temporary folder for the application's lifetime. Settings and database stay in the configured user directories; no installer or shortcuts are created. WebView2 and the Visual C++ x64 runtime remain prerequisites. This mode cannot be built on Linux. Windows CI verifies IExpress creation; native GUI launch and cleanup still require a manual Windows trial. See [single-executable packaging](../docs/DENO.md#package-and-windows-trial).

`deno task package linux-x64` builds a Linux comparison package requiring GTK/WebKitGTK. `deno task build` followed by `deno task start` runs the API/UI server from the checkout. `deno task desktop` builds the assets and uses `deno desktop --hmr` to compile and launch the native window. Ordinary `deno run` does not expose `Deno.BrowserWindow`. No public HTTP shutdown route or subprocess sidecar is added.

Linux tests verify the native Deno backend, SQLite changes/restarts, CSV import/export, backups, Host/Origin and revision protections, startup failures and bounded shutdown. A Windows cross-build does not establish Windows GUI behavior; a Windows launch trial remains necessary. The native close/navigation/popup limits remain production adoption blockers.
