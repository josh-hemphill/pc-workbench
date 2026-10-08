import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {seed} from '../server/seed';
import {Store,encodeCSV,decodeCSV} from '../server/store';
import {schemas} from '../server/schema';
import {saveStockRecord,applyStockOperation} from '../server/inventory';
import {savePCRecord,commissionPCRecord} from '../server/pc-lifecycle';
import {stockCounts,fleetPicklist,pcAllocations} from '../shared/inventory';
import type {Database, InventoryPC} from '../shared/types';

function setup(){
 const db=structuredClone(seed);
 const receive=(id:string,componentId='ram',quantity=5,serialized=false)=>{const stock=saveStockRecord({id,componentId,quantity,tracking:serialized?'serialized':'bulk',serial:serialized?id:'',assetTag:'',location:'Shelf',condition:'Serviceable',notes:'',allocations:[],history:[]},db);db.inventory.push(stock);return stock;};
 const action=(id:string,input:unknown)=>{const index=db.inventory.findIndex(s=>s.id===id),result=applyStockOperation(db.inventory[index],input,db);db.inventory[index]=result.stock;if(result.additionalStock)db.inventory.push(result.additionalStock);return result;};
 const change=(patch:Partial<InventoryPC>)=>{const next=savePCRecord({...db.pcs[0],...patch},db);db.pcs[0]=next;return next;};
 return {db,receive,action,change};
}
function allocated(){const s=setup();s.receive('memory');s.action('memory',{action:'install',pcId:'pc-01',quantity:2});s.action('memory',{action:'reserve',pcId:'pc-01',quantity:1,owner:'Engineer',workOrder:'BUILD-1'});s.receive('gpu-unit','gpu',1,true);s.action('gpu-unit',{action:'install',pcId:'pc-01',quantity:1});return s;}
function commissioned(){const s=setup();for(const p of s.db.configurations[0].placements){s.receive(`stock-${p.id}`,p.componentId,p.quantity);s.action(`stock-${p.id}`,{action:'install',pcId:'pc-01',quantity:p.quantity,plannedPlacementId:p.id});}s.db.pcs[0]=commissionPCRecord(s.db.pcs[0],{by:'Engineer',checks:['Hardware and equipment tested']},s.db);return s;}

 test('Parts only retains installed serialized and bulk parts plus reservations, with an auditable lifecycle transition',()=>{
 const {db,change}=allocated(),before=structuredClone(db.inventory),pc=change({lifecycle:'Parts only'});
 assert.deepEqual(db.inventory,before);assert.deepEqual(stockCounts(db.inventory[0]),{installed:2,reserved:1,unallocated:2,available:2});assert.equal(stockCounts(db.inventory[1]).available,0);
 assert.equal(pc.timeline!.at(-1)!.kind,'parts-only');assert.match(pc.timeline!.at(-1)!.summary,/remain assigned/);assert.equal(schemas.pcs.safeParse(pc).success,true);
});
test('Parts-only PCs reject new reservations, installs and reservation conversions atomically',()=>{
 const {db,change,action}=allocated();change({lifecycle:'Parts only'});const before=structuredClone(db.inventory),reserved=db.inventory[0].allocations.find(a=>a.state==='reserved')!;
 for(const op of [{action:'reserve',pcId:'pc-01',quantity:1},{action:'install',pcId:'pc-01',quantity:1},{action:'install-reserved',allocationId:reserved.id,quantity:1}]){assert.throws(()=>action('memory',op),/Parts-only/);assert.deepEqual(db.inventory,before);}
});
test('salvage removes parts to explicit condition and location, releases holds, and conserves physical inventory',()=>{
 const {db,change,action}=allocated();change({lifecycle:'Parts only'});const installed=db.inventory[0].allocations.find(a=>a.state==='installed')!,reserved=db.inventory[0].allocations.find(a=>a.state==='reserved')!;
 action('memory',{action:'configure',allocationId:installed.id,role:'general',mount:'internal',slotId:'',notes:'Identify salvage position'});assert.equal(db.inventory[0].allocations.find(a=>a.id===installed.id)!.mount,'internal');
 const result=action('memory',{action:'remove',allocationId:installed.id,quantity:1,destinationLocation:'Repair cabinet',disposition:'Repair',notes:'Failed memory',actor:'Technician'});
 assert.equal(result.additionalStock!.condition,'Repair');assert.equal(result.additionalStock!.location,'Repair cabinet');assert.equal(stockCounts(result.additionalStock!).available,0);assert.equal(db.inventory.filter(s=>s.componentId==='ram').reduce((n,s)=>n+s.quantity,0),5);
 action('memory',{action:'release',allocationId:reserved.id,quantity:1,notes:'Cancelled build'});assert.equal(stockCounts(db.inventory[0]).available,3);
 action('gpu-unit',{action:'remove',allocationId:db.inventory[1].allocations[0].id,quantity:1,destinationLocation:'Salvage shelf',disposition:'Quarantined',notes:'Await inspection'});assert.equal(db.inventory[1].serial,'gpu-unit');assert.equal(db.inventory[1].condition,'Quarantined');assert.equal(db.inventory[1].location,'Salvage shelf');assert.equal(stockCounts(db.inventory[1]).available,0);
 assert.equal(db.pcs[0].lifecycle,'Parts only');assert.equal(db.inventory[0].history.filter(e=>e.action==='configure').length,1);
});
test('historical acceptance is preserved but Parts-only machines must rebuild and commission again before service',()=>{
 const {db,change}=commissioned(),old=structuredClone(db.pcs[0]),inventory=structuredClone(db.inventory);let pc=change({lifecycle:'Parts only'});
 assert.deepEqual(pc.snapshot,old.snapshot);assert.deepEqual(pc.snapshots,old.snapshots);assert.deepEqual(pc.commissioning,old.commissioning);assert.deepEqual(db.inventory,inventory);
 assert.throws(()=>commissionPCRecord(pc,{by:'Engineer',checks:['Checked']},db),/Return it to Building/);
 for(const lifecycle of ['Commissioned','In service','Maintenance','Planning'] as const)assert.throws(()=>change({lifecycle}),/Return a Parts-only PC to Building/);
 pc=change({lifecycle:'Building'});assert.equal(pc.timeline!.at(-1)!.kind,'parts-only-rebuild');assert.throws(()=>change({lifecycle:'In service'}),/Commission this PC again/);
 change({lifecycle:'Maintenance'});assert.throws(()=>change({lifecycle:'In service'}),/Commission this PC again/);change({lifecycle:'Building'});
 db.pcs[0]=commissionPCRecord(db.pcs[0],{by:'Engineer',checks:['Salvaged system revalidated']},db);pc=change({lifecycle:'In service'});assert.equal(pc.lifecycle,'In service');assert.equal(pc.snapshots!.length,2);assert.deepEqual(pc.snapshots![0],old.snapshots![0]);
});
test('an imported Parts-only record without transition history still requires a new acceptance after rebuilding',()=>{
 const {db,change}=commissioned();db.pcs[0].lifecycle='Parts only';db.pcs[0].timeline=[];change({lifecycle:'Building'});assert.throws(()=>change({lifecycle:'In service'}),/Commission this PC again/);
});
test('fleet picks ignore Parts-only build demand while assigned stock stays unavailable to other builds',()=>{
 const {db,change}=allocated();change({lifecycle:'Parts only'});db.configurations[0].placements=[{id:'ram',componentId:'ram',quantity:4,slotId:'',role:'general',mount:'auto',group:''}];db.pcs.push({...structuredClone(db.pcs[0]),id:'second-pc',name:'Active build',lifecycle:'Building'});
 const picks=fleetPicklist(db);assert.ok(picks.every(row=>row.pcId==='second-pc'));assert.equal(picks[0].pick,2);assert.equal(picks[0].shortage,2);assert.equal(pcAllocations('pc-01',db).length,3);
});
test('Parts-only PC allocations survive CSV, whole-workspace restore and SQLite restart; Retired invariants remain strict',()=>{
 const {db,change}=allocated();change({lifecycle:'Parts only'});const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bench-parts-only-'));let store:Store|undefined;
 try{store=new Store(dir);store.restore(db);store.replace('pcs',decodeCSV('pcs',encodeCSV('pcs',db.pcs)));assert.deepEqual(store.db.inventory,db.inventory);store.close();store=new Store(dir);assert.equal(store.db.pcs[0].lifecycle,'Parts only');assert.equal(pcAllocations('pc-01',store.db).length,3);
  const invalid:Database=structuredClone(store.db);invalid.pcs[0].lifecycle='Retired';assert.throws(()=>store!.restore(invalid),/retired PC/);assert.equal(store.db.pcs[0].lifecycle,'Parts only');
 }finally{store?.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('final retirement is blocked until both installations and existing holds are explicitly cleared',()=>{
 const {db,change,action}=allocated();change({lifecycle:'Parts only'});assert.throws(()=>change({lifecycle:'Retired'}),/Remove installed components and release reservations/);
 for(const {stock,allocation} of pcAllocations('pc-01',db))action(stock.id,{action:allocation.state==='installed'?'remove':'release',allocationId:allocation.id,quantity:allocation.quantity,notes:'Final salvage',...(allocation.state==='installed'?{disposition:'Serviceable',destinationLocation:'Shelf'}:{})});
 const pc=change({lifecycle:'Retired'});assert.equal(pc.lifecycle,'Retired');assert.equal(pcAllocations(pc.id,db).length,0);assert.equal(db.inventory.reduce((n,s)=>n+stockCounts(s).available,0),6);
});
