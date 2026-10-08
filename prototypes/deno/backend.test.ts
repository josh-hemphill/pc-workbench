import assert from 'node:assert/strict';
import { Backend, MESSAGE_LIMIT, parseReady, proxyRequest, proxyTarget } from './backend.ts';

Deno.test('ready messages accept loopback only and surface bounded server errors', () => {
  assert.equal(parseReady('{"type":"ready","url":"http://127.0.0.1:3001"}'), 'http://127.0.0.1:3001');
  for (const url of ['https://127.0.0.1/', 'http://localhost/', 'http://example.com/', 'http://127.0.0.1/path', 'http://user@127.0.0.1/', 'http://127.0.0.1/?x=1', 'http://127.0.0.1/#x']) assert.throws(() => parseReady(JSON.stringify({ type: 'ready', url })));
  assert.throws(() => parseReady('{"type":"error","message":"workspace locked"}'), /workspace locked/);
  assert.throws(() => parseReady('x'.repeat(MESSAGE_LIMIT + 1)), /64 KiB/);
  assert.throws(() => parseReady('null'));
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

const executable = Deno.env.get('BENCH_DENO_SERVER');
Deno.test({ name: 'real SEA startup errors reject readiness and release the child', ignore: !executable, fn: async () => {
  const directory = await Deno.makeTempDir({ prefix: 'pc-workbench-deno-failure-' });
  const backend = new Backend(executable!, { env: { BENCH_DATA_DIR: directory, PORT: 'invalid', XDG_CONFIG_HOME: directory } });
  try { await assert.rejects(backend.ready, /PORT/); await backend.stop(); assert.equal((await backend.status).code, 1); }
  finally { await backend.stop(); await Deno.remove(directory, { recursive: true }); }
} });
Deno.test({ name: 'real SEA server through Deno proxy: frontend, SQLite edits/restart, CSV export/import, JSON backup and shutdown', ignore: !executable, fn: async () => {
  const directory = await Deno.makeTempDir({ prefix: 'pc-workbench-deno-test-' });
  const socket = Deno.listen({ hostname: '127.0.0.1', port: 0 });
  const port = (socket.addr as Deno.NetAddr).port; socket.close();
  const options = { env: { BENCH_DATA_DIR: directory, PORT: String(port), XDG_CONFIG_HOME: directory } };
  let backend: Backend | undefined;
  let proxy: Deno.HttpServer | undefined;
  try {
    backend = new Backend(executable!, options);
    const backendOrigin = await backend.ready;
    backend.child.emit('error', Object.assign(Error('Simulated failed termination'), { code: 'EPERM' }));
    assert.equal(await Promise.race([backend.status.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 20))]), false, 'A running process error must not be treated as confirmed exit');
    proxy = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen: () => {} }, request => proxyRequest(request, backendOrigin));
    const url = `http://127.0.0.1:${(proxy.addr as Deno.NetAddr).port}`;
    const html = await fetch(url); assert.equal(html.status, 200);
    assert.match(await html.text(), /id="app"/);
    assert.match(html.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
    const response = await fetch(`${url}/api/state`); const state = await response.json();
    const record = { id: 'deno-probe-location', name: 'Deno prototype bench', kind: 'Bench', parentId: '', requirementSetId: '', requirementRevision: 0, targetConfigurationId: '', notes: 'Persisted through Deno proxy' };
    const write = await fetch(`${url}/api/installationLocations/${record.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': state.revision }, body: JSON.stringify(record) });
    assert.equal(write.status, 200, await write.text());
    const csvResponse = await fetch(`${url}/api/export/installationLocations`);
    assert.match(csvResponse.headers.get('content-disposition')!, /installationLocations.csv/);
    const csv = await csvResponse.text(); assert.match(csv, /deno-probe-location/);
    const current = await fetch(`${url}/api/state`); const currentState = await current.json();
    const imported = await fetch(`${url}/api/installationLocations/import`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'If-Match': currentState.revision }, body: JSON.stringify({ csv }) });
    assert.equal(imported.status, 200, await imported.text());
    const backup = await fetch(`${url}/api/backup`); assert.ok((await backup.json()).installationLocations.some((r: { id: string }) => r.id === record.id));
    await proxy.shutdown(); proxy = undefined;
    const stopping = backend.stop(); assert.equal(stopping, backend.stop()); await stopping;
    assert.equal((await backend.status).code, 0);
    backend = new Backend(executable!, options);
    const restarted = await backend.ready;
    const persisted = await fetch(`${restarted}/api/state`); assert.ok((await persisted.json()).installationLocations.some((r: { id: string }) => r.id === record.id));
    await backend.stop(); assert.equal((await backend.status).code, 0);
  } finally { await proxy?.shutdown(); await backend?.stop(); await Deno.remove(directory, { recursive: true }); }
} });
