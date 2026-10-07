import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { StockRecord } from '../shared/types';
import { checkInstalledPC, installedConfiguration, pcAllocations, planDifferences, stockCounts, stockReadiness } from '../shared/inventory';
import { Store, decodeCSV, encodeCSV, encodeMovements } from '../server/store';
import { applyStockAction, adjustStockCount, saveStockRecord, transferBulkStock } from '../server/inventory';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-inventory-'));
  const store = new Store(dir);
  store.replace('pcs', [...store.db.pcs, { ...store.db.pcs[0], id: 'pc-02', name: 'Second machine' }]);
  const create = (id = 'stock-1', componentId = 'daq', tracking: StockRecord['tracking'] = 'serialized', quantity = 1) => {
    const row = saveStockRecord({ id, componentId, tracking, quantity, serial: tracking === 'serialized' ? `SERIAL-${id}` : '', assetTag: id, location: 'Shelf A', condition: 'Serviceable', notes: 'Test receipt', allocations: [], history: [] }, store.db);
    store.replace('inventory', [...store.db.inventory, row]); return row;
  };
  const act = (id: string, input: unknown) => {
    const row = applyStockAction(store.db.inventory.find(s => s.id === id)!, input, store.db);
    store.replace('inventory', store.db.inventory.map(s => s.id === id ? row : s)); return row;
  };
  return { dir, store, create, act, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('a serialized unit cannot be double-allocated and returns to stock on removal', () => {
  const { store, create, act, cleanup } = setup();
  try {
    create(); let row = act('stock-1', { action: 'reserve', pcId: 'pc-01', quantity: 1 });
    assert.deepEqual(stockCounts(row), { available: 0, reserved: 1, installed: 0, unallocated: 0 });
    assert.throws(() => act('stock-1', { action: 'reserve', pcId: 'pc-02', quantity: 1 }), /Insufficient available/);
    assert.throws(() => act('stock-1', { action: 'reserve', pcId: 'pc-01', quantity: 2 }), /Insufficient available/);
    row = act('stock-1', { action: 'install-reserved', allocationId: row.allocations[0].id, quantity: 1 });
    assert.equal(row.allocations[0].state, 'installed');
    assert.throws(() => act('stock-1', { action: 'release', allocationId: row.allocations[0].id, quantity: 1 }), /Only reservations/);
    row = act('stock-1', { action: 'remove', allocationId: row.allocations[0].id, quantity: 1, notes: 'Replacement' });
    assert.equal(stockCounts(row).available, 1); assert.equal(row.allocations.length, 0);
    assert.deepEqual(row.history.map(e => e.action), ['receive', 'reserve', 'install', 'remove']);
    assert.equal(row.history[3].pcName, 'IMG-WS-01');
    assert.equal(new Store(store.dir).db.inventory[0].history.length, 4);
  } finally { cleanup(); }
});

test('bulk partial installs, removals, releases and adjustments conserve stock across PCs', () => {
  const { store, create, act, cleanup } = setup();
  try {
    create('ram-lot', 'ram', 'bulk', 10);
    let row = act('ram-lot', { action: 'reserve', pcId: 'pc-01', quantity: 4 });
    const first = row.allocations[0].id;
    act('ram-lot', { action: 'reserve', pcId: 'pc-02', quantity: 3 });
    row = act('ram-lot', { action: 'install', pcId: 'pc-02', quantity: 2 });
    assert.equal(stockCounts(row).available, 1);
    assert.throws(() => act('ram-lot', { action: 'install', pcId: 'pc-01', quantity: 2 }), /Insufficient available/);
    row = act('ram-lot', { action: 'install-reserved', allocationId: first, quantity: 2 });
    assert.equal(row.allocations.find(a => a.id === first)!.quantity, 2);
    const installed = row.allocations.find(a => a.state === 'installed' && a.pcId === 'pc-01')!;
    row = act('ram-lot', { action: 'remove', allocationId: installed.id, quantity: 1 });
    row = act('ram-lot', { action: 'release', allocationId: first, quantity: 1 });
    assert.deepEqual(stockCounts(row), { reserved: 4, installed: 3, available: 3, unallocated: 3 });
    assert.throws(() => adjustStockCount(row, { quantity: 6, notes: 'Count correction' }, store.db), /cannot be lower/);
    assert.throws(() => adjustStockCount(row, { quantity: 7, notes: '' }, store.db));
    row = adjustStockCount(row, { quantity: 7, notes: 'Three discarded units' }, store.db);
    store.replace('inventory', [row]); assert.equal(stockCounts(row).available, 0);
    assert.equal(row.history.at(-1)!.quantity, -3);
  } finally { cleanup(); }
});

test('duplicate serials, nonserviceable allocations and unsafe deletion preserve persisted inventory', () => {
  const { store, create, act, cleanup } = setup();
  try {
    let row = create();
    assert.throws(() => store.replace('inventory', [row, { ...row, id: 'duplicate', assetTag: 'different' }]), /Duplicate serial/);
    assert.throws(() => store.replace('inventory', [row, { ...row, id: 'duplicate', serial: 'DIFFERENT' }]), /Duplicate inventory asset/);
    row = act('stock-1', { action: 'reserve', pcId: 'pc-01', quantity: 1 });
    assert.throws(() => store.replace('pcs', store.db.pcs.filter(p => p.id !== 'pc-01')), /allocated PC not found/);
    assert.throws(() => store.replace('inventory', []), /cannot be deleted/);
    assert.throws(() => store.replace('inventory', [{ ...row, condition: 'Retired' }]), /Release reservations/);
    const quarantined = saveStockRecord({ ...row, condition: 'Quarantined' }, store.db);
    store.replace('inventory', [quarantined]);
    assert.throws(() => act('stock-1', { action: 'install-reserved', allocationId: row.allocations[0].id, quantity: 1 }), /cannot be installed/);
    assert.equal(stockCounts(quarantined).available, 0);
    assert.throws(() => saveStockRecord({ ...quarantined, componentId: 'gpu' }, store.db), /cannot change/);
    assert.throws(() => saveStockRecord({ ...quarantined, allocations: [] }, store.db), /Stock changed/);
    act('stock-1', { action: 'release', allocationId: row.allocations[0].id, quantity: 1 });
    row = store.db.inventory[0]; store.replace('inventory', [{ ...row, condition: 'Retired' }]);
    assert.equal(new Store(store.dir).db.inventory[0].condition, 'Retired');
  } finally { cleanup(); }
});

test('BOM linkage rejects a mismatched component and captured installed hardware survives template edits', () => {
  const { store, create, act, cleanup } = setup();
  try {
    const config = structuredClone(store.db.configurations[0]);
    for (const p of config.placements) {
      const id = `stock-${p.id}`; create(id, p.componentId, 'bulk', p.quantity);
      act(id, { action: 'install', pcId: 'pc-01', quantity: p.quantity, plannedPlacementId: p.id });
    }
    const pc = store.db.pcs[0];
    assert.equal(checkInstalledPC(pc, store.db).findings.filter(f => f.severity === 'error').length, 0);
    assert.deepEqual(planDifferences(pc, store.db), []);
    const actual = installedConfiguration(pc, store.db);
    config.storage = { raid: 'raid6', bootMirror: false };
    config.placements.find(p => p.componentId === 'nvme')!.role = 'data';
    store.replace('configurations', store.db.configurations.map(c => c.id === config.id ? config : c));
    assert.deepEqual(installedConfiguration(pc, store.db), actual);
    assert.ok(planDifferences(pc, store.db).some(d => d.includes('redundancy settings')));
    assert.equal(checkInstalledPC(pc, store.db).bootGb, 1000);
    create('spare-cpu', 'cpu');
    assert.throws(() => act('spare-cpu', { action: 'reserve', pcId: 'pc-01', quantity: 1, plannedPlacementId: 'line-0' }), /does not match/);
  } finally { cleanup(); }
});

test('readiness aggregates repeated types, excludes blocked stock and does not treat reservations as installed', () => {
  const { store, create, act, cleanup } = setup();
  try {
    create('ram', 'ram', 'bulk', 3);
    const template = structuredClone(store.db.configurations[0]);
    template.placements = [{ id: 'a', componentId: 'ram', quantity: 2, role: 'general', mount: 'auto', slotId: '', group: '' }, { id: 'b', componentId: 'ram', quantity: 2, role: 'general', mount: 'auto', slotId: '', group: '' }];
    let r = stockReadiness(template, store.db, 'pc-01')[0]; assert.equal(r.required, 4); assert.equal(r.shortage, 1);
    act('ram', { action: 'reserve', pcId: 'pc-01', quantity: 2 });
    r = stockReadiness(template, store.db, 'pc-01')[0]; assert.equal(r.reserved, 2); assert.equal(r.installed, 0); assert.equal(r.shortage, 1);
    assert.equal(installedConfiguration(store.db.pcs[0], store.db).placements.length, 0);
    const row = store.db.inventory[0]; store.replace('inventory', [{ ...row, condition: 'Quarantined' }]);
    r = stockReadiness(template, store.db, 'pc-01')[0]; assert.equal(r.blocked, 2); assert.equal(r.shortage, 4);
  } finally { cleanup(); }
});

test('inventory CSV round-trips full allocations/history and legacy workspaces gain empty stock safely', () => {
  const { dir, store, create, act, cleanup } = setup();
  try {
    create(); act('stock-1', { action: 'install', pcId: 'pc-01', quantity: 1, notes: 'Comma, quote " and\nnew line' });
    assert.deepEqual(decodeCSV('inventory', encodeCSV('inventory', store.db.inventory)), store.db.inventory);
    assert.match(encodeMovements(store.db), /IMG-WS-01/);
    fs.unlinkSync(path.join(dir, 'inventory.csv'));
    fs.writeFileSync(path.join(dir, 'pcs.csv'), 'id,name,serial,location,configurationId,notes\npc-01,Legacy PC,,,imaging,Keep this PC\n');
    const migrated = new Store(dir);
    assert.deepEqual(migrated.db.inventory, []);
    assert.equal(migrated.db.pcs[0].name, 'Legacy PC'); assert.equal(migrated.db.pcs[0].buildSettings, null);
    assert.equal(migrated.db.configurations.length, 3);
  } finally { cleanup(); }
});

test('drift matching reallocates auto placements to honor constrained mounts regardless of BOM order', () => {
  const { store, create, act, cleanup } = setup();
  try {
    const template = structuredClone(store.db.configurations[0]);
    template.placements = [
      { id: 'flexible', componentId: 'ssd', quantity: 1, role: 'data', mount: 'auto', slotId: '', group: '' },
      { id: 'pinned', componentId: 'ssd', quantity: 1, role: 'data', mount: 'front-hot-swap', slotId: '', group: '' },
    ];
    store.replace('configurations', store.db.configurations.map(c => c.id === template.id ? template : c));
    create('ssd-front', 'ssd', 'bulk', 1); create('ssd-internal', 'ssd', 'bulk', 1);
    act('ssd-front', { action: 'install', pcId: 'pc-01', quantity: 1, role: 'data', mount: 'front-hot-swap' });
    act('ssd-internal', { action: 'install', pcId: 'pc-01', quantity: 1, role: 'data', mount: 'internal' });
    assert.deepEqual(planDifferences(store.db.pcs[0], store.db), []);
    const front = store.db.inventory[0];
    act(front.id, { action: 'configure', allocationId: front.allocations[0].id, role: 'boot', mount: 'front-hot-swap', slotId: '', notes: 'Drive role changed' });
    assert.ok(planDifferences(store.db.pcs[0], store.db).length >= 2);
    store.replace('inventory', store.db.inventory.map(s => s.id === front.id ? { ...s, condition: 'Quarantined' } : s));
    assert.ok(checkInstalledPC(store.db.pcs[0], store.db).findings.some(f => f.title === 'Installed stock is not serviceable'));
  } finally { cleanup(); }
});

test('bulk lot splits conserve total units and preserve allocated units and linked history', () => {
  const { store, create, act, cleanup } = setup();
  try {
    create('source-lot', 'ram', 'bulk', 10);
    const original = act('source-lot', { action: 'reserve', pcId: 'pc-01', quantity: 4 });
    assert.throws(() => transferBulkStock(original, { quantity: 7, assetTag: 'NEW', location: 'Shelf C', condition: 'Serviceable', notes: 'Move' }, store.db), /exceeds unallocated/);
    let { source, target } = transferBulkStock(original, { quantity: 2, assetTag: 'RAM-QUARANTINE', location: 'Repair cabinet', condition: 'Quarantined', notes: 'Two modules need testing' }, store.db);
    store.replace('inventory', [source, target]);
    assert.equal(source.quantity + target.quantity, 10);
    assert.equal(source.allocations[0].quantity, 4); assert.equal(stockCounts(source).available, 4); assert.equal(stockCounts(target).available, 0);
    assert.equal(source.history.at(-1)!.action, 'transfer-out'); assert.equal(source.history.at(-1)!.quantity, -2);
    assert.ok(target.history[0].notes.includes(source.id));
    const before = encodeCSV('inventory', store.db.inventory);
    ({ source, target } = transferBulkStock(source, { quantity: 1, assetTag: 'RAM-QUARANTINE', location: 'Shelf D', condition: 'Serviceable', notes: 'Duplicate tag' }, store.db));
    assert.throws(() => store.replace('inventory', [source, ...store.db.inventory.filter(s => s.id !== source.id), target]), /Duplicate inventory asset/);
    assert.equal(encodeCSV('inventory', new Store(store.dir).db.inventory), before);
  } finally { cleanup(); }
});

test('movement histories larger than the original CSV parser limit remain readable after restart', () => {
  const { store, create, cleanup } = setup();
  try {
    const stock = create();
    for (let i=0;i<300;i++) stock.history.push({id:`large-history-${i}`,at:new Date(0).toISOString(),action:'edit',quantity:0,pcId:'',pcName:'',allocationId:'',notes:'x'.repeat(10000)});
    store.replace('inventory',[stock]);
    const resumed=new Store(store.dir);
    assert.equal(resumed.db.inventory[0].history.length,301);
    assert.equal(resumed.db.inventory[0].history.at(-1)!.notes.length,10000);
  } finally { cleanup(); }
});
