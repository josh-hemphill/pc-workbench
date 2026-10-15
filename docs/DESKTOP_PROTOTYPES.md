# Desktop prototype findings

Follow-up to the [framework comparison](DESKTOP_FRAMEWORK_COMPARISON.md), on `exploration/node-pnpm-desktop`. Reviewed October 13, 2026 Pacific time.

## Linux native follow-up

The Linux prerequisites are now installed workspace-locally. Actual WebKitGTK/X11 checks passed for frontend rendering, script callbacks, canceled close retaining an edited form, blocked external navigation, and accepted close releasing SQLite. The packaged SEA also opened a native window and exited cleanly. See [setup and repeatable native checks](WEBVIEWJS_LINUX_SETUP.md). This supersedes the missing-Linux-libraries limitation below; Windows/macOS and broader native UX checks remain outstanding.

## Current result

**WebviewJS is now a runnable Node desktop experiment with our own SEA packaging. Neutralino has a runnable Node-owned host adapter. Tauri has a verified, target-named backend sidecar input, but no Rust window host yet.** Main now uses Node.js/pnpm exclusively; the old runtime and native host have been removed.

| Candidate | Concrete work | Verification here | Still needed |
| --- | --- | --- | --- |
| WebviewJS 0.4.7 | Node window adapter, close decision, native navigation/popup guards, profile context, embedded/extracted N-API addon | Typecheck/build; actual desktop SEA in empty PATH/cwd; API/persistence/restart; Chromium close-decision UI; clean native missing-library failure | Actual Windows/macOS/Linux native window, downloads, native guard enforcement and release signing |
| Neutralino 6.10.0 + client 6.10.0 | Node starts a supplied native binary, injects client/close hook, connects token-authenticated extension protocol, stops backend before native exit | Real child/WebSocket protocol fixture, including rejected stale approval and session cleanup | Actual native binary/UI, same-window navigation veto, installer and browser-profile behavior |
| Tauri 2 | Existing backend SEA tested and copied to the correct `externalBin` target-triple filename; config fragment generated | Real sidecar stdout-ready/stdin-shutdown/EOF protocol and workspace lock release | Implement/compile Rust host and validate installer/native window; Rust and Linux development prerequisites absent here |
| Electrobun 2.0.2 / Cottontail 0.7.1 | Verified paired Hutch 0.27.1 download; cross-runtime backend probe prepared | Hutch version confirmed; compatibility probe passed under Node as reference | Cottontail execution: its release manifest is blocked by the environment proxy, so runtime compatibility is unverified |

Neither the protocol fixture nor Chromium is a native WebView test. CI now packages/headlessly probes desktop artifacts on Windows, macOS and Linux; this configuration does not certify native UI behavior.

## Try WebviewJS

```sh
pnpm install --frozen-lockfile
pnpm build:web
pnpm dev:desktop
```

This source command serves the built frontend in the native window; it does not add native-window HMR yet. Ordinary `pnpm dev` retains the existing Vue HMR workflow. Use `BENCH_CONFIG_FILE`, `BENCH_DATA_DIR`, `BENCH_USER_SETTINGS_FILE` and `BENCH_CACHE_DIR` as documented for an isolated review workspace. Source mode defaults to repository data; packaged mode defaults to profile data.

For a self-contained artifact:

```sh
pnpm build:desktop
pnpm package:desktop
pnpm test:desktop-package
```

Run `bin/pc-workbench-desktop-<platform>-<arch>` (with `.exe` on Windows). It contains Node, the frontend/backend JS, the platform-specific native addon and the Neutralino client. WebviewJS is the default shell. The generated manifest distinguishes included window support from actual validation with `windowValidated:false`.

Node SEA cannot load an embedded `.node` addon directly. This prototype writes it beneath the configured per-user cache in a version/platform/architecture/SHA-256 directory, verifies the content before loading, and rejects corrupt files or symlink targets. The wrapper JS remains bundled. No installed Node or node_modules is required by the packaged WebviewJS path, but the OS WebView libraries still are.

The packaging uses the project's pinned esbuild and Postject, not WebviewJS's published CLI. Native package resolution is relative to WebviewJS itself so it works with pnpm's isolated dependency layout. Node's SEA loader is adapted to load the extracted addon. Snapshots/code cache remain disabled; target binaries must be built on each native OS/architecture.

Measured artifact metadata is saved in the [prototype evidence snapshot](research/desktop-prototype-2026-10-14.json). Linux x64 measurements are approximately **132.32 MiB executable / 45.17 MiB gzip**, versus **124.00 MiB / 42.09 MiB** for the backend alone. The native addon is 8,682,336 bytes. These are experimental executable sizes, not signed installers or a measurement of native startup/memory use.

## Close and navigation behavior

The Vue app exposes one read-only `__pcWorkbenchCanClose()` decision. It shares the unsaved-state checks used for browser unload, rejects an active top-level save/import, and asks whether to discard edits. Canceling does not reset forms. The hook provides no filesystem/process API.

WebviewJS cancels the OS close synchronously before requesting the renderer decision. It checks the displayed origin, uses a fresh request ID, validates the callback, and rechecks the origin before accepting. Missing hooks, malformed callbacks, errors and timeouts leave the window open. Repeated native requests share one pending decision. Accepted close waits for HTTP shutdown/SQLite lock release before disposing native resources; host shutdown is idempotent.

The native source at the npm package's recorded commit, `ff35d93ed1fac7962f4c4f0fa155aff0380fcaa8`, uses a CalleeHandled N-API script callback (error-first), while the online guide describes one argument. The adapter handles both, including quoted WebView2 JSON results. This is another reason to verify the installed version rather than copy a current documentation example.

