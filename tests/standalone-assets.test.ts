import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { request as httpRequest } from 'node:http';
import { createApp, type AppOptions } from '../server/index';

async function embeddedWorkspace(run: (base: string, dir: string) => Promise<void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-embedded-assets-'));
  const assets: NonNullable<AppOptions['assets']> = Object.assign(Object.create({
    '/assets/inherited.js': { data: Buffer.from('prototype asset must not be served'), mime: 'text/javascript' },
  }), {
    '/index.html': { data: Buffer.from('<!doctype html><title>Embedded Bench</title>'), mime: 'text/html; charset=utf-8' },
    '/assets/app.js': { data: Buffer.from('console.log("embedded");'), mime: 'text/javascript; charset=utf-8' },
    '/assets/app.css': { data: Buffer.from('body{color:green}'), mime: 'text/css; charset=utf-8' },
    '/assets/icon.png': { data: Buffer.from([137, 80, 78, 71, 0, 255, 17]), mime: 'image/png' },
  });
  const app = createApp(dir, { assets }), server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, dir);
  } finally {
    // All request assertions are complete; Deno may keep discarded fetch bodies connected.
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('embedded frontend serves root and exact binary assets with MIME, nosniff and HEAD metadata', async () => {
  await embeddedWorkspace(async base => {
    const root = await fetch(`${base}/`);
    assert.equal(root.status, 200); assert.match(root.headers.get('content-type')!, /^text\/html/);
    assert.equal(root.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await root.text(), '<!doctype html><title>Embedded Bench</title>');
    for (const [url, mime, expected] of [
      ['/assets/app.js', 'text/javascript', Buffer.from('console.log("embedded");')],
      ['/assets/app.css', 'text/css', Buffer.from('body{color:green}')],
      ['/assets/icon.png', 'image/png', Buffer.from([137, 80, 78, 71, 0, 255, 17])],
    ] as const) {
      const get = await fetch(`${base}${url}?cache-test=1`);
      assert.equal(get.status, 200); assert.ok(get.headers.get('content-type')!.startsWith(mime));
      assert.deepEqual(Buffer.from(await get.arrayBuffer()), expected);
      const head = await fetch(`${base}${url}`, { method: 'HEAD' });
      assert.equal(head.status, 200); assert.equal(head.headers.get('content-length'), String(expected.length));
      assert.ok(head.headers.get('content-type')!.startsWith(mime)); assert.equal((await head.arrayBuffer()).byteLength, 0);
    }
    const indexHead = await fetch(`${base}/`, { method: 'HEAD' });
    assert.equal(indexHead.status, 200); assert.equal(await indexHead.text(), '');
  });
});

test('embedded frontend refuses unknown, inherited, traversal and non-read asset requests', async () => {
  await embeddedWorkspace(async base => {
    for (const url of ['/missing', '/assets/unknown.js', '/assets/inherited.js', '/constructor', '/__proto__', '/toString',
      '/assets/%2e%2e%2f%2e%2e%2fserver%2findex.ts', '/assets/%5c..%5cserver%5cindex.ts']) {
      const response = await fetch(`${base}${url}`);
      assert.equal(response.status, 404, url); assert.ok(!(await response.text()).includes('prototype asset must not be served'));
    }
    for (const method of ['POST', 'PUT', 'DELETE']) assert.equal((await fetch(`${base}/assets/app.js`, { method })).status, 404);
    const unknownHead = await fetch(`${base}/assets/inherited.js`, { method: 'HEAD' });
    assert.equal(unknownHead.status, 404); assert.equal(await unknownHead.text(), '');
  });
});

test('embedded frontend retains local Host/Origin protections and uses the explicit workspace for API persistence', async () => {
  await embeddedWorkspace(async (base, dir) => {
    for (const url of ['/', '/assets/app.js', '/api/state']) {
      assert.equal((await fetch(`${base}${url}`, { headers: { Origin: 'https://untrusted.example' } })).status, 403);
      // Fetch controls Host itself; use a raw HTTP request to exercise the server guard.
      const hostStatus = await new Promise<number | undefined>((resolve, reject) => {
        const request = httpRequest(`${base}${url}`, { headers: { Host: 'untrusted.example' } }, response => {
          response.resume(); response.once('end', () => resolve(response.statusCode));
        });
        request.once('error', reject); request.end();
      });
      assert.equal(hostStatus, 403);
      assert.equal((await fetch(`${base}${url}`, { headers: { Origin: base } })).status, 200);
    }
    const response = await fetch(`${base}/api/state`), state = await response.json();
    assert.ok(Array.isArray(state.components)); assert.ok(response.headers.get('x-workspace-revision'));
    assert.ok(fs.existsSync(path.join(dir, 'workbench.sqlite')));
    assert.ok(!fs.existsSync(path.join(dir, 'config.json')));
    const backup = await fetch(`${base}/api/backup`);
    assert.equal(backup.status, 200); assert.ok(Array.isArray((await backup.json()).inventory));
  });
});
