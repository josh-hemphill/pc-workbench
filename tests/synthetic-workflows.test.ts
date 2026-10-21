import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {AddressInfo} from 'node:net';
import type {Database,InventoryPC} from '../shared/types.ts';
import {createApp} from '../server/app.ts';
import {collections} from '../server/store.ts';
import {fixtureFiles,fixtureRoot} from '../tools/synthetic-workflows/generate.ts';
import {fixtureScenario,workflowFixtures} from '../tools/synthetic-workflows/scenarios.ts';
import {planTransition,transitionCohorts,transitionMatches} from '../shared/transitions.ts';
const read=(name:string)=>fs.readFileSync(path.join(fixtureRoot,name),'utf8');
const fixtures=workflowFixtures();
async function isolated(run:(ctx:Awaited<ReturnType<typeof context>>)=>Promise<void>){
 const ctx=await context();try{await run(ctx);}finally{ctx.server.closeAllConnections();await new Promise<void>(resolve=>ctx.server.close(()=>resolve()));fs.rmSync(ctx.dir,{recursive:true,force:true});}
}
async function context(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'synthetic-workflow-')),app=createApp(dir),server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 async function state(){return await (await fetch(base+'/api/state')).json() as Database&{revision:string};}
 async function call(url:string,body?:unknown,method='POST',headers?:Record<string,string>){const revision=(await state()).revision;const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json','If-Match':revision,...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};}
 async function ok(url:string,body?:unknown,method='POST',headers?:Record<string,string>){const result=await call(url,body,method,headers);assert.equal(result.status,200,`${url}: ${JSON.stringify(result.body)}`);return result.body;}
 async function restore(backup:unknown){const preview=await ok('/api/restore/preview',{backup});await ok('/api/restore',{backup,backupRevision:preview.backupRevision},'POST');}
 async function importCSV(collection:string,csv:string){const preview=await ok('/api/import/preview',{collection,csv});assert(preview.valid,`${collection}: ${preview.error}`);return await ok('/api/import/apply',{collection,csv,token:preview.token});}
 return {dir,app,server,state,call,ok,restore,importCSV};
}
function database(state:Database):Database{return Object.fromEntries(collections.map(c=>[c,state[c]])) as unknown as Database;}

test('published synthetic imports are deterministic and match their generator',()=>{
 for(const [name,content] of fixtureFiles())assert.equal(read(name),content,`Regenerate ${name} with pnpm fixtures:workflows`);
});
for(const fixture of fixtures)test(`synthetic import paths: ${fixture.id}`,async()=>isolated(async ctx=>{
 const backup=JSON.parse(read(`${fixture.id}/workspace.json`));const original=await ctx.state();
 const preview=await ctx.ok('/api/restore/preview',{backup});assert.equal((await ctx.state()).revision,original.revision,'preview must be read only');
 await ctx.ok('/api/restore',{backup,backupRevision:preview.backupRevision});const restored=await ctx.state(),canonical=database(restored);
 assert.equal(transitionMatches(restored,fixtureScenario(fixture)).length,fixture.expected.active);
 const plan=JSON.parse(read(`${fixture.id}/transition-plan.json`)).scenario,before=JSON.stringify(restored),report=planTransition(restored,plan);
 assert.equal(report.blocked,fixture.expected.blocked);assert.equal(report.included,plan.pcIds.length-fixture.expected.blocked);assert.equal(JSON.stringify(restored),before,'planning must not mutate inventory');
 const exported=await ctx.ok('/api/backup',undefined,'GET');assert.equal(exported.transitionPlans.length,1);assert.deepEqual(exported.transitionPlans[0].scenario,plan);
 await ctx.restore(JSON.parse(read(`${fixture.id}/catalog.json`)));
 for(const collection of ['installationLocations','pcs','inventory']){
  const csv=read(`${fixture.id}/${collection}.csv`);await ctx.importCSV(collection,csv);const revision=(await ctx.state()).revision;
  const repeated=await ctx.importCSV(collection,csv);assert.equal(repeated.imported,0,'reuploading unchanged exports must be safe');assert.equal((await ctx.state()).revision,revision);
 }
 assert.deepEqual(database(await ctx.state()),canonical,'staged CSV and whole-workspace restore must agree');
 const saved=await ctx.ok(`/api/transition-plans/plan-${fixture.id}`,{id:`plan-${fixture.id}`,scenario:plan,draft:null,workspaceRevision:(await ctx.state()).revision,draftWorkspaceRevision:''},'PUT',{'If-Match':'missing'});assert(saved.revision);
 const backupAgain=await ctx.ok('/api/backup',undefined,'GET');await ctx.restore(backupAgain);const reloaded=await ctx.state();assert.deepEqual(database(reloaded),canonical);assert.equal(planTransition(reloaded,plan).blocked,fixture.expected.blocked);
}));

