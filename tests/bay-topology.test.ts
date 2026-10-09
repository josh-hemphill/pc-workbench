import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkBayTopology} from '../shared/bay-topology';
import type {BayTarget,Component,Configuration,Database,Placement,Specs} from '../shared/types';
const component=(id:string,category:Component['category'],specs:Specs):Component=>({id,name:id,category,manufacturer:'Example',source:'',verified:true,specs});
const placement=(id:string,extra:Partial<Placement>={}):Placement=>({id,componentId:id,quantity:1,slotId:'',role:'general',mount:'auto',group:'',...extra});
const bays=(positions=[1,2,3,4]):BayTarget[]=>positions.map(position=>({id:`B${position}`,size:'5.25',group:'Front',position,maxDepthMm:200}));
function setup(){
 const chassis=component('chassis','Chassis',{bays525:4,bays25:0,bays35:0,hotSwapBays:0,bayTargets:bays()});
 const cage=component('cage','Storage adapter',{storageAdapterKind:'bay-cage',baySize:'5.25',bayUnits:2,lengthMm:150});
 const config:Configuration={id:'config',name:'Test',description:'',systemId:'',status:'Draft',updatedAt:'',notes:'',placements:[placement('chassis'),placement('cage',{bayTargetIds:['B1','B2']})],storage:{raid:'none',bootMirror:false}};
 const db:Database={components:[chassis,cage],configurations:[config],systems:[],pcs:[],inventory:[],requirementsSets:[],installationLocations:[]};
 return {db,config,chassis,cage,row:config.placements[1]};
}
const has=(report:ReturnType<typeof checkBayTopology>,title:string,severity='error')=>report.findings.some(f=>f.title===title&&f.severity===severity);
const resource=(report:ReturnType<typeof checkBayTopology>,name:string)=>report.resources.find(r=>r.name===name)!;

