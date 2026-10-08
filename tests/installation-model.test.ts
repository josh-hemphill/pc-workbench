import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../server/seed';
import { schemas } from '../server/schema';
import { checkConfiguration, resolveRequirementVersion } from '../shared/compatibility';
import { installedConfiguration, checkInstalledPC, planDifferences, commissioningDrift } from '../shared/inventory';
import { locationPath, installationParts, installationPCs, checkLocationPC, installationSnapshot } from '../shared/installations';
import type { Database, InstallationLocation, RequirementVersion, StockRecord } from '../shared/types';
const version:RequirementVersion={revision:1,at:'2026-10-08T10:00:00Z',name:'Microscopy acquisition',description:'Published engineering requirements',connections:[],constraints:{minMemoryGb:64,minDataGb:8000,minBootGb:1000,minScientificCards:1}};
const setup=()=>{const db=structuredClone(seed);db.requirementsSets=[{id:'microscopy',name:'Microscopy',description:'Reusable requirements',versions:[structuredClone(version)]}];return {db,configuration:db.configurations[0],pc:db.pcs[0]};};
function built(db:Database) {
 const configuration=db.configurations[0],pc=db.pcs[0];
 db.inventory=configuration.placements.map((p,index)=>({id:`physical-${index}`,componentId:p.componentId,tracking:'bulk',serial:'',assetTag:`LOT-${index}`,quantity:p.quantity,location:'Store room',condition:'Serviceable',notes:'',allocations:[{id:`allocation-${index}`,pcId:pc.id,quantity:p.quantity,state:'installed',plannedPlacementId:p.id,slotId:p.slotId,role:p.role,mount:p.mount,group:p.group,createdAt:version.at,updatedAt:version.at,notes:''}],history:[]} satisfies StockRecord));
 return pc;
}
const location=(id:string,parentId='',kind:InstallationLocation['kind']='Bench'):InstallationLocation=>({id,name:id,kind,parentId,requirementSetId:'',requirementRevision:0,targetConfigurationId:'',notes:''});
const error=(report:ReturnType<typeof checkConfiguration>,title:string)=>report.findings.some(f=>f.severity==='error'&&f.title===title);
test('pinned requirement revisions remain stable after publishing stronger versions',()=>{
 const {db,configuration}=setup();configuration.requirementSetId='microscopy';configuration.requirementRevision=1;configuration.requirementSnapshot=structuredClone(version);db.requirementsSets[0].versions.push({...version,revision:2,constraints:{minMemoryGb:128}});assert.equal(resolveRequirementVersion(configuration,db)?.revision,1);assert.ok(!error(checkConfiguration(configuration,db),'Requirements capacity insufficient'));
 configuration.requirementRevision=2;delete configuration.requirementSnapshot;assert.ok(error(checkConfiguration(configuration,db),'Requirements capacity insufficient'));
 configuration.requirementRevision=999;assert.ok(error(checkConfiguration(configuration,db),'Requirements revision missing'));
});
test('engineering requirements validate actual memory, storage, scientific cards and exact catalog quantities',()=>{
 const {db,configuration}=setup();configuration.requirementSetId='microscopy';configuration.requirementRevision=1;db.requirementsSets[0].versions[0].constraints={minMemoryGb:128,minDataGb:16000,minBootGb:2000,minScientificCards:2,requiredComponents:[{componentId:'legacy',quantity:1}]};const report=checkConfiguration(configuration,db);assert.equal(report.findings.filter(f=>f.title==='Requirements capacity insufficient'&&f.severity==='error').length,4);assert.ok(error(report,'Required component missing'));
});
test('unknown memory capacity requires review instead of asserting a known shortfall',()=>{
 const {db,configuration}=setup();configuration.requirementSetId='microscopy';configuration.requirementRevision=1;delete db.components.find(c=>c.id==='ram')!.specs.capacityGb;const report=checkConfiguration(configuration,db);assert.ok(report.findings.some(f=>f.title==='Required capacity unconfirmed'&&f.severity==='warning'));assert.ok(!report.findings.some(f=>f.title==='Requirements capacity insufficient'&&f.detail.includes('memory')));
});
test('published connection requirements override mutable legacy equipment port counts',()=>{
 const {db,configuration}=setup();configuration.requirementSetId='microscopy';configuration.requirementRevision=1;configuration.requirementSnapshot={...version,connections:[{id:'camera',name:'Camera bank',usbA:30,usbC:0,ethernet:0,notes:''}]};db.systems.find(s=>s.id===configuration.systemId)!.connections=[];assert.ok(error(checkConfiguration(configuration,db),'USB-A ports capacity exceeded'));
});
test('required software and redundancy distinguish missing specifications from known mismatch',()=>{
 const {db,configuration}=setup();configuration.requirementSetId='microscopy';configuration.requirementRevision=1;configuration.requirementSnapshot={...version,software:{os:'Linux',drivers:{daq:'DAQ-3'}},storage:{raid:'raid6',bootMirror:true}};let report=checkConfiguration(configuration,db);assert.ok(report.findings.some(f=>f.title==='Required software unrecorded'&&f.severity==='warning'));assert.ok(error(report,'Requirements storage mismatch'));configuration.software={os:'Windows',drivers:{daq:'DAQ-2'}};report=checkConfiguration(configuration,db);assert.ok(error(report,'Requirements software mismatch'));
});
test('physical parts roll up hierarchy and follow PC moves while reservations stay at stock',()=>{
 const {db,pc}=setup();built(db);db.installationLocations=[location('site','','Site'),location('room','site','Room'),location('bench-a','room'),location('bench-b','room')];pc.installationLocationId='bench-a';assert.equal(locationPath('bench-a',db),'site / room / bench-a');assert.equal(installationPCs('site',db).length,1);assert.equal(installationPCs('room',db,false).length,0);const installed=installationParts('site',db);assert.equal(installed.length,db.configurations[0].placements.length);assert.equal(installed[0].locationPath,'site / room / bench-a');db.inventory[0].allocations[0].state='reserved';assert.equal(installationParts('site',db).length,installed.length-1);pc.installationLocationId='bench-b';assert.equal(installationParts('bench-a',db).length,0);assert.equal(installationParts('bench-b',db).length,installed.length-1);assert.equal(db.inventory[0].location,'Store room');
});
test('assigned PCs use leaf requirements without implicitly inheriting parent constraints',()=>{
 const {db,pc}=setup();built(db);const parent={...location('room','','Room'),requirementSetId:'microscopy',requirementRevision:2,requirementSnapshot:{...version,revision:2,constraints:{minMemoryGb:128}}},leaf={...location('bench','room'),requirementSetId:'microscopy',requirementRevision:1,requirementSnapshot:structuredClone(version)};db.requirementsSets[0].versions.push(parent.requirementSnapshot);db.installationLocations=[parent,leaf];pc.installationLocationId=leaf.id;assert.ok(!error(checkInstalledPC(pc,db),'Requirements capacity insufficient'));leaf.requirementRevision=2;leaf.requirementSnapshot=parent.requirementSnapshot;assert.ok(error(checkInstalledPC(pc,db),'Requirements capacity insufficient'));assert.equal(checkInstalledPC(pc,db).resources.find(resource=>resource.name==='Installation Required memory (GB)')?.used,128);
});
test('location reports compare actual hardware with target plans and reject absent assignments',()=>{
 const {db,pc}=setup();built(db);const bench={...location('bench'),requirementSetId:'microscopy',requirementRevision:1,requirementSnapshot:structuredClone(version),targetConfigurationId:'imaging'};db.installationLocations=[bench];pc.installationLocationId=bench.id;assert.ok(!error(checkLocationPC(pc,bench,db),'Requirements capacity insufficient'));db.inventory.find(s=>s.componentId==='daq')!.allocations=[];assert.ok(error(checkLocationPC(pc,bench,db),'Requirements capacity insufficient'));assert.ok(checkLocationPC(pc,bench,db).findings.some(f=>f.title==='Installation target differs'));pc.installationLocationId='missing';assert.ok(error(checkInstalledPC(pc,db),'Installation location missing'));
});
test('PC requirement selections are captured independently from mutable templates',()=>{
 const {db,pc,configuration}=setup();built(db);configuration.requirementSetId='microscopy';configuration.requirementRevision=1;configuration.requirementSnapshot=structuredClone(version);pc.buildSettings={...pc.buildSettings!,requirementSetId:'microscopy',requirementRevision:1,requirementSnapshot:structuredClone(version)};assert.equal(installedConfiguration(pc,db).requirementSnapshot?.revision,1);assert.equal(planDifferences(pc,db).length,0);configuration.requirementRevision=2;configuration.requirementSnapshot={...version,revision:2};assert.ok(planDifferences(pc,db).some(d=>d.includes('settings differ')));
});
test('requirements schema rejects duplicate revisions and equipment identities; legacy configuration stays valid',()=>{
 const {db,configuration}=setup();assert.ok(schemas.configurations.safeParse(configuration).success);assert.ok(schemas.pcs.safeParse(db.pcs[0]).success);assert.ok(!schemas.requirementsSets.safeParse({...db.requirementsSets[0],versions:[version,version]}).success);const connection={id:'same',name:'Instrument',usbA:0,usbC:0,ethernet:0,notes:''};assert.ok(!schemas.requirementsSets.safeParse({...db.requirementsSets[0],versions:[{...version,connections:[connection,connection]}]}).success);
});
test('hierarchy helpers terminate on cyclic drafts instead of freezing the editor',()=>{
 const {db,pc}=setup();db.installationLocations=[location('a','b','Room'),location('b','a','Site')];pc.installationLocationId='a';assert.equal(installationPCs('a',db).length,1);assert.ok(locationPath('a',db).includes('a'));
});

