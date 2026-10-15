# Desktop framework comparison for PC Workbench

Research snapshot: October 14, 2026 UTC. Branch: `exploration/node-pnpm-desktop`.

## Recommendation

Keep **Tauri 2 + the existing Node SEA backend** as the strongest distribution candidate. Add **WebviewJS** as the first small experiment for a simpler JavaScript development experience. Keep **Neutralino** as a serious alternative, particularly its newer host-project model. Do not commit to a shell until a packaged Windows prototype passes the same close, navigation, persistence and startup checks.

This refines the [initial migration assessment](NODE_DESKTOP_MIGRATION.md). Precise package searches found worthwhile options that broad framework recommendations miss. WebviewJS is particularly close to the original Deno desktop approach: a Node N-API binding to Tao/Wry, rather than another browser distribution or a backend rewrite. However, its published builder falls short of its current online documentation.

The [October 9 Deno announcement](https://deno.com/blog/cloudflare) is now independently verified: the team will provide monthly runtime bug fixes/security updates for another year, then end its development of the runtime. It remains open source. This confirms the user's migration motivation; community continuation is possible but is not a maintenance guarantee.

## What the app actually needs

Vue/Vuetify can stay unchanged. Express, the configuration/inventory/transition logic, and built-in `node:sqlite` already work under Node 24. The existing SEA embeds frontend assets and JS dependencies. A shell should preserve that investment and the separation between portable workspace SQLite and per-user settings/cache.

We need a native window, cancelable close with unsaved forms, controlled external links/popups, file upload/download behavior, profile-scoped browser storage, graceful database shutdown, useful startup errors, second-launch handling, and signed Windows/macOS distribution. A hello-world window alone does not demonstrate these requirements.

The measured Linux backend SEA is **124.00 MiB**, or **42.09 MiB through default gzip**. Every option retaining Node contains those runtime bytes somewhere. A small WebView host does not turn this application into a 5 MiB package. Keeping Node while avoiding a bundled Chromium is still valuable. Removing Node's size requires a separate runtime/backend compatibility project.

## Recent release and usage evidence

These figures come from exact-name npm registry searches, collected in the [evidence snapshot](research/desktop-npm-2026-10-14.json). The direct download API was blocked, but registry search results exposed weekly/monthly counts. Search does not supply explicit window boundaries; these are the registry's reported recent periods, not a dated time series. Latest release dates come from package version timestamps, not search-index update times.

| Package / role | Latest npm version | Published UTC | Reported weekly downloads | Reported monthly downloads |
| --- | --- | --- | ---: | ---: |
| `@tauri-apps/cli` — build CLI | 2.12.2 | 2026-10-10 | 2,727,270 | 10,954,685 |
| `@neutralinojs/neu` — build CLI | 11.8.0 | 2026-10-06 | 4,566 | 15,714 |
| `@neutralinojs/lib` — client API | 6.10.0 | 2026-10-06 | 1,887 | 7,079 |
| `@webviewjs/webview` — Node native binding | 0.4.7 | 2026-09-24 | 7,536 | 267,664 |
| `electrobun` — tooling bootstrap | 2.0.2 | 2026-09-29 | 40,443 | 239,914 |
| `@nativewindow/webview` — Node native binding | 1.0.6 | 2026-04-04 | 80 | 436 |
| `webview-nodejs` — Node binding | 0.5.0 | 2026-06-30 | 126 | 432 |
| `node-neutralino` — community Node host wrapper | 2.0.0 | 2024-08-27 | 11 | 36 |
| `webview` — separate older Node binding | 1.1.0 | 2023-06-04 | 121 | 557 |
| `@gluon-framework/gluon` — installed-browser shell | 0.14.0 | 2023-05-10 | 12 | 101 |
| `deskgap` — Node/system-WebView framework | 0.2.0 | 2019-12-04 | 13 | 51 |
| `@webui-dev/bun-webui` — Bun/WebUI binding | 2.5.7 | 2026-04-20 | 14 | 57 |

Downloads include development installs, CI and automation. CLI, binding and bootstrap counts measure different things; do not interpret them as installed application populations. WebviewJS's month/weekly disparity particularly needs a longer time series before inferring sustained adoption. Its repository page shows 81 stars and 195 commits; `@nativewindow/webview` shows 6 stars and 21 commits. These are supporting signals, not evidence of platform correctness. Counts can change or come from cached pages.

The registry lists seven publishing maintainers for the Tauri CLI and one for each other shortlisted package. Publisher count is not contributor count, but small publishing ownership matters when maintenance continuity is the reason for migrating.

Broad npm searches mostly returned unrelated mobile React Native packages. Exact package names, desktop/webview keywords, and searches for Node SEA/native lifecycle APIs were substantially more useful. A guessed `@webui-dev/node-webui` package returned 404; it is not an available Node alternative under that name.

## Tauri, Neutralino and WebviewJS in this repository

| Concern | Tauri 2 + Node SEA | Neutralino + Node SEA | WebviewJS + Node SEA |
| --- | --- | --- | --- |
| Backend | Existing SEA as bundled sidecar | Existing SEA as extension, or Node host launching Neutralino | Node can own both Express and native binding in one process; sidecar remains possible |
| Development | pnpm drives Vite/Node and Tauri CLI; Rust and platform development tools required | pnpm drives Vite/Node and `neu`; prebuilt host avoids compiling C++ for ordinary use | pnpm installs platform N-API addon; no Rust compilation when a matching prebuild works |
| Process ownership | Rust host starts fixed backend, reads readiness, writes shutdown, handles exit | Choose one owner: Neutralino starts backend extension, or Node starts Neutralino; avoid two competing supervisors | Prefer async GUI event pumping in Node; a blocking GUI loop would stop Express |
| Packaging | Established installers/signing/updater ecosystem; target-suffixed external binary | Resource embedding and builder targets exist; backend executable still needs its own packaging | Published binding useful; published CLI needs a replacement or repair for dependable SEA packaging |
| Native close | Native close request can be intercepted; prompt first, then stop backend and close | Set `exitProcessOnClose:false`, handle `windowClose`, then explicitly exit after confirmation/shutdown | JS wrapper exposes synchronous `preventDefault`; cancel first, then run async confirmation and dispose |
| External navigation | Native host navigation/new-window hooks; open allowed external links through OS opener | `newWindowPolicy` supports browser/custom handling; same-window redirect restriction still needs source/platform verification | Published wrapper includes synchronous navigation and new-window guards; verify enforcement in native binaries |
| User storage | Configure host browser data directory under profile; retain existing settings service | Set framework `dataLocation` and `storageLocation` to `system`; defaults place these beside the app | Configure WebContext/profile cache explicitly; addon extraction must also stay outside portable data |
| Main tradeoff | More build tooling, stronger release infrastructure | Less language tooling, additional extension/token/server coordination | Simplest Node API shape, more responsibility for packaging, lifecycle and ongoing native-binding maintenance |

The Tauri sidecar API maps directly to our existing stdout readiness and stdin shutdown protocol. Start it from the trusted Rust host rather than exposing generic process execution to the renderer. Package the Node binary for each native target and configure `externalBin` with Tauri's target-triple suffix. Keep the frontend served from the backend's loopback origin; do not casually switch to an asset origin and break relative API calls or origin checks. [Official sidecar guide](https://v2.tauri.app/develop/sidecar/).

Neutralino is more capable than the initial comparison implied. CLI 11.3 introduced `hostProject`; 11.6 added `neu build --embed-resources`; 11.8 improves development-command cleanup and injected-client integration. This means a Node-owned host is an actual documented path. Resource embedding packages Neutralino resources, not automatically the complete Node backend. The community `node-neutralino` wrapper is older and its README uses `projectRunner` terminology, while current CLI docs use `hostProject`; do not copy its template without checking compatibility. [CLI release notes](https://neutralino.js.org/docs/release-notes/cli/), [distribution overview](https://neutralino.js.org/docs/distribution/overview/).

Neutralino's native APIs use a token-protected WebSocket. Loading our Express URL needs deliberately configured client/global injection and a narrow API allow list. Avoid moving the app to Neutralino's static server merely to acquire those APIs: that would introduce a second origin and API proxy/CORS work. Prefer one process supervisor and retain a single app HTTP origin. Its close event and popup policies are documented, but they do not alone establish a native same-window navigation veto. [Configuration reference](https://neutralino.js.org/docs/configuration/neutralino.config.json/).

## What the narrower search uncovered

### WebviewJS: strongest new fit, with a published packaging gap

[`@webviewjs/webview`](https://github.com/webviewjs/webview) publishes N-API binaries for macOS, Windows and glibc Linux architectures and requires Node >=24. Its main-thread event pump can coexist with asynchronous Node work, making an Express backend plus window in one Node process plausible. Avoid `runSync` with an in-process API server. Synchronous SQLite work can also delay window event pumping during large imports; measure responsiveness before choosing one process.

The published JS wrapper includes cancelable window close and synchronous navigation/popup guards. For asynchronous unsaved-change confirmation, cancel immediately, request the decision from Vue, then dispose only after approval and database shutdown. This is a much closer API shape to the former Deno host than a new Rust application layer. [Lifecycle guide](https://webview.js.org/guides/application-lifecycle/), [navigation guide](https://webview.js.org/guides/navigation-and-popups/).

**Do not use the online SEA example as though it ships in npm 0.4.7.** I downloaded the npm tarball without running installation scripts and inspected `cli/index.mjs`, `cli/build.mjs` and the JS wrapper:

- Online docs describe `webview build entry.ts`, esbuild bundling, automatic addon embedding/extraction, pinned Postject, and runtime capability probing.
- Published 0.4.7 rejects the positional `build` command with `ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL`. Its accepted shape is `webview --build --input ...`.
- Its Node builder passes the entry directly to SEA, without bundling JS dependencies or embedding/extracting the `.node` addon automatically.
- It joins arguments into shell command strings and runs `npx --yes postject` without pinning the fetched version. Paths containing spaces and reproducible/offline builds need attention.
- Some packaged documentation describes different close/disposal behavior from the current online guide. Treat installed source and actual native behavior as authoritative.

These are source/CLI findings, not a failed native GUI test. A controlled prototype should use our already pinned esbuild/Postject packaging, explicitly embed the correct addon, extract it safely to a profile cache with integrity checks, and load it through Node's native-addon mechanism. The documented newer CLI may eventually remove that work, but an unreleased documentation claim is not a shipped capability. [Current executable-building guide](https://webview.js.org/guides/building-executables/), [published tarball](https://registry.npmjs.org/@webviewjs/webview/-/webview-0.4.7.tgz).

The Linux x64 0.4.7 native addon is 8,682,336 bytes. Inspection found WebKitGTK 4.1, JavaScriptCoreGTK 4.1 and libxdo missing on this host, so native launch was not attempted. This confirms prebuilt bindings still require system libraries. It is not a portable browser/runtime replacement. No complete WebviewJS GUI size or Windows behavior has been measured.

### NativeWindow and webview-nodejs: useful leads, weaker fit today

[`@nativewindow/webview`](https://github.com/nativewindow/webview) was first published in March 2026. It offers Tao/Wry N-API prebuilds, window control, typed IPC and WebView2 detection/installation. The repository labels it beta even though its npm version is 1.x. Published types expose `onClose(callback: () => void)` rather than an obvious cancellation event; several permissions are explicitly documented as not enforced by the Wry backend. Do not assume names such as `allowedHosts` or a permission flag establish the guarantees we need without checking native enforcement. Its very small recent download signal and six-month release gap place it behind WebviewJS for this app.

[`webview-nodejs`](https://github.com/Winterreisender/webview-nodejs) did publish a June 2026 update, so it should not be dismissed as abandoned. However, its published `start()` calls the native `webview_run` loop synchronously; documentation says timers stop. Keeping Express on that same thread would fail. A separate backend process could work, but then we still need packaging, close protection and native link controls. The older package named simply `webview` is a different project with a 2023 release; package names are not interchangeable.

### Electrobun 2: worth a compatibility spike if runtime size dominates

Current [runtime documentation](https://framework.blackboard.sh/electrobun/guides/native-main-process/) makes **Cottontail the default**, with Bun an explicit alternative. This corrects the earlier Bun-default assessment. Hutch manages the devkit/toolchain; the npm package is a small bootstrap, not the whole installed runtime.

The [build configuration](https://framework.blackboard.sh/electrobun/apis/cli/build-configuration/) recognizes `node:sqlite` as a selectable SQLite capability. That makes it more relevant than merely saying SQLite is unavailable. However, import recognition does not prove our `DatabaseSync`, prepared statements, backups, transaction semantics, Express streams and Node tests behave identically. Two routes remain: retain Node SEA as a sidecar (adding a second runtime), or validate the full backend under Cottontail to potentially shrink distribution. The latter is a distinct compatibility experiment; no size or correctness win is established here.

### Other precise-search results

[Gluon](https://github.com/gluon-framework/gluon) uses installed browsers and Node, but its npm release is from 2023 with little recent download activity. Browser discovery, profile behavior and native lifecycle fidelity are extra dependencies, so it is not the first replacement for the Deno native window.

[DeskGap](https://github.com/patr0nus/DeskGap) matches the attractive Node + system-WebView idea, but the original npm package last published in 2019. A newer repository fork alone does not establish a maintained, consumable Node 24 distribution. It is not shortlisted.

[WebUI's Bun binding](https://www.npmjs.com/package/@webui-dev/bun-webui) is real and recently published, but it changes the runtime and does not supply a verified Node package under the guessed name. [Lynxtron's newer CEF webview](https://lynxjs.org/next/lynxtron/Native-Libraries/Officially-Maintained-Libraries/cef-webview-getting-started.html) is another current search result, but adds CEF plus a different UI/host stack. Neither improves this app's Node + Vue + system-WebView migration enough to shortlist. Mobile React Native/Capacitor WebViews are not desktop Node hosts.

## Concrete next experiments and decision gates

1. **WebviewJS feasibility:** pin 0.4.7; open the current local Node UI with async native pumping; wire the existing Vue dirty-state decision to native close; reject external same-window navigation/popups. Build with our pinned SEA pipeline and an explicit native-addon asset. Verify launches outside the checkout with no installed Node, profile cache placement, clean SQLite shutdown, and paths containing spaces. Do not rely on the published CLI to solve addon packaging.
2. **Tauri distribution baseline:** wrap the same backend SEA as a fixed sidecar; reuse readiness/shutdown; add close/navigation guards and single-instance focus. Produce a Windows installer and assess Rust/toolchain friction from a clean checkout. This provides a practical comparison against WebviewJS's simpler development but more custom release work.
3. **Neutralino comparison:** use pinned current host-project configuration, injected client/globals and minimal native capabilities. Test the close/popup policies and prove a native same-window navigation restriction. Keep framework data/storage under the user profile and measure token/process startup complexity. Use the community Node wrapper only after a current-version compatibility check.
4. **Optional smaller-runtime experiment:** run existing backend tests and actual SQLite restart/backup/import cases under Electrobun's pinned Cottontail. Pursue only if reducing the measured Node runtime footprint justifies another compatibility surface.

Compare clean-install developer steps, cold start, packaged download/installed size, import responsiveness, child cleanup, browser cache locations, updates/signing and Windows DPI/table behavior. Use the same workspace and user profile scenarios across shells. A candidate wins only if it preserves unsaved edits and workspace integrity as well as opening a window.

Implementation follow-up: [desktop prototypes, commands and actual validation](DESKTOP_PROTOTYPES.md).

This research pass added research and evidence only. No native framework dependency, GUI implementation or release switch is introduced. Existing Node backend verification remains 334 passing tests; native parity still needs the experiments above.
