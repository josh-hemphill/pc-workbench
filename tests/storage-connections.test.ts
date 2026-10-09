import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Component,Configuration,Database,Placement} from '../shared/types';
import {checkStorageConnections} from '../shared/storage-connections';

const component=(id:string,category:Component['category'],specs:Component['specs']):Component=>({id,name:id,category,specs,manufacturer:'Example',verified:true,source:''});
const place=(id:string,extra:Partial<Placement>={}):Placement=>({id,componentId:id,quantity:1,slotId:'',role:'data',mount:'auto',group:'',...extra});
function setup(){
 const board=component('board','Motherboard',{sataPorts:2,sataDataPorts:[{id:'S1'},{id:'S2'}]});
 const psu=component('psu','PSU',{sataPower:2,sataPowerConnectors:[{id:'P1',harness:'H1'},{id:'P2',harness:'H1'}]});
 const drive=component('drive','Drive',{driveInterface:'SATA',driveSize:'2.5'});
 const config:Configuration={id:'config',name:'Test',description:'',systemId:'',status:'Draft',updatedAt:'',notes:'',placements:[place('board'),place('psu'),place('drive')],storage:{raid:'none',bootMirror:false}};
 const db:Database={components:[board,psu,drive],configurations:[config],systems:[],pcs:[],inventory:[],requirementsSets:[],installationLocations:[]};
 return {db,config,board,psu,drive,p:config.placements[2]};
}
const errors=(report:ReturnType<typeof checkStorageConnections>)=>report.findings.filter(f=>f.severity==='error');
const has=(report:ReturnType<typeof checkStorageConnections>,title:string)=>report.findings.some(f=>f.title===title);
const value=(report:ReturnType<typeof checkStorageConnections>,name:string)=>report.resources.find(r=>r.name===name)!;
function cageFixture(){
 const f=setup();
 const cage=component('cage','Storage adapter',{storageAdapterKind:'bay-cage',baySize:'5.25',sataDataInputs:[{id:'IN1'},{id:'IN2'}],sataPowerInputs:[{id:'POWER'}],driveTargets:[{id:'BAY1',mount:'front-hot-swap',driveSizes:['2.5'],interfaces:['SATA'],sataDataInputId:'IN1',sataPowerInputId:'POWER'},{id:'BAY2',mount:'front-hot-swap',driveSizes:['2.5'],interfaces:['SATA'],sataDataInputId:'IN2',sataPowerInputId:'POWER'}]});
 const cp=place('cage',{sataDataConnections:[{inputId:'IN1',controllerPlacementId:'board',portId:'S1'},{inputId:'IN2',controllerPlacementId:'board',portId:'S2'}],sataPowerConnections:[{inputId:'POWER',powerProviderPlacementId:'psu',connectorId:'P1'}]});
 f.db.components.push(cage);f.config.placements.push(cp);
 Object.assign(f.p,{adapterPlacementId:'cage',targetId:'BAY1',mount:'auto'});
 return {...f,cage,cp};
}