Navigation is limited to the exact local app origin; new windows are denied. The desktop API also rejects another loopback port and a mismatched Host header. Native guard correctness still needs platform tests: the binding's native guard helpers default to allowing navigation if invoking the JS callback fails. Our handlers catch invalid URLs and return false, but that cannot establish native enforcement under every failure mode.

Opening allowed external product links in the OS browser is not implemented in this experiment. File uploads, HTTP downloads and Blob-based exports must be tested in each native engine before adoption. The normal browser workflow remains available while these checks are incomplete.

## Try Neutralino

Supply an official **Neutralino 6.10.0** binary for the current platform. The adapter expects an executable, not a zip archive or the npm CLI. It does not silently download or choose a newer framework version.

```sh
# POSIX example; use an absolute native-binary path on each OS.
BENCH_NEUTRALINO_BIN=/absolute/path/to/neutralino pnpm dev:neutralino
```

Build the frontend first. The same packaged desktop executable can select this adapter with `--neutralino`; `BENCH_NEUTRALINO_BIN` is still required. A final installer would bundle and verify that binary instead of relying on the reviewer's environment variable. No complete Neutralino distribution size is claimed.

Node owns Express/SQLite and the native child. It writes private per-launch configuration, authentication and preload files under the profile cache, injects the pinned client library, and uses the framework's exported authentication to connect the host extension. The native binary does **not** contain that client library; the adapter supplies it explicitly. Version-pinned source checks confirmed both the client-library configuration requirement and the `nlPort` / `nlToken` / `nlConnectToken` authentication fields.

The renderer receives only `app.exit` and `extensions.dispatch` capabilities. It can submit a session-specific close approval through the native extension channel. The host ignores other events/stale session IDs, closes the backend first, requests native exit, and applies bounded termination fallbacks. Session files are removed afterward. WebView2's data directory stays under the configured user cache; permanent framework storage is configured for the system profile.

Popups use the custom policy and are suppressed. A same-window native navigation veto remains a release blocker. The injected close script refuses to run on another origin, but that is not a replacement for native navigation control. Startup-error presentation, saved window state, second-launch focus and browser-cache behavior also remain native checks. The adapter currently reports startup errors through its console.

## Tauri integration boundary

```sh
pnpm build
pnpm package:sea
pnpm test:sea
pnpm stage:tauri-sidecar
```

Staging creates `.standalone/tauri/binaries/pc-workbench-backend-<target-triple>` and `bundle.fragment.json`. It checks the backend manifest's platform, architecture and SHA-256 before copying. This is bundle input, not a generated Tauri application or installer.

The remaining Rust host should launch this fixed binary with `--desktop`, validate the bounded stdout readiness record, then create the WebView at its loopback origin. Native close must be prevented until the same Vue decision returns, followed by `shutdown\n`, lock release and host exit. EOF remains the crash/parent-exit fallback. Use native navigation/popup callbacks and keep any renderer command limited to that close exchange; generic shell/filesystem permissions are unnecessary. Profile cache placement and second-launch focus belong in this host, while portable data paths remain backend-owned.

Tauri retains the strongest release-tooling case. This pass deliberately does not label an uncompiled Rust scaffold as a working desktop implementation.

## Electrobun runtime probe

The official Electrobun 2.0.2 artifact index pinned Hutch 0.27.1. Its Linux archive was verified against the index's size and SHA-256, and `hutch --version` returned 0.27.1. [Official artifact index](https://github.com/blackboardsh/electrobun/releases/download/v2.0.2/hutch-artifacts.json). Runtime selection is separate from this successful tool installation.

`hutch cottontail path 0.7.1` failed with `ReleaseDownloadFailed`. Inspecting Hutch's downloader located the official manifest at `https://electrobun-artifacts.blackboard.sh/cottontail/releases/0.7.1/manifest.json`; direct access returns proxy 403. This is an acquisition failure, not evidence that the backend is incompatible.

A reproducible probe is included:

```sh
pnpm probe:runtime  # Node reference run
# On a machine with the complete Cottontail 0.7.1 distribution:
cottontail tools/node/runtime-compatibility-probe.ts
```

It uses temporary data and checks actual SQLite/WAL initialization, an Express revisioned edit, CSV/backup, rollback after an injected persistence failure, durable restart, origin rejection and lock release. It passed under Node. After it passes under Cottontail, run the application test files using Cottontail's test runner and measure a complete packaged application. Do not substitute Node's test-runner command and call that runtime validation.

## Validation and next decision

- Full application suite: **342 passed**; Vue/TypeScript check and production desktop build passed.
- Actual backend and desktop SEAs: empty PATH/cwd, embedded assets, revisioned edits, exports/backup, SQLite restart, shutdown command, parent EOF, occupied-port failure and workspace-lock release passed. Desktop headless mode also extracts the embedded addon into the separate cache.
- Packaged UI in Chromium: clean close, dirty-form cancellation preserving the input, approved discard decision, and 390/320-pixel layouts passed without page errors.
- Native Linux startup: missing WebKitGTK was reported and the workspace lock released; no native window was launched.
- Neutralino protocol: real child process and WebSocket verified stale-approval rejection, backend shutdown before native exit and per-session cleanup. Native Neutralino itself remains untested.
- Cross-runtime probe: passed under Node only. Windows/macOS CI and native-window results remain separate evidence to obtain.

The next meaningful decision is a packaged Windows comparison: test unsaved component/bulk/transition forms, imports, CSV/Blob downloads, source links, profile/portable-path separation, occupied workspace/port errors, second launch, DPI and native close. Compare WebviewJS's simpler Node workflow against Tauri's installer/signing/lifecycle support. Keep Neutralino behind a proven same-window navigation restriction and Cottontail behind the runtime compatibility probe.
