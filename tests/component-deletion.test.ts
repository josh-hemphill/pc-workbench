import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {AddressInfo} from 'node:net';
import {createApp} from '../server/app.ts';
import {Store} from '../server/store.ts';
import {seed} from '../server/seed.ts';
import {componentUsage} from '../shared/component-usage.ts';
import type {StockRecord} from '../shared/types.ts';
const stock=(componentId:string):StockRecord=>({id:'import-lot',componentId,tracking:'bulk',serial:'',assetTag:'DUPLICATE-LOT',quantity:1,location:'Store',condition:'Serviceable',notes:'',allocations:[],history:[]});

test('component usage identifies current plans, stock/PC allocations and immutable requirements revisions',()=>{
 const db=structuredClone(seed),cpu=db.components.find(c=>c.id==='cpu')!,part=stock(cpu.id);
 part.allocations=[{id:'installed',pcId:db.pcs[0].id,state:'installed',quantity:1,plannedPlacementId:'cpu',slotId:'',role:'general',mount:'auto',createdAt:'2026-10-16T12:00:00Z',updatedAt:'2026-10-16T12:00:00Z',notes:''}];db.inventory=[part];
 db.requirementsSets=[{id:'baseline',name:'Acquisition baseline',description:'',versions:[{revision:1,at:'2026-10-16T12:00:00Z',name:'Baseline',description:'',connections:[],constraints:{requiredComponents:[{componentId:cpu.id,quantity:1}]}}]}];
 const uses=componentUsage(cpu.id,db);assert.ok(uses.some(u=>u.kind==='configuration'));assert.ok(uses.some(u=>u.kind==='requirementsSet'&&u.detail.includes('1')));
 const usage=uses.find(u=>u.kind==='stock')!;assert.equal(usage.name,'DUPLICATE-LOT');assert.match(usage.detail,new RegExp(db.pcs[0].name));assert.match(usage.detail,/installed/);
});

test('deleting a duplicate after repointing plans identifies leftover stock and succeeds only after live references are removed',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-delete-')),app=createApp(dir),store=app.locals.store as Store;
 const duplicate={...structuredClone(store.db.components.find(c=>c.id==='cpu')!),id:'duplicate-cpu',name:'Imported duplicate processor'};store.replace('components',[...store.db.components,duplicate]);store.replace('inventory',[stock(duplicate.id)]);
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 const remove=()=>fetch(`${base}/api/components/${duplicate.id}`,{method:'DELETE',headers:{'If-Match':store.revision}});
 try{
  const before=store.revision;const response=await remove();assert.equal(response.status,400);const body=await response.json();assert.match(body.error,/Cannot delete component/);assert.match(body.error,/DUPLICATE-LOT/);assert.match(body.error,/import-lot/);assert.match(body.error,/stock records or installed parts/);assert.equal(store.revision,before);assert.ok(store.db.components.some(c=>c.id===duplicate.id));
  // A self-contained historical snapshot retains the old catalog entry without a live reference.
  const pc=structuredClone(store.db.pcs[0]);pc.snapshot={at:'2026-10-16T12:00:00Z',configuration:structuredClone(store.db.configurations[0]),components:[duplicate],system:null};store.replace('pcs',store.db.pcs.map(p=>p.id===pc.id?pc:p));
  store.replace('inventory',[]);assert.deepEqual(componentUsage(duplicate.id,store.db),[]);assert.equal((await remove()).status,200);assert.ok(!store.db.components.some(c=>c.id===duplicate.id));assert.equal(store.db.pcs[0].snapshot?.components[0].id,duplicate.id);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));fs.rmSync(dir,{recursive:true,force:true});}
});

test('catalog deletion archives zero-count lots atomically and retains original catalog specifications',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-empty-delete-')),store=new Store(dir);
 try{
  const component={...structuredClone(store.db.components[0]),id:'empty-only',name:'Empty imported type'};store.replace('components',[...store.db.components,component]);
  const lot={...stock(component.id),quantity:0,history:[{id:'empty-history',at:'2026-10-19T12:00:00Z',action:'adjust' as const,quantity:-1,pcId:'',pcName:'',allocationId:'',notes:'Disposed of last unit'}]};store.replace('inventory',[lot]);const recorded=structuredClone(store.db.inventory[0]),before=store.backup(),persist=store.persist.bind(store);
  store.persist=(collection,rows)=>{if(collection==='inventory')throw Error('Injected failure');persist(collection,rows);};assert.throws(()=>store.deleteComponent(component.id),/Injected failure/);assert.deepEqual(store.backup(),before);store.persist=persist;
  store.deleteComponent(component.id);assert.ok(!store.db.components.some(c=>c.id===component.id));assert.ok(!store.db.inventory.some(s=>s.id===lot.id));assert.deepEqual(store.archivedInventory()[0].stock,recorded);assert.deepEqual(store.archivedInventory()[0].component,component);
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
