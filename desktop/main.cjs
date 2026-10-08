'use strict';
const { app, BrowserWindow, dialog, Menu, shell } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { parseBackendMessage, isAppNavigation, externalHTTPS, stopBackend } = require('./protocol.cjs');

let window, backend, quitAllowed = false, stopping = false, failed = false, ready = false;
let startupTimer, stderr = '', pending = '';

function stop() {
  if (stopping) return;
  stopping = true;
  clearTimeout(startupTimer);
  stopBackend(backend, { onStopped: result => {
    if (!result.confirmed) dialog.showErrorBox('Server shutdown was not confirmed', 'The local server did not exit after the shutdown timeout. Check Task Manager for pc-workbench-server.exe before restarting PC Workbench. Your workspace lock will prevent a second server from opening the same data.');
    quitAllowed = true; app.quit();
  } });
}
function fail(message) {
  if (failed || stopping) return;
  failed = true;
  dialog.showErrorBox('PC Workbench could not start', message);
  if (window && !window.isDestroyed()) window.destroy();
  stop();
}
function openExternal(url) { const allowed = externalHTTPS(url); if (allowed) void shell.openExternal(allowed).catch(error => dialog.showErrorBox('Cannot open link', error.message)); }

function createWindow(url) {
  const origin = new URL(url).origin;
  window = new BrowserWindow({ title: 'PC Workbench', width: 1440, height: 960, minWidth: 800, minHeight: 600, show: false, backgroundColor: '#f4f7fa', webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, webviewTag: false, navigateOnDragDrop: false, webSecurity: true } });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.on('will-navigate', event => { if (!isAppNavigation(event.url, origin)) event.preventDefault(); });
  window.webContents.on('will-frame-navigate', event => { if (!isAppNavigation(event.url, origin)) event.preventDefault(); });
  window.webContents.on('will-redirect', event => { if (!isAppNavigation(event.url, origin)) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  // Renderer JavaScript cannot prove user activation. External links require the native context-menu action below.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('context-menu', (_event, params) => {
    const template = [];
    if (externalHTTPS(params.linkURL)) template.push({ label: 'Open link in browser', click: () => openExternal(params.linkURL) }, { type: 'separator' });
    if (params.isEditable) template.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' });
    else if (params.selectionText) template.push({ role: 'copy' });
    if (template.length) Menu.buildFromTemplate(template).popup({ window });
  });
  window.webContents.on('will-prevent-unload', event => {
    const discard = dialog.showMessageBoxSync(window, { type: 'question', title: 'Unsaved changes', message: 'Discard unsaved changes?', detail: 'Your changes in the open editor will be lost.', buttons: ['Keep editing', 'Discard changes'], defaultId: 0, cancelId: 0, noLink: true });
    if (discard === 1) event.preventDefault();
  });
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => { window = null; stop(); });
  window.webContents.on('render-process-gone', (_event, details) => fail(`The application window stopped (${details.reason}). Restart PC Workbench. Saved inventory is retained.`));
  window.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => { if (isMainFrame && code !== -3) fail(`Cannot load the local application: ${description}`); });
  void window.loadURL(url).catch(error => fail(error.message));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.on('before-quit', event => { if (!quitAllowed) { event.preventDefault(); if (window && !window.isDestroyed()) window.close(); else stop(); } });
  app.on('window-all-closed', stop);
  app.whenReady().then(() => {
    if (stopping || failed) return;
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'File', submenu: [{ role: 'close' }, { role: 'quit' }] },
      { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: 'View', submenu: [{ role: 'reload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
      { label: 'Help', submenu: [{ label: 'About PC Workbench', click: () => void dialog.showMessageBox({ type: 'info', title: 'PC Workbench', message: `PC Workbench ${app.getVersion()}`, detail: 'Local inventory, configuration and installation management. Data stays in your configured workspace.' }) }] },
    ]));
    const executable = path.join(process.resourcesPath, 'pc-workbench-server.exe');
    backend = spawn(executable, ['--desktop'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
    startupTimer = setTimeout(() => fail('The local server did not become ready within 30 seconds. Check your settings and restart PC Workbench.'), 30000);
    backend.once('error', error => fail(`Cannot launch the local server: ${error.message}`));
    backend.stdin.on('error', error => { if (!stopping) fail(`Cannot communicate with the local server: ${error.message}`); });
    backend.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8192); });
    backend.stdout.setEncoding('utf8');
    backend.stdout.on('data', chunk => {
      if (stopping || failed) return;
      pending += chunk;
      if (Buffer.byteLength(pending) > 65536) { fail('The local server sent an invalid startup message.'); return; }
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline).trim(); pending = pending.slice(newline + 1);
        if (!line) continue;
        try {
          const message = parseBackendMessage(line);
          if (message.type === 'error') { fail(message.message); return; }
          if (ready) throw Error('The server reported readiness twice.');
          ready = true; clearTimeout(startupTimer); createWindow(message.url);
        } catch (error) { fail(`Invalid local server response: ${error.message}`); return; }
      }
    });
    backend.once('exit', (code, signal) => { if (!stopping) fail(`The local server stopped unexpectedly (${signal || `exit ${code}`}).${stderr ? `\n\n${stderr}` : ''}`); });
  }).catch(error => fail(error.message));
}
