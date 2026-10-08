import {test} from 'node:test';
import assert from 'node:assert/strict';
import {seed} from '../server/seed';
import {schemas} from '../server/schema';
import {checkConfiguration} from '../shared/compatibility';
import type {Component, Placement} from '../shared/types';

const placement=(id:string,componentId:string,extra:Partial<Placement>={}):Placement=>({id,componentId,quantity:1,slotId:'',role:'general',mount:'auto',group:'',...extra});
const setup=()=>{
 const db=structuredClone(seed),config=db.configurations[0],chassis=db.components.find(c=>c.category==='Chassis')!,board=db.components.find(c=>c.id==='board-atx')!,psu=db.components.find(c=>c.category==='PSU')!;
 chassis.specs.bays525=1;chassis.specs.bayTargets=[{id:'OPTICAL',size:'5.25'}];chassis.specs.hotSwapBays=0;
 const cage:Component={id:'dual-cage',name:'Dual SATA cage',category:'Storage adapter',manufacturer:'Example',source:'',verified:true,specs:{baySize:'5.25',bayUnits:1,sataPowerPlugs:1,powerW:2,driveTargets:[{id:'A',mount:'front-hot-swap',driveSizes:['2.5'],interfaces:['SATA'],hotSwap:true,bootable:true},{id:'B',mount:'front-hot-swap',driveSizes:['2.5'],interfaces:['SATA'],hotSwap:true,bootable:true}]}};
 db.components.push(cage);config.placements.push(placement('cage','dual-cage',{targetId:'OPTICAL'}));
 const hdd=db.components.find(c=>c.id==='hdd')!;hdd.specs.driveSize='2.5';config.placements=config.placements.filter(p=>p.componentId!=='hdd');
 config.placements.push(placement('data-a','hdd',{role:'data',mount:'front-hot-swap',adapterPlacementId:'cage',targetId:'A'}),placement('data-b','hdd',{role:'data',mount:'front-hot-swap',adapterPlacementId:'cage',targetId:'B'}));
 return {db,config,chassis,board,psu,cage};
};
const has=(report:ReturnType<typeof checkConfiguration>,title:string,severity='error')=>report.findings.some(f=>f.title===title&&f.severity===severity);
const value=(report:ReturnType<typeof checkConfiguration>,name:string)=>report.resources.find(r=>r.name===name)!;

