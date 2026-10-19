import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import type {AddressInfo} from 'node:net';
import {createApp} from '../server/app.ts';
import {seed} from '../server/seed.ts';
import {exportResearchPack,previewResearch,researchFileSchema} from '../server/catalog-research.ts';
import type {Component,Database} from '../shared/types.ts';
import type {ResearchFile,ResearchProposal} from '../shared/catalog-research.ts';
import type {Store} from '../server/store.ts';
const cpu:Component={id:'research-cpu',name:'Research CPU',category:'CPU',manufacturer:'',source:'',verified:true,specs:{socket:'AM5',coreCount:4,powerW:0,notes:'Existing notes'}};
function fixture(){const db=structuredClone(seed);db.components.push(structuredClone(cpu));return db;}
const evidence={sourceUrl:'https://vendor.example/cpu.pdf',evidence:'Specification table, page 2: 16 logical threads.'};
function proposed(db:Database,fields:ResearchProposal[]):ResearchFile{const pack=exportResearchPack(db,[cpu.id],'export-revision');pack.components[0].proposals=fields;return pack;}
test('research pack exports exact IDs, current context, typed missing fields and blank proposal slots',()=>{
 const db=fixture(),pack=exportResearchPack(db,[cpu.id],'rev');assert.equal(pack.workspaceRevision,'rev');assert.equal(pack.components[0].id,cpu.id);assert.deepEqual(pack.components[0].existing,cpu);
 assert.deepEqual(pack.components[0].proposals.map(p=>p.path),['manufacturer','source','specs.threadCount']);assert(pack.components[0].proposals.every(p=>p.value===null));assert(pack.instructions);assert(researchFileSchema.safeParse(JSON.parse(JSON.stringify(pack))).success);
 (pack.components[0].existing as Component).specs.coreCount=99;assert.equal(db.components.at(-1)!.specs.coreCount,4);
 assert.throws(()=>exportResearchPack(db,[cpu.id,cpu.id],'rev'));assert.throws(()=>exportResearchPack(db,['deleted'],'rev'),/no longer exists/);
});
test('blank packs are no-ops; zero values fill missing fields and evidence preserves existing notes',()=>{
 const db=fixture(),blank=exportResearchPack(db,[cpu.id],'rev');assert.equal(previewResearch(db,blank,'rev').preview.fields,0);
 const file=proposed(db,[{path:'specs.threadCount',value:16,...evidence},{path:'manufacturer',value:'Vendor',...evidence}]);
 const result=previewResearch(db,file,'rev');assert.equal(result.preview.fields,2);assert.equal(result.preview.components,1);assert.equal(result.preview.valid,true);
 const after=result.components.find(c=>c.id===cpu.id)!;assert.equal(after.specs.threadCount,16);assert.equal(after.verified,false);assert.equal(after.specs.coreCount,4);assert.equal(after.specs.powerW,0);assert.match(after.specs.notes!,/Existing notes\nUnverified research/);assert.match(after.specs.notes!,/vendor.example\/cpu.pdf/);assert.match(after.specs.notes!,/page 2/);assert.equal(db.components.at(-1)!.specs.threadCount,undefined);
 const empty=structuredClone(cpu);empty.id='research-board';empty.category='Motherboard';empty.specs={};db.components.push(empty);
 const zero=exportResearchPack(db,[empty.id],'rev');zero.components[0].proposals=[{path:'specs.usbC',value:0,...evidence}];assert.equal(previewResearch(db,zero,'rev').components.at(-1)!.specs.usbC,0);
});
test('current known values, named zero inventories and changed identities are never overwritten',()=>{
 const db=fixture(),file=proposed(db,[{path:'specs.threadCount',value:16,...evidence},{path:'specs.powerW',value:99,...evidence},{path:'specs.coreCount',value:4,...evidence}]);db.components.at(-1)!.specs.threadCount=8;
 const result=previewResearch(db,file,'rev');assert.deepEqual(result.preview.rows.map(row=>row.status),['Conflict','Conflict','Unchanged']);assert.equal(result.preview.fields,0);assert.deepEqual(result.components,db.components);
 db.components.at(-1)!.name='Renamed CPU';assert(previewResearch(db,file,'rev').preview.rows.every(row=>row.reason.includes('identity changed')));
 const named:Component={...cpu,id:'research-board',name:'Named board',category:'Motherboard',specs:{ports:[]}};db.components.push(named);const pack=exportResearchPack(db,[named.id],'rev');assert(!pack.components[0].proposals.some(p=>p.path==='specs.usbC'));pack.components[0].proposals=[{path:'specs.usbC',value:2,...evidence}];assert.equal(previewResearch(db,pack,'rev').preview.rows[0].status,'Conflict');
});
test('research rejects unsupported fields, wrong types, missing evidence and unsafe source links',()=>{
 const db=fixture();for(const proposal of [{path:'verified',value:true,...evidence},{path:'specs.notes',value:'replace history',...evidence},{path:'specs.threadCount',value:'16',...evidence},{path:'specs.threadCount',value:1.5,...evidence},{path:'specs.threadCount',value:16,sourceUrl:'javascript:alert(1)',evidence:'test'},{path:'specs.threadCount',value:16,sourceUrl:evidence.sourceUrl,evidence:''}]){
  const result=previewResearch(db,proposed(db,[proposal]),'rev');assert.equal(result.preview.rows[0].status,'Invalid');assert.equal(result.preview.fields,0);assert.deepEqual(result.components,db.components);
 }
 const duplicate=proposed(db,[{path:'specs.threadCount',value:16,...evidence},{path:'specs.threadCount',value:8,...evidence}]);assert.throws(()=>previewResearch(db,duplicate,'rev'),/duplicate proposed/);
});
test('selective research review includes only chosen fields and ignores edits to context',()=>{
 const db=fixture(),file=proposed(db,[{path:'specs.threadCount',value:16,...evidence},{path:'manufacturer',value:'Vendor',...evidence}]);(file.components[0].existing as Component).verified=true;(file.components[0].existing as Component).specs.coreCount=999;
 const first=previewResearch(db,file,'rev',[`${cpu.id}:specs.threadCount`]);assert.equal(first.preview.fields,1);const after=first.components.at(-1)!;assert.equal(after.manufacturer,'');assert.equal(after.specs.coreCount,4);assert.equal(after.verified,false);assert.notEqual(first.preview.token,previewResearch(db,file,'rev').preview.token);
 assert.throws(()=>previewResearch(db,file,'rev',['unknown']),/absent/);
 const long=fixture();long.components.at(-1)!.specs.notes='x'.repeat(9990);assert.equal(previewResearch(long,file,'rev').preview.valid,false);
});
async function workspace(run:(store:Store,call:(route:string,body:unknown,method?:string,revision?:string)=>Promise<Response>)=>Promise<void>){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bench-research-')),app=createApp(dir),store=app.locals.store as Store;store.restore(fixture());const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;try{await run(store,(route,body,method='POST',revision)=>fetch(origin+route,{method,headers:{'Content-Type':'application/json',...(revision?{'If-Match':revision}:{})},body:JSON.stringify(body)}));}finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));fs.rmSync(dir,{recursive:true,force:true});}}
test('research API round trip is read-only until reviewed apply and protects stale or changed proposals',async()=>workspace(async(store,call)=>{
 const before=store.revision,exported=await call('/api/catalog/research/export',{componentIds:[cpu.id]});assert.equal(exported.status,200);const file=await exported.json();assert.equal(store.revision,before);
 file.components[0].proposals=[{path:'specs.threadCount',value:16,...evidence},{path:'manufacturer',value:'Vendor',...evidence}];
 const preview=await(await call('/api/catalog/research/preview',{file,selected:[`${cpu.id}:specs.threadCount`]})).json();assert.equal(preview.valid,true);assert.equal(store.revision,before);
 const altered=structuredClone(file);altered.components[0].proposals[0].value=32;assert.equal((await call('/api/catalog/research/apply',{file:altered,selected:preview.selected,token:preview.token},'PUT',preview.revision)).status,409);
 assert.equal((await call('/api/catalog/research/apply',{file,selected:[],token:preview.token},'PUT',preview.revision)).status,400);
 const response=await call('/api/catalog/research/apply',{file,selected:preview.selected,token:preview.token},'PUT',preview.revision);assert.equal(response.status,200);assert.deepEqual(await response.json(),{components:1,fields:1});assert.equal(store.db.components.at(-1)!.specs.threadCount,16);assert.equal(store.db.components.at(-1)!.manufacturer,'');
 assert.equal((await call('/api/catalog/research/apply',{file,selected:preview.selected,token:preview.token},'PUT',preview.revision)).status,409);
 const fresh=await(await call('/api/catalog/research/preview',{file})).json();assert.equal(fresh.rows[0].status,'Unchanged');assert.deepEqual(fresh.selected,[`${cpu.id}:manufacturer`]);
}));
