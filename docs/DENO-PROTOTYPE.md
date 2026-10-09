# Deno desktop pipeline evaluation

## Current architecture

The `deno-prototype` branch migrates the complete pipeline to Deno 2.9.7. Deno installs pinned npm dependencies from `deno.json`/`deno.lock`, runs Vite/Vue and the Vue/TypeScript checker, executes the original application tests, bundles the backend and frontend, and cross-builds the native WebView package. Node and pnpm are not required.

The desktop application runs Express and native `node:sqlite` **inside Deno**, sharing the existing backend/business logic in `server/app.ts`. SQLite persistence, inventory, installation tracking, compatibility checks, CSV import/export and user-only storage configuration use the same implementation as the application. The former Node SEA sidecar and its private subprocess protocol have been removed from the prototype.

The window renders the unchanged Vue/Vuetify UI through a guarded local proxy. The proxy consumes the desktop runtime’s `DENO_SERVE_ADDRESS` override, then clears it before Express starts: Deno 2.9.7 tracks this override independently in `Deno.serve` and `node:http`, otherwise both listeners try to bind the shell-assigned port. Its backend honors the configured API port; its window proxy uses an automatic port. The runtime has filesystem, environment, system information and localhost network permissions, with no subprocess permission and no privileged renderer bindings. Shutdown drains connections within a deadline and closes SQLite. Both window and backend are in one process.

See [setup, tasks and packaging](../prototypes/deno/README.md).

## Validation

- Deno's native `node:sqlite` supports the application's `DatabaseSync` API; no external SQLite library or FFI adapter is needed.
- All **216 original application tests across 27 files** pass under Deno, with individual JUnit counts checked. No suites were skipped or removed. Six API test fixtures explicitly close remaining test connections after assertions to account for Deno HTTP keepalive behavior.
- Seven additional in-process desktop integration tests cover real SQLite edits/restart, CSV import/export, backups, stale revisions, malformed imports, Host/Origin rejection, duplicate workspace ownership, startup port errors, desktop-assigned proxy/backend port separation, and bounded shutdown. They run without `--allow-run`.
- Vite/Vue production builds, development transforms and Vue/TypeScript checking execute inside Deno. An intentional type-error probe was rejected. A clean Deno dependency installation was tested independently of the previous pnpm `node_modules`.
- Runtime packaging embeds only used backend dependencies and frontend assets. It rejects Node executables, the former server sidecar and `node_modules` directories. ZIP and embedded-file checksums are emitted.

Windows x64 packaging is cross-built on Linux. Windows GUI execution requires a Windows machine and is not established by Linux tests. Package manifests identify the in-process backend and `nodeSidecar:false`.

## Remaining adoption blockers

Deno 2.9.7 pins Laufey 0.7.0's WebView implementation: WebView2 on Windows and WebKitGTK on Linux. Its Windows backend automatically accepts `beforeunload`; the native close callback is a noncancelable notification. Unsaved draft protection remains unresolved.

This version also lacks native pre-navigation veto, popup policy and permission interception. Its Windows backend can open HTTP/HTTPS popup URLs externally without requiring user activation. The response CSP remains useful but does not replace native policies. Do not add privileged renderer bindings while these controls are unavailable.

WebView2 must already be installed, and browser-cache placement must be established before native initialization. A production installer/bootstrapper, code-signing process and remaining native policy fixes are still needed. The lightweight package contains a native launcher plus Deno runtime DLL rather than one self-contained file.

Source evidence: [Deno desktop API](https://github.com/denoland/deno/blob/v2.9.7/cli/tsc/dts/lib.deno.desktop.d.ts), [Deno close callback](https://github.com/denoland/deno/blob/v2.9.7/cli/rt_desktop/lib.rs), [Windows backend](https://github.com/littledivy/laufey/blob/v0.7.0/webview/src/webview_windows.cc), [distribution guide](https://docs.deno.com/runtime/desktop/distribution/).
