# WebviewJS Linux prerequisites and native checks

The managed Debian 13 workspace now has WebKitGTK 2.54.0, GTK 3.24.49, libxdo, development headers, Xvfb and X11 close-event test tools installed under `/workspace/.tools/webviewjs-native`. Signed Debian indexes and package checksums were verified by APT. Packages were extracted locally because the workspace user has no administrator access; system packages were not changed.

## Use the installed environment

```sh
source /workspace/.tools/webviewjs-native/env.sh
pnpm build:desktop
pnpm package:desktop
/workspace/.tools/webviewjs-native/run ./bin/pc-workbench-desktop-linux-x64
```

The generated `env.sh` exposes the native libraries, binaries, headers and pkg-config metadata. The `run` wrapper starts a D-Bus session and maps WebKit's compiled-in helper-executable directory to the local installation using `proot`. Without an existing `DISPLAY`, it creates a virtual X11 display automatically. The environment remains workspace-local; no separate Node installation is needed by the packaged executable.

The wrapper disables libuv io_uring use and path-mapper syscall acceleration for compatibility, and selects software graphics by default. It **does not disable WebKit's sandbox**. The prerequisite inventory is at `/workspace/.tools/webviewjs-native/installed-packages.json` (135 packages, including transitive dependencies).

Source-mode static file serving encountered an `EFAULT` during an asynchronous file open under the path mapper after native initialization. Use the packaged executable in this managed environment. The native integration check serves the same built assets from memory, as packaging does. Run pnpm commands outside the path mapper; its configuration-file reads can encounter the same issue. The direct Node native-check command below and the packaged executable both passed. This local path-mapping issue does not establish a source-mode failure on a normal system installation.

## Normal Debian/Ubuntu installation

On an administrator-controlled machine, install the libraries normally; the local path mapper is unnecessary:

```sh
sudo apt-get update
sudo apt-get install --no-install-recommends \
  libwebkit2gtk-4.1-dev libxdo-dev xvfb xauth xdotool dbus-x11 x11-utils python3
pnpm install --frozen-lockfile
pnpm build:web
pnpm dev:desktop
```

Node 26 and the pinned WebviewJS prebuilt addon are used. A Rust toolchain is not needed to build this application's JS bundle and SEA from the published native addon. Rebuilding the addon itself from Rust source is a separate toolchain setup.

## Repeat the real native check

In the managed workspace:

```sh
/workspace/.tools/webviewjs-native/run node tools/node/native-webview-smoke.ts
```

With system-installed prerequisites:

```sh
xvfb-run -a dbus-run-session -- pnpm test:desktop-native
```

The check requires Python 3 and X11 tools. It creates temporary workspace/settings/cache paths, loads the real Vue frontend in WebKitGTK, edits a component form, sends actual `WM_DELETE_WINDOW` requests, confirms cancellation preserves both the form and backend, rejects external navigation, and verifies accepted close releases the SQLite lock. Confirmation answers are controlled inside the test renderer; the native close event and script callback transport are real.

Optionally set `BENCH_NATIVE_SCREENSHOT=/absolute/path/native-window.png` to capture the loaded window; this additionally requires ImageMagick's `import` utility. Use a dedicated display so the close-event fixture targets only the test application.

## Observed results

- Native binding loaded; pkg-config resolves WebKitGTK and GTK development metadata.
- The real frontend, styles and API loaded in the native window.
- Native script callbacks returned the close decision correctly.
- Canceling an OS close retained an edited component form and the running backend.
- Attempted navigation to an external origin retained the local application document.
- Accepting an OS close released the database lock.
- The actual packaged SEA opened a native window, loaded its cache-extracted addon, accepted an OS close and exited with code zero with no remaining workspace lock.
- The new native check and the Vue/TypeScript check passed.

This verifies the Linux path under Xvfb. Windows/macOS native checks, file dialogs/downloads, source-link opening, installer/signing and second-launch UX remain outstanding. See [prototype findings](DESKTOP_PROTOTYPES.md).
