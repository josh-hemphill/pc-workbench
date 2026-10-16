import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store,encodeMovements} from '../server/store.ts';
import {saveStockRecord} from '../server/inventory.ts';
import {buildComponentMerge} from '../server/component-merge.ts';
import {newTransitionScenario} from '../shared/transitions.ts';
import type {StockRecord} from '../shared/types.ts';
const at='2026-10-16T12:00:00Z';
function workspace(run:(store:Store,dir:string)=>void){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-merge-'));const store=new Store(dir);try{run(store,dir);}finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}}
function setup(store:Store){const canonical=store.db.components.find(c=>c.id==='cpu')!,duplicate={...structuredClone(canonical),id:'duplicate-cpu',name:'Imported CPU with another name'};store.replace('components',[...store.db.components,duplicate]);const config=structuredClone(store.db.configurations[0]);config.placements.find(p=>p.componentId===canonical.id)!.componentId=duplicate.id;config.software={drivers:{[duplicate.id]:'driver-1'}};store.replace('configurations',store.db.configurations.map(c=>c.id===config.id?config:c));const pc=store.db.pcs[0];const stock=saveStockRecord({id:'duplicate-stock',componentId:duplicate.id,tracking:'serialized',serial:'SERIAL-1',assetTag:'UNIT-1',quantity:1,location:'Shelf',condition:'Serviceable',notes:'',allocations:[],history:[]},store.db);stock.allocations.push({id:'installed-cpu',pcId:pc.id,quantity:1,state:'installed',plannedPlacementId:config.placements.find(p=>p.componentId===duplicate.id)!.id,slotId:'',role:'general',mount:'auto',group:'',notes:'',createdAt:at,updatedAt:at});store.replace('inventory',[stock]);return {canonical,duplicate,config,pc,stock:structuredClone(store.db.inventory[0]),input:{sourceIds:[duplicate.id],targetId:canonical.id,notes:'Duplicate import correction'}};}

test('previewed merge preserves physical identities allocations and history, retargets software and plans, and persists atomically',()=>workspace((store,dir)=>{
 const {canonical,duplicate,stock,input,pc}=setup(store);const scenario=newTransitionScenario();scenario.policies={cohort:{segment:{replacementId:duplicate.id,evidence:''}}};store.savePlan({id:'plan',scenario,draft:scenario,workspaceRevision:store.revision,draftWorkspaceRevision:store.revision},'missing');
 const snapPC=structuredClone(store.db.pcs[0]);snapPC.snapshot={at,configuration:structuredClone(store.db.configurations[0]),components:[duplicate],system:null};store.replace('pcs',store.db.pcs.map(p=>p.id===snapPC.id?snapPC:p));
 const original=structuredClone(store.db),preview=store.previewComponentMerge(input);assert.equal(preview.preview.inventory.length,1);assert.equal(preview.preview.transitionPlans,1);assert.deepEqual(store.db,original);
 store.mergeComponents(input,preview.token);assert.ok(!store.db.components.some(c=>c.id===duplicate.id));assert.deepEqual(store.db.components.find(c=>c.id===canonical.id),canonical);
 assert.deepEqual(store.db.pcs[0].snapshot,original.pcs[0].snapshot);
 const merged=store.db.inventory[0];assert.equal(merged.id,stock.id);assert.equal(merged.serial,stock.serial);assert.equal(merged.quantity,1);assert.deepEqual(merged.allocations,stock.allocations);assert.deepEqual(merged.history.slice(0,-1),stock.history);assert.match(merged.history.at(-1)!.notes,/Duplicate import correction/);assert.equal(merged.componentId,canonical.id);
 assert.equal(store.db.configurations[0].software?.drivers?.[canonical.id],'driver-1');assert.equal(store.db.configurations[0].status,'Draft');assert.equal(store.db.pcs.find(p=>p.id===pc.id)!.timeline?.at(-1)?.kind,'component-merge');assert.equal(store.plans()[0].scenario!.policies.cohort.segment.replacementId,canonical.id);
 const saved=store.backup();store.close();const reopened=new Store(dir);try{assert.deepEqual(reopened.backup(),saved);}finally{reopened.close();}
}));

test('merges reject stale previews, cross-category records, serial collisions and conflicting software values without mutation',()=>workspace(store=>{
 const {input,canonical,duplicate,stock}=setup(store);const preview=store.previewComponentMerge(input);store.replace('components',store.db.components.map(c=>c.id===canonical.id?{...c,name:'Canonical renamed'}:c));assert.throws(()=>store.mergeComponents(input,preview.token),/changed/);
 assert.throws(()=>store.previewComponentMerge({...input,targetId:'ram'}),/category/);assert.throws(()=>store.previewComponentMerge({...input,targetId:duplicate.id}),/also be a duplicate/);
 const other={...structuredClone(stock),id:'other-stock',componentId:canonical.id,assetTag:'UNIT-2',serial:'serial-1',allocations:[],history:[]};store.replace('inventory',[stock,other]);const before=store.backup();assert.throws(()=>store.previewComponentMerge(input),/serial number/);assert.deepEqual(store.backup(),before);
 store.replace('inventory',[stock]);const db=structuredClone(store.db);db.configurations[0].software={drivers:{[duplicate.id]:'a',[canonical.id]:'b'}};assert.throws(()=>buildComponentMerge(db,input,[]),/Conflicting drivers/);
}));

test('published requirement references and referenced connector ID loss block merges',()=>workspace(store=>{
 const {input,duplicate}=setup(store);store.replace('requirementsSets',[{id:'baseline',name:'Immutable baseline',description:'',versions:[{revision:1,at,name:'v1',description:'',connections:[],constraints:{requiredComponents:[{componentId:duplicate.id,quantity:1}]}}]}]);assert.throws(()=>store.previewComponentMerge(input),/immutable requirements/);
 const db=structuredClone(store.db);db.requirementsSets=[];const board=db.components.find(c=>c.id==='board-atx')!,other={...structuredClone(board),id:'other-board',name:'Other board',specs:{...board.specs,slots:[]}};db.components.push(other);db.configurations[0].placements.find(p=>p.componentId==='gpu')!.slotId=board.specs.slots![0].id;assert.throws(()=>buildComponentMerge(db,{sourceIds:[board.id],targetId:other.id,notes:''},[]),/referenced slots ID/);
}));

test('stock deletion archives empty/retired records, preserves history and allows deleting now-unused component types',()=>workspace((store,dir)=>{
 const component={...structuredClone(store.db.components[0]),id:'unused-import',name:'Retired imported part'};store.replace('components',[...store.db.components,component]);const stock=saveStockRecord({id:'old-stock',componentId:component.id,tracking:'bulk',serial:'',assetTag:'OLD-LOT',quantity:0,condition:'Serviceable',location:'Store',notes:'',allocations:[],history:[]},store.db);store.replace('inventory',[stock]);const recorded=structuredClone(store.db.inventory[0]);
 store.archiveInventory(stock.id);assert.equal(store.db.inventory.length,0);assert.deepEqual(store.archivedInventory()[0].stock,recorded);assert.deepEqual(store.archivedInventory()[0].component,component);assert.match(encodeMovements(store.db,false,store.archivedInventory()),/Retired imported part/);store.replace('components',store.db.components.filter(c=>c.id!==component.id));assert.equal(store.archivedInventory()[0].component.name,component.name);
 const backup=store.backup();assert.equal(backup.archivedInventory?.length,1);store.restore(structuredClone(store.db),true);assert.deepEqual(store.archivedInventory(),backup.archivedInventory);store.restore(backup);assert.deepEqual(store.backup(),backup);store.close();const reopened=new Store(dir);try{assert.deepEqual(reopened.backup(),backup);}finally{reopened.close();}
}));

test('deletion blocks active allocations and remaining serviceable stock; archive transaction failures retain both live stock and history',()=>workspace(store=>{
 const {stock}=setup(store);const before=store.backup();assert.throws(()=>store.archiveInventory(stock.id),/Release reservations/);assert.deepEqual(store.backup(),before);
 const db=structuredClone(store.db);db.inventory[0].allocations=[];store.restore(db,true);assert.throws(()=>store.archiveInventory(stock.id),/retire this record/);
 db.inventory[0].condition='Retired';store.restore(db,true);const original=store.persist.bind(store);store.persist=(collection,rows)=>{if(collection==='pcs')throw Error('Injected failure');original(collection,rows);};const prior=store.backup();assert.throws(()=>store.archiveInventory(stock.id),/Injected failure/);assert.deepEqual(store.backup(),prior);store.persist=original;store.archiveInventory(stock.id);assert.equal(store.archivedInventory()[0].stock.serial,stock.serial);
}));

test('merging failures roll back every collection',()=>workspace(store=>{
 const {input}=setup(store);const preview=store.previewComponentMerge(input),before=store.backup(),persist=store.persist.bind(store);store.persist=(collection,rows)=>{if(collection==='inventory')throw Error('Injected merge failure');persist(collection,rows);};assert.throws(()=>store.mergeComponents(input,preview.token),/Injected merge failure/);assert.deepEqual(store.backup(),before);store.persist=persist;
}));


test('independently changed saved plans invalidate merge previews and invalid archives reject restores atomically',()=>workspace(store=>{
 const {input}=setup(store);const preview=store.previewComponentMerge(input),scenario=newTransitionScenario();store.savePlan({id:'independent-plan',scenario,draft:null,workspaceRevision:store.revision,draftWorkspaceRevision:''},'missing');const before=store.backup();assert.throws(()=>store.mergeComponents(input,preview.token),/changed/);assert.deepEqual(store.backup(),before);
 assert.throws(()=>store.restore({...before,archivedInventory:[{id:'invalid',at,stock:store.db.inventory[0],component:store.db.components[0]}]}));assert.deepEqual(store.backup(),before);
}));


test('a plan changed by another connection during the final merge backup is not overwritten',()=>workspace((store,dir)=>{
 const {input}=setup(store),preview=store.previewComponentMerge(input),other=new Store(dir),snapshot=store.snapshot.bind(store),before=structuredClone(store.db);
 try{store.snapshot=()=>{snapshot();const scenario=newTransitionScenario();other.savePlan({id:'racing-plan',scenario,draft:null,workspaceRevision:other.revision,draftWorkspaceRevision:''},'missing');};assert.throws(()=>store.mergeComponents(input,preview.token),/Saved plans/);assert.deepEqual(store.db,before);assert.equal(store.plans()[0].id,'racing-plan');}finally{other.close();store.snapshot=snapshot;}
}));