test('commissioning captures installation context and detects moves without following new requirement revisions',()=>{
 const {db,pc}=setup();built(db);const leaf={...location('bench-a'),requirementSetId:'microscopy',requirementRevision:1,requirementSnapshot:structuredClone(version)};db.installationLocations=[leaf,location('bench-b')];pc.installationLocationId=leaf.id;const config=installedConfiguration(pc,db);pc.snapshot={at:version.at,configuration:config,components:structuredClone(db.components.filter(c=>config.placements.some(p=>p.componentId===c.id))),system:structuredClone(db.systems.find(s=>s.id===config.systemId)||null),installation:installationSnapshot(pc,db)};assert.equal(commissioningDrift(pc,db),false);db.requirementsSets[0].versions.push({...version,revision:2});assert.equal(commissioningDrift(pc,db),false);leaf.requirementSnapshot!.constraints!.minMemoryGb=128;assert.equal(pc.snapshot.installation!.requirementSnapshot!.constraints!.minMemoryGb,64);assert.equal(commissioningDrift(pc,db),true);leaf.requirementSnapshot=structuredClone(version);pc.installationLocationId='bench-b';assert.equal(commissioningDrift(pc,db),true);
});

test('legacy equipment edits do not change commissioning acceptance when pinned requirements replace it',()=>{
 const {db,pc}=setup();built(db);pc.buildSettings={...pc.buildSettings!,requirementSetId:'microscopy',requirementRevision:1,requirementSnapshot:structuredClone(version)};const config=installedConfiguration(pc,db);pc.snapshot={at:version.at,configuration:config,components:structuredClone(db.components.filter(c=>config.placements.some(p=>p.componentId===c.id))),system:structuredClone(db.systems.find(s=>s.id===config.systemId)||null)};assert.equal(commissioningDrift(pc,db),false);db.systems.find(s=>s.id===config.systemId)!.connections[0].usbA=100;assert.equal(commissioningDrift(pc,db),false);
});
