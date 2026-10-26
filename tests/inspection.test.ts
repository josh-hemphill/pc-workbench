import {createApp} from '../server/app.ts';
import type {AddressInfo} from 'node:net';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store,encodeCSV,decodeCSV} from '../server/store.ts';
import {inspectionCategories,locationMatches} from '../shared/inspection.ts';
import {savePCRecord} from '../server/pc-lifecycle.ts';
import {applyStockOperation} from '../server/inventory.ts';
import {stockCounts} from '../shared/inventory.ts';
import type {InspectionInput} from '../server/inspection.ts';
const at='2026-10-20T10:00:00Z';
function workspace(run:(store:Store,dir:string)=>void){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bench-inspection-')),store=new Store(dir);try{run(store,dir);}finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}}
function input(store:Store):InspectionInput{return {id:'save-a',sessionId:'session-a',pcId:store.db.pcs[0].id,observedAt:at,actor:'Inspector',method:'opened-case',evidence:'Opened case, labels photographed, photo reference IMG-123.',reportedLocation:'Previously at Bench A',finished:false,coverage:inspectionCategories.map(category=>({category,status:'unchecked',notes:''})),discoveries:[{componentId:'ram',quantity:2,serial:'',assetTag:'DISCOVERED-RAM',notes:'Two modules present; untested'}]};}
function save(store:Store,body:InspectionInput){return store.saveInspection(body,store.previewInspection(body).token);}
test('discovery inside Parts only donor is atomic, quarantined, unavailable, idempotent and preserves lifecycle/snapshots',()=>workspace((store,dir)=>{
 const pc=store.db.pcs[0];store.replace('pcs',store.db.pcs.map(p=>p.id===pc.id?{...p,lifecycle:'Parts only'}:p));const before=structuredClone(store.db),body=input(store),preview=store.previewInspection(body);assert.deepEqual(store.db,before);store.saveInspection(body,preview.token);
 const stock=store.db.inventory.at(-1)!;assert.equal(stock.quantity,2);assert.equal(stock.condition,'Quarantined');assert.equal(stock.allocations[0].pcId,pc.id);assert.equal(stock.allocations[0].state,'installed');assert.equal(stockCounts(stock).available,0);assert.equal(store.db.pcs[0].lifecycle,'Parts only');assert.deepEqual(store.db.pcs[0].snapshot,before.pcs[0].snapshot);assert.deepEqual(store.db.configurations,before.configurations);
 const saved=store.backup();store.saveInspection(body,preview.token);assert.deepEqual(store.backup(),saved);assert.throws(()=>store.saveInspection({...body,evidence:'Different'},preview.token),/already used/);
 store.close();const reopened=new Store(dir);try{assert.deepEqual(reopened.backup(),saved);}finally{reopened.close();}
}));
test('new catalog models and placeholders are discovered inline without inventing specifications',()=>workspace(store=>{
 const body=input(store);body.discoveries=[{newComponent:{id:'new-unknown',name:'Unreadable module',category:'Memory',manufacturer:'',source:'',verified:false,identityKind:'placeholder',specs:{}},quantity:1,serial:'',assetTag:'',notes:'Label unreadable'}];body.coverage.find(r=>r.category==='Memory')!.status='unidentified';save(store,body);assert.equal(store.db.components.at(-1)!.identityKind,'placeholder');assert.deepEqual(store.db.components.at(-1)!.specs,{});assert.equal(store.db.pcs[0].hardwareSurvey?.status,'partial');
}));
test('existing quarantined custody can be recorded while installations remain blocked; assigned serials cannot be duplicated',()=>workspace(store=>{
 const body=input(store);body.discoveries[0].quantity=1;body.discoveries[0].serial='SERIAL-FOUND';body.discoveries[0].assetTag='';save(store,body);const stock=store.db.inventory.at(-1)!;
 assert.throws(()=>store.previewInspection({...body,id:'save-b'}),/serial is already recorded/);
 assert.throws(()=>store.previewInspection({...body,id:'save-c',discoveries:[{componentId:'ram',stockId:stock.id,quantity:1,serial:'',assetTag:'',notes:''}]}),/already recorded on this PC/);
 const other=store.db.pcs[1]||{...store.db.pcs[0],id:'other-pc',name:'Other',inspections:[],timeline:[]};if(!store.db.pcs.some(p=>p.id===other.id))store.replace('pcs',[...store.db.pcs,other]);
 assert.throws(()=>store.previewInspection({...body,id:'save-d',pcId:other.id,discoveries:[{componentId:'ram',stockId:stock.id,quantity:1,serial:'',assetTag:'',notes:''}]}),/already assigned/);
 assert.throws(()=>applyStockOperation(stock,{action:'install',pcId:other.id,quantity:1,notes:'',plannedPlacementId:''},store.db),/serviceable/);
}));
test('coverage distinguishes empty shells, unchecked and unresolved parts; historical notes do not create inventory',()=>workspace(store=>{
 const body=input(store);body.discoveries=[];body.finished=true;assert.throws(()=>store.previewInspection(body),/every category/);
 body.coverage.forEach(r=>r.status='absent');save(store,body);assert.equal(store.db.pcs[0].hardwareSurvey?.status,'complete');assert.equal(store.db.inventory.length,0);
 const historical={...body,id:'history-a',method:'historical' as const,finished:false};store.replace('pcs',store.db.pcs.map(p=>({...p,lifecycle:'Retired'})));save(store,historical);assert.equal(store.db.inventory.length,0);assert.equal(store.db.pcs[0].lifecycle,'Retired');
 assert.throws(()=>store.previewInspection({...historical,id:'bad-history',discoveries:input(store).discoveries}),/Historical evidence/);assert.throws(()=>store.previewInspection({...body,id:'retired-physical'}),/Retired PC/);
}));
test('absence contradictions, future dates, stale previews and transaction failures leave all records intact',()=>workspace(store=>{
 const body=input(store),first=store.previewInspection(body),before=store.backup();body.coverage.find(r=>r.category==='Memory')!.status='absent';assert.throws(()=>store.previewInspection(body),/installed records still exist/);body.coverage.find(r=>r.category==='Memory')!.status='unchecked';
 assert.throws(()=>store.previewInspection({...body,observedAt:'2099-01-01T00:00:00Z'}),/future/);assert.deepEqual(store.backup(),before);
 const persist=store.persist.bind(store);store.persist=(collection,rows)=>{if(collection==='inventory')throw Error('Injected failure');persist(collection,rows);};assert.throws(()=>store.saveInspection(body,first.token),/Injected failure/);store.persist=persist;assert.deepEqual(store.backup(),before);
 store.replace('components',store.db.components.map(c=>c.id==='ram'?{...c,name:'Renamed RAM'}:c));assert.throws(()=>store.saveInspection(body,first.token),/changed/);
}));
test('inspection and structured location history are portable, immutable through normal editing and former-location searchable',()=>workspace(store=>{
 const body=input(store);save(store,body);const pc=store.db.pcs[0];assert.throws(()=>savePCRecord({...pc,hardwareSurvey:{status:'complete',configurationId:'',evidence:'Unchecked'}},store.db),/Inspection coverage/);assert.throws(()=>savePCRecord({...pc,hardwareSurvey:undefined},store.db),/Inspection coverage/);assert.throws(()=>savePCRecord({...pc,inspections:[]},store.db),/managed by lifecycle/);
 const loc={id:'old-bench',name:'Old bench',kind:'Bench' as const,parentId:'',requirementSetId:'',requirementRevision:0,targetConfigurationId:'',notes:''};store.replace('installationLocations',[...store.db.installationLocations,loc]);const assigned=savePCRecord({...pc,installationLocationId:loc.id},store.db);store.replace('pcs',store.db.pcs.map(p=>p.id===pc.id?assigned:p));const moved=savePCRecord({...assigned,installationLocationId:''},store.db);assert(locationMatches(moved,new Set([loc.id]),'former'));assert(!locationMatches(moved,new Set([loc.id]),'current'));assert.equal(moved.locationHistory!.at(-1)!.fromPath,'Old bench');assert.throws(()=>savePCRecord({...assigned,locationHistory:[]},store.db),/managed by lifecycle/);
 const roundtrip=decodeCSV('pcs',encodeCSV('pcs',[moved]))[0] as typeof moved;assert.deepEqual(roundtrip.inspections,moved.inspections);assert.deepEqual(roundtrip.locationHistory,moved.locationHistory);const oldCSV='id,name,serial,location,configurationId,notes,buildSettings\n'+[pc.id,'PC','','','','',''].join(',')+'\n';const parsed=decodeCSV('pcs',oldCSV,[],[pc])[0] as typeof pc;assert.deepEqual(parsed.inspections,pc.inspections);
}));

test('recording existing unallocated repair stock preserves total quantity and condition',()=>workspace(store=>{
 const body=input(store),stock={id:'repair-unit',componentId:'ram',tracking:'serialized' as const,serial:'REPAIR-1',assetTag:'',quantity:1,location:'Bench',condition:'Repair' as const,notes:'',allocations:[],history:[]};store.replace('inventory',[stock]);body.discoveries=[{componentId:'ram',stockId:stock.id,quantity:1,serial:'',assetTag:'',notes:'Located inside donor; previous repair status retained'}];save(store,body);assert.equal(store.db.inventory.length,1);assert.equal(store.db.inventory[0].quantity,1);assert.equal(store.db.inventory[0].condition,'Repair');assert.equal(stockCounts(store.db.inventory[0]).available,0);
}));

test('inspection HTTP preview is read-only and apply protects the revision and reviewed payload',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'inspection-api-')),app=createApp(dir),store=app.locals.store as Store,body=input(store),before=store.backup(),server=app.listen(0,'127.0.0.1');
 await new Promise<void>(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 const call=(name:string,payload:unknown,revision?:string)=>fetch(base+'/api/inspection/'+name,{method:'POST',headers:{'Content-Type':'application/json',...(revision?{'If-Match':revision}:{})},body:JSON.stringify(payload)});
 try{const response=await call('preview',body);assert.equal(response.status,200);const preview=await response.json(),revision=response.headers.get('X-Workspace-Revision')!;assert.deepEqual(store.backup(),before);
 assert.equal((await call('apply',{input:body,token:preview.token})).status,428);
 assert.equal((await call('apply',{input:{...body,evidence:'Changed evidence'},token:preview.token},revision)).status,409);assert.deepEqual(store.backup(),before);
 assert.equal((await call('apply',{input:body,token:preview.token},revision)).status,200);assert.equal(store.db.pcs[0].inspections?.length,1);
 assert.equal((await call('apply',{input:body,token:preview.token},revision)).status,409);assert.equal(store.db.pcs[0].inspections?.length,1);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));fs.rmSync(dir,{recursive:true,force:true});}
});
