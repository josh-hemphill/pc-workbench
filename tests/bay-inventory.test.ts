import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../server/seed';
import { applyStockOperation, saveStockRecord } from '../server/inventory';
import { commissionPCRecord } from '../server/pc-lifecycle';
import { schemas } from '../server/schema';
import { decodeCSV, encodeCSV } from '../server/store';
import { checkInstalledPC, commissioningDrift, installedConfiguration,planDifferences } from '../shared/inventory';

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

function wiredFixture(){
 const f=fixture(),config=f.db.configurations[0],cage=f.db.components.find(c=>c.id==='cage')!,cp=config.placements.find(p=>p.id==='cage-line')!;
 const board=config.placements.find(p=>p.componentId==='board-atx')!,psu=config.placements.find(p=>p.componentId==='psu')!;
 const chassis=f.db.components.find(c=>c.id===f.chassis.componentId)!;
 chassis.specs.bayTargets=[{id:'BAY1',size:'5.25',group:'FRONT',position:1,maxDepthMm:180},{id:'BAY2',size:'5.25',group:'FRONT',position:2,maxDepthMm:180}];
 cage.specs.bayUnits=2;cage.specs.lengthMm=150;cage.specs.sataDataInputs=[{id:'IN1'}];cage.specs.sataPowerInputs=[{id:'POWER'}];
 Object.assign(cage.specs.driveTargets![0],{sataDataInputId:'IN1',sataPowerInputId:'POWER'});
 const bs=f.db.components.find(c=>c.id===board.componentId)!.specs;bs.sataDataPorts=Array.from({length:bs.sataPorts||6},(_,i)=>({id:`SATA${i+1}`}));
 const ps=f.db.components.find(c=>c.id===psu.componentId)!.specs;ps.sataPower=2;ps.sataPowerConnectors=[{id:'P1',harness:'H1'},{id:'P2',harness:'H1'}];
 cp.bayTargetIds=['BAY1','BAY2'];cp.sataDataConnections=[{inputId:'IN1',controllerPlacementId:board.id,portId:'SATA1'}];cp.sataPowerConnections=[{inputId:'POWER',powerProviderPlacementId:psu.id,connectorId:'P1'}];
 return {...f,config,cage,cp,board,psu};
}

test('named bay and cable allocations remap actual providers, survive CSV, and remain immutable in commissioned snapshots',()=>{
 const {db,pc,install,act,cp,board,psu}=wiredFixture();install();
 const allocation=(planned:string)=>db.inventory.flatMap(s=>s.allocations).find(a=>a.plannedPlacementId===planned)!;
 const actual=installedConfiguration(pc,db),cage=actual.placements.find(p=>p.componentId==='cage')!;
 assert.deepEqual(cage.bayTargetIds,['BAY1','BAY2']);assert.equal(cage.sataDataConnections![0].controllerPlacementId,allocation(board.id).id);assert.equal(cage.sataPowerConnections![0].powerProviderPlacementId,allocation(psu.id).id);
 const accepted=commissionPCRecord(pc,{by:'Engineer',checks:['Physical cable endpoints and cage mounting inspected'],notes:''},db);
 assert.equal(commissioningDrift(accepted,db),false);
 for(const collection of ['components','configurations','inventory'] as const){const records=db[collection].map(record=>schemas[collection].parse(record));assert.deepEqual(decodeCSV(collection,encodeCSV(collection,records)),records);}
 const transferred=[schemas.pcs.parse(JSON.parse(JSON.stringify(accepted)))];assert.deepEqual(decodeCSV('pcs',encodeCSV('pcs',transferred)),transferred);
 const installed=allocation(cp.id);act(`stock-${cp.id}`,{action:'configure',allocationId:installed.id,role:installed.role,mount:installed.mount,slotId:installed.slotId,sataPowerConnections:[{inputId:'POWER',powerProviderPlacementId:allocation(psu.id).id,connectorId:'P2'}],notes:'Moved power to spare harness end plug'});
 assert.equal(commissioningDrift(accepted,db),true);assert.equal(accepted.snapshot!.configuration.placements.find(p=>p.componentId==='cage')!.sataPowerConnections![0].connectorId,'P1');assert.equal(accepted.snapshot!.installedStock!.find(s=>s.componentId==='cage')!.sataPowerConnections![0].connectorId,'P1');
 assert.ok(db.inventory.find(s=>s.id===`stock-${cp.id}`)!.history.at(-1)!.notes.includes('P2'));
});

