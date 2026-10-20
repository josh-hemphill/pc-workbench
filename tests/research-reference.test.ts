import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import type {AddressInfo} from 'node:net';
import {seed} from '../server/seed.ts';
import {exportResearchPack,previewResearch,researchFileSchema} from '../server/catalog-research.ts';
import {researchJSONSchema,type ResearchFieldReference} from '../server/research-reference.ts';
import {createApp} from '../server/app.ts';
import type {Component} from '../shared/types.ts';
const fan:Component={id:'reference-fan',name:'Reference fan',model:'FAN-123',family:'Quiet series',category:'Fan',manufacturer:'Vendor',source:'',verified:false,specs:{coolingDevices:[{id:'FAN_1',kind:'fan',count:1}],notes:'Model FAN-123 from the manufacturer table.'}};
const pointer=(root:unknown,ref:string):unknown=>ref.slice(2).split('/').reduce((value,key)=>(value as Record<string,unknown>)[key.replace(/~1/g,'/').replace(/~0/g,'~')],root);
function refs(value:unknown):string[]{if(!value||typeof value!=='object')return [];return Object.entries(value).flatMap(([key,value])=>key==='$ref'?[String(value)]:refs(value));}
test('pack begins with a navigable index and deduplicated schemas before raw component context',()=>{
 const db=structuredClone(seed);db.components.push(fan,{...fan,id:'reference-fan-copy',specs:{}});const pack=exportResearchPack(db,[fan.id,'reference-fan-copy'],'rev');
 const keys=Object.keys(pack);for(const field of ['guide','componentIndex','$defs'])assert(keys.indexOf(field)<keys.indexOf('components'));assert.equal(pack.$schema,'component-research.schema.json');assert(researchFileSchema.safeParse(JSON.parse(JSON.stringify(pack))).success);
 const index=pack.componentIndex as {id:string;model?:string;componentRef:string;notesRef?:string;existingRef:string;proposalsRef:string;availablePaths:string[];existingRecordIds:Record<string,string[]>}[];
 assert.equal(index[0].id,fan.id);assert.equal(index[0].model,fan.model);assert.deepEqual(pointer(pack,index[0].existingRef),fan);assert.equal(pointer(pack,index[0].notesRef!),fan.specs.notes);assert.deepEqual(pointer(pack,index[0].proposalsRef),pack.components[0].proposals);assert.deepEqual(index[0].existingRecordIds['specs.coolingDevices'],['FAN_1']);assert(!Object.hasOwn(index[1].existingRecordIds,'specs.coolingDevices'));
 const fields=pack.components[0].missingFields as ResearchFieldReference[],motor=fields.find(f=>f.path==='specs.coolingDevices')!;assert(!('valueSchema' in motor));assert(motor.newRecordSchemaRef&&motor.updateRecordSchemaRef);const definition=pointer(pack,motor.newRecordSchemaRef!) as {required:string[]};assert(definition.required.includes('kind'));const update=pointer(pack,motor.updateRecordSchemaRef!) as {required:string[]};assert.deepEqual(update.required,['id']);
 for(const entry of pack.components)for(const field of entry.missingFields as ResearchFieldReference[]){assert(pointer(pack,field.valueSchemaRef));if(field.newRecordSchemaRef)assert(pointer(pack,field.newRecordSchemaRef));}
 for(const ref of refs(pack.$defs))assert(pointer(pack,ref),ref);assert.equal(Object.keys(pack.$defs as object).filter(key=>key==='new_specs_coolingDevices').length,1);
});
test('explicit empty inventories remain distinct in the index and shared references cover exported categories',()=>{
 const db=structuredClone(seed);db.components.push({...fan,specs:{coolingDevices:[]}});const pack=exportResearchPack(db,db.components.map(c=>c.id),'rev');const index=pack.componentIndex as {id:string;existingRecordIds:Record<string,string[]>}[];assert.deepEqual(index.find(c=>c.id===fan.id)!.existingRecordIds['specs.coolingDevices'],[]);
 for(const entry of pack.components)for(const field of entry.missingFields as ResearchFieldReference[])assert(pointer(pack,field.valueSchemaRef));const schema=researchJSONSchema();for(const ref of refs(schema))assert(ref.startsWith('#/')&&pointer(schema,ref),ref);
});
test('reference metadata never writes to records and legacy or compact responses remain accepted',()=>{
 const db=structuredClone(seed);db.components.push(fan);const pack=exportResearchPack(db,[fan.id],'rev');pack.components[0].proposals=[{path:'specs.coolingDevices',value:[{id:'FAN_1',currentA:0.2}],sourceUrl:'https://vendor.example/manual.pdf',evidence:'Manufacturer maximum current table.'}];pack.guide={overwriteKnown:true};pack.componentIndex=[{id:'fake'}];pack.$defs={value_specs_coolingDevices:{type:'null'}};
 const result=previewResearch(db,pack,'rev');assert.equal(result.preview.valid,true);assert.equal(result.components.at(-1)!.specs.coolingDevices![0].currentA,0.2);assert.equal(result.components.at(-1)!.model,fan.model);
 const compact={format:pack.format,version:pack.version,components:pack.components.map(({id,name,model,category,proposals})=>({id,name,model,category,proposals}))};assert(researchFileSchema.safeParse(compact).success);assert.equal(previewResearch(db,compact,'rev').preview.fields,1);
 const legacy={...compact,components:compact.components.map(c=>({...c,existing:fan,missingFields:[{path:'specs.coolingDevices',valueSchema:{type:'array'}}]}))};assert.equal(previewResearch(db,legacy,'rev').preview.fields,1);
});
test('standalone schema download is read-only and has the expected schema media type',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'research-schema-')),app=createApp(dir),server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));try{
  const revision=app.locals.store.revision,response=await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/catalog/research/schema`);assert.equal(response.status,200);assert.match(response.headers.get('content-type')!,/application\/schema\+json/);assert.match(response.headers.get('content-disposition')!,/component-research.schema.json/);const schema=await response.json();assert.match(schema.$schema,/2020-12/);assert(schema.$defs.new_specs_coolingDevices.required.includes('kind'));assert.equal(app.locals.store.revision,revision);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));fs.rmSync(dir,{recursive:true,force:true});}
});
