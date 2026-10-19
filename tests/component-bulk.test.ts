import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Component,Database} from '../shared/types.ts';
import {seed} from '../server/seed.ts';
import {componentSpecsSchema} from '../shared/component-schema.ts';
import {componentFieldPaths,componentFieldValue,commonComponentDraft,sharedComponentPaths,changedComponentPaths,applyComponentFieldEdits,sameValue} from '../shared/component-bulk.ts';
const part=(id:string,category:Component['category']='Motherboard',specs:Component['specs']={}):Component=>({id,name:id,category,specs,manufacturer:'',source:'',verified:true});
const database=(components:Component[]):Database=>({...structuredClone(seed),components,configurations:[],inventory:[],pcs:[],requirementsSets:[],installationLocations:[],systems:[]});
test('bulk field coverage follows the complete component schema and excludes per-record identity',()=>{
 const keys=Object.keys(componentSpecsSchema.shape).map(key=>`specs.${key}`);
 assert.deepEqual(componentFieldPaths,['manufacturer','source','verified',...keys]);assert.deepEqual(sharedComponentPaths([part('one'),part('two')]),componentFieldPaths);
 for(const path of ['id','name','category','specs.__proto__'])assert(!componentFieldPaths.includes(path));
});
test('the common draft never copies mixed values or lists from the first component',()=>{
 const first=part('a','Motherboard',{socket:'AM5',powerW:0,bifurcation:false,sataDataPorts:[{id:'A'}]}),second=part('b','Motherboard',{socket:'AM5',powerW:10,bifurcation:false,sataDataPorts:[{id:'B'}]});
 first.manufacturer='Vendor A';second.manufacturer='Vendor B';const draft=commonComponentDraft([first,second]);
 assert.equal(draft.manufacturer,'');assert.equal(draft.specs.socket,'AM5');assert.equal(draft.specs.powerW,undefined);assert.equal(draft.specs.bifurcation,false);assert.equal(draft.specs.sataDataPorts,undefined);
 const edited=structuredClone(draft);edited.specs.threadCount=16;assert.deepEqual(changedComponentPaths(draft,edited,componentFieldPaths),['specs.threadCount']);
});
test('mixed categories restrict edits to their shared subset',()=>{
 const board=part('board','Motherboard'),cpu=part('cpu','CPU'),paths=sharedComponentPaths([board,cpu]);
 assert(paths.includes('specs.socket'));assert(paths.includes('specs.powerW'));assert(!paths.includes('specs.slots'));assert(!paths.includes('specs.threadCount'));assert(paths.includes('manufacturer'));
 const network=part('network','Network card');assert(sharedComponentPaths([board,network]).includes('specs.ports'));
});
test('scalar replace fill and clear preserve all other fields including identity',()=>{
 const cpu=part('cpu','CPU',{coreCount:4,threadCount:8,powerW:0,socket:'AM5'}),db=database([cpu]);
 const next=applyComponentFieldEdits(cpu,[{path:'specs.coreCount',mode:'set',value:6},{path:'specs.threadCount',mode:'fill',value:12},{path:'specs.powerW',mode:'fill',value:65},{path:'specs.socket',mode:'clear'},{path:'source',mode:'set',value:'Vendor spec'}],db);
 assert.deepEqual(next.specs,{coreCount:6,threadCount:8,powerW:0});assert.equal(next.id,cpu.id);assert.equal(next.name,cpu.name);assert.equal(next.category,cpu.category);assert.equal(next.source,'Vendor spec');assert.equal(next.verified,false);assert.equal(cpu.specs.socket,'AM5');
 assert.throws(()=>applyComponentFieldEdits(cpu,[{path:'specs.threadCount',mode:'set',value:1.5}],db),/threadCount/);
 assert.throws(()=>applyComponentFieldEdits(cpu,[{path:'name',mode:'set',value:'Reclassified'}],db),/Unsupported/);
});
test('list merge preserves unmatched records and optional details while syncing aggregate counts',()=>{
 const board=part('board','Motherboard',{sataDataPorts:[{id:'KEEP',disabled:true},{id:'SATA_DATA_1'}],sataPorts:2}),db=database([board]);
 const next=applyComponentFieldEdits(board,[{path:'specs.sataDataPorts',mode:'merge',value:[{id:'KEEP'},{id:'NEW'}]}],db);
 assert.deepEqual(next.specs.sataDataPorts,[{id:'KEEP',disabled:true},{id:'SATA_DATA_1'},{id:'NEW'}]);assert.equal(next.specs.sataPorts,3);
 const blank=part('blank','Motherboard',{sataDataPorts:[]});assert.deepEqual(applyComponentFieldEdits(blank,[{path:'specs.sataDataPorts',mode:'fill',value:[{id:'NEW'}]}],database([blank])).specs.sataDataPorts,[]);
 assert.throws(()=>applyComponentFieldEdits(board,[{path:'specs.sataPorts',mode:'set',value:10}],db),/named list/);
});
test('derived count edits are omitted when changing named lists',()=>{
 const before=part('board'),after=part('board','Motherboard',{sataDataPorts:[{id:'SATA_DATA_1'}],sataPorts:1});
 assert.deepEqual(changedComponentPaths(before,after,componentFieldPaths),['specs.sataDataPorts']);
});
test('replacing or clearing referenced IDs is blocked but merging preserves wiring',()=>{
 const board=part('board','Motherboard',{sataDataPorts:[{id:'PORT_1'}]}),drive=part('drive','Drive',{driveInterface:'SATA',driveSize:'2.5'}),db=database([board,drive]);
 db.configurations=[{...structuredClone(seed.configurations[0]),id:'wired-plan',name:'Wired plan',systemId:'',placements:[{id:'board-placement',componentId:board.id,quantity:1,slotId:'',role:'general',mount:'auto',group:''},{id:'drive-placement',componentId:drive.id,quantity:1,slotId:'',role:'data',mount:'auto',group:'',sataDataConnections:[{controllerPlacementId:'board-placement',portId:'PORT_1'}]}]}];
 for(const mode of ['set','clear'] as const)assert.throws(()=>applyComponentFieldEdits(board,[{path:'specs.sataDataPorts',mode,value:[]}],db),/keep PORT_1.*Wired plan/);
 const next=applyComponentFieldEdits(board,[{path:'specs.sataDataPorts',mode:'merge',value:[{id:'PORT_2'}]}],db);assert.equal(next.specs.sataDataPorts!.length,2);
});
test('cross-field references validate against the whole edited component and preserve originals on failure',()=>{
 const cage=part('cage','Storage adapter',{storageAdapterKind:'bay-cage',sataDataInputs:[{id:'DATA_IN'}],driveTargets:[{id:'TRAY',mount:'front-hot-swap',sataDataInputId:'DATA_IN'}]}),db=database([cage]);
 assert.throws(()=>applyComponentFieldEdits(cage,[{path:'specs.sataDataInputs',mode:'clear'}],db),/does not exist/);
 const cleared=applyComponentFieldEdits(cage,[{path:'specs.sataDataInputs',mode:'clear'},{path:'specs.driveTargets',mode:'clear'}],db);assert.equal(cleared.specs.driveTargets,undefined);assert.equal(cage.specs.driveTargets!.length,1);
});
test('software cooling and SFF records use the same field patch mechanism',()=>{
 const c=part('board'),db=database([c]),next=applyComponentFieldEdits(c,[{path:'specs.requiredFirmware',mode:'set',value:'2.4'},{path:'specs.supportedOS',mode:'set',value:['Linux']},{path:'specs.sffPorts',mode:'merge',value:[{id:'SFF_8643_1',connector:'SFF-8643',protocols:['SAS'],channels:4}]},{path:'specs.coolingHeaders',mode:'merge',value:[{id:'CPU_FAN',connector:'Fan 4-pin',controlModes:['PWM']}]}],db);
 assert.equal(next.specs.requiredFirmware,'2.4');assert.equal(next.specs.sffPorts![0].channels,4);assert.deepEqual(next.specs.coolingHeaders![0].controlModes,['PWM']);assert(sameValue({b:1,a:false},{a:false,b:1}));
});
test('merging partial named catalogs cannot silently reduce count-only capacity',()=>{
 for(const [component,source,value] of [[part('board','Motherboard',{sataPorts:6}),'sataDataPorts',[{id:'PORT_1'}]],[part('psu','PSU',{sataPower:6}),'sataPowerConnectors',[{id:'PLUG_1'}]],[part('network','Network card',{ethernet:2}),'ports',[{id:'USB_1',kind:'USB-A'}]]] as const){
  const db=database([component]);assert.throws(()=>applyComponentFieldEdits(component,[{path:`specs.${source}`,mode:'merge',value}],db),/reduce the recorded/);
  const explicit=applyComponentFieldEdits(component,[{path:`specs.${source}`,mode:'set',value}],db);assert.equal((explicit.specs[source] as unknown[]).length,1);
 }
});
test('mixed inferred roles stay blank while selecting a role is an explicit change',()=>{
 const controller=part('controller','Storage adapter',{}),cage=part('cage','Storage adapter',{storageAdapterKind:'bay-cage'});
 const parts=[controller,cage],draft=commonComponentDraft(parts),next=structuredClone(draft);
 assert.equal(draft.specs.storageAdapterKind,undefined);next.specs.storageAdapterKind='controller';assert.deepEqual(changedComponentPaths(draft,next,sharedComponentPaths(parts)),['specs.storageAdapterKind']);
 const implicit=part('implicit','Storage adapter',{}),explicit=part('explicit','Storage adapter',{storageAdapterKind:'controller'});assert.equal(commonComponentDraft([implicit,explicit]).specs.storageAdapterKind,'controller');
});
test('an explicit verification choice overrides automatic invalidation in either edit order',()=>{
 const c=part('cpu','CPU',{coreCount:4}),db=database([c]);
 for(const verified of [true,false])for(const reverse of [true,false]){
  const edits=[{path:'verified',mode:'set' as const,value:verified},{path:'specs.coreCount',mode:'set' as const,value:8}];if(reverse)edits.reverse();
  const next=applyComponentFieldEdits(c,edits,db);assert.equal(next.verified,verified);assert.equal(next.specs.coreCount,8);
 }
 assert.equal(applyComponentFieldEdits(c,[{path:'specs.coreCount',mode:'set',value:8}],db).verified,false);
});
