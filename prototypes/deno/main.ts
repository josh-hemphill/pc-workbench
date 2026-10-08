import { Backend, proxyRequest } from './backend.ts';

const headless = Deno.env.get('BENCH_DENO_HEADLESS') === '1';
const separator = Deno.build.os === 'windows' ? '\\' : '/';
const executable = Deno.execPath();
const directory = executable.slice(0, executable.lastIndexOf(separator));
const backendPath = Deno.env.get('BENCH_DENO_SERVER') || `${directory}${separator}pc-workbench-server${Deno.build.os === 'windows' ? '.exe' : ''}`;
const appWindow = headless ? undefined : new Deno.BrowserWindow({ title: 'PC Workbench — Deno prototype (save before closing)', width: 1440, height: 960 });
appWindow?.setTitle('PC Workbench — Deno prototype (save before closing)');
let backend: Backend | undefined;
let backendOrigin: string | undefined, startupError: string | undefined;
let closing: Promise<void> | undefined;
const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen: ({ port }) => console.log(JSON.stringify({ type: 'proxy', url: `http://127.0.0.1:${port}` })) }, request => {
  if (backendOrigin) return proxyRequest(request, backendOrigin);
  if (startupError) return new Response(`PC Workbench Deno prototype could not start.\n${startupError}`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  return new Response('Starting the local server…', { status: 503 });
});

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
  backend = new Backend(backendPath);
  backendOrigin = await backend.ready;
  // Native startup gives up waiting after 15 s, before our 30 s backend timeout.
  // Explicit navigation replaces any earlier startup/error document.
  if (appWindow && !closing && !appWindow.isClosed()) appWindow.navigate(`http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`);
  console.log(JSON.stringify({ type: 'ready', backend: backendOrigin, pid: backend.child.pid }));
  void backend.status.then(status => {
    if (!closing) {
      backendOrigin = undefined;
      startupError = `The server exited unexpectedly (${status.code}). Close and restart the prototype.`;
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