test('reserved and removed data providers never satisfy installed named cable routes',()=>{
 const {db,pc,install,act,board}=wiredFixture();install();
 const boardStock=db.inventory.find(s=>s.id===`stock-${board.id}`)!,allocation=boardStock.allocations[0];
 act(boardStock.id,{action:'remove',allocationId:allocation.id,quantity:1,destinationLocation:'Stock room',disposition:'Serviceable',notes:'Removed board'});
 let report=checkInstalledPC(pc,db);assert.ok(report.findings.some(f=>f.title==='SATA data provider invalid'));
 const reserved=act(boardStock.id,{action:'reserve',pcId:pc.id,quantity:1,plannedPlacementId:board.id});report=checkInstalledPC(pc,db);assert.ok(report.findings.some(f=>f.title==='SATA data provider invalid'));
 const actual=installedConfiguration(pc,db);assert.equal(actual.placements.find(p=>p.componentId==='cage')!.sataDataConnections![0].controllerPlacementId,board.id);assert.ok(!actual.placements.some(p=>p.id===reserved.allocations[0].id));
 act(boardStock.id,{action:'install-reserved',allocationId:reserved.allocations[0].id,quantity:1});assert.ok(!checkInstalledPC(pc,db).findings.some(f=>f.title==='SATA data provider invalid'));
});

test('ambiguous planned power providers remain unresolved until an exact installed allocation is recorded',()=>{
 const {db,pc,install,act,receive,cp,psu}=wiredFixture();install();receive('second-power-supply',psu.componentId);act('second-power-supply',{action:'install',pcId:pc.id,quantity:1,plannedPlacementId:psu.id});
 assert.equal(installedConfiguration(pc,db).placements.find(p=>p.componentId==='cage')!.sataPowerConnections![0].powerProviderPlacementId,psu.id);
 assert.ok(checkInstalledPC(pc,db).findings.some(f=>f.title==='Ambiguous installed provider binding'));
 const cage=db.inventory.find(s=>s.id===`stock-${cp.id}`)!.allocations[0],supply=db.inventory.find(s=>s.id===`stock-${psu.id}`)!.allocations[0];
 act(`stock-${cp.id}`,{action:'configure',allocationId:cage.id,role:cage.role,mount:cage.mount,slotId:cage.slotId,sataPowerConnections:[{inputId:'POWER',powerProviderPlacementId:supply.id,connectorId:'P1'}]});
 assert.equal(installedConfiguration(pc,db).placements.find(p=>p.componentId==='cage')!.sataPowerConnections![0].powerProviderPlacementId,supply.id);
 assert.ok(!checkInstalledPC(pc,db).findings.some(f=>f.title==='Ambiguous installed provider binding'));
});

test('partial BOM allocations and reservation splits do not invent shared physical bay and cable identities',()=>{
 const {db,pc,cp,receive,act}=wiredFixture();cp.quantity=2;
 receive('single-cage','cage');const partial=act('single-cage',{action:'install',pcId:pc.id,quantity:1,plannedPlacementId:cp.id});
 assert.equal(partial.allocations[0].bayTargetIds,undefined);assert.equal(partial.allocations[0].sataDataConnections,undefined);assert.equal(partial.allocations[0].sataPowerConnections,undefined);
 assert.equal(partial.allocations[0].targetId,'');
 const bulk=saveStockRecord({id:'cage-lot',componentId:'cage',tracking:'bulk',serial:'',assetTag:'',quantity:2,location:'Stock',condition:'Serviceable',notes:'',allocations:[],history:[]},db);db.inventory.push(bulk);
 const held=act(bulk.id,{action:'reserve',pcId:pc.id,quantity:2,plannedPlacementId:cp.id});assert.deepEqual(held.allocations[0].bayTargetIds,cp.bayTargetIds);
 const split=act(bulk.id,{action:'install-reserved',allocationId:held.allocations[0].id,quantity:1});assert.equal(split.allocations.length,2);
 for(const allocation of split.allocations){assert.equal(allocation.bayTargetIds,undefined);assert.equal(allocation.sataDataConnections,undefined);assert.equal(allocation.sataPowerConnections,undefined);assert.equal(allocation.targetId,'');}
 assert.ok(split.history.at(-1)!.notes.includes('must be reassigned'));assert.ok(split.history.at(-1)!.notes.includes('BAY1'));
});