test('bay fields and accessory category validate without changing legacy schemas',()=>{
 const {db,cage}=setup();assert.equal(schemas.components.safeParse(cage).success,true);assert.equal(schemas.components.safeParse({...cage,category:'Bay accessory'}).success,true);
 assert.equal(schemas.components.safeParse({...cage,specs:{...cage.specs,bayUnits:0}}).success,false);
 assert.equal(schemas.components.safeParse({...cage,specs:{...cage.specs,baySize:'M.2'}}).success,false);
 assert.equal(schemas.components.safeParse({...cage,specs:{...cage.specs,bayTargets:[{id:'DUP',size:'5.25'},{id:'DUP',size:'3.5'}]}}).success,false);
 assert.equal(schemas.components.safeParse(db.components.find(c=>c.id==='cpu')).success,true);
});
test('installed dual SATA cage consumes one optical bay, two SATA links and one shared power plug',()=>{
 const {db,config}=setup(),report=checkConfiguration(config,db);
 assert.equal(report.findings.filter(f=>f.severity==='error').length,0);
 assert.equal(value(report,'5.25-inch bays').used,1);assert.equal(value(report,'Front hot-swap bays').used,0);
 assert.equal(value(report,'Adapter Dual SATA cage drive positions').used,2);assert.equal(value(report,'Adapter Dual SATA cage drive positions').available,2);
 assert.equal(value(report,'SATA ports').used,2);assert.equal(value(report,'SATA power plugs').used,1);
 assert.ok(!Object.keys(report.slotAssignments).some(k=>k.startsWith('cage:')));
});
test('passive cages do not create SATA host links and downstream drives still need controller capacity',()=>{
 const {db,config,board,cage}=setup();cage.specs.sataPorts=100;board.specs.sataPorts=1;
 const report=checkConfiguration(config,db);assert.ok(has(report,'SATA ports capacity exceeded'));assert.equal(value(report,'SATA ports').available,1);
});
test('cage input plugs replace drive plugs only when explicitly specified',()=>{
 const {db,config,cage,psu}=setup();psu.specs.sataPower=1;assert.ok(!has(checkConfiguration(config,db),'SATA power plugs capacity exceeded'));
 delete cage.specs.sataPowerPlugs;const report=checkConfiguration(config,db);assert.equal(value(report,'SATA power plugs').used,2);assert.ok(has(report,'SATA power plugs capacity exceeded'));assert.ok(has(report,'Bay adapter power inputs unknown','warning'));
});
test('bay speaker and cage cannot occupy the same optical bay and both count toward the chassis budget',()=>{
 const {db,config}=setup();db.components.push({id:'speaker',name:'Bay speaker',category:'Bay accessory',manufacturer:'Example',source:'',verified:true,specs:{baySize:'5.25',bayUnits:1,powerW:1}});config.placements.push(placement('speaker','speaker',{targetId:'OPTICAL'}));
 const report=checkConfiguration(config,db);assert.ok(has(report,'Bay target double booked'));assert.ok(has(report,'5.25-inch bays capacity exceeded'));
});
test('missing installed cage cannot provide drive positions even when catalog entry remains',()=>{
 const {db,config}=setup();config.placements=config.placements.filter(p=>p.id!=='cage');const report=checkConfiguration(config,db);
 assert.ok(has(report,'Drive adapter missing'));assert.ok(has(report,'Drive target missing'));assert.ok(has(report,'Front hot-swap bays capacity exceeded'));assert.ok(!report.resources.some(r=>r.name==='Adapter Dual SATA cage drive positions'));
});
test('drive target size, individual occupancy, and cage bay fit are checked separately',()=>{
 const {db,config,cage,chassis}=setup();chassis.specs.bayTargets![0].size='3.5';cage.specs.driveTargets![0].driveSizes=['3.5'];config.placements.find(p=>p.id==='data-b')!.targetId='A';
 const report=checkConfiguration(config,db);assert.ok(has(report,'Bay size mismatch'));assert.ok(has(report,'Drive target size mismatch'));assert.ok(has(report,'Drive target double booked'));
});
test('bulk providers require individual placements for physical target bindings',()=>{
 const {db,config}=setup();config.placements.find(p=>p.id==='cage')!.quantity=2;const report=checkConfiguration(config,db);assert.ok(has(report,'Ambiguous drive adapter instance'));assert.ok(has(report,'Bay target double booked'));assert.equal(value(report,'5.25-inch bays').used,2);
});
test('unknown bay and power metadata require review, while absent chassis provider is invalid',()=>{
 const {db,config,cage,chassis}=setup();delete cage.specs.baySize;delete chassis.specs.bays525;delete chassis.specs.bayTargets;
 let report=checkConfiguration(config,db);assert.ok(has(report,'Bay installation specifications incomplete','warning'));assert.ok(!has(report,'No compatible expansion slot'));
 cage.specs.baySize='5.25';report=checkConfiguration(config,db);assert.ok(has(report,'5.25-inch bays capacity unknown','warning'));
 config.placements.find(p=>p.id==='cage')!.adapterPlacementId='absent';assert.ok(has(checkConfiguration(config,db),'Bay provider missing'));
});
test('multi-bay consumption respects aggregate capacity and warns physical adjacency is unrecorded',()=>{
 const {db,config,cage}=setup();cage.specs.bayUnits=2;const report=checkConfiguration(config,db);assert.ok(has(report,'5.25-inch bays capacity exceeded'));assert.ok(has(report,'Multi-bay occupancy review','warning'));
});
test('cyclic or self-containing bay providers are rejected',()=>{
 const {db,config,cage}=setup();cage.specs.bayTargets=[{id:'OPTICAL',size:'5.25'}];config.placements.find(p=>p.id==='cage')!.adapterPlacementId='cage';assert.ok(has(checkConfiguration(config,db),'Bay provider missing'));
 db.components.push({...structuredClone(cage),id:'second',name:'Second cage'});config.placements.push(placement('second','second',{adapterPlacementId:'cage',targetId:'OPTICAL'}));config.placements.find(p=>p.id==='cage')!.adapterPlacementId='second';assert.ok(has(checkConfiguration(config,db),'Bay provider cycle'));
});
test('a cage in a 3.5-inch bay shares chassis capacity with direct internal drives',()=>{
 const {db,config,cage,chassis}=setup();cage.specs.baySize='3.5';chassis.specs.bayTargets=[{id:'OPTICAL',size:'3.5'}];chassis.specs.bays35=1;
 config.placements.push(placement('extra-internal','hdd',{mount:'internal'}));db.components.find(c=>c.id==='hdd')!.specs.driveSize='3.5';
 const report=checkConfiguration(config,db);assert.equal(value(report,'Internal 3.5-inch bays').used,2);assert.ok(has(report,'Internal 3.5-inch bays capacity exceeded'));
});
test('PCIe controller input metadata and invalid cage targets cannot waive external drive power plugs',()=>{
 const {db,config,cage}=setup();cage.specs.sataPowerPlugs=0;cage.specs.baySize=undefined;cage.specs.slotBus='PCIe';cage.specs.driveTargets=undefined;
 let report=checkConfiguration(config,db);assert.equal(value(report,'SATA power plugs').used,2);assert.equal(value(report,'Front hot-swap bays').used,2);
 const clean=setup();clean.config.placements.find(p=>p.id==='data-a')!.targetId='MISSING';report=checkConfiguration(clean.config,clean.db);assert.equal(value(report,'SATA power plugs').used,2);assert.ok(has(report,'Bay adapter power routing unconfirmed','warning'));
});
test('an undocumented interface-capable bay accessory leaves Serial capacity uncertain',()=>{
 const {db,config}=setup();for(const c of db.components)if(['Motherboard','Scientific card','Network card','Storage adapter','GPU'].includes(c.category))c.specs.ports=[];
 db.components.push({id:'front-panel',name:'Front panel',category:'Bay accessory',manufacturer:'Example',source:'',verified:true,specs:{baySize:'5.25',bayUnits:1}});config.placements.push(placement('front-panel','front-panel'));
 db.systems.find(s=>s.id===config.systemId)!.connections=[{id:'serial-instrument',name:'Serial instrument',usbA:0,usbC:0,ethernet:0,notes:'',requirements:[{id:'serial',kind:'Serial',quantity:1}]}];
 const report=checkConfiguration(config,db);assert.ok(has(report,'Serial ports capacity unknown','warning'));assert.ok(!has(report,'Serial ports capacity exceeded'));assert.ok(!has(report,'Equipment ports cannot be allocated'));
});
test('adapter M.2 targets use their own dimensions and do not consume motherboard shared M.2 resources',()=>{
 const {db,config,cage,board}=setup();cage.specs.driveTargets=[{id:'A',mount:'internal',driveSizes:['M.2'],interfaces:['NVMe'],m2Lengths:[22110],bootable:true}];
 board.specs.m2Lengths=[80];board.specs.m2Slots=2;board.specs.laneRules=[{id:'onboard-budget',slots:['PCIE_1'],disableM2Slots:0}];
 const drive=db.components.find(c=>c.id==='hdd')!;drive.specs.driveSize='M.2';drive.specs.driveInterface='NVMe';drive.specs.m2Length=22110;
 config.placements=config.placements.filter(p=>p.id!=='data-b');const placed=config.placements.find(p=>p.id==='data-a')!;placed.mount='auto';config.storage.raid='none';
 const report=checkConfiguration(config,db);assert.equal(value(report,'Onboard M.2 slots').used,2);assert.ok(!has(report,'M.2 length unsupported'));assert.ok(!has(report,'Expansion slots cannot be allocated'));assert.ok(!has(report,'Drive target length mismatch'));
});