test('direct SATA data and PSU end plugs are counted independently, including shared harness plugs',()=>{
 const {db,config,p}=setup();p.sataDataConnections=[{controllerPlacementId:'board',portId:'S1'}];p.sataPowerConnections=[{powerProviderPlacementId:'psu',connectorId:'P1'}];
 const report=checkStorageConnections(config,db,{});assert.deepEqual(errors(report),[]);
 assert.equal(value(report,'SATA ports').used,1);assert.equal(value(report,'SATA power plugs').used,1);assert.equal(value(report,'SATA power plugs').available,2);
 assert.equal(value(report,'SATA data endpoint board / S2').used,0);assert.equal(value(report,'SATA power endpoint psu / P2').used,0);
});
test('complete named endpoint catalogs override larger legacy counts, including declared zero',()=>{
 const {db,config,board,psu}=setup();board.specs.sataDataPorts=[];psu.specs.sataPowerConnectors=[];
 const report=checkStorageConnections(config,db,{});assert.equal(value(report,'SATA ports').available,0);assert.equal(value(report,'SATA power plugs').available,0);
 assert.ok(has(report,'SATA data catalog differs from count'));assert.ok(has(report,'SATA power catalog differs from count'));
 assert.ok(has(report,'SATA ports capacity exceeded'));assert.ok(has(report,'SATA power plugs capacity exceeded'));
});
test('legacy capacity remains usable while unknown physical routing is reported for review',()=>{
 const {db,config,board,psu}=setup();delete board.specs.sataDataPorts;delete psu.specs.sataPowerConnectors;
 const report=checkStorageConnections(config,db,{});assert.deepEqual(errors(report),[]);assert.ok(has(report,'SATA data connection unrecorded'));assert.ok(has(report,'SATA power connection unrecorded'));
 assert.equal(value(report,'SATA ports').available,2);assert.equal(value(report,'SATA power plugs').available,2);
 delete board.specs.sataPorts;delete psu.specs.sataPower;
 const unknown=checkStorageConnections(config,db,{});assert.deepEqual(errors(unknown),[]);assert.ok(has(unknown,'SATA ports capacity unknown'));assert.ok(has(unknown,'SATA power plugs capacity unknown'));
});
test('named data and power endpoints cannot be double booked or invented',()=>{
 const {db,config,p}=setup();p.sataDataConnections=[{controllerPlacementId:'board',portId:'S1'}];p.sataPowerConnections=[{powerProviderPlacementId:'psu',connectorId:'P1'}];
 config.placements.push(place('second',{componentId:'drive',sataDataConnections:[{controllerPlacementId:'board',portId:'S1'}],sataPowerConnections:[{powerProviderPlacementId:'psu',connectorId:'P1'}]}));
 const report=checkStorageConnections(config,db,{});assert.ok(has(report,'SATA data endpoint double booked'));assert.ok(has(report,'SATA power endpoint double booked'));
 p.sataDataConnections[0].portId='missing';p.sataPowerConnections[0].connectorId='missing';
 const missing=checkStorageConnections(config,db,{});assert.ok(has(missing,'SATA data endpoint missing'));assert.ok(has(missing,'SATA power endpoint missing'));
});
test('active lane rules disable named endpoints without double counting their matching legacy count',()=>{
 const {db,config,board,p}=setup();board.specs.laneRules=[{id:'sharing',slots:['X'],disableSataPortIds:['S1'],disableSataPorts:1}];p.sataDataConnections=[{controllerPlacementId:'board',portId:'S1'}];
 const inactive=checkStorageConnections(config,db,{});assert.equal(value(inactive,'SATA ports').available,2);assert.ok(!has(inactive,'SATA data endpoint disabled'));
 const active=checkStorageConnections(config,db,{'card:0':'X'});assert.equal(value(active,'SATA ports').available,1);assert.ok(has(active,'SATA data endpoint disabled'));
 board.specs.laneRules.push({id:'same',slots:['X'],disableSataPortIds:['S1']});assert.equal(value(checkStorageConnections(config,db,{'card:0':'X'}),'SATA ports').available,1);
});
test('static disabled ports and unidentified lane losses reduce availability conservatively',()=>{
 const {db,config,board,p}=setup();board.specs.sataDataPorts![0].disabled=true;board.specs.laneRules=[{id:'sharing',slots:['X'],disableSataPorts:1}];p.sataDataConnections=[{controllerPlacementId:'board',portId:'S2'}];
 const report=checkStorageConnections(config,db,{'card:0':'X'});assert.equal(value(report,'SATA ports').available,0);assert.ok(has(report,'SATA lane-sharing route unconfirmed'));assert.ok(has(report,'SATA ports capacity exceeded'));
});
test('an active storage controller supplies its own data capacity; a passive cage does not',()=>{
 const {db,config,p}=setup();const hba=component('hba','Storage adapter',{storageAdapterKind:'controller',sataPorts:1,sataDataPorts:[{id:'H1'}]});db.components.push(hba);config.placements.push(place('hba'));p.controllerPlacementId='hba';
 const report=checkStorageConnections(config,db,{});assert.equal(value(report,'SATA ports').used,0);assert.equal(value(report,'SATA controller hba').used,1);assert.deepEqual(errors(report),[]);
 hba.specs.storageAdapterKind='mount-adapter';assert.ok(has(checkStorageConnections(config,db,{}),'SATA data provider invalid'));
});
test('physical routes require singular consumer/provider instances and correct provider categories',()=>{
 const {db,config,p}=setup();config.placements[0].quantity=2;p.quantity=2;p.sataDataConnections=[{controllerPlacementId:'board',portId:'S1'}];p.sataPowerConnections=[{powerProviderPlacementId:'board',connectorId:'P1'}];
 const report=checkStorageConnections(config,db,{});assert.ok(has(report,'Ambiguous SATA data provider instance'));assert.ok(has(report,'Ambiguous SATA data consumer instance'));assert.ok(has(report,'SATA power provider invalid'));
 p.sataDataConnections[0].controllerPlacementId='gone';assert.ok(has(checkStorageConnections(config,db,{}),'SATA data provider invalid'));
});
test('named cage inputs reserve empty channels and occupied drives reuse those channels and shared power',()=>{
 const {db,config,cp}=cageFixture();let report=checkStorageConnections(config,db,{});assert.deepEqual(errors(report),[]);assert.equal(value(report,'SATA ports').used,2);assert.equal(value(report,'SATA power plugs').used,1);
 config.placements.push(place('second',{componentId:'drive',adapterPlacementId:'cage',targetId:'BAY2'}));report=checkStorageConnections(config,db,{});
 assert.deepEqual(errors(report),[]);assert.equal(value(report,'SATA ports').used,2);assert.equal(value(report,'SATA power plugs').used,1);
 cp.sataDataConnections=[];report=checkStorageConnections(config,db,{});assert.equal(value(report,'SATA ports').used,2);assert.ok(has(report,'SATA data connection unrecorded'));
});
test('unmapped unoccupied cage data inputs do not consume channels',()=>{
 const {db,config,cp}=cageFixture();cp.sataDataConnections=[];
 const report=checkStorageConnections(config,db,{});assert.equal(value(report,'SATA ports').used,1);assert.equal(value(report,'SATA power plugs').used,1);assert.deepEqual(errors(report),[]);
});
test('a cage target must identify valid data/power inputs and cannot share one data channel between drives',()=>{
 const {db,config,cage}=cageFixture();config.placements.push(place('second',{componentId:'drive',adapterPlacementId:'cage',targetId:'BAY2'}));cage.specs.driveTargets![1].sataDataInputId='IN1';
 assert.ok(has(checkStorageConnections(config,db,{}),'SATA cage data input shared'));
 cage.specs.driveTargets![0].sataDataInputId='absent';cage.specs.driveTargets![0].sataPowerInputId='absent';
 const report=checkStorageConnections(config,db,{});assert.ok(has(report,'SATA cage data input missing'));assert.ok(has(report,'SATA cage power input missing'));
});
test('multiple cage inputs require explicit target routing; direct downstream mappings cannot bypass declared cage routes',()=>{
 const {db,config,cage,p}=cageFixture();delete cage.specs.driveTargets![0].sataDataInputId;assert.ok(has(checkStorageConnections(config,db,{}),'SATA cage data route ambiguous'));
 cage.specs.driveTargets![0].sataDataInputId='IN1';p.sataDataConnections=[{controllerPlacementId:'board',portId:'S1'}];p.sataPowerConnections=[{powerProviderPlacementId:'psu',connectorId:'P2'}];
 const report=checkStorageConnections(config,db,{});assert.ok(has(report,'SATA drive data route bypasses cage'));assert.ok(has(report,'SATA drive power route bypasses cage'));
});
test('legacy cage power plugs cover only compatible bay-mounted targets and are not counted twice',()=>{
 const {db,config,cage,cp}=cageFixture();delete cage.specs.sataPowerInputs;cage.specs.sataPowerPlugs=1;cp.sataPowerConnections=[{inputId:'POWER',powerProviderPlacementId:'psu',connectorId:'P1'}];
 const report=checkStorageConnections(config,db,{});assert.equal(value(report,'SATA power plugs').used,1);assert.deepEqual(errors(report),[]);assert.ok(has(report,'SATA power input catalog unknown'));
 cage.specs.storageAdapterKind='controller';cage.specs.driveTargets![0].mount='rear-sled';assert.equal(value(checkStorageConnections(config,db,{}),'SATA power plugs').used,2);
});
test('SATA M.2 requires a host data channel but takes slot power; NVMe is not a SATA consumer',()=>{
 const {db,config,drive,p}=setup();drive.specs.driveSize='M.2';let report=checkStorageConnections(config,db,{});assert.equal(value(report,'SATA ports').used,1);assert.equal(value(report,'SATA power plugs').used,0);
 p.sataPowerConnections=[{powerProviderPlacementId:'psu',connectorId:'P1'}];assert.ok(has(checkStorageConnections(config,db,{}),'SATA M.2 power route invalid'));
 drive.specs.driveInterface='NVMe';p.sataDataConnections=[{controllerPlacementId:'board',portId:'S1'}];report=checkStorageConnections(config,db,{});assert.ok(has(report,'SATA data consumer invalid'));assert.equal(value(report,'SATA ports').used,0);
});
test('bay accessories consume their declared power inputs even with no attached drives',()=>{
 const {db,config}=setup();config.placements=config.placements.filter(p=>p.componentId!=='drive');db.components.push(component('panel','Bay accessory',{sataPowerInputs:[{id:'LIGHTS'}]}));config.placements.push(place('panel',{sataPowerConnections:[{inputId:'LIGHTS',powerProviderPlacementId:'psu',connectorId:'P2'}]}));
 const report=checkStorageConnections(config,db,{});assert.deepEqual(errors(report),[]);assert.equal(value(report,'SATA power plugs').used,1);assert.equal(value(report,'SATA ports').used,0);
});
test('input mappings cannot double-map sinks, invent documented inputs, or treat a passive adapter as a data consumer',()=>{
 const {db,config,cp,cage}=cageFixture();cp.sataDataConnections!.push({inputId:'IN1',controllerPlacementId:'board',portId:'S2'});cp.sataPowerConnections!.push({inputId:'MISSING',powerProviderPlacementId:'psu',connectorId:'P2'});
 const report=checkStorageConnections(config,db,{});assert.ok(has(report,'SATA data input double mapped'));assert.ok(has(report,'SATA power input missing'));
 cage.specs.storageAdapterKind='mount-adapter';assert.ok(has(checkStorageConnections(config,db,{}),'SATA data consumer invalid'));
});

