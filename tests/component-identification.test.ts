import {createApp} from '../server/app.ts';
import type {AddressInfo} from 'node:net';
import {newTransitionScenario} from '../shared/transitions.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store,decodeCSV,encodeCSV} from '../server/store.ts';
import {buildIdentification} from '../server/component-identification.ts';
import {componentSchema} from '../shared/component-schema.ts';
import {applyComponentFieldEdits} from '../shared/component-bulk.ts';
import {needsCatalogAttention} from '../shared/catalog-quality.ts';
import {exportResearchPack,previewResearch} from '../server/catalog-research.ts';
import {EnrichmentQueue} from '../server/enrichment.ts';
import {checkConfiguration} from '../shared/compatibility.ts';
import type {IdentificationInput} from '../shared/component-identification.ts';
import type {StockRecord} from '../shared/types.ts';
const at='2026-10-21T12:00:00Z';
function workspace(run:(store:Store,dir:string)=>void){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-identify-'));const store=new Store(dir);try{run(store,dir);}finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}}
function setup(store:Store){
 const target={...structuredClone(store.db.components.find(c=>c.id==='cpu')!),model:'EXACT-CPU-A'};
 const source={...structuredClone(target),id:'unknown-cpu',name:'Unknown Intel CPU',identityKind:'placeholder' as const,model:undefined,verified:false,specs:{}};
 delete source.model;
 const other={...structuredClone(target),id:'cpu-b',name:'CPU B',model:'EXACT-CPU-B'};
 store.replace('components',[...store.db.components.map(c=>c.id===target.id?target:c),source,other]);
 const cfg=structuredClone(store.db.configurations[0]),placement=cfg.placements.find(p=>p.componentId===target.id)!;placement.componentId=source.id;cfg.status='Draft';
 store.replace('configurations',store.db.configurations.map(c=>c.id===cfg.id?cfg:c));
 const pc=structuredClone(store.db.pcs[0]);pc.configurationId=cfg.id;pc.snapshot={at,configuration:structuredClone(cfg),components:[source],system:null};
 const otherPC={...structuredClone(pc),id:'second-pc',name:'Second PC'};store.replace('pcs',[pc,otherPC]);
 const allocation=(id:string,pcId:string,state:'reserved'|'installed')=>({id,pcId,quantity:1,state,plannedPlacementId:placement.id,slotId:'',role:'general' as const,mount:'auto' as const,notes:'',owner:'',workOrder:'',dueAt:'',expiresAt:'',createdAt:at,updatedAt:at});
 const stock:StockRecord={id:'mixed-stock',componentId:source.id,tracking:'bulk',serial:'',assetTag:'MIXED-LOT',quantity:10,location:'Shelf',condition:'Serviceable',notes:'Original lot',allocations:[allocation('installed-a',pc.id,'installed'),allocation('reserved-b',otherPC.id,'reserved')],history:[{id:'received',at,action:'receive',quantity:10,pcId:'',pcName:'',allocationId:'',notes:'Imported lot'}]};
 store.replace('inventory',[stock]);
 const input:IdentificationInput={sourceId:source.id,targetId:target.id,evidence:'Asset PC-1 CPU ID confirms EXACT-CPU-A; labels on three spare units.',actor:'Tester',stock:[{stockId:stock.id,availableQuantity:3,allocationIds:['installed-a']}],configurations:[{configurationId:cfg.id,placementIds:[placement.id],pcIds:[pc.id],updateTemplate:false}]};
 return {source,target,other,cfg,placement,pc,otherPC,stock:structuredClone(store.db.inventory[0]),input};
}
test('partial identification conserves quantities, keeps allocation IDs and history, copies shared templates and preserves snapshots',()=>workspace((store,dir)=>{
 const {input,source,target,cfg,pc,otherPC,stock}=setup(store),before=store.backup();
 const result=store.previewIdentification(input);assert.deepEqual(store.backup(),before);assert.equal(result.preview.quantity,4);assert.equal(result.preview.remainingQuantity,6);
 store.identifyComponents(input,result.token);
 const remainder=store.db.inventory.find(s=>s.id===stock.id)!,identified=store.db.inventory.find(s=>s.componentId===target.id)!;
 assert.equal(remainder.quantity,6);assert.equal(identified.quantity,4);assert.equal(store.db.inventory.reduce((n,s)=>n+s.quantity,0),10);
 assert.deepEqual(remainder.allocations,[stock.allocations[1]]);assert.deepEqual(identified.allocations,[stock.allocations[0]]);
 assert.deepEqual(remainder.history[0],stock.history[0]);assert.equal(remainder.history.at(-1)!.quantity,-4);assert.equal(remainder.history.at(-1)!.targetStockId,identified.id);assert.equal(identified.history[0].sourceStockId,stock.id);
 assert.equal(store.db.configurations.find(c=>c.id===cfg.id)!.placements.find(p=>p.id===input.configurations[0].placementIds[0])!.componentId,source.id);
 const updatedPC=store.db.pcs.find(p=>p.id===pc.id)!;assert.notEqual(updatedPC.configurationId,cfg.id);assert.equal(store.db.pcs.find(p=>p.id===otherPC.id)!.configurationId,cfg.id);assert.deepEqual(updatedPC.snapshot,pc.snapshot);assert.equal(updatedPC.timeline?.at(-1)?.kind,'component-identification');
 assert.equal(store.db.configurations.find(c=>c.id===updatedPC.configurationId)!.status,'Draft');
 // A second discovered model consumes only the remaining selected units.
 const second={...input,targetId:'cpu-b',stock:[{stockId:stock.id,availableQuantity:2,allocationIds:[]}],configurations:[]};store.identifyComponents(second,store.previewIdentification(second).token);
 assert.equal(store.db.inventory.find(s=>s.componentId==='cpu-b')!.quantity,2);assert.equal(store.db.inventory.find(s=>s.id===stock.id)!.quantity,4);
 const saved=store.backup();store.close();const reopened=new Store(dir);try{assert.deepEqual(reopened.backup(),saved);}finally{reopened.close();}
}));
test('whole serialized identification retains the physical stock record and reserved allocation',()=>workspace(store=>{
 const {input,source,target,cfg,placement,otherPC,stock}=setup(store);
 const serial={...stock,id:'serial-stock',tracking:'serialized' as const,serial:'CPU-SERIAL',assetTag:'SERIAL-UNIT',quantity:1,history:[],allocations:[stock.allocations[1]]};store.replace('inventory',[{...stock,allocations:[stock.allocations[0]]},serial]);
 const operation={...input,stock:[{stockId:serial.id,availableQuantity:0,allocationIds:['reserved-b']}],configurations:[{configurationId:cfg.id,placementIds:[placement.id],pcIds:[otherPC.id],updateTemplate:false}]};
 store.identifyComponents(operation,store.previewIdentification(operation).token);const result=store.db.inventory.find(s=>s.id===serial.id)!;assert.equal(result.componentId,target.id);assert.equal(result.serial,'CPU-SERIAL');assert.deepEqual(result.allocations,serial.allocations);assert.equal(result.history.at(-1)!.action,'edit');assert.equal(store.db.inventory.find(s=>s.id===stock.id)!.componentId,source.id);
}));
test('identification rejects stale tokens, excess quantities, wrong categories, missing model and mismatched planned allocations',()=>workspace(store=>{
 const {input,target}=setup(store),before=store.backup(),preview=store.previewIdentification(input);
 assert.throws(()=>store.previewIdentification({...input,stock:[{...input.stock[0],availableQuantity:9}]}),/exceeds/);
 assert.throws(()=>store.previewIdentification({...input,configurations:[]}),/planned placement/);
 assert.throws(()=>store.previewIdentification({...input,targetId:'ram'}),/same category/);
 assert.throws(()=>store.previewIdentification({...input,targetId:undefined,newComponent:{...target,id:'new-cpu',model:''}}),/exact target model/);
 assert.throws(()=>store.previewIdentification({...input,stock:[input.stock[0],input.stock[0]]}),/once/);
 assert.deepEqual(store.backup(),before);
 store.replace('components',store.db.components.map(c=>c.id===target.id?{...c,name:'Renamed'}:c));const current=store.backup();assert.throws(()=>store.identifyComponents(input,preview.token),/changed/);assert.deepEqual(store.backup(),current);
}));
test('new models can resolve template-only uses without creating stock or rewriting historical approvals',()=>workspace(store=>{
 const {input,target,cfg,pc}=setup(store),newComponent={...target,id:'new-exact-model',model:'NEW-MODEL',name:'New exact model'};
 const operation={...input,targetId:undefined,newComponent,stock:[],configurations:[{...input.configurations[0],pcIds:[],updateTemplate:true}]};
 const before=structuredClone(store.db.pcs);store.identifyComponents(operation,store.previewIdentification(operation).token);
 assert.equal(store.db.components.at(-1)!.id,newComponent.id);assert.equal(store.db.inventory.length,1);assert.equal(store.db.configurations.find(c=>c.id===cfg.id)!.placements.find(p=>p.id===input.configurations[0].placementIds[0])!.componentId,newComponent.id);assert.deepEqual(store.db.pcs.find(p=>p.id===pc.id)!.snapshot,before.find(p=>p.id===pc.id)!.snapshot);
}));
test('referenced connector loss is rejected, including bindings on other installed components',()=>workspace(store=>{
 setup(store);const db=structuredClone(store.db),board=db.components.find(c=>c.id==='board-atx')!;board.identityKind='placeholder';board.verified=false;const target={...structuredClone(board),id:'identified-board',model:'BOARD-A',identityKind:'model' as const,specs:{...board.specs,slots:[]}};db.components.push(target);const cfg=db.configurations[0],p=cfg.placements.find(p=>p.componentId===board.id)!;cfg.placements.find(p=>p.componentId==='gpu')!.slotId=board.specs.slots![0].id;
 const operation:IdentificationInput={sourceId:board.id,targetId:target.id,evidence:'Board label',actor:'',stock:[],configurations:[{configurationId:cfg.id,placementIds:[p.id],pcIds:[],updateTemplate:true}]};assert.throws(()=>buildIdentification(db,operation),/referenced slots/);
}));
test('placeholder identity is portable, explicit, bulk editable and cannot claim verification',()=>workspace(store=>{
 const {source}=setup(store);assert(needsCatalogAttention(source));assert(!componentSchema.safeParse({...source,verified:true}).success);
 const classified=applyComponentFieldEdits({...source,identityKind:undefined,verified:true},[{path:'identityKind',mode:'set',value:'placeholder'}],store.db);assert.equal(classified.verified,false);
 assert.throws(()=>applyComponentFieldEdits(source,[{path:'verified',mode:'set',value:true}],store.db),/Identify the model/);
 const csv=encodeCSV('components',[source]);assert.deepEqual(decodeCSV('components',csv),[JSON.parse(JSON.stringify(componentSchema.parse(source)))]);
 // Older CSVs without the optional column must preserve an explicit classification.
 const old='id,name,category,manufacturer,specs,source,verified\nunknown-cpu,Unknown Intel CPU,CPU,Intel,{},,false\n';assert.equal((decodeCSV('components',old,[source])[0] as typeof source).identityKind,'placeholder');
}));
test('placeholder research packs request identification and reject crafted specification proposals and queued enrichment',()=>workspace(store=>{
 const {source}=setup(store),pack=exportResearchPack(store.db,[source.id],store.revision);assert.deepEqual(pack.components[0].proposals,[]);assert.match(JSON.stringify(pack.componentIndex),/identificationNeeded/);
 pack.components[0].proposals=[{path:'specs.coreCount',value:8,sourceUrl:'https://example.com/specs',evidence:'Guessed model'}];const preview=previewResearch(store.db,pack,store.revision).preview;assert.equal(preview.fields,0);assert.equal(preview.rows[0].status,'Conflict');
 const queue=new EnrichmentQueue(store);assert.throws(()=>queue.enqueue([{componentId:source.id,url:'https://pcpartpicker.com/product/abcdef/test'}]),/Identify the placeholder/);queue.close();
 assert(checkConfiguration(store.db.configurations[0],store.db).findings.some(f=>f.severity==='error'&&f.title==='Component identity needed'));
}));

test('identification transactions roll back every collection and reject previews when saved plans change',()=>workspace(store=>{
 const {input}=setup(store),preview=store.previewIdentification(input),before=store.backup(),persist=store.persist.bind(store);
 store.persist=(collection,rows)=>{if(collection==='inventory')throw Error('Injected identification failure');persist(collection,rows);};
 assert.throws(()=>store.identifyComponents(input,preview.token),/Injected identification failure/);assert.deepEqual(store.backup(),before);store.persist=persist;
 const scenario=newTransitionScenario();store.savePlan({id:'new-plan',scenario,draft:null,workspaceRevision:store.revision,draftWorkspaceRevision:''},'missing');
 assert.throws(()=>store.identifyComponents(input,preview.token),/changed/);assert.deepEqual(store.db,before);
}));
test('identification API previews read-only, requires a revision for apply, and rejects altered or stale scopes',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-identify-api-')),app=createApp(dir),store=app.locals.store as Store,{input}=setup(store),before=store.backup();
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 const call=(route:string,body:unknown,revision?:string)=>fetch(base+'/api/catalog/identify/'+route,{method:'POST',headers:{'Content-Type':'application/json',...(revision?{'If-Match':revision}:{})},body:JSON.stringify(body)});
 try{
  const response=await call('preview',input);assert.equal(response.status,200);const preview=await response.json(),revision=response.headers.get('X-Workspace-Revision')!;assert.deepEqual(store.backup(),before);
  assert.equal((await call('apply',{input,token:preview.token})).status,428);
  assert.equal((await call('apply',{input:{...input,evidence:'Changed evidence'},token:preview.token},revision)).status,409);assert.deepEqual(store.backup(),before);
  const applied=await call('apply',{input,token:preview.token},revision);assert.equal(applied.status,200);assert.equal((await applied.json()).quantity,4);
  assert.equal((await call('apply',{input,token:preview.token},revision)).status,409);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));fs.rmSync(dir,{recursive:true,force:true});}
});
