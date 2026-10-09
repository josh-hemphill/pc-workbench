import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store,encodeCSV,decodeCSV} from '../server/store';
import {saveStockRecord,applyStockOperation} from '../server/inventory';
import {mapStorageBindings} from '../shared/storage-bindings';
import type {StorageBindings} from '../shared/types';
const wiring:StorageBindings={bayTargetIds:['FRONT_1','FRONT_2'],sataDataConnections:[{inputId:'D1',controllerPlacementId:'line-1',portId:'SATA_1'},{inputId:'D2',controllerPlacementId:'line-1',portId:'SATA_2'}],sataPowerConnections:[{inputId:'P1',powerProviderPlacementId:'line-9',connectorId:'PLUG_1'}]};
function workspace(run:(store:Store)=>void){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bench-wiring-inventory-'));const store=new Store(dir);try{const cage={id:'cage',name:'Cage',category:'Storage adapter' as const,manufacturer:'',source:'',verified:false,specs:{storageAdapterKind:'bay-cage' as const,baySize:'5.25' as const,bayUnits:2,sataDataInputs:[{id:'D1'},{id:'D2'}],sataPowerInputs:[{id:'P1'}]}};store.replace('components',[...store.db.components,cage]);const config=structuredClone(store.db.configurations[0]);config.placements.push({id:'cage-plan',componentId:'cage',quantity:1,role:'general',mount:'auto',slotId:'',group:'',...mapStorageBindings(wiring)});store.replace('configurations',store.db.configurations.map(c=>c.id===config.id?config:c));store.replace('inventory',[saveStockRecord({id:'cage-stock',componentId:'cage',tracking:'bulk',serial:'',assetTag:'CAGES',quantity:2,location:'Shelf',condition:'Serviceable',notes:'',allocations:[],history:[]},store.db)]);run(store);}finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}}
function action(store:Store,input:unknown){const result=applyStockOperation(store.db.inventory[0],input,store.db);store.replace('inventory',[result.stock,...store.db.inventory.slice(1),...(result.additionalStock?[result.additionalStock]:[])]);return result.stock;}
test('template wiring copied into a reservation is isolated from subsequent template and editor changes',()=>workspace(store=>{
 const stock=action(store,{action:'reserve',pcId:'pc-01',quantity:1,plannedPlacementId:'cage-plan',...mapStorageBindings(wiring)});assert.deepEqual(mapStorageBindings(stock.allocations[0]),wiring);
 const copied=mapStorageBindings(stock.allocations[0]);copied.bayTargetIds![0]='OTHER';copied.sataDataConnections![0].portId='OTHER';assert.deepEqual(mapStorageBindings(store.db.inventory[0].allocations[0]),wiring);
 const config=structuredClone(store.db.configurations[0]);config.placements.at(-1)!.sataDataConnections![0].portId='CHANGED';store.replace('configurations',store.db.configurations.map(c=>c.id===config.id?config:c));assert.deepEqual(mapStorageBindings(store.db.inventory[0].allocations[0]),wiring);
}));
test('placement wiring edits survive reservation installation, exact CSV round trip and SQLite restart',()=>workspace(store=>{
 let stock=action(store,{action:'reserve',pcId:'pc-01',quantity:1,plannedPlacementId:'cage-plan',...mapStorageBindings(wiring)});const allocationId=stock.allocations[0].id;
 const edited=mapStorageBindings(wiring);edited.sataPowerConnections![0].connectorId='PLUG_2';stock=action(store,{action:'configure',allocationId,role:'general',mount:'auto',slotId:'',notes:'Changed PSU cable',...edited});assert.deepEqual(mapStorageBindings(stock.allocations[0]),edited);
 stock=action(store,{action:'install-reserved',allocationId,quantity:1});assert.equal(stock.allocations[0].state,'installed');assert.deepEqual(mapStorageBindings(stock.allocations[0]),edited);
 store.replace('inventory',decodeCSV('inventory',encodeCSV('inventory',store.db.inventory)));const reopened=new Store(store.dir);try{assert.deepEqual(mapStorageBindings(reopened.db.inventory[0].allocations[0]),edited);}finally{reopened.close();}
}));
test('explicitly clearing named wiring preserves unrelated placement and reservation information',()=>workspace(store=>{
 let stock=action(store,{action:'reserve',pcId:'pc-01',quantity:1,plannedPlacementId:'cage-plan',owner:'Engineer',workOrder:'WO-1',...mapStorageBindings(wiring)});const before=structuredClone(stock.allocations[0]);stock=action(store,{action:'configure',allocationId:before.id,role:before.role,mount:before.mount,slotId:before.slotId,notes:'Use count-only connections',bayTargetIds:[],sataDataConnections:[],sataPowerConnections:[]});
 assert.deepEqual(mapStorageBindings(stock.allocations[0]),{bayTargetIds:[],sataDataConnections:[],sataPowerConnections:[]});assert.equal(stock.allocations[0].owner,'Engineer');assert.equal(stock.allocations[0].workOrder,'WO-1');assert.equal(stock.allocations[0].plannedPlacementId,'cage-plan');assert.equal(stock.allocations[0].state,'reserved');
}));