test('rejected synthetic imports leave all collections and revisions intact',async()=>isolated(async ctx=>{
 await ctx.restore(JSON.parse(read('01-locations-only/catalog.json')));
 for(const entry of JSON.parse(read('manifest.json')).rejectedImports){
  const before=await ctx.state(),preview=await ctx.ok('/api/import/preview',{collection:entry.collection,csv:read(`rejected-imports/${entry.file}`)});
  assert.equal(preview.valid,false,entry.file);assert(preview.error.includes(entry.error),`${entry.file}: ${preview.error}`);
  const apply=await ctx.call('/api/import/apply',{collection:entry.collection,csv:read(`rejected-imports/${entry.file}`),token:preview.token});assert.equal(apply.status,400);assert.deepEqual(await ctx.state(),before);
 }
}));

test('locations-only import supports spreadsheet CSV, explicit registration, reupload after deletion and stale guards',async()=>isolated(async ctx=>{
 await ctx.restore(JSON.parse(read('01-locations-only/catalog.json')));
 const locations=fixtures[0].db.installationLocations;assert.equal(locations.filter(l=>l.name==='Bench 1').length,2,'repeated labels at different sites must remain distinct');
 // Spreadsheet delimiter/header variants, including quoted embedded notes, use the public import path.
 const {stringify}=await import('csv-stringify/sync');const csv=stringify([['Location ID','name','kind','Parent ID','requirementSetId','requirementRevision','targetConfigurationId','notes'],...locations.map(l=>[l.id,l.name,l.kind,l.parentId,l.requirementSetId,l.requirementRevision,l.targetConfigurationId,'Synthetic; note with a comma, and "quotes"'])],{delimiter:';'});
 await ctx.importCSV('installationLocations',csv);
 const request={collection:'installationLocations',action:'delete',ids:locations.map(l=>l.id)},preview=await ctx.ok('/api/bulk/preview',request);assert(preview.valid);await ctx.ok('/api/bulk/apply',{request,token:preview.token},'PUT');
 await ctx.importCSV('installationLocations',csv);assert.equal((await ctx.state()).installationLocations.length,6);
 const stale=(await ctx.state()).revision,registration={locationIds:['bench-1','bench-2'],survey:{status:'uninspected',configurationId:'source-hdd',evidence:'Synthetic owner report 2026-10-21'}};
 const before=await ctx.state();assert.equal((await ctx.call('/api/pcs/register-unsurveyed',{...registration,locationIds:['bench-1','site-a']})).status,400);assert.deepEqual(await ctx.state(),before);
 await ctx.ok('/api/pcs/register-unsurveyed',registration);assert.equal((await ctx.call('/api/pcs/register-unsurveyed',{...registration,locationIds:['bench-3']},'POST',{'If-Match':stale})).status,409);
 assert.equal((await ctx.call('/api/pcs/register-unsurveyed',registration)).status,400);const after=await ctx.state();assert.equal(after.pcs.length,2);assert.deepEqual(after.inventory,before.inventory);assert(after.pcs.every(p=>p.configurationId===''&&p.buildSettings===null));
 const fixture={...fixtures[0],db:after};assert.equal(planTransition(after,fixtureScenario(fixture)).blocked,0);
}));

async function bulkSurvey(ctx:Awaited<ReturnType<typeof context>>,pcs:InventoryPC[],configurationId:string){
 const request={collection:'pcs',action:'edit',ids:pcs.map(p=>p.id),patch:{hardwareSurvey:{status:'uninspected',configurationId,evidence:'Synthetic onsite observation 2026-10-21'}}};
 const preview=await ctx.ok('/api/bulk/preview',request);assert(preview.valid,preview.error);await ctx.ok('/api/bulk/apply',{request,token:preview.token},'PUT');
}
test('legacy and incomplete-survey imports recover through the same bulk editor API',async()=>isolated(async ctx=>{
 for(const id of ['02-legacy-plans','07-survey-gaps']){
  await ctx.restore(JSON.parse(read(`${id}/workspace.json`)));let db=await ctx.state();const fixture=fixtures.find(f=>f.id===id)!;
  if(id==='02-legacy-plans')assert(planTransition(db,fixtureScenario({...fixture,db})).procurement.every(r=>r.assumedRetained===0));
  await bulkSurvey(ctx,db.pcs,'source-hdd');db=await ctx.state();const report=planTransition(db,fixtureScenario({...fixture,db}));assert.equal(report.blocked,0);assert(report.procurement.some(r=>r.assumedRetained>0));assert.equal(db.inventory.length,0);
 }
}));

