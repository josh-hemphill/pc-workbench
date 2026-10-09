import assert from 'node:assert/strict';
import { Backend, proxyRequest } from './backend.ts';
import { startDesktopProxy } from './proxy-server.ts';
// @deno-types="./server-bundle.d.mts"
import { createApp } from './server-bundle.mjs';

Deno.test('desktop serve override belongs only to the proxy; Express retains its configured port', async () => {
  const directory = await Deno.makeTempDir({ prefix: 'pc-workbench-desktop-address-' });
  // Keep both reservations open until ports have been chosen so they differ.
  const proxyReservation = Deno.listen({ hostname: '127.0.0.1', port: 0 });
  const backendReservation = Deno.listen({ hostname: '127.0.0.1', port: 0 });
  const proxyPort = (proxyReservation.addr as Deno.NetAddr).port;
  const backendPort = (backendReservation.addr as Deno.NetAddr).port;
  proxyReservation.close(); backendReservation.close();
  const previousOverride = Deno.env.get('DENO_SERVE_ADDRESS');
  Deno.env.set('DENO_SERVE_ADDRESS', `tcp:127.0.0.1:${proxyPort}`);
  let proxy: Deno.HttpServer | undefined;
  let backend: Backend | undefined;
  let backendOrigin: string | undefined;
  try {
    proxy = startDesktopProxy(request => backendOrigin
      ? proxyRequest(request, backendOrigin)
      : new Response('Starting', { status: 503 }), () => {});
    assert.equal((proxy.addr as Deno.NetAddr).port, proxyPort);
    assert.equal(Deno.env.get('DENO_SERVE_ADDRESS'), undefined);
    backend = new Backend(() => createApp(directory), { port: backendPort });
    backendOrigin = await backend.ready;
    assert.equal(backendOrigin, `http://127.0.0.1:${backendPort}`);
    const state = await fetch(`http://127.0.0.1:${proxyPort}/api/state`);
    assert.equal(state.status, 200); const { revision } = await state.json();
    const record = { id: 'desktop-address-location', name: 'Desktop address bench', kind: 'Bench', parentId: '', requirementSetId: '', requirementRevision: 0, targetConfigurationId: '', notes: '' };
    const saved = await fetch(`http://127.0.0.1:${proxyPort}/api/installationLocations/${record.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': revision }, body: JSON.stringify(record),
    });
    assert.equal(saved.status, 200, await saved.text());
    const csv = await fetch(`http://127.0.0.1:${proxyPort}/api/export/installationLocations`);
    assert.equal(csv.status, 200); assert.match(await csv.text(), /desktop-address-location/);
    await backend.stop();
    assert.equal((await backend.status).success, true);
    await assert.rejects(Deno.stat(`${directory}/.server-lock.json`), Deno.errors.NotFound);
  } finally {
    await proxy?.shutdown(); await backend?.stop();
    if (previousOverride === undefined) Deno.env.delete('DENO_SERVE_ADDRESS');
    else Deno.env.set('DENO_SERVE_ADDRESS', previousOverride);
    await Deno.remove(directory, { recursive: true });
  }
});
