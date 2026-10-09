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

Run `deno task package:windows`, extract the entire `pc-workbench-win-x64.zip`, and launch `pc-workbench-win-x64.exe`. Keep its Deno runtime DLL beside the launcher. The Vue interface, Express backend and native SQLite execute inside one Deno application process. No Node sidecar, Node installation, pnpm or Electron is needed. WebView2 Runtime and Microsoft Visual C++ 2015–2022 Redistributable (x64) must already be installed on Windows.

The desktop application uses the existing workspace lock and revision checks and binds only to loopback. Closing its window stops the in-process server and closes SQLite with a bounded connection-drain period. **Save drafts before closing:** Deno 2.9.7's Windows native backend cannot guarantee an unsaved-draft prompt or native navigation/popup protections. See [desktop limitations](DESKTOP-LIMITATIONS.md).

Extract into a writable user-owned directory because the pinned WebView backend defaults its browser cache beside the launcher. Set `WEBVIEW2_USER_DATA_FOLDER` before starting the executable if another browser-cache directory is needed. Replacing the whole application directory updates code; settings and database stay in their configured locations. The desktop package is unsigned and does not install WebView2.

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

## Build a Windows desktop package

Install Deno 2.9.7; no Node toolchain is required:

```sh
deno install --frozen
deno task package:windows
```

Output: `bin/pc-workbench-win-x64.zip` plus `.sha256` and `.build.json`. The manifest records runtime files and `nodeSidecar:false`. Packaging cross-builds the native WebView launcher/runtime DLL and embeds the used backend dependencies and Vue assets. Generated bundles, executables and build intermediates are ignored by Git. Unix build hosts need `zip`; Windows hosts use PowerShell's native ZIP command.

To distribute one executable, run `deno task package:windows:single` on Windows x64. It uses built-in IExpress and outputs `bin/pc-workbench-win-x64-single.exe` with checksum/manifest files. Only the EXE is required to launch: it extracts the original launcher and DLL into a temporary folder for the application's lifetime. Settings and database stay in the configured user directories; no installer or shortcuts are created. WebView2 and the Visual C++ x64 runtime remain prerequisites. This mode cannot be built on Linux, and its IExpress creation, launch and cleanup still require Windows verification. See [single-executable packaging](../docs/DENO.md#package-and-windows-trial).

`deno task package linux-x64` builds a Linux comparison package requiring GTK/WebKitGTK. `deno task build` followed by `deno task start` runs the API/UI server from the checkout. `deno task desktop` builds the assets and uses `deno desktop --hmr` to compile and launch the native window. Ordinary `deno run` does not expose `Deno.BrowserWindow`. No public HTTP shutdown route or subprocess sidecar is added.

Linux tests verify the native Deno backend, SQLite changes/restarts, CSV import/export, backups, Host/Origin and revision protections, startup failures and bounded shutdown. A Windows cross-build does not establish Windows GUI behavior; a Windows launch trial remains necessary. The native close/navigation/popup limits remain production adoption blockers.