test('multi-bay cages budget every space and detect collisions with accessories',()=>{
 const {db,config}=setup();let report=checkBayTopology(config,db);
 assert.equal(report.findings.filter(f=>f.severity==='error').length,0);assert.equal(resource(report,'5.25-inch bays').used,2);
 db.components.push(component('speaker','Bay accessory',{baySize:'5.25',bayUnits:1,lengthMm:100}));config.placements.push(placement('speaker',{bayTargetIds:['B2']}));
 report=checkBayTopology(config,db);assert.ok(has(report,'Bay target double booked'));assert.equal(resource(report,'5.25-inch bays').used,3);
});
test('multi-bay devices need adjacent spaces in one bank; undocumented topology remains reviewable',()=>{
 const {db,config,chassis,row}=setup();row.bayTargetIds=['B1','B3'];assert.ok(has(checkBayTopology(config,db),'Mounting bays are not adjacent'));
 row.bayTargetIds=['B1','B2'];chassis.specs.bayTargets![1].group='Rear';assert.ok(has(checkBayTopology(config,db),'Mounting bays are not adjacent'));
 delete chassis.specs.bayTargets![1].group;const report=checkBayTopology(config,db);assert.ok(has(report,'Multi-bay adjacency unconfirmed','warning'));assert.ok(!has(report,'Mounting bays are not adjacent'));
});
test('bulk consumers must bind the exact distinct occupied count and allow separate adjacent spans',()=>{
 const {db,config,row,chassis}=setup();row.quantity=2;row.bayTargetIds=['B1','B2','B3','B4'];let report=checkBayTopology(config,db);assert.equal(resource(report,'5.25-inch bays').used,4);assert.ok(!has(report,'Occupied bay count mismatch'));assert.ok(!has(report,'Mounting bays are not adjacent'));
 chassis.specs.bayTargets=bays([1,2,4,5]);row.bayTargetIds=['B1','B2','B4','B5'];assert.ok(!has(checkBayTopology(config,db),'Mounting bays are not adjacent'));
 row.bayTargetIds=['B1','B2','B4'];assert.ok(has(checkBayTopology(config,db),'Occupied bay count mismatch'));
 row.bayTargetIds=['B1','B2','B1','B2'];assert.ok(has(checkBayTopology(config,db),'Bay target double booked'));
});
test('named mounting spaces check bay size and available insertion depth',()=>{
 const {db,config,chassis,cage}=setup();cage.specs.lengthMm=250;chassis.specs.bayTargets![0].size='3.5';let report=checkBayTopology(config,db);assert.ok(has(report,'Bay depth exceeded'));assert.ok(has(report,'Bay size mismatch'));
 delete cage.specs.lengthMm;report=checkBayTopology(config,db);assert.ok(has(report,'Bay depth unconfirmed','warning'));assert.ok(!has(report,'Bay depth exceeded'));
});
test('legacy anchors retain aggregate demand and warn that other occupied spaces are unbound',()=>{
 const {db,config,row}=setup();delete row.bayTargetIds;row.targetId='B1';let report=checkBayTopology(config,db);assert.equal(resource(report,'5.25-inch bays').used,2);assert.ok(has(report,'Multi-bay occupancy review','warning'));assert.ok(!has(report,'Occupied bay count mismatch'));
 row.quantity=2;report=checkBayTopology(config,db);assert.ok(has(report,'Bay target double booked'));assert.equal(resource(report,'5.25-inch bays').used,4);
});
test('direct drive aliases share real occupancy with adapters without counting target plus bay twice',()=>{
 const {db,config,chassis,cage,row}=setup();chassis.specs.bayTargets=[{id:'DISK',size:'2.5',maxDepthMm:200}];chassis.specs.bays25=2;chassis.specs.driveTargets=[{id:'SATA1',bayId:'DISK',mount:'internal',driveSizes:['2.5'],interfaces:['SATA']}];
 const drive=component('drive','Drive',{driveSize:'2.5',driveInterface:'SATA',lengthMm:100});db.components.push(drive);config.placements=config.placements.filter(p=>p!==row);config.placements.push(placement('drive',{targetId:'SATA1',mount:'internal'}));
 let report=checkBayTopology(config,db);assert.equal(resource(report,'Internal 2.5-inch bays').used,1);assert.ok(!has(report,'Bay target double booked'));
 cage.specs.baySize='2.5';cage.specs.bayUnits=1;row.bayTargetIds=['DISK'];config.placements.push(row);report=checkBayTopology(config,db);assert.ok(has(report,'Bay target double booked'));assert.equal(resource(report,'Internal 2.5-inch bays').used,2);
 config.placements.find(p=>p.id==='drive')!.bayTargetIds=['OTHER'];assert.ok(has(checkBayTopology(config,db),'Drive target physical bay mismatch'));
});
test('cage logical positions do not consume extra chassis bays; optical disks use 5.25-inch space',()=>{
 const {db,config,cage}=setup();cage.specs.driveTargets=[{id:'D1',mount:'front-hot-swap',driveSizes:['3.5'],interfaces:['SATA']}];
 db.components.push(component('disk','Drive',{driveSize:'3.5',driveInterface:'SATA'}),component('optical','Drive',{driveKind:'optical',driveSize:'5.25',driveInterface:'SATA',lengthMm:150}));
 config.placements.push(placement('disk',{adapterPlacementId:'cage',targetId:'D1',mount:'front-hot-swap'}),placement('optical',{bayTargetIds:['B3'],mount:'internal'}));
 const report=checkBayTopology(config,db);assert.equal(resource(report,'5.25-inch bays').used,3);assert.equal(resource(report,'Internal 3.5-inch bays').used,0);assert.equal(resource(report,'Front hot-swap bays').used,0);assert.ok(!report.resources.some(r=>r.name.includes('SATA')));
});
test('nested physical mounting adapters account for host and downstream mounting spaces separately',()=>{
 const {db,config,cage,row}=setup();cage.specs.storageAdapterKind='mount-adapter';cage.specs.bayUnits=1;row.bayTargetIds=['B1'];cage.specs.bayTargets=[{id:'INNER',size:'2.5',maxDepthMm:150}];cage.specs.driveTargets=[{id:'D1',bayId:'INNER',mount:'internal',driveSizes:['2.5'],interfaces:['SATA']}];
 db.components.push(component('disk','Drive',{driveSize:'2.5',driveInterface:'SATA',lengthMm:100}));config.placements.push(placement('disk',{adapterPlacementId:'cage',targetId:'D1',mount:'internal'}));
 const report=checkBayTopology(config,db);assert.equal(resource(report,'5.25-inch bays').used,1);assert.equal(resource(report,'Bay provider cage (cage) 2.5-inch bays').used,1);assert.ok(!report.findings.some(f=>f.severity==='error'));
});
test('missing providers, provider instance ambiguity, and provider cycles remain errors',()=>{
 const {db,config,cage,row}=setup();row.adapterPlacementId='absent';assert.ok(has(checkBayTopology(config,db),'Bay provider missing'));
 row.adapterPlacementId='chassis';config.placements[0].quantity=2;assert.ok(has(checkBayTopology(config,db),'Ambiguous bay provider instance'));
 config.placements[0].quantity=1;cage.specs.storageAdapterKind='mount-adapter';cage.specs.bayTargets=bays();db.components.push({...structuredClone(cage),id:'second'});config.placements.push(placement('second',{adapterPlacementId:'cage',bayTargetIds:['B1','B2']}));row.adapterPlacementId='second';assert.ok(has(checkBayTopology(config,db),'Bay provider cycle'));
});
test('contradictory scalar capacities warn but retain named spaces, and unknown differs from zero',()=>{
 const {db,config,chassis}=setup();chassis.specs.bays525=1;let report=checkBayTopology(config,db);assert.equal(resource(report,'5.25-inch bays').available,4);assert.ok(has(report,'Bay capacity declarations disagree','warning'));
 delete chassis.specs.bayTargets;delete chassis.specs.bays525;report=checkBayTopology(config,db);assert.ok(has(report,'5.25-inch bays capacity unknown','warning'));
 chassis.specs.bayTargets=[];report=checkBayTopology(config,db);assert.equal(resource(report,'5.25-inch bays').available,0);assert.ok(has(report,'5.25-inch bays capacity exceeded'));
});

