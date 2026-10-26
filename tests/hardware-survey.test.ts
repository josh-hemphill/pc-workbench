import {parse as parseCSV} from 'csv-parse/sync';
import {stringify as stringifyCSV} from 'csv-stringify/sync';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {AddressInfo} from 'node:net';
import {seed} from '../server/seed.ts';
import {registerUnsurveyedPCs} from '../server/hardware-survey.ts';
import {commissionPCRecord,savePCRecord} from '../server/pc-lifecycle.ts';
import {Store,encodeCSV,decodeCSV} from '../server/store.ts';
import {createApp} from '../server/index.ts';
import {buildBulkCandidate} from '../server/bulk-records.ts';
const survey={status:'uninspected' as const,configurationId:'imaging',evidence:'Owner confirmed presence; inferred adjacent build, 2026-10-20'};
const location=(id:string)=>({id,name:id,kind:'Bench' as const,parentId:'',requirementSetId:'',requirementRevision:0,targetConfigurationId:'imaging',notes:''});
test('explicit device registration leaves installation targets build plans and inventory separate',()=>{
 const db=structuredClone(seed);db.installationLocations=[location('a'),location('b')];const before=JSON.stringify(db);
 const pcs=registerUnsurveyedPCs({locationIds:['a','b'],survey},db);assert.equal(pcs.length,2);assert.notEqual(pcs[0].id,pcs[1].id);
 for(const pc of pcs){assert.equal(pc.configurationId,'');assert.equal(pc.buildSettings,null);assert.deepEqual(pc.hardwareSurvey,survey);assert.equal(pc.timeline?.[0].kind,'register');assert.equal(pc.serial,'');}
 assert.equal(JSON.stringify(db),before);
 db.pcs.push(pcs[0]);assert.throws(()=>registerUnsurveyedPCs({locationIds:['b','a'],survey},db),/already has a PC/);
 for(const locationIds of [['a','a'],['missing']])assert.throws(()=>registerUnsurveyedPCs({locationIds,survey},db));
 db.installationLocations[1].kind='Site' as 'Bench';assert.throws(()=>registerUnsurveyedPCs({locationIds:['b'],survey},db),/Station, Bench or System/);
});
test('survey data round trips portable CSV and SQLite and configuration dependencies remain protected',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'survey-store-'));let store=new Store(dir);
 try{const pc=savePCRecord({...store.db.pcs[0],hardwareSurvey:survey},store.db);store.replace('pcs',[pc]);assert.deepEqual(decodeCSV('pcs',encodeCSV('pcs',[pc])),[pc]);
 const legacyRows=parseCSV(encodeCSV('pcs',[{...pc,hardwareSurvey:undefined}]),{columns:true}) as Record<string,string>[];for(const row of legacyRows)delete row.hardwareSurvey;const legacy=stringifyCSV(legacyRows,{header:true});assert.deepEqual((decodeCSV('pcs',legacy,[],[pc])[0] as typeof pc).hardwareSurvey,survey);
 assert.throws(()=>store.replace('configurations',store.db.configurations.filter(c=>c.id!==survey.configurationId)),/configuration not found/);
 store.close();store=new Store(dir);assert.deepEqual(store.db.pcs[0].hardwareSurvey,survey);
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('bulk survey changes are audited without changing planned hardware and incomplete surveys cannot commission',()=>{
 const db=structuredClone(seed),pc=db.pcs[0];const result=buildBulkCandidate({collection:'pcs',action:'edit',ids:[pc.id],patch:{hardwareSurvey:survey}},db);
 assert.equal(result.next.pcs[0].configurationId,pc.configurationId);assert.deepEqual(result.next.pcs[0].buildSettings,pc.buildSettings);assert.match(result.rows[0].after,/inferred adjacent build/);assert.match(result.next.pcs[0].timeline!.at(-1)!.summary,/hardwareSurvey/);
 assert.throws(()=>commissionPCRecord(result.next.pcs[0],{by:'Owner',checks:['Enumerated'],notes:''},result.next),/Complete the hardware survey/);
});
test('registration endpoint is atomic revision guarded and rejects duplicate devices',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'survey-api-')),app=createApp(dir),server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const state=async()=>{const r=await fetch(base+'/api/state');return {body:await r.json(),revision:r.headers.get('X-Workspace-Revision')!};};
 const post=(value:unknown,revision?:string)=>fetch(base+'/api/pcs/register-unsurveyed',{method:'POST',headers:{'Content-Type':'application/json',...(revision?{'If-Match':revision}:{})},body:JSON.stringify(value)});
 try{app.locals.store.replace('installationLocations',[location('a'),location('b')]);const before=await state();
 assert.equal((await post({locationIds:['a'],survey})).status,428);
 assert.equal((await post({locationIds:['a','missing'],survey},before.revision)).status,400);assert.equal((await state()).revision,before.revision);
 assert.equal((await post({locationIds:['a','b'],survey},before.revision)).status,200);const after=await state();assert.equal(after.body.pcs.length,before.body.pcs.length+2);assert.deepEqual(after.body.inventory,before.body.inventory);
 assert.equal((await post({locationIds:['a'],survey},before.revision)).status,409);assert.equal((await post({locationIds:['a'],survey},after.revision)).status,400);assert.equal((await state()).revision,after.revision);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));fs.rmSync(dir,{recursive:true,force:true});}
});
