import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../server/seed';
import { applyStockOperation, saveStockRecord } from '../server/inventory';
import { commissionPCRecord } from '../server/pc-lifecycle';
import { schemas } from '../server/schema';
import { decodeCSV, encodeCSV } from '../server/store';
import { checkInstalledPC, commissioningDrift, installedConfiguration } from '../shared/inventory';

function fixture() {
  const db = structuredClone(seed), config = db.configurations[0], pc = db.pcs[0];
  config.systemId = ''; config.storage = { raid: 'none', bootMirror: false };
  config.placements = config.placements.filter(p => ['case-tower', 'board-atx', 'cpu', 'ram', 'nvme', 'psu', 'cooler'].includes(p.componentId));
  for (const p of config.placements) p.quantity = 1;
  const chassis = config.placements.find(p => p.componentId === 'case-tower')!;
  Object.assign(db.components.find(c => c.id === chassis.componentId)!.specs, {
    bays25: 0, bays525: 2, bayTargets: [{ id: 'BAY1', size: '5.25' }, { id: 'BAY2', size: '5.25' }],
  });
  db.components.find(c => c.id === 'psu')!.specs.sataPower = 1;
  db.components.push({ id: 'cage', name: 'Front SATA cage', category: 'Storage adapter', manufacturer: 'Test', source: '', verified: true,
    specs: { baySize: '5.25', bayUnits: 1, sataPowerPlugs: 1, powerW: 4,
      driveTargets: [{ id: 'DATA1', mount: 'front-hot-swap', driveSizes: ['2.5'], interfaces: ['SATA'], hotSwap: true }] } });
  config.placements.push(
    { id: 'cage-line', componentId: 'cage', quantity: 1, role: 'general', mount: 'auto', slotId: '', group: '', adapterPlacementId: chassis.id, targetId: 'BAY1' },
    { id: 'data-line', componentId: 'ssd', quantity: 1, role: 'data', mount: 'front-hot-swap', slotId: '', group: '', adapterPlacementId: 'cage-line', targetId: 'DATA1' },
  );
  pc.buildSettings = { systemId: '', storage: { raid: 'none', bootMirror: false }, notes: '' };
  const receive = (stockId: string, componentId: string) => {
    const stock = saveStockRecord({ id: stockId, componentId, tracking: 'serialized', serial: stockId, assetTag: '', quantity: 1,
      location: 'Stock room', condition: 'Serviceable', notes: '', history: [], allocations: [] }, db);
    db.inventory.push(stock); return stock;
  };
  const act = (stockId: string, input: unknown) => {
    const index = db.inventory.findIndex(stock => stock.id === stockId);
    const result = applyStockOperation(db.inventory[index], input, db);
    db.inventory[index] = result.stock;
    if (result.additionalStock) db.inventory.push(result.additionalStock);
    return result.stock;
  };
  const install = (includeCage = true) => {
    for (const p of config.placements) {
      if (!includeCage && p.id === 'cage-line') continue;
      receive(`stock-${p.id}`, p.componentId);
      act(`stock-${p.id}`, { action: 'install', pcId: pc.id, quantity: 1, plannedPlacementId: p.id });
    }
  };
  return { db, pc, chassis, receive, act, install };
}

test('installed cages remap chassis and downstream drive bindings and preserve them in commissioning snapshots', () => {
  const { db, pc, chassis, install, act } = fixture(); install();
  const allocation = (planId: string) => db.inventory.flatMap(stock => stock.allocations).find(a => a.plannedPlacementId === planId)!;
  const actual = installedConfiguration(pc, db), cage = actual.placements.find(p => p.componentId === 'cage')!, drive = actual.placements.find(p => p.componentId === 'ssd')!;
  assert.equal(cage.adapterPlacementId, allocation(chassis.id).id);
  assert.equal(drive.adapterPlacementId, cage.id);
  assert.equal(cage.targetId, 'BAY1'); assert.equal(drive.targetId, 'DATA1');
  const report = checkInstalledPC(pc, db);
  assert.equal(report.resources.find(r => r.name === '5.25-inch bays')?.used, 1);
  assert.equal(report.resources.find(r => r.name === 'Front hot-swap bays')?.used, 0);
  assert.equal(report.resources.find(r => r.name === 'SATA power plugs')?.used, 1);
  assert.equal(report.status, 'Needs review');
  const accepted = commissionPCRecord(pc, { by: 'Engineer', checks: ['Cage power and drive servicing verified'], notes: '' }, db);
  assert.deepEqual(accepted.snapshot?.configuration.placements, actual.placements);
  assert.equal(commissioningDrift(accepted, db), false);
  const recorded = allocation('cage-line');
  act('stock-cage-line', { action: 'configure', allocationId: recorded.id, role: recorded.role, mount: recorded.mount, slotId: recorded.slotId,
    adapterPlacementId: recorded.adapterPlacementId, targetId: 'BAY2', notes: 'Moved cage to second bay' });
  assert.equal(commissioningDrift(accepted, db), true);
  assert.equal(accepted.snapshot?.configuration.placements.find(p => p.componentId === 'cage')?.targetId, 'BAY1');
});

