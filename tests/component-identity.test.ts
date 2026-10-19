import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {parse} from 'csv-parse/sync';import {stringify} from 'csv-stringify/sync';
import {componentSchema} from '../shared/component-schema.ts';
import type {Component} from '../shared/types.ts';
import {duplicateModelGroups,identityDifferences,normalizedModel} from '../shared/component-identity.ts';
import {applyComponentFieldEdits,commonComponentDraft,sharedComponentPaths} from '../shared/component-bulk.ts';
import {missingFields,patchMissing} from '../shared/catalog-quality.ts';
import {seed} from '../server/seed.ts';
import {Store,encodeCSV,decodeCSV} from '../server/store.ts';
import {previewImport} from '../server/csv-preview.ts';
import {exportResearchPack,previewResearch} from '../server/catalog-research.ts';
import {importProductHTML} from '../tools/pcpartpicker.ts';
const drive:Component={id:'variant-a',name:'Vendor Series SSD',category:'Drive',manufacturer:'Vendor',model:'SSD-1000',family:'Series',verified:true,source:'',specs:{capacityGb:1000,driveInterface:'SATA',driveSize:'2.5'}};
const workspace=(run:(store:Store,dir:string)=>void)=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'identity-'));const store=new Store(dir);try{store.replace('components',[...store.db.components,drive]);run(store,dir);}finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}};
test('model and family remain optional; CSV JSON and SQLite preserve exact variants',()=>workspace((store,dir)=>{
 const legacy={...drive,id:'legacy-drive'};delete legacy.model;delete legacy.family;assert.deepEqual(componentSchema.parse(legacy),legacy);assert.equal(componentSchema.parse({...drive,model:' SSD-1000 '}).model,'SSD-1000');assert(!componentSchema.safeParse({...drive,model:'x'.repeat(201)}).success);
 assert.deepEqual(decodeCSV('components',encodeCSV('components',[drive,legacy])),[drive,legacy]);
 const backup=store.backup();assert.equal(backup.components.at(-1)!.model,drive.model);store.close();const reopened=new Store(dir);try{assert.deepEqual(reopened.db.components.at(-1),drive);}finally{reopened.close();}
}));
test('older CSV headers preserve model metadata while explicit blank identity columns clear it',()=>workspace(store=>{
 const records=parse(encodeCSV('components',[drive]),{columns:true}) as Record<string,string>[];
 for(const record of records){delete record.model;delete record.family;}
 const legacy=stringify(records,{header:true});const preview=previewImport(store,'components',legacy);assert.equal(preview.valid,true);assert.equal(preview.rows[0].status,'Unchanged');
 const cleared=encodeCSV('components',[{...drive,model:undefined,family:undefined}]);const clearing=previewImport(store,'components',cleared);assert.equal(clearing.valid,true);assert.equal(clearing.rows[0].status,'Update');assert.equal((clearing.candidate.find(c=>c.id===drive.id)! as Component).model,undefined);
 const alias=encodeCSV('components',[drive]).replace('model,family,','MPN,Series,');assert.equal((decodeCSV('components',alias)[0] as Component).model,drive.model);
}));
test('duplicate hints normalize model formatting but keep manufacturers capacities and series variants separate',()=>{
 const duplicate={...drive,id:'variant-copy',model:'ssd 1000',manufacturer:'vendor'},larger={...drive,id:'variant-2tb',model:'SSD-2000',specs:{...drive.specs,capacityGb:2000}},sameModelOtherCapacity={...larger,model:drive.model};
 assert.equal(normalizedModel('SSD_1000'),'ssd1000');assert.deepEqual(duplicateModelGroups([drive,duplicate,larger,sameModelOtherCapacity,{...drive,id:'other-brand',manufacturer:'Other'},{...drive,id:'unknown-model',model:undefined}]).map(g=>g.map(c=>c.id)),[[drive.id,duplicate.id]]);
 assert.deepEqual(identityDifferences(duplicate,drive),[]);assert.deepEqual(identityDifferences(larger,drive),['Model / part number','Capacity']);assert(identityDifferences(drive,{...drive,model:undefined}).includes('Model / part number'));
});
test('shared bulk and research editors fill model metadata without making optional identity fields mandatory gaps',()=>{
 const legacy={...drive,model:undefined,family:undefined};const db={...structuredClone(seed),components:[legacy]};assert(!missingFields(legacy).some(f=>['model','family'].includes(f.key)));assert.equal(patchMissing(legacy,{model:'ssd-1000'},{components:[drive,legacy]}).model,'ssd-1000');assert(sharedComponentPaths([drive,legacy]).includes('family'));assert.equal(commonComponentDraft([drive,legacy]).model,undefined);
 const next=applyComponentFieldEdits(drive,[{path:'family',mode:'set',value:'New Series'},{path:'model',mode:'clear'}],db);assert.equal(next.model,undefined);assert.equal(next.family,'New Series');assert.equal(next.verified,false);
 const file=exportResearchPack(db,[legacy.id],'rev');assert(file.components[0].proposals.some(p=>p.path==='model'));file.components[0].proposals=[{path:'model',value:'SSD-1000',sourceUrl:'https://vendor.example/manual.pdf',evidence:'Manufacturer part-number table.'}];const result=previewResearch(db,file,'rev');assert.equal(result.preview.valid,true);assert.equal(result.components[0].model,'SSD-1000');assert.equal(result.components[0].specs.capacityGb,1000);
 const known={...db,components:[drive]},stale=exportResearchPack(known,[drive.id],'rev');stale.components[0].proposals=[{path:'family',value:'New Series',sourceUrl:'https://vendor.example/manual.pdf',evidence:'Series table.'}];known.components[0]={...drive,model:'Other-model'};assert.equal(previewResearch(known,stale,'changed').preview.rows[0].status,'Conflict');
});
test('merges require explicit review of model or capacity differences and retain canonical identity',()=>workspace(store=>{
 const other={...drive,id:'variant-b',model:'SSD-2000',specs:{...drive.specs,capacityGb:2000}};store.replace('components',[...store.db.components,other]);const input={sourceIds:[other.id],targetId:drive.id,notes:'Correct imported identity after checking manufacturer documentation'};const preview=store.previewComponentMerge(input),revision=store.revision;assert.deepEqual(preview.preview.identityConflicts,[{id:other.id,fields:['Model / part number','Capacity']}]);assert.throws(()=>store.mergeComponents(input,preview.token),/acknowledge/);assert.equal(store.revision,revision);assert(store.db.components.some(c=>c.id===other.id));store.mergeComponents(input,preview.token,true);assert(!store.db.components.some(c=>c.id===other.id));assert.deepEqual(store.db.components.find(c=>c.id===drive.id),drive);
}));
test('structured product import uses manufacturer part numbers and never treats supplier SKUs as models',()=>{
 const html=(props:Record<string,unknown>)=>`<script type="application/ld+json">${JSON.stringify({'@type':'Product',name:'Vendor CPU',brand:'Vendor',url:'https://pcpartpicker.com/product/abc/test',...props})}</script>`;
 assert.equal(importProductHTML(html({mpn:'M-100',sku:'STORE-999'}),'CPU')[0].model,'M-100');assert.equal(importProductHTML(html({sku:'STORE-999'}),'CPU')[0].model,undefined);
});
