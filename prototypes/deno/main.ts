import { Backend, proxyRequest } from './backend.ts';
import { startDesktopProxy } from './proxy-server.ts';
// @deno-types="./server-bundle.d.mts"
import { createApp, resolveRuntimeConfig, assets } from './server-bundle.mjs';

const headless = Deno.env.get('BENCH_DENO_HEADLESS') === '1';
if (!headless && typeof Deno.BrowserWindow !== 'function') {
  throw new Error('The native window requires Deno’s desktop runtime. Run deno task desktop from the repository root; ordinary deno run does not provide BrowserWindow.');
}
const appWindow = headless ? undefined : new Deno.BrowserWindow({ title: 'PC Workbench — Deno prototype (save before closing)', width: 1440, height: 960 });
appWindow?.setTitle('PC Workbench — Deno prototype (save before closing)');
let backend: Backend | undefined;
let backendOrigin: string | undefined, startupError: string | undefined;
let closing: Promise<void> | undefined;
const server = startDesktopProxy(request => {
  if (backendOrigin) return proxyRequest(request, backendOrigin);
  if (startupError) return new Response(`PC Workbench Deno prototype could not start.\n${startupError}`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  return new Response('Starting the local server…', { status: 503 });
}, ({ port }) => console.log(JSON.stringify({ type: 'proxy', url: `http://127.0.0.1:${port}` })));

function close(): Promise<void> {
  return closing ??= (async () => {
    let code = 0;
    try { await backend?.stop(); } catch (error) { console.error(error); code = 1; }
    await server.shutdown();
    Deno.exit(code);
  })();
}
appWindow?.addEventListener('close', () => { void close(); });
// Prototype intentionally exposes no privileged renderer bindings. Deno 2.9.7
// cannot guarantee cancelable native close or intercept external navigation.
if (Deno.build.os !== 'windows') {
  Deno.addSignalListener('SIGTERM', () => { void close(); });
  Deno.addSignalListener('SIGINT', () => { void close(); });
}
try {
  const config = resolveRuntimeConfig({ standalone: true });
  backend = new Backend(() => createApp(config.dataDir, { assets }), { port: config.port });
  backendOrigin = await backend.ready;
  // Native startup gives up waiting after 15 s; explicitly refresh when ready.
  // Explicit navigation replaces any earlier startup/error document.
  if (appWindow && !closing && !appWindow.isClosed()) appWindow.navigate(`http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`);
  console.log(JSON.stringify({ type: 'ready', backend: backendOrigin, pid: Deno.pid }));
  void backend.status.then(status => {
    if (!closing) {
      backendOrigin = undefined;
      startupError = `The local server stopped unexpectedly (${status.code}). Close and restart the prototype.`;
      if (appWindow) appWindow.reload(); else void close();
    }
  });
} catch (error) {
  startupError = error instanceof Error ? error.message : String(error);
  console.error(startupError);
  try { await backend?.stop(); } catch (shutdownError) { console.error(shutdownError); }
  if (appWindow && !closing && !appWindow.isClosed()) appWindow.navigate(`http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`);
  if (headless) { await server.shutdown(); Deno.exit(1); }
}