test('reserved and removed cages cannot provide ghost drive positions or consume installed chassis bays', () => {
  const { db, pc, receive, act, install } = fixture(); install(false); receive('cage-stock', 'cage');
  let stock = act('cage-stock', { action: 'reserve', pcId: pc.id, quantity: 1, plannedPlacementId: 'cage-line' });
  const assertMissing = () => {
    assert.ok(!installedConfiguration(pc, db).placements.some(p => p.componentId === 'cage'));
    const report = checkInstalledPC(pc, db);
    assert.equal(report.resources.find(r => r.name === '5.25-inch bays')?.used, 0);
    assert.ok(report.findings.some(f => f.title === 'Drive adapter missing' && f.severity === 'error'));
    assert.throws(() => commissionPCRecord(pc, { by: 'Engineer', checks: ['Checked'], notes: '' }, db), /Resolve installed compatibility/);
  };
  assertMissing();
  stock = act('cage-stock', { action: 'install-reserved', allocationId: stock.allocations[0].id, quantity: 1, notes: 'Installed cage' });
  assert.equal(checkInstalledPC(pc, db).resources.find(r => r.name === '5.25-inch bays')?.used, 1);
  act('cage-stock', { action: 'remove', allocationId: stock.allocations[0].id, quantity: 1, destinationLocation: 'Stock room', disposition: 'Serviceable', notes: 'Removed cage' });
  assertMissing();
});

test('multiple installed cages for one planned provider require an exact allocation before commissioning', () => {
  const { db, pc, chassis, receive, act, install } = fixture(); install(); receive('second-cage', 'cage');
  const chassisAllocation = db.inventory.flatMap(stock => stock.allocations).find(a => a.plannedPlacementId === chassis.id)!;
  const second = act('second-cage', { action: 'install', pcId: pc.id, quantity: 1, plannedPlacementId: 'cage-line', adapterPlacementId: chassisAllocation.id, targetId: 'BAY2' });
  assert.ok(checkInstalledPC(pc, db).findings.some(f => f.title === 'Ambiguous installed provider binding' && f.severity === 'error'));
  assert.throws(() => commissionPCRecord(pc, { by: 'Engineer', checks: ['Checked'], notes: '' }, db), /Resolve installed compatibility/);
  const drive = db.inventory.find(stock => stock.id === 'stock-data-line')!.allocations[0];
  act('stock-data-line', { action: 'configure', allocationId: drive.id, role: drive.role, mount: drive.mount, slotId: drive.slotId,
    adapterPlacementId: second.allocations[0].id, targetId: 'DATA1', notes: 'Connected to second installed cage' });
  assert.ok(!checkInstalledPC(pc, db).findings.some(f => f.title === 'Ambiguous installed provider binding'));
  assert.equal(installedConfiguration(pc, db).placements.find(p => p.componentId === 'ssd')?.adapterPlacementId, second.allocations[0].id);
  const history = db.inventory.find(stock => stock.id === 'stock-data-line')!.history.at(-1)!;
  assert.ok(history.notes.includes(second.allocations[0].id));
});

test('CSV transfers preserve bay catalogs, fitted stock bindings and commissioned cage snapshots', () => {
  const { db, pc, install } = fixture(); install();
  const accepted = commissionPCRecord(pc, { by: 'Engineer', checks: ['Bay and cable routing verified'], notes: '' }, db);
  const components = db.components.filter(c => ['case-tower', 'cage'].includes(c.id)).map(c => schemas.components.parse(c));
  assert.deepEqual(decodeCSV('components', encodeCSV('components', components)), components);
  const inventory = db.inventory.map(stock => schemas.inventory.parse(stock));
  assert.deepEqual(decodeCSV('inventory', encodeCSV('inventory', inventory)), inventory);
  // JSON cells omit optional undefined keys, as a workspace JSON transfer does.
  const pcs = [schemas.pcs.parse(JSON.parse(JSON.stringify(accepted)))];
  assert.deepEqual(decodeCSV('pcs', encodeCSV('pcs', pcs)), pcs);
});
