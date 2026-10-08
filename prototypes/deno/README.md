# PC Workbench Deno WebView prototype

This experiment uses official **Deno 2.9.7 desktop**, its pinned **Laufey 0.7.0 WebView backend**, and our existing Node SEA/SQLite server. Vue/Vuetify, CSV import/export and per-user settings are unchanged. The renderer receives no native bindings. The Deno wrapper proxies the interface over an ephemeral loopback port, validates Host/Origin and forwards backend revision headers and download attachments. The backend keeps its configured port, default 3001.

## Windows trial

1. Extract the **entire ZIP** into a writable folder under your user profile. Keep the executable, runtime DLL and `pc-workbench-server.exe` together.
2. Make sure **Microsoft Edge WebView2 Runtime** is installed. This prototype does not install or bundle it.
3. Close any other running PC Workbench server, then run `pc-workbench-deno-prototype-win-x64.exe`.
4. Save all drafts before closing. This is an evaluation package, not the production desktop replacement.

The existing `%APPDATA%\pc-workbench\config.json`, `%LOCALAPPDATA%\pc-workbench\data` defaults, CSV imports/exports and backups still apply. The prototype opens the **same configured workspace** as the other packages. For an isolated trial, use a separate settings file via `BENCH_CONFIG_FILE` or set `BENCH_DATA_DIR` before launching. Changing the data directory does not move data.

WebView2 browser cache is separate from SQLite. The pinned backend defaults to a folder beside the launcher; hence the writable extraction directory requirement. A Windows launcher can set `WEBVIEW2_USER_DATA_FOLDER` to a user-owned directory **before** starting the native executable. Setting it later from TypeScript may occur after browser initialization.

## Findings and limits

- Official `deno desktop` is available in the released Deno 2.9.7. The Windows WebView backend is a small native launcher with a Deno runtime DLL; Chromium is not bundled. No Rust/C#/Go build toolchain is required.
- Startup/readiness and private stdin shutdown integrate with the tested Node executable. Closing or losing the wrapper's pipe triggers server shutdown and SQLite closure. No HTTP shutdown endpoint is added.
- **Unsaved-close protection is a blocker:** the pinned Windows backend automatically accepts `beforeunload`, and Deno's native close event is a noncancelable notification despite the guide's cancellation example. This prototype cannot promise to retain unsaved drafts when the title-bar close button is used.
- **Native navigation/popup policy is a blocker:** this Deno version exposes no pre-navigation veto, popup policy or WebView permission interception. The pinned Windows backend opens HTTP/HTTPS popup URLs in the external browser without requiring user activation. Response CSP reduces exposure but cannot replace native controls. Do not expose privileged native bindings to the renderer.
- WebView2 must already be installed. A writable browser-cache directory and an explicit runtime/bootstrapper strategy are needed for production deployment.
- Packaging produces multiple files. A single portable launcher needs an additional packager. The current experiment uses a ZIP; Deno's default MSI installation into Program Files needs a browser-cache override and bundled sidecar integration before use.
- The wrapper has subprocess permission to start its bundled backend and environment access to preserve the backend's per-user settings and overrides. It uses Deno's Node-compatible `spawn` with `windowsHide: true`, because `Deno.Command` does not expose console suppression. Production permission scopes and the missing native policies must be resolved before adoption.

Source evidence: [Deno API](https://github.com/denoland/deno/blob/v2.9.7/cli/tsc/dts/lib.deno.desktop.d.ts), [Deno close callback](https://github.com/denoland/deno/blob/v2.9.7/cli/rt_desktop/lib.rs), [Windows WebView backend](https://github.com/littledivy/laufey/blob/v0.7.0/webview/src/webview_windows.cc), [distribution guide](https://docs.deno.com/runtime/desktop/distribution/).

## Reproduce

Install Deno **2.9.7** plus the repository's normal Node/pnpm toolchain. Build the frontend and matching SEA backend, then the wrapper:

```sh
pnpm package:server:windows
pnpm prototype:deno:windows
```

`BENCH_DENO_BIN` optionally selects the Deno executable. The builder also detects `.standalone/deno-tools/deno[.exe]` if a locally downloaded runtime is present. On Unix build hosts, ZIP packaging requires the `zip` utility; Windows uses PowerShell `Compress-Archive`. No Electron tooling is imported by this prototype builder. Staging occurs outside the pnpm workspace so unused npm dependencies cannot inflate the Deno payload.

Linux GUI comparison (requires GTK/WebKitGTK and a graphical display):

```sh
pnpm package:standalone
node tools/build-deno-desktop.mjs --target linux-x64
```

Run the Deno-side tests with a matching SEA backend and disposable test data:

```sh
cd prototypes/deno
BENCH_DENO_SERVER=../../bin/pc-workbench-linux-x64 deno test --config deno.json --allow-read --allow-write --allow-env --allow-net=127.0.0.1 --allow-run backend.test.ts
```

Use an **absolute** `BENCH_DENO_SERVER` path on Windows or when starting from another directory. `BENCH_DENO_HEADLESS=1` runs `main.ts` without a native window for proxy/lifecycle diagnostics; it does not validate WebView rendering or Windows close behavior. Never treat a Linux test as proof of Windows GUI operation.

Validation results and package sizes are recorded in the repository's `docs/DENO-PROTOTYPE.md`.