test('partial recovery clears remaining aggregate physical bindings and preserves prior wiring in movement history',()=>{
 const {db,pc,cp,act}=wiredFixture();cp.quantity=2;
 const stock=saveStockRecord({id:'cage-lot',componentId:'cage',tracking:'bulk',serial:'',assetTag:'',quantity:2,location:'Stock',condition:'Serviceable',notes:'',allocations:[],history:[]},db);db.inventory.push(stock);
 const installed=act(stock.id,{action:'install',pcId:pc.id,quantity:2,plannedPlacementId:cp.id});const allocation=installed.allocations[0];
 const result=act(stock.id,{action:'remove',allocationId:allocation.id,quantity:1,destinationLocation:'Stock',disposition:'Serviceable',notes:'Recovered one unit'});
 assert.equal(result.allocations[0].quantity,1);assert.equal(result.allocations[0].bayTargetIds,undefined);assert.equal(result.allocations[0].sataDataConnections,undefined);
 assert.equal(result.allocations[0].targetId,'');
 assert.ok(result.history.at(-1)!.notes.includes('BAY1'));assert.ok(result.history.at(-1)!.notes.includes('reassign'));
});

test('valid serialized subsets cover an aggregate planned bay span without false missing or extra inventory',()=>{
 const {db,pc,config,cage,cp,chassis,install,receive,act}=wiredFixture();
 cage.category='Bay accessory';for(const field of ['driveTargets','sataDataInputs','sataPowerInputs','sataPowerPlugs'] as const)delete cage.specs[field];
 cp.quantity=2;cp.bayTargetIds=['BAY1','BAY2','BAY3','BAY4'];delete cp.sataDataConnections;delete cp.sataPowerConnections;
 const enclosure=db.components.find(c=>c.id===chassis.componentId)!;enclosure.specs.bays525=4;enclosure.specs.bayTargets=Array.from({length:4},(_,i)=>({id:`BAY${i+1}`,size:'5.25' as const,group:'FRONT',position:i+1,maxDepthMm:180}));
 config.placements=config.placements.filter(p=>p.id!=='data-line');delete config.software;delete pc.software;install(false);
 receive('first-cage','cage');receive('second-cage','cage');
 act('first-cage',{action:'install',pcId:pc.id,quantity:1,plannedPlacementId:cp.id,bayTargetIds:['BAY1','BAY2'],targetId:'BAY1'});
 act('second-cage',{action:'install',pcId:pc.id,quantity:1,plannedPlacementId:cp.id,bayTargetIds:['BAY3','BAY4'],targetId:'BAY3'});
 assert.deepEqual(planDifferences(pc,db),[]);
 const second=db.inventory.find(s=>s.id==='second-cage')!.allocations[0];act('second-cage',{action:'configure',allocationId:second.id,role:second.role,mount:second.mount,slotId:second.slotId,bayTargetIds:['BAY1','BAY2'],targetId:'BAY1'});
 assert.ok(planDifferences(pc,db).some(detail=>detail.includes('missing BAY3, BAY4')));
});

test('storage binding schemas permit automatic providers but reject invalid IDs and dangling catalog endpoints',()=>{
 const {db,config,cage,cp}=wiredFixture();cp.sataDataConnections![0].controllerPlacementId='';cp.sataPowerConnections![0].powerProviderPlacementId='';
 assert.equal(schemas.configurations.safeParse(config).success,true);
 cp.sataDataConnections![0].controllerPlacementId='   ';assert.equal(schemas.configurations.safeParse(config).success,false);
 const invalid=structuredClone(cage);invalid.specs.driveTargets![0].sataDataInputId='absent';assert.equal(schemas.components.safeParse(invalid).success,false);
 const board=structuredClone(db.components.find(c=>c.id==='board-atx')!);board.specs.laneRules=[{id:'sharing',slots:[board.specs.slots![0].id],disableSataPortIds:['absent']}];assert.equal(schemas.components.safeParse(board).success,false);
});
