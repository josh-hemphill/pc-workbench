import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/index';
import { decodeCSV, encodeCSV } from '../server/store';
import { fleetPicklist, stockCounts } from '../shared/inventory';
import { installationParts } from '../shared/installations';
import type { Database, InventoryPC } from '../shared/types';

async function workspace(run: (request: Request, state: () => Promise<Database>) => Promise<void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-parts-only-api-'));
  const server = createApp(dir).listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request: Request = async (url, method = 'GET', body) => {
    const current = await fetch(`${base}/api/state`);
    return fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'If-Match': current.headers.get('X-Workspace-Revision')! },
      body: body === undefined ? undefined : JSON.stringify(body) });
  };
  try { await run(request, async () => (await request('/api/backup')).json() as Promise<Database>); }
  finally {
    // All request assertions are complete; Deno may keep discarded fetch bodies connected.
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
type Request = (url: string, method?: string, body?: unknown) => Promise<Response>;
const receive = (id: string, componentId: string, quantity: number) => ({ id, componentId, tracking: 'bulk', serial: '', assetTag: '', quantity,
  location: 'Stock room', condition: 'Serviceable', notes: '', history: [], allocations: [] });

test('Parts only keeps commissioned hardware and whereabouts, blocks fitting, and allows incremental salvage before final retirement', async () => {
  await workspace(async (request, state) => {
    let db = await state(); const original = db.pcs[0], config = db.configurations.find(c => c.id === original.configurationId)!;
    const location = { id: 'salvage-bench', name: 'Salvage bench', kind: 'Bench', parentId: '', requirementSetId: '', requirementRevision: 0, targetConfigurationId: '', notes: '' };
    assert.equal((await request('/api/installationLocations/salvage-bench', 'PUT', location)).status, 200);
    assert.equal((await request(`/api/pcs/${original.id}`, 'PUT', { ...original, installationLocationId: location.id })).status, 200);
    for (const p of config.placements) {
      assert.equal((await request(`/api/inventory/stock-${p.id}`, 'PUT', receive(`stock-${p.id}`, p.componentId, p.quantity))).status, 200);
      assert.equal((await request(`/api/inventory/stock-${p.id}/action`, 'POST', { action: 'install', pcId: original.id, plannedPlacementId: p.id, quantity: p.quantity })).status, 200);
    }
    assert.equal((await request('/api/inventory/spare', 'PUT', receive('spare', 'ssd', 3))).status, 200);
    assert.equal((await request('/api/inventory/spare/action', 'POST', { action: 'reserve', pcId: original.id, quantity: 1 })).status, 200);
    const commissioned = await request(`/api/pcs/${original.id}/commission`, 'POST', { by: 'Engineer', checks: ['Hardware accepted'], notes: '' });
    assert.equal(commissioned.status, 200); const accepted = await commissioned.json() as InventoryPC;
    db = await state(); const allocations = structuredClone(db.inventory.flatMap(stock => stock.allocations));
    assert.equal((await request(`/api/pcs/${original.id}`, 'PUT', { ...accepted, lifecycle: 'Parts only' })).status, 200);
    db = await state(); const parts = db.pcs.find(pc => pc.id === original.id)!;
    assert.equal(parts.lifecycle, 'Parts only'); assert.deepEqual(parts.snapshot, accepted.snapshot); assert.deepEqual(parts.snapshots, accepted.snapshots);
    assert.deepEqual(parts.commissioning, accepted.commissioning); assert.equal(parts.installationLocationId, location.id);
    assert.deepEqual(db.inventory.flatMap(stock => stock.allocations), allocations);
    assert.equal(stockCounts(db.inventory.find(stock => stock.id === 'spare')!).available, 2);
    assert.ok(db.inventory.filter(stock => stock.id !== 'spare').every(stock => stockCounts(stock).available === 0));
    assert.equal(installationParts(location.id, db).length, config.placements.length);
    assert.ok(!fleetPicklist(db).some(row => row.pcId === original.id));
    for (const action of ['reserve', 'install']) assert.equal((await request('/api/inventory/spare/action', 'POST', { action, pcId: original.id, quantity: 1 })).status, 400);
    const reservation = db.inventory.find(stock => stock.id === 'spare')!.allocations[0];
    assert.equal((await request('/api/inventory/spare/action', 'POST', { action: 'install-reserved', allocationId: reservation.id, quantity: 1 })).status, 400);
    assert.equal((await request(`/api/pcs/${original.id}/commission`, 'POST', { by: 'Engineer', checks: ['Checked'], notes: '' })).status, 400);
    assert.equal((await request(`/api/pcs/${original.id}`, 'PUT', { ...parts, lifecycle: 'Retired' })).status, 400);
    assert.equal((await request('/api/inventory/spare/action', 'POST', { action: 'release', allocationId: reservation.id, quantity: 1, notes: 'Released salvage reservation' })).status, 200);
    const ramStock = db.inventory.find(stock => stock.componentId === 'ram')!, ram = ramStock.allocations[0];
    const removed = await request(`/api/inventory/${ramStock.id}/action`, 'POST', { action: 'remove', allocationId: ram.id, quantity: 1,
      disposition: 'Serviceable', destinationLocation: 'Salvage shelf', notes: 'Recovered one DIMM' });
    assert.equal(removed.status, 200);
    db = await state();
    assert.equal(db.pcs.find(pc => pc.id === original.id)?.lifecycle, 'Parts only');
    assert.equal(db.inventory.find(stock => stock.id === ramStock.id)?.allocations[0].quantity, ram.quantity - 1);
    assert.equal(db.inventory.filter(stock => stock.componentId === 'ram').reduce((n, stock) => n + stockCounts(stock).available, 0), 1);
    const total = db.inventory.reduce((n, stock) => n + stock.quantity, 0);
    for (const stock of db.inventory) for (const allocation of stock.allocations) {
      assert.equal((await request(`/api/inventory/${stock.id}/action`, 'POST', { action: allocation.state === 'installed' ? 'remove' : 'release',
        allocationId: allocation.id, quantity: allocation.quantity, disposition: 'Serviceable', destinationLocation: 'Salvage shelf', notes: 'Completed recovery' })).status, 200);
    }
    db = await state(); assert.equal(db.inventory.flatMap(stock => stock.allocations).length, 0);
    assert.equal(db.inventory.reduce((n, stock) => n + stock.quantity, 0), total);
    assert.equal((await request(`/api/pcs/${original.id}`, 'PUT', { ...db.pcs[0], lifecycle: 'Retired' })).status, 200);
    const retired = (await state()).pcs[0]; assert.equal(retired.lifecycle, 'Retired'); assert.deepEqual(retired.snapshot, accepted.snapshot);
  });
});

test('Parts only CSV and backups retain allocations, while CSV and whole restore still reject allocated Retired PCs', async () => {
  await workspace(async (request, state) => {
    let db = await state(); const pc = db.pcs[0];
    assert.equal((await request('/api/inventory/retained', 'PUT', receive('retained', 'ram', 2))).status, 200);
    assert.equal((await request('/api/inventory/retained/action', 'POST', { action: 'install', pcId: pc.id, quantity: 2 })).status, 200);
    assert.equal((await request(`/api/pcs/${pc.id}`, 'PUT', { ...pc, lifecycle: 'Parts only' })).status, 200);
    const csv = await (await request('/api/export/pcs')).text(), rows = decodeCSV('pcs', csv) as InventoryPC[];
    assert.equal(rows[0].lifecycle, 'Parts only');
    assert.equal((await request('/api/pcs/import', 'POST', { csv: encodeCSV('pcs', [{ ...rows[0], name: 'Salvage donor' }]) })).status, 200);
    db = await state(); assert.equal(db.pcs[0].name, 'Salvage donor'); assert.equal(db.inventory[0].allocations[0].quantity, 2);
    assert.equal((await request('/api/restore/preview', 'POST', { backup: db })).status, 200);
    assert.equal((await request('/api/restore', 'POST', { backup: db })).status, 200);
    const invalid = structuredClone(db); invalid.pcs[0].lifecycle = 'Retired';
    assert.equal((await request('/api/pcs/import', 'POST', { csv: encodeCSV('pcs', invalid.pcs) })).status, 400);
    assert.equal((await request('/api/restore/preview', 'POST', { backup: invalid })).status, 400);
    assert.equal((await request('/api/restore', 'POST', { backup: invalid })).status, 400);
    const unchanged = await state(); assert.equal(unchanged.pcs[0].lifecycle, 'Parts only'); assert.equal(unchanged.inventory[0].allocations[0].quantity, 2);
  });
});
