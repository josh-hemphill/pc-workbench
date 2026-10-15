# Desktop validation and remaining limitations

Development, tests, builds and executable packaging use Node.js 24 and pnpm. The retired runtime, native host, lockfile, packagers and CI workflow have been removed. Framework comparison documents retain historical research; current commands are in [README](../README.md) and [desktop prototypes](DESKTOP_PROTOTYPES.md).

## Validated behavior

The backend uses Express and built-in `node:sqlite`, with portable workspace data and separate per-user settings. CI tests application behavior and builds both server and desktop single-executable applications on Linux, Windows and macOS. The executable checks cover embedded assets with empty PATH/cwd, revisioned edits, CSV/backup, persistence across restart, shutdown on command/parent EOF, port-conflict failure and workspace-lock release.

Linux WebviewJS native checks exercise frontend rendering, exact-origin navigation restrictions, cancelled OS close with an edited form retained, accepted close and SQLite lock release. CI runs these checks under Xvfb with WebKitGTK. The test supplies confirmation answers in the renderer; it does not assess the appearance of native confirmation dialogs.

## Remaining adoption work

- Windows/macOS native rendering, close behavior, navigation and popup policy need real GUI trials. Passing packaging and headless tests does not establish these behaviors.
- Native file dialogs, downloads, accessibility, documentation-link opening and OS integration need platform validation. The WebviewJS experiment currently rejects external navigation and popups.
- Windows requires WebView2 and Visual C++ runtime prerequisites; Linux requires WebKitGTK/GTK. See [Linux setup](WEBVIEWJS_LINUX_SETUP.md).
- Executables embed the Node runtime. Desktop packages also extract a SHA-256-verified native addon into the private user cache. Distribution size, signing/notarization, installers, prerequisite bootstrapping and updates need release work.
- Neutralino remains an alternative host experiment; its protocol fixture passes, but native GUI behavior and same-window navigation restrictions remain unverified. Tauri has sidecar staging only, without a Rust window host.

No native shell is selected for production release yet. These limits do not prevent using the Node server with a normal browser.