test('downstream boot and hot-plug requirements follow the actual cage input controller',()=>{
 const {db,config,board,p}=cageFixture();board.specs.bootable=false;board.specs.hotPlug=false;p.role='boot';
 const report=checkStorageConnections(config,db,{});assert.ok(has(report,'Storage controller cannot boot'));assert.ok(has(report,'Storage controller hot-plug unsupported'));
});
test('legacy drive controller bindings cannot contradict named direct or cage-input routes',()=>{
 const direct=setup();direct.p.controllerPlacementId='other';direct.p.sataDataConnections=[{controllerPlacementId:'board',portId:'S1'}];
 assert.ok(has(checkStorageConnections(direct.config,direct.db,{}),'SATA drive controller route conflicts'));
 const cage=cageFixture();cage.p.controllerPlacementId='other';assert.ok(has(checkStorageConnections(cage.config,cage.db,{}),'SATA cage controller route conflicts'));
});
test('legacy cage controller defaults route downstream channels without pretending the cage is an active controller',()=>{
 const {db,config,cage,cp}=cageFixture();delete cage.specs.sataDataInputs;for(const target of cage.specs.driveTargets!)delete target.sataDataInputId;cp.sataDataConnections=[];
 db.components.push(component('hba','Storage adapter',{storageAdapterKind:'controller',sataPorts:2}));config.placements.push(place('hba'));cp.controllerPlacementId='hba';
 const report=checkStorageConnections(config,db,{});assert.equal(value(report,'SATA ports').used,0);assert.equal(value(report,'SATA controller hba').used,1);assert.ok(has(report,'SATA cage data routing unconfirmed'));
});
