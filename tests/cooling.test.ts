import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {checkConfiguration} from '../shared/compatibility.ts';
import {checkCooling,coolingPowerW,coolingInputs} from '../shared/cooling.ts';
import {componentSchema} from '../shared/component-schema.ts';
import {componentSections} from '../shared/component-fields.ts';
import {componentReferences} from '../shared/component-editor.ts';
import {mapStorageBindings,storageBindingsMatch} from '../shared/storage-bindings.ts';
import {splitConfigurationPlacement} from '../shared/configuration-editing.ts';
import {schemas} from '../server/schema.ts';
import {Store,encodeCSV,decodeCSV} from '../server/store.ts';
import {saveStockRecord,applyStockOperation} from '../server/inventory.ts';
import {stockCounts,installedConfiguration} from '../shared/inventory.ts';
import {seed} from '../server/seed.ts';
import type {Component,Configuration,Database,CoolingDevice,CoolingHeader} from '../shared/types.ts';
function setup(){
 const db:Database=structuredClone(seed);
 const header:CoolingHeader={id:'CPU_FAN',connector:'Fan 4-pin',voltageV:12,maxCurrentA:1,maxDevices:3,controlModes:['PWM','DC voltage','Fixed speed'],tachometer:true,limitGroup:'FANS'};
 const device:CoolingDevice={id:'FAN_1',kind:'fan',powerConnector:'Fan 4-pin',control:'PWM',voltageV:12,currentA:0.3,tachometer:true};
 const component=(id:string,category:Component['category'],specs:Component['specs']):Component=>({id,name:id,category,specs,manufacturer:'',source:'',verified:true});
 db.components.push(component('test-board','Motherboard',{coolingHeaders:[header],coolingHeaderGroups:[{id:'FANS',maxCurrentA:1.5}]}),component('test-fan','Fan',{coolingDevices:[device],stockUnit:'fan'}));
 const config:Configuration={...structuredClone(db.configurations[0]),id:'cooling',status:'Draft',placements:[{id:'board-line',componentId:'test-board',quantity:1,role:'general',mount:'auto',slotId:'',group:''},{id:'fan-line',componentId:'test-fan',quantity:1,role:'general',mount:'auto',slotId:'',group:'',coolingConnections:[{deviceId:'FAN_1',deviceIndex:1,headerPlacementId:'board-line',headerId:'CPU_FAN'}]}]};
 return {db,config,header,device,fan:db.components.at(-1)!};
}
const errors=(cfg:Configuration,db:Database)=>checkCooling(cfg,db).findings.filter(f=>f.severity==='error');
test('fans and cooler pumps share validated power/control specs and stable cooling section',()=>{
 const {fan,device}=setup();assert.equal(componentSchema.parse(fan).category,'Fan');assert.ok(componentSections(fan).includes('cooling'));
 assert.equal(componentSchema.safeParse({...fan,specs:{coolingDevices:[device,{...device}]}}).success,false);
 assert.equal(componentSchema.safeParse({...fan,specs:{coolingDevices:[{...device,currentA:-1}]}}).success,false);
 assert.equal(componentSchema.safeParse({...fan,specs:{coolingHeaders:[{id:'H',connector:'Fan 3-pin',controlModes:['PWM']}]}}).success,false);
 assert.equal(componentSchema.safeParse({...fan,category:'Cooler',specs:{coolingDevices:[{...device,id:'PUMP',kind:'pump',powerConnector:'SATA power',controlConnector:'Fan 4-pin'}]}}).success,true);
 assert.ok(Math.abs(coolingPowerW(fan)!-3.6)<1e-9);assert.equal(coolingPowerW({...fan,specs:{...fan.specs,powerW:7}}),7);
});
test('cooling checks distinguish PWM, DC and fixed-speed control without assuming undocumented capabilities',()=>{
 const {db,config,header,device}=setup();assert.deepEqual(errors(config,db),[]);
 device.powerConnector='Fan 3-pin';device.control='DC voltage';assert.deepEqual(errors(config,db),[]);
 header.controlModes=['PWM'];assert.ok(errors(config,db).some(f=>f.title==='Cooling control mismatch'));
 device.control='PWM';assert.ok(errors(config,db).some(f=>f.title==='Cooling PWM connector mismatch'));
 device.powerConnector='Fan 4-pin';header.voltageV=5;assert.ok(errors(config,db).some(f=>f.title==='Cooling voltage mismatch'));assert.ok(checkConfiguration(config,db).findings.some(f=>f.title==='Cooling voltage mismatch'));
 header.voltageV=12;delete device.currentA;delete header.maxCurrentA;
 const unknown=checkCooling(config,db);assert.ok(unknown.findings.some(f=>f.title==='Cooling current unconfirmed'));assert.ok(!unknown.resources.some(r=>r.name.includes('header current')));
});
test('multiple fans charge per motor, enforce header and shared budgets and detect mixed control',()=>{
 const {db,config,header,device,fan}=setup();config.placements[1].quantity=3;
 for(let index=2;index<=3;index++)config.placements[1].coolingConnections!.push({...config.placements[1].coolingConnections![0],deviceIndex:index});
 assert.equal(coolingInputs(fan,3).length,3);assert.deepEqual(errors(config,db),[]);
 header.maxDevices=2;assert.ok(errors(config,db).some(f=>f.title==='Cooling header device limit exceeded'));
 header.maxDevices=3;device.currentA=0.6;assert.ok(errors(config,db).some(f=>f.title==='Cooling header current exceeded'));
 header.maxCurrentA=3;assert.ok(errors(config,db).some(f=>f.title==='Cooling shared current exceeded'));
 device.currentA=0.2;fan.specs.coolingDevices!.push({...device,id:'DC_FAN',control:'DC voltage',powerConnector:'Fan 3-pin'});
 config.placements[1].quantity=1;config.placements[1].coolingConnections=[config.placements[1].coolingConnections![0],{...config.placements[1].coolingConnections![0],deviceId:'DC_FAN'}];
 assert.ok(errors(config,db).some(f=>f.title==='Cooling shared control conflict'));
});
test('SATA-powered PWM pumps do not charge motor current to the control header and need separate power',()=>{
 const {db,config,header,device,fan}=setup();device.kind='pump';device.powerConnector='SATA power';device.controlConnector='Fan 4-pin';device.currentA=2;header.maxCurrentA=0.1;
 assert.deepEqual(errors(config,db),[]);assert.ok(checkCooling(config,db).findings.some(f=>f.title==='Cooling external power unconfirmed'));
 fan.specs.sataPowerPlugs=1;assert.ok(!checkCooling(config,db).findings.some(f=>f.title==='Cooling external power unconfirmed'));
 fan.specs.sataPowerPlugs=0;assert.ok(errors(config,db).some(f=>f.title==='Cooling external power missing'));
});
test('dangling, duplicate, ambiguous and incomplete cooling bindings remain visible',()=>{
 const {db,config}=setup(),line=config.placements[1],connection=line.coolingConnections![0];
 line.coolingConnections!.push({...connection});assert.ok(errors(config,db).some(f=>f.title==='Cooling input connected twice'));
 line.coolingConnections=[{...connection,deviceIndex:2}];assert.ok(errors(config,db).some(f=>f.title==='Cooling input missing'));assert.ok(checkCooling(config,db).findings.some(f=>f.title==='Cooling wiring incomplete'));
 line.coolingConnections=[{...connection,headerId:'MISSING'}];assert.ok(errors(config,db).some(f=>f.title==='Cooling header missing'));
 line.coolingConnections=[connection];config.placements[0].quantity=2;assert.ok(errors(config,db).some(f=>f.title==='Cooling provider ambiguous'));
 assert.throws(()=>splitConfigurationPlacement(config,'board-line',()=>crypto.randomUUID()),/supplies/);
 db.configurations.push(config);assert.ok(componentReferences(db.components.find(c=>c.id==='test-board')!,'coolingHeaders','CPU_FAN',db).length);
});
test('bulk fan reservations/installations preserve counts and wiring through CSV, backup, restart and actual-provider resolution',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-fans-'));let store=new Store(directory);
 try{
  const {db,config,fan}=setup();store.replace('components',db.components);store.replace('configurations',[...store.db.configurations,config]);
  let stock=saveStockRecord({id:'fan-lot',componentId:fan.id,tracking:'bulk',serial:'',assetTag:'FANS',quantity:8,location:'Shelf',condition:'Serviceable',notes:'',allocations:[],history:[]},store.db);
  const pc={...store.db.pcs[0],configurationId:config.id};store.replace('pcs',store.db.pcs.map(p=>p.id===pc.id?pc:p));
  stock=applyStockOperation(stock,{action:'reserve',pcId:pc.id,quantity:1,plannedPlacementId:'fan-line'},store.db).stock;
  assert.equal(stock.quantity,8);assert.equal(stockCounts(stock).available,7);assert.deepEqual(stock.allocations[0].coolingConnections,config.placements[1].coolingConnections);
  stock=applyStockOperation(stock,{action:'install-reserved',allocationId:stock.allocations[0].id,quantity:1},store.db).stock;
  assert.throws(()=>applyStockOperation(stock,{action:'consume',quantity:1,notes:'Used'},store.db),/cables and consumables/);
  store.replace('inventory',[stock]);assert.deepEqual(decodeCSV('inventory',encodeCSV('inventory',[stock])),[stock]);
  assert.deepEqual(decodeCSV('components',encodeCSV('components',[fan])),[fan]);
  const board=saveStockRecord({id:'board-lot',componentId:'test-board',tracking:'bulk',serial:'',assetTag:'BOARDS',quantity:1,location:'Shelf',condition:'Serviceable',notes:'',allocations:[],history:[]},store.db);
  const installedBoard=applyStockOperation(board,{action:'install',pcId:pc.id,quantity:1,plannedPlacementId:'board-line'},store.db).stock;
  store.replace('inventory',[stock,installedBoard]);const actual=installedConfiguration(pc,store.db);
  assert.equal(actual.placements.find(p=>p.componentId===fan.id)!.coolingConnections![0].headerPlacementId,installedBoard.allocations[0].id);
  assert.deepEqual(errors(actual,store.db),[]);
  const copied=mapStorageBindings(stock.allocations[0],id=>id==='board-line'?installedBoard.allocations[0].id:id);
  assert.ok(storageBindingsMatch(stock.allocations[0],copied,id=>id==='board-line'?installedBoard.allocations[0].id:id));
  const snapshot=schemas.pcs.parse({...pc,snapshot:{at:new Date().toISOString(),configuration:config,components:db.components,system:null,installedStock:[{stockId:stock.id,componentId:fan.id,serial:'',assetTag:stock.assetTag,allocationId:stock.allocations[0].id,quantity:1,role:'general',mount:'auto',slotId:'',...copied}]}}).snapshot!;
  assert.equal(snapshot.installedStock![0].coolingConnections![0].headerPlacementId,installedBoard.allocations[0].id);
  const backup=JSON.parse(JSON.stringify(store.db));assert.ok(store.validateBackup(backup).inventory[0].allocations[0].coolingConnections?.length);
  const multi={...config,placements:config.placements.map(p=>p.id==='fan-line'?{...p,quantity:2,coolingConnections:[...p.coolingConnections!,{...p.coolingConnections![0],deviceIndex:2}]}:p)};
  store.replace('configurations',store.db.configurations.map(c=>c.id===config.id?multi:c));
  const partial=applyStockOperation(stock,{action:'reserve',pcId:pc.id,quantity:1,plannedPlacementId:'fan-line'},store.db).stock;
  assert.equal(partial.allocations.at(-1)!.coolingConnections,undefined,'partial allocations must not copy the entire multi-fan wiring');
  store.close();store=new Store(directory);assert.deepEqual(store.db.inventory[0].allocations[0].coolingConnections,stock.allocations[0].coolingConnections);
 }finally{store.close();fs.rmSync(directory,{recursive:true,force:true});}
});