test('controller logical targets never waive the attached SATA drive physical chassis demand',()=>{
 const {db,config,chassis,row}=setup();config.placements=config.placements.filter(p=>p!==row);chassis.specs.bays35=1;
 db.components.push(component('controller','Storage adapter',{storageAdapterKind:'controller',driveTargets:[{id:'PORT1',mount:'internal',driveSizes:['3.5'],interfaces:['SATA']}]}),component('disk','Drive',{driveSize:'3.5',driveInterface:'SATA'}));
 config.placements.push(placement('controller'),placement('disk',{adapterPlacementId:'controller',targetId:'PORT1',mount:'internal'}));
 assert.equal(resource(checkBayTopology(config,db),'Internal 3.5-inch bays').used,1);
});

test('cleared occupied lists return to count-only planning and preserve logical cage positions',()=>{
 const {db,config,row,cage}=setup();row.bayTargetIds=[];row.targetId='';cage.specs.driveTargets=[{id:'D1',mount:'internal',driveSizes:['3.5'],interfaces:['SATA']}];db.components.push(component('disk','Drive',{driveSize:'3.5',driveInterface:'SATA'}));config.placements.push(placement('disk',{adapterPlacementId:'cage',targetId:'D1',mount:'internal',bayTargetIds:[]}));
 const report=checkBayTopology(config,db);assert.equal(resource(report,'5.25-inch bays').used,2);assert.equal(resource(report,'Internal 3.5-inch bays').used,0);assert.ok(has(report,'Individual bay target unrecorded','warning'));assert.ok(!has(report,'Occupied bay count mismatch'));
});
