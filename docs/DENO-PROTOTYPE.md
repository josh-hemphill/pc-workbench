# Deno WebView desktop evaluation

## Decision

**The application works in a Deno WebView wrapper, but the reviewed Deno 2.9.7 Windows backend is not ready to replace our desktop package.** The remaining blockers concern unsaved drafts and native navigation/popup controls, rather than Vue, SQLite or CSV compatibility. The prototype is isolated from the normal application and packaging commands.

## What was built

- Official Deno 2.9.7 `deno desktop`, pinned Laufey 0.7.0, `webview` backend: WebView2 on Windows and WebKitGTK on Linux.
- A TypeScript desktop entrypoint and loopback proxy with no privileged renderer bindings or third-party Deno packages.
- The existing Node SEA executable as a bundled sidecar. Native SQLite, catalog/configuration compatibility checks, inventory, installation tracking and CSV handling stay in the existing backend.
- Private JSON readiness/shutdown over pipes, startup/error navigation, bounded startup messages, confirmed graceful/forced termination, and parent-loss shutdown. Deno's Node-compatible subprocess API suppresses the sidecar console on Windows.
- A Windows x64 application directory in a ZIP, plus SHA-256 and a manifest for every embedded file. It includes a native GUI `.exe`, Deno runtime `.dll` and `pc-workbench-server.exe`. The builder stages outside the pnpm workspace to exclude the unrelated npm dependency snapshot.

Build with `pnpm package:server:windows` followed by `pnpm prototype:deno:windows`. Install the pinned Deno separately or select it with `BENCH_DENO_BIN`. See [prototype launch, data isolation and reproduction instructions](../prototypes/deno/README.md).

## Evidence

| Check | Result |
|---|---|
| Released CLI availability | Downloaded and checksum-verified official Deno 2.9.7; `desktop --help` works. |
| Windows cross-build | Full WebView2 application packaged successfully from Linux; launcher, runtime DLL and Node sidecar are AMD64 PE files. |
| Type checking | Existing Node/Vue checks and Deno prototype checks pass. |
| Deno automated checks | Five checks pass, including real SEA/SQLite integration, startup errors, proxy host/origin boundaries and post-spawn errors not falsely confirming termination. |
| Frontend/API integration | Embedded Vue assets and state API served through the Deno proxy. Revision headers preserve protected edits. |
| Data workflows | SQLite edits survive backend restart. CSV export retains its attachment filename; exported CSV imports successfully. JSON backup includes the edits. |
| Actual desktop rendering | Compiled Linux WebView bundle launched on Xvfb with isolated WebKitGTK runtime dependencies; full Vue/Vuetify interface visibly rendered. |
| Default sidecar discovery | Actual packaged Linux app found its co-located backend without a path override. |
| Native close | Closing the mapped native window exited the wrapper with code 0, stopped its server, closed the backend port, released the workspace lock and retained SQLite data. |
| Windows runtime launch | Not performed: this environment is Linux and has no Windows WebView2 runtime. Native save dialogs and frontend Blob downloads also remain unverified; HTTP attachment checks establish payloads and filenames only. |

The initial Windows ZIP was about **65 MiB**, including the unchanged Node backend, versus the existing Electron portable package's **116 MiB**. These are the measured distribution formats, not an equal-codec engine-size benchmark. The uncompressed Deno folder is about 169 MiB; retaining both Deno and Node runtimes limits the size reduction.

A developer experiment using `BrowserWindow.executeJs` did not establish a reliable DOM inspection of the imported test entrypoint. GUI verification instead used screen capture, real proxy requests and native window-close messages. That exploratory harness is not shipped as a working automated GUI test.

## Production blockers

1. **Unsaved-close protection.** The pinned Windows WebView backend automatically accepts `beforeunload`. Deno's native close callback is a notification after native closure and cannot enforce the documented `preventDefault()` example. The app's existing browser draft guards therefore cannot reliably stop title-bar closure. Save drafts before testing.
2. **Navigation and popup policy.** The public desktop API has no native pre-navigation veto, popup policy or WebView permission handler. The Windows backend opens HTTP/HTTPS popup URLs externally without checking user activation. Proxy CSP and absent native bindings reduce exposure but do not provide the controls used in the current wrapper.
3. **Deployment integration.** WebView2 must be present. Its default browser-cache folder sits beside the executable, requiring a writable extraction folder or a launcher-provided user-data override. An installer must handle that directory and runtime prerequisite explicitly; the prototype ZIP does neither automatically.

Native code references: [desktop window types](https://github.com/denoland/deno/blob/v2.9.7/cli/tsc/dts/lib.deno.desktop.d.ts), [native close implementation](https://github.com/denoland/deno/blob/v2.9.7/cli/rt_desktop/lib.rs), [Windows popup and beforeunload behavior](https://github.com/littledivy/laufey/blob/v0.7.0/webview/src/webview_windows.cc), [WebView2 user-data-folder rules](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/user-data-folder).

To adopt Deno, obtain or contribute upstream native navigation/permission and cancelable-close controls, then validate them on Windows with dirty editors, blocked external navigation, missing WebView2, read-only install paths, startup failures, CSV downloads and crash recovery. A full backend migration into Deno could remove the second runtime, but it is a separate compatibility project and was not needed to prove this prototype.
