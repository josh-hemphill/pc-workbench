# Desktop validation and remaining limitations

## Current architecture

The repository runs the complete pipeline with Deno 2.9.7. Deno installs pinned npm dependencies from `deno.json`/`deno.lock`, runs Vite/Vue and the Vue/TypeScript checker, executes the application tests, bundles the backend and frontend, and cross-builds the native WebView package. Node and pnpm are not required.

The desktop application runs Express and native `node:sqlite` **inside Deno**, sharing the existing backend/business logic in `server/app.ts`. SQLite persistence, inventory, installation tracking, compatibility checks, CSV import/export and user-only storage configuration use the same implementation as the application. The former Node SEA sidecar and its private subprocess protocol have been removed from the repository.

The window renders the unchanged Vue/Vuetify UI through a guarded local proxy. The proxy consumes the desktop runtime’s `DENO_SERVE_ADDRESS` override, then clears it before Express starts: Deno 2.9.7 tracks this override independently in `Deno.serve` and `node:http`, otherwise both listeners try to bind the shell-assigned port. Its backend honors the configured API port; its window proxy uses an automatic port. The runtime has filesystem, environment, system information and localhost network permissions, with no subprocess permission and no privileged renderer bindings. Shutdown drains connections within a deadline and closes SQLite. Both window and backend are in one process.

See [setup, tasks and packaging](../docs/DENO.md).

## Validation

- Deno's native `node:sqlite` supports the application's `DatabaseSync` API; no external SQLite library or FFI adapter is needed.
- All **222 application tests across 30 files** pass under Deno, with individual JUnit counts checked. The 13 tests for the retired Electron/Node-sidecar protocol were removed with that unused code; application tests are retained. Six API test fixtures explicitly close remaining test connections after assertions to account for Deno HTTP keepalive behavior.
- Seven additional in-process desktop integration tests cover real SQLite edits/restart, CSV import/export, backups, stale revisions, malformed imports, Host/Origin rejection, duplicate workspace ownership, startup port errors, desktop-assigned proxy/backend port separation, and bounded shutdown. They run without `--allow-run`.
- Vite/Vue production builds, development transforms and Vue/TypeScript checking execute inside Deno. An intentional type-error probe was rejected. A clean Deno dependency installation was tested independently of the previous pnpm `node_modules`.
- Runtime packaging embeds only used backend dependencies and frontend assets. It rejects Node executables, the former server sidecar and `node_modules` directories. ZIP and embedded-file checksums are emitted.

Windows x64 packaging is cross-built on Linux. Windows GUI execution requires a Windows machine and is not established by Linux tests. Package manifests identify the in-process backend and `nodeSidecar:false`.

## Remaining adoption blockers

Deno 2.9.7 pins Laufey 0.7.0's WebView implementation: WebView2 on Windows and WebKitGTK on Linux. Its Windows backend automatically accepts `beforeunload`; the native close callback is a noncancelable notification. Unsaved draft protection remains unresolved.

This version also lacks native pre-navigation veto, popup policy and permission interception. Its Windows backend can open HTTP/HTTPS popup URLs externally without requiring user activation. The response CSP remains useful but does not replace native policies. Do not add privileged renderer bindings while these controls are unavailable.

WebView2 and Microsoft Visual C++ 2015–2022 Redistributable (x64) must already be installed, and browser-cache placement must be established before native initialization. A production installer/bootstrapper, code-signing process and remaining native policy fixes are still needed. The native runtime uses a launcher plus Deno runtime DLL. Optional Windows-only `deno task package:windows:single` wraps those files with built-in IExpress into one self-extracting EXE for distribution; files are extracted to temporary storage at runtime. Windows CI verifies both distributions and the seven desktop integration tests; native GUI launch and cleanup still require a manual Windows trial.

Source evidence: [Deno desktop API](https://github.com/denoland/deno/blob/v2.9.7/cli/tsc/dts/lib.deno.desktop.d.ts), [Deno close callback](https://github.com/denoland/deno/blob/v2.9.7/cli/rt_desktop/lib.rs), [Windows backend](https://github.com/littledivy/laufey/blob/v0.7.0/webview/src/webview_windows.cc), [distribution guide](https://docs.deno.com/runtime/desktop/distribution/).
