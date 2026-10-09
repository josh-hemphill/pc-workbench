import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createServer, request as httpRequest } from 'node:http';
import { Backend, proxyRequest, proxyTarget } from './backend.ts';
// @deno-types="./server-bundle.d.mts"
import { createApp } from './server-bundle.mjs';

const largeAsset=Buffer.from('Deno bundled asset '.repeat(100000));
const assets = { '/large.js':{data:largeAsset,mime:'text/javascript'}, '/index.html': { data: Buffer.from('<html><div id="app">Deno integration fixture</div></html>'), mime: 'text/html' } };

Deno.test('in-process startup errors reject readiness and shutdown stays idempotent', async () => {
  const backend = new Backend(() => { throw Error('workspace locked'); });
  await assert.rejects(backend.ready, /workspace locked/);
  const stopping = backend.stop(); assert.equal(stopping, backend.stop());
  await stopping; assert.equal((await backend.status).success, false);
});

Deno.test('proxy paths and queries cannot replace the fixed loopback upstream', () => {
  assert.equal(proxyTarget('http://127.0.0.1:5000//evil.example/api?q=x', 'http://127.0.0.1:3001'), 'http://127.0.0.1:3001//evil.example/api?q=x');
  assert.throws(() => proxyTarget('http://127.0.0.1/', 'https://example.com'));
});

Deno.test('proxy rejects foreign host and origin before connecting to backend', async () => {
  const foreignHost = await proxyRequest(new Request('http://example.com/'), 'http://127.0.0.1:1');
  assert.equal(foreignHost.status, 403); await foreignHost.text();
  const foreignOrigin = await proxyRequest(new Request('http://127.0.0.1:5000/', { headers: { origin: 'https://example.com' } }), 'http://127.0.0.1:1');
  assert.equal(foreignOrigin.status, 403); await foreignOrigin.text();
});

Deno.test('native Deno Express/SQLite: proxy frontend, revisioned edits, CSV, backup, shutdown and restart', async () => {
  const directory = await Deno.makeTempDir({ prefix: 'pc-workbench-deno-test-' });
  const factory = () => createApp(directory, { assets });
  let backend: Backend | undefined;
  let proxy: Deno.HttpServer | undefined;
  try {
    backend = new Backend(factory);
    const backendOrigin = await backend.ready;
    // The workspace may have only one API owner, even within this process.
    const duplicate = new Backend(factory);
    await assert.rejects(duplicate.ready, /already open/);
    await duplicate.stop();
    proxy = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen: () => {} }, request => proxyRequest(request, backendOrigin));
    const url = `http://127.0.0.1:${(proxy.addr as Deno.NetAddr).port}`;
    const html = await fetch(url); assert.equal(html.status, 200);
    assert.match(await html.text(), /id="app"/);
    assert.match(html.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
    const large=await fetch(`${url}/large.js`);assert.equal(large.status,200);assert.deepEqual(Buffer.from(await large.arrayBuffer()),largeAsset);
    for (const headers of [{ host: 'evil.example' }, { origin: 'https://evil.example' }]) {
      const blockedStatus = await new Promise<number>(resolve => {
        httpRequest(`${backendOrigin}/api/state`, { headers }, response => {
          response.resume(); response.on('end', () => resolve(response.statusCode!));
        }).end();
      });
      assert.equal(blockedStatus, 403);
    }
    const response = await fetch(`${url}/api/state`); const state = await response.json();
    const record = { id: 'deno-probe-location', name: 'Deno prototype bench', kind: 'Bench', parentId: '', requirementSetId: '', requirementRevision: 0, targetConfigurationId: '', notes: 'Persisted through Deno proxy' };
    const write = await fetch(`${url}/api/installationLocations/${record.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': state.revision }, body: JSON.stringify(record) });
    assert.equal(write.status, 200, await write.text());
    const stale = await fetch(`${url}/api/installationLocations/${record.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': state.revision }, body: JSON.stringify({ ...record, name: 'Stale update' }) });
    assert.equal(stale.status, 409); await stale.text();
    const csvResponse = await fetch(`${url}/api/export/installationLocations`);
    assert.match(csvResponse.headers.get('content-disposition')!, /installationLocations.csv/);
    const csv = await csvResponse.text(); assert.match(csv, /deno-probe-location/);
    const current = await fetch(`${url}/api/state`); const currentState = await current.json();
    const invalid = await fetch(`${url}/api/installationLocations/import`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'If-Match': currentState.revision }, body: JSON.stringify({ csv: 'id,name\ninvalid,Missing required columns' }) });
    assert.equal(invalid.status, 400); await invalid.text();
    const imported = await fetch(`${url}/api/installationLocations/import`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'If-Match': currentState.revision }, body: JSON.stringify({ csv }) });
    assert.equal(imported.status, 200, await imported.text());
    const backup = await fetch(`${url}/api/backup`); assert.ok((await backup.json()).installationLocations.some((r: { id: string }) => r.id === record.id));
    await proxy.shutdown(); proxy = undefined;
    const stopping = backend.stop(); assert.equal(stopping, backend.stop()); await stopping;
    assert.equal((await backend.status).code, 0);
    assert.equal((await Deno.stat(`${directory}/workbench.sqlite`)).isFile, true);
    await assert.rejects(Deno.stat(`${directory}/.server-lock.json`), Deno.errors.NotFound);
    backend = new Backend(factory);
    const restarted = await backend.ready;
    const persisted = await fetch(`${restarted}/api/state`); assert.ok((await persisted.json()).installationLocations.some((r: { id: string }) => r.id === record.id));
    await backend.stop(); assert.equal((await backend.status).code, 0);
  } finally { await proxy?.shutdown(); await backend?.stop(); await Deno.remove(directory, { recursive: true }); }
});

Deno.test('listen failure releases SQLite and permits opening the workspace again', async () => {
  const directory = await Deno.makeTempDir({ prefix: 'pc-workbench-deno-listen-' });
  const occupied = Deno.listen({ hostname: '127.0.0.1', port: 0 });
  let restarted: Backend | undefined;
  try {
    const backend = new Backend(() => createApp(directory, { assets }), { port: (occupied.addr as Deno.NetAddr).port });
    await assert.rejects(backend.ready, /address.*use|EADDRINUSE|Invalid local server address/i);
    await backend.stop(); assert.equal((await backend.status).success, false);
    await assert.rejects(Deno.stat(`${directory}/.server-lock.json`), Deno.errors.NotFound);
    restarted = new Backend(() => createApp(directory, { assets }));
    assert.match(await restarted.ready, /^http:\/\/127\.0\.0\.1:/);
  } finally { occupied.close(); await restarted?.stop(); await Deno.remove(directory, { recursive: true }); }
});

Deno.test('shutdown drains or aborts lingering clients before releasing application resources', async () => {
  let released = false;
  let acceptRequest!: () => void;
  const received = new Promise<void>(resolve => { acceptRequest = resolve; });
  const backend = new Backend(() => {
    const server = createServer((_req, res) => { res.writeHead(200); res.write('pending'); acceptRequest(); });
    return { listen: (port, host, callback) => server.listen(port, host, callback), locals: { closeStore: () => { released = true; } } };
  }, { shutdownTimeoutMs: 20 });
  const request = httpRequest(await backend.ready, response => response.resume());
  request.on('error', () => {}); request.end();
  try {
    await received;
    await backend.stop();
    assert.equal(released, true);
    assert.equal((await backend.status).success, true);
  } finally { request.destroy(); await backend.stop(); }
});
