# Deno development and desktop packaging

The repository runs the whole application pipeline with **Deno 2.9.7**: dependency installation, Vite/Vue development, Vue/TypeScript checks, the existing application tests, backend bundling, and desktop packaging. Express, CSV libraries and native `node:sqlite` execute inside Deno through its Node compatibility layer. **No Node installation, pnpm, Electron, Node server sidecar, or Node runtime executable is required.** npm packages and platform build binaries such as esbuild/Rolldown remain development dependencies managed by Deno.

Repository tooling lives in `tools/deno/`, the API launch entry in `server/serve.ts`, and the native host in `desktop/`. GitHub Actions runs application tests and desktop checks on Linux, then tests and builds both Windows distributions on Windows x64. Desktop runtime limitations remain documented in [Desktop validation and remaining limitations](DESKTOP-LIMITATIONS.md).

## Development and validation

Run from the repository root with Deno 2.9.7 on PATH:

```sh
deno install --frozen
deno task dev
```

Open http://127.0.0.1:5173. Startup first installs the locked dependencies in one process, then starts the frontend and API using the installed cache. This prevents competing npm installers and overlapping download/Vite progress output. Neither watcher clears the terminal, so startup errors remain visible. If startup stays in dependency preparation, run `deno install --frozen` separately to isolate registry/download problems.

The frontend and API are Deno processes; Vite provides Vue HMR, and the API restarts on source changes. Ctrl+C stops both. The default development workspace is `data/`; use `BENCH_DATA_DIR` for an isolated workspace. The API defaults to port 3001; if overriding `PORT`, update the frontend proxy accordingly.

```sh
deno task check          # Deno tools plus Vue/shared/backend TypeScript checks
deno task test           # All 222 application assertions, verified via JUnit
deno task build         # Vue assets + self-contained backend module + desktop typechecks
deno task test:desktop  # Build, then seven real in-process Deno desktop integration tests
deno task desktop       # Build, then launch the native WebView runtime with deno desktop --hmr
```

Tests use disposable workspaces, not your configured data. The desktop host tests use read/write/env/sys and localhost network permissions; they require **no subprocess permission**. `deno task build` uses native build tools; `deno task dev` supervises Deno child processes. The Vue checker runs TypeScript 6 inside Deno because Vue tooling needs the JavaScript compiler API, and Deno 2.9.7 itself ships TypeScript 6.

`Deno.BrowserWindow` is available only inside the native desktop runtime. Ordinary `deno run desktop/main.ts` cannot open the window. Deno 2.9.7 uses `deno desktop --hmr` to compile and launch it locally; `deno desktop` without `--hmr` only builds the package. The task builds frontend assets first; rerun it after Vue changes to refresh embedded assets.

`deno task build` generates the ignored `desktop/server-bundle.mjs`, containing the backend's actual npm dependencies and embedded frontend assets. Runtime packages do not need `node_modules`, source files, or network access to package registries. The tracked declaration describes the host boundary; the shared implementation is checked separately by the Vue/TypeScript checker.

## Package and Windows trial

```sh
deno task package:windows
# Optional Linux comparison (GTK/WebKitGTK required):
deno task package linux-x64
```

The Windows output is `bin/pc-workbench-win-x64.zip`. Extract the entire ZIP into a writable user-owned folder and run `pc-workbench-win-x64.exe`. Keep the Deno runtime DLL beside the launcher. There is no `pc-workbench-server.exe` and no Node executable. The builder cleans its old target output, stages only runtime files outside the workspace, checks for forbidden sidecars, and records file checksums. Unix build hosts need `zip`; Windows packaging uses native PowerShell.

For a **single executable to distribute**, run this on Windows x64:

```sh
deno task package:windows:single
```

Output: `bin/pc-workbench-win-x64-single.exe`, plus optional `.sha256` and `.build.json` verification files. The task first builds the standard native package, then uses Windows' built-in `iexpress.exe` to embed its original launcher and matching runtime DLL into one self-extracting executable. No additional compiler or Node installation is needed. Double-click the single EXE; IExpress extracts the two runtime files to a Windows temporary directory, launches the application and cleans up after it exits. This is one distribution file; the runtime DLL still exists on disk while the application runs. Settings and SQLite data retain their configured user storage paths, outside the extracted application. It does not install the app or create shortcuts.

This packaging mode requires a Windows build host. Other hosts can still cross-build the standard ZIP. Windows CI has verified IExpress executable creation and the seven desktop backend tests. Native GUI launch and temporary-directory cleanup still require a manual Windows trial. The resulting EXE is unsigned; WebView2 and the Visual C++ x64 runtime must already be installed. Deno 2.9.7's own `--compress` option creates a batch launcher and a separate archive on Windows, so it does not provide this single-EXE format.

Microsoft Edge WebView2 Runtime and the Microsoft Visual C++ 2015–2022 Redistributable (x64) must already be installed. The native launcher imports `MSVCP140.dll`, `VCRUNTIME140.dll` and `VCRUNTIME140_1.dll`. The pinned native backend defaults its browser cache beside the launcher, requiring writable extraction. `WEBVIEW2_USER_DATA_FOLDER` can be configured before launching; setting it from application TypeScript can be too late for native initialization.

The existing `%APPDATA%\pc-workbench\config.json` and `%LOCALAPPDATA%\pc-workbench\data` defaults remain supported. `BENCH_CONFIG_FILE`, `BENCH_DATA_DIR` and `PORT` overrides still work. Changing storage settings does not move existing data. Close any application using the same workspace before launching; native SQLite and the existing workspace lock protect it. For trials, select a disposable data directory.

The backend runs **in the same process** as the desktop host, on the configured loopback API port. The window's proxy uses a separate ephemeral loopback port, preserving Host/Origin checks, CSP, revision headers and CSV/backup download attachments. The renderer receives no native bindings. Graceful close drains idle clients and bounds outstanding requests before closing SQLite; process loss cannot leave a detached backend process behind. SQLite's normal WAL recovery handles an abrupt process termination.

`BENCH_DENO_HEADLESS=1` runs the same host without a native window and prints its proxy URL for diagnostics. It validates the packaged backend but does not validate Windows WebView behavior.

## Remaining desktop limits

Removing Node does not fix the reviewed native window backend's policy limitations:

- Windows `beforeunload` is automatically accepted and the native close notification is not cancelable. Save drafts before closing; unsaved-close protection remains a production blocker.
- This version exposes no pre-navigation veto, popup policy or WebView permission interception. The pinned Windows backend can open popup URLs externally without user activation. CSP reduces exposure but cannot replace native controls.
- The runtime uses a launcher and DLL, including when wrapped in a single self-extracting EXE. WebView2 installation, writable browser cache, code signing and a production installer strategy remain deployment work.

See [evaluation evidence](DESKTOP-LIMITATIONS.md) and the [migration specification](MIGRATION.md). Native Linux runtime tests and a Windows cross-build do not prove Windows GUI execution.
