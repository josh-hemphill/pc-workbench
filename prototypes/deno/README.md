# PC Workbench Deno desktop prototype

This branch runs the whole application pipeline with **Deno 2.9.7**: dependency installation, Vite/Vue development, Vue/TypeScript checks, the existing application tests, backend bundling, and desktop packaging. Express, CSV libraries and native `node:sqlite` execute inside Deno through its Node compatibility layer. **No Node installation, pnpm, Electron, Node server sidecar, or Node runtime executable is required.** npm packages and platform build binaries such as esbuild/Rolldown remain development dependencies managed by Deno.

## Development and validation

Run from the repository root with Deno 2.9.7 on PATH:

```sh
deno install --frozen
deno task dev
```

Open http://127.0.0.1:5173. The frontend and API are Deno processes; Vite provides Vue HMR, and the API restarts on source changes. Ctrl+C stops both. The default development workspace is `data/`; use `BENCH_DATA_DIR` for an isolated workspace. The API defaults to port 3001; if overriding `PORT`, update the frontend proxy accordingly.

```sh
deno task check          # Deno tools plus Vue/shared/backend TypeScript checks
deno task test           # All 216 existing application assertions, verified via JUnit
deno task build         # Vue assets + self-contained backend module + desktop typechecks
deno task test:desktop  # Build, then six real in-process Deno backend integration tests
deno task desktop       # Build and run the native WebView window
```

Tests use disposable workspaces, not your configured data. The desktop host tests use read/write/env/sys and localhost network permissions; they require **no subprocess permission**. `deno task build` uses native build tools; `deno task dev` supervises Deno child processes. The Vue checker runs TypeScript 6 inside Deno because Vue tooling needs the JavaScript compiler API, and Deno 2.9.7 itself ships TypeScript 6.

`deno task build` generates the ignored `prototypes/deno/server-bundle.mjs`, containing the backend's actual npm dependencies and embedded frontend assets. Runtime packages do not need `node_modules`, source files, or network access to package registries. The tracked declaration describes the host boundary; the shared implementation is checked separately by the Vue/TypeScript checker.

## Package and Windows trial

```sh
deno task package:windows
# Optional Linux comparison (GTK/WebKitGTK required):
deno task package linux-x64
```

The Windows output is `bin/pc-workbench-deno-prototype-win-x64.zip`. Extract the entire ZIP into a writable user-owned folder and run `pc-workbench-deno-prototype-win-x64.exe`. Keep the Deno runtime DLL beside the launcher. There is no `pc-workbench-server.exe` and no Node executable. The builder cleans its old target output, stages only runtime files outside the workspace, checks for forbidden sidecars, and records file checksums. Unix build hosts need `zip`; Windows packaging uses native PowerShell.

Microsoft Edge WebView2 Runtime must already be installed. The pinned native backend defaults its browser cache beside the launcher, requiring writable extraction. `WEBVIEW2_USER_DATA_FOLDER` can be configured before launching; setting it from application TypeScript can be too late for native initialization.

The existing `%APPDATA%\pc-workbench\config.json` and `%LOCALAPPDATA%\pc-workbench\data` defaults remain supported. `BENCH_CONFIG_FILE`, `BENCH_DATA_DIR` and `PORT` overrides still work. Changing storage settings does not move existing data. Close any application using the same workspace before launching; native SQLite and the existing workspace lock protect it. For trials, select a disposable data directory.

The backend runs **in the same process** as the desktop host, on the configured loopback API port. The window's proxy uses a separate ephemeral loopback port, preserving Host/Origin checks, CSP, revision headers and CSV/backup download attachments. The renderer receives no native bindings. Graceful close drains idle clients and bounds outstanding requests before closing SQLite; process loss cannot leave a detached backend process behind. SQLite's normal WAL recovery handles an abrupt process termination.

`BENCH_DENO_HEADLESS=1` runs the same host without a native window and prints its proxy URL for diagnostics. It validates the packaged backend but does not validate Windows WebView behavior.

## Remaining desktop limits

Removing Node does not fix the reviewed native window backend's policy limitations:

- Windows `beforeunload` is automatically accepted and the native close notification is not cancelable. Save drafts before closing; unsaved-close protection remains a production blocker.
- This version exposes no pre-navigation veto, popup policy or WebView permission interception. The pinned Windows backend can open popup URLs externally without user activation. CSP reduces exposure but cannot replace native controls.
- The package still contains a launcher and runtime DLL. WebView2 installation, writable browser cache, code signing and a production installer strategy remain deployment work.

See [evaluation evidence](../../docs/DENO-PROTOTYPE.md) and the [migration specification](../../docs/MIGRATION.md). Native Linux runtime tests and a Windows cross-build do not prove Windows GUI execution.
