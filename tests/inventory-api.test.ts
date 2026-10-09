import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/index';
import { decodeCSV } from '../server/store';

test('inventory HTTP workflows are durable and reject overspending or unaudited quantity changes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-inventory-api-'));
  const server = createApp(dir).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const req=async(url:string,method='GET',body?:unknown,headers:Record<string,string>={})=>{const state=await fetch(base+'/api/state');const revision=state.headers.get('X-Workspace-Revision')!;return fetch(base+url,{method,headers:{'Content-Type':'application/json','If-Match':revision,...headers},body:body===undefined?undefined:JSON.stringify(body)});};
  try {
    const stock = { id: 'api-lot', componentId: 'ram', tracking: 'bulk', quantity: 5, serial: '', assetTag: 'API-LOT', location: 'Shelf', condition: 'Serviceable', notes: '', allocations: [], history: [] };
    const received = await (await req('/api/inventory/api-lot', 'PUT', stock)).json(); assert.equal(received.history[0].action, 'receive');
    let response = await req('/api/inventory/api-lot/action', 'POST', { action: 'reserve', pcId: 'pc-01', quantity: 2, plannedPlacementId: 'line-3' });
    assert.equal(response.status, 200); const reserved = await response.json();
    assert.equal((await req('/api/inventory/api-lot/action', 'POST', { action: 'reserve', pcId: 'pc-01', quantity: 4 })).status, 400);
    assert.equal((await req('/api/inventory/api-lot', 'PUT', { ...reserved, quantity: 0 })).status, 400);
    assert.equal((await req('/api/inventory/api-lot/adjust', 'POST', { quantity: 1, notes: 'Invalid total' })).status, 400);
    assert.equal((await req('/api/pcs/pc-01', 'DELETE')).status, 400);
    response = await req('/api/inventory/api-lot/action', 'POST', { action: 'install-reserved', allocationId: reserved.allocations[0].id, quantity: 1 });
    assert.equal(response.status, 200);
    const build = await (await req('/api/pcs/pc-01/build')).json();
    assert.equal(build.allocations.filter((r: { allocation: { state: string } }) => r.allocation.state === 'installed').length, 1);
    assert.equal(build.readiness.find((r: { componentId: string }) => r.componentId === 'ram').installed, 1);
    assert.equal((await req('/api/inventory/api-lot/adjust', 'POST', { quantity: 6, notes: 'Receipt of one additional module' })).status, 200);
    const csv = await (await req('/api/export/inventory')).text(); assert.equal(decodeCSV('inventory', csv).length, 1);
    const ledger = await (await req('/api/export/movements')).text(); assert.match(ledger, /Receipt of one additional module/);
    const transfer = await req('/api/inventory/api-lot/transfer', 'POST', {quantity:2,assetTag:'API-SPLIT',location:'Repair shelf',condition:'Quarantined',notes:'Inspection needed'});
    assert.equal(transfer.status,200);const split=await transfer.json();assert.equal(split.source.quantity,4);assert.equal(split.target.quantity,2);assert.equal(split.target.condition,'Quarantined');
    assert.equal((await req('/api/inventory/api-lot', 'DELETE')).status, 400);
    assert.equal((await req('/api/pcs/missing/build')).status, 404);
    assert.equal((await req('/api/state')).status, 200);
  } finally { // All request assertions are complete; Deno may keep discarded fetch bodies connected.
 server.closeAllConnections();
 await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); fs.rmSync(dir, { recursive: true, force: true }); }
});