test('partial survey conflict can be reconciled, physically enumerated and commissioned',async()=>isolated(async ctx=>{
 const fixture=fixtures.find(f=>f.id==='04-partial-conflict')!;await ctx.restore(JSON.parse(read(`${fixture.id}/workspace.json`)));let db=await ctx.state();
 await bulkSurvey(ctx,[db.pcs[2]],'source-extra-memory');db=await ctx.state();assert.equal(planTransition(db,fixtureScenario({...fixture,db})).blocked,0);
 const pc=db.pcs[2],cfg=db.configurations.find(c=>c.id==='source-extra-memory')!;
 assert.equal((await ctx.call(`/api/pcs/${pc.id}/commission`,{by:'Synthetic tester',checks:['Enumerated'],notes:''})).status,400);
 // Receive and install the unrecorded parts using operational commands, preserving existing RAM allocations.
 for(const p of cfg.placements.filter(p=>p.componentId!=='ram')){
  const id=`onsite-${p.id}`,record={id,componentId:p.componentId,tracking:'bulk',serial:'',assetTag:id,quantity:p.quantity,location:'SYNTHETIC onsite survey',condition:'Serviceable',notes:'Found physically installed during synthetic survey',allocations:[],history:[]};
  await ctx.ok(`/api/inventory/${id}`,record,'PUT');await ctx.ok(`/api/inventory/${id}/action`,{action:'install',pcId:pc.id,quantity:p.quantity,plannedPlacementId:'',role:p.role,mount:p.mount,slotId:p.slotId,group:p.group,notes:'Synthetic actual enumeration'});
 }
 db=await ctx.state();const current=db.pcs.find(p=>p.id===pc.id)!;await ctx.ok(`/api/pcs/${pc.id}`,{...current,hardwareSurvey:{...current.hardwareSurvey!,status:'complete',configurationId:''}},'PUT');
 const commissioned=await ctx.ok(`/api/pcs/${pc.id}/commission`,{by:'Synthetic tester',checks:['Physical enumeration complete','Boot and data checks'],notes:'Fictional commissioning'});assert.equal(commissioned.lifecycle,'Commissioned');assert.equal(commissioned.snapshot.installedStock.length,cfg.placements.length);
 db=await ctx.state();assert.equal(planTransition(db,fixtureScenario({...fixture,db})).blocked,0);assert(db.inventory.every(s=>s.quantity>=s.allocations.reduce((n,a)=>n+a.quantity,0)));
}));

test('unknown capacities and pinned requirements recover only with measurements and sufficient hardware',async()=>isolated(async ctx=>{
 const fixture=fixtures.find(f=>f.id==='06-unknown-capacity')!;await ctx.restore(JSON.parse(read(`${fixture.id}/workspace.json`)));const db=await ctx.state(),scenario=fixtureScenario({...fixture,db});assert.equal(planTransition(db,scenario).blocked,2);
 for(const cohort of transitionCohorts(db,scenario)){scenario.destinationIds[cohort.id]='destination-large';for(const segment of cohort.segments.filter(s=>s.role==='data'))(scenario.policies[cohort.id]??={})[segment.id]={usedGb:1000,evidence:'Synthetic measured usage, 2026-10-21'};}
 const report=planTransition(db,scenario);assert.equal(report.blocked,0);assert(report.pcs.every(p=>p.beforeData===null));assert(report.pcs.every(p=>(p.afterData||0)>=6000));
}));
test('stock pressure counts each pool once and scale filters preserve explicit selection',async()=>isolated(async ctx=>{
 const pressure=fixtures.find(f=>f.id==='05-stock-pressure')!;await ctx.restore(JSON.parse(read(`${pressure.id}/workspace.json`)));let db=await ctx.state();let scenario=fixtureScenario({...pressure,db}),report=planTransition(db,scenario);
 assert.deepEqual(Object.fromEntries(report.procurement.filter(r=>r.order).map(r=>[r.id,r.order])),{ram:2,cage:1,ssd:2});assert.equal(report.procurement.find(r=>r.id==='ssd')!.free,1);assert.equal(report.procurement.find(r=>r.id==='ssd')!.reserved,1);
 scenario.pcIds.push('synthetic-pc-4','synthetic-pc-5');report=planTransition(db,scenario);assert.equal(report.blocked,2);assert.equal(report.procurement.find(r=>r.id==='ssd')!.target,4);
 const scale=fixtures.find(f=>f.id==='08-fleet-scale')!;await ctx.restore(JSON.parse(read(`${scale.id}/workspace.json`)));db=await ctx.state();scenario=fixtureScenario({...scale,db});assert.equal(scenario.pcIds.length,120);scenario.locationId='site-a';assert.equal(transitionMatches(db,scenario).length,63);assert.equal(scenario.pcIds.length,120);scenario.sourceIds=['source-hdd'];assert.equal(transitionMatches(db,scenario).length,32);assert.equal(planTransition(db,scenario).included,120,'filters must not silently prune explicit plan IDs');
}));
