import {registerUnsurveyedPCs} from './hardware-survey.ts';
import {researchJSONSchema} from './research-reference.ts';
import {exportResearchPack,previewResearch,researchExportSchema,researchPreviewSchema} from './catalog-research.ts';
import {componentMergeSchema} from './component-merge.ts';
import {previewImport,importToken} from './csv-preview.ts';
import {prepareImportedRecord} from './import-record.ts';
import {saveConfigurationRecord} from './configuration-record.ts';
import express from 'express';
import {bulkSchema,bulkToken,buildBulkCandidate} from './bulk-records.ts';
import {EnrichmentQueue,type ProductFetcher} from './enrichment.ts';
import {patchMissing} from '../shared/catalog-quality.ts';
import {z} from 'zod';
import {resolveRuntimeConfig} from './runtime-config.ts';
import type { RuntimeConfig } from './runtime-config.ts';
import { SettingsStore, SettingsConflict } from './settings.ts';
import { isThemePreference } from '../shared/appearance.ts';
import {prepareInstallationRecord} from './installation-requirements.ts';
import {savePCRecord,commissionPCRecord,decommissionPC} from './pc-lifecycle.ts';
import {lockWorkspace} from './persistence.ts';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Store,collections,encodeCSV,decodeCSV,encodeMovements,WorkspaceRecoveryError,PlanConflict} from './store.ts';
import type {Collection} from './schema.ts';
import {checkConfiguration} from '../shared/compatibility.ts';
import {checkInstalledPC,pcAllocations,planDifferences,stockReadiness} from '../shared/inventory.ts';
import {saveStockRecord,applyStockOperation,convertBulkToSerialized,adjustStockCount,transferBulkStock} from './inventory.ts';
export interface AppOptions { desktopOriginOnly?:boolean; assets?:Record<string,{data:Buffer;mime:string}>; sourceRoot?:string; productFetcher?:ProductFetcher; runtimeConfig?:RuntimeConfig }
export function createApp(dataDir?:string,options:AppOptions={}) {
const root=options.sourceRoot??(import.meta.url?path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'):process.cwd());
const runtime=options.runtimeConfig??resolveRuntimeConfig({sourceRoot:root,standalone:false});
dataDir??=runtime.dataDir;
const settings=new SettingsStore({...runtime,dataDir});
const release=lockWorkspace(dataDir);
let store:Store;try{store=new Store(dataDir);}catch(error){release();throw error;}
const app=express();
let enrichment:EnrichmentQueue;try{enrichment=new EnrichmentQueue(store,options.productFetcher);}catch(error){store.close();release();throw error;}
const closeStore=()=>{enrichment.close();store.close();release();};
app.locals.closeStore=closeStore;
app.locals.store=store;
const listen=app.listen.bind(app);
app.listen=((...args:Parameters<typeof app.listen>)=>{const server=listen(...args);server.once('close',closeStore);server.once('error',closeStore);return server;}) as typeof app.listen;
app.use((req,res,next)=>{
 if(options.desktopOriginOnly){
  const authority=`127.0.0.1:${req.socket.localPort}`;
  if(req.headers.host!==authority||req.headers.origin&&req.headers.origin!==`http://${authority}`)return res.status(403).json({error:'Untrusted desktop origin'});
 }
 const host=(req.headers.host||'').split(':')[0];
 if(!['localhost','127.0.0.1','['].includes(host))return res.status(403).json({error:'Local connections only'});
 if(req.headers.origin){try{const url=new URL(req.headers.origin);if(!['localhost','127.0.0.1'].includes(url.hostname))return res.status(403).json({error:'Untrusted request origin'});}catch{return res.status(403).json({error:'Invalid origin'});}}
 res.setHeader('X-Content-Type-Options','nosniff');next();
});
app.use(express.json({limit:'10mb'}));
// User and app settings are independent of the workspace and its record revision.
function expectedSettingsRevision(req:express.Request,res:express.Response,label='settings'):string|undefined {
 const value=req.headers['if-match'];
 if(typeof value!=='string'){res.status(428).json({error:`Reload ${label} and provide its revision in If-Match.`});return;}
 return value.replace(/^"([^"]+)"$/,'$1');
}
app.use(['/api/settings','/api/preferences'],(_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
app.get('/api/settings/user',(_req,res)=>{
 const snapshot=settings.user();
 res.json({...snapshot,legacyTheme:!snapshot.exists?store.getLegacyThemePreference():null});
});
app.put('/api/settings/user',(req,res)=>{const expected=expectedSettingsRevision(req,res);if(expected!==undefined)res.json(settings.saveUser(req.body,expected));});
app.post('/api/settings/user/import-legacy',(req,res)=>{
 const expected=expectedSettingsRevision(req,res);if(expected===undefined)return;
 const snapshot=settings.user(),theme=store.getLegacyThemePreference();
 if(snapshot.exists)throw new SettingsConflict('User settings already exist. They take precedence over workspace preferences.');
 if(theme===null)throw Error('This workspace has no legacy appearance preference.');
 res.json(settings.saveUser({...snapshot.value,appearance:{...snapshot.value.appearance,theme}},expected));
});
app.get('/api/settings/app',(_req,res)=>res.json(settings.app()));
app.post('/api/settings/app/preview',(req,res)=>res.json(settings.previewApp(req.body)));
app.put('/api/settings/app',(req,res)=>{const expected=expectedSettingsRevision(req,res);if(expected!==undefined)res.json(settings.saveApp(req.body,expected));});
// Compatibility endpoint stores only per-user preferences, never workspace metadata.
app.get('/api/preferences',(_req,res)=>{const snapshot=settings.user();res.setHeader('ETag',`"${snapshot.revision}"`);res.json({theme:snapshot.value.appearance.theme});});
app.put('/api/preferences',(req,res)=>{
 const body=req.body;
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||!Object.hasOwn(body,'theme'))return res.status(400).json({error:'Provide only a theme preference.'});
 if(!isThemePreference(body.theme))throw Error('Theme must be system, light or dark.');
 const expected=expectedSettingsRevision(req,res);if(expected===undefined)return;
 const snapshot=settings.user();
 const saved=settings.saveUser({...snapshot.value,appearance:{...snapshot.value.appearance,theme:body.theme}},expected);
 res.setHeader('ETag',`"${saved.revision}"`);res.json({theme:saved.value.appearance.theme});
});
app.get('/api/transition-plans',(_req,res)=>{res.setHeader('Cache-Control','no-store');res.json({plans:store.plans()});});
app.put('/api/transition-plans/:id',(req,res)=>{const expected=expectedSettingsRevision(req,res,'the plan');if(expected===undefined)return;if(req.body.id!==req.params.id)throw Error('Plan ID mismatch.');res.json(store.savePlan(req.body,expected));});
app.delete('/api/transition-plans/:id',(req,res)=>{const expected=expectedSettingsRevision(req,res,'the plan');if(expected===undefined)return;store.deletePlan(req.params.id,expected);res.json({ok:true});});
app.use('/api',(req,res,next)=>{const json=res.json.bind(res),send=res.send.bind(res);res.json=((body:unknown)=>{res.setHeader('X-Workspace-Revision',store.revision);return json(body);}) as typeof res.json;res.send=((body:unknown)=>{res.setHeader('X-Workspace-Revision',store.revision);return send(body);}) as typeof res.send;const protectedEdit=!['GET','HEAD','OPTIONS'].includes(req.method)&&!['/restore/preview','/bulk/preview','/import/preview','/catalog/merge/preview','/catalog/research/export','/catalog/research/preview'].includes(req.path);if(protectedEdit)store.assertWritable();if(protectedEdit){if(!req.headers['if-match'])return res.status(428).json({error:'Read the workspace revision and send it in If-Match before editing.'});if(req.headers['if-match']!==store.revision)return res.status(409).json({error:'Workspace changed. Reload before saving.'});}next();});
app.get('/api/inventory-archive',(_req,res)=>{res.setHeader('Cache-Control','no-store');res.json({records:store.archivedInventory()});});
app.post('/api/catalog/merge/preview',(req,res)=>{const result=store.previewComponentMerge(req.body);res.json({...result.preview,token:result.token});});
app.post('/api/catalog/merge/apply',(req,res)=>{const input=z.object({input:componentMergeSchema,token:z.string().length(64),identityReviewed:z.boolean().default(false)}).strict().parse(req.body);res.json(store.mergeComponents(input.input,input.token,input.identityReviewed));});
app.get('/api/enrichment',(_req,res)=>res.json({jobs:enrichment.jobs,running:enrichment.running}));
app.get('/api/catalog/research/schema',(_req,res)=>{res.setHeader('Cache-Control','no-store');res.attachment('component-research.schema.json').type('application/schema+json').json(researchJSONSchema());});
app.post('/api/catalog/research/export',(req,res)=>{const {componentIds}=researchExportSchema.parse(req.body);res.setHeader('Cache-Control','no-store');res.attachment('component-research.json').json(exportResearchPack(store.db,componentIds,store.revision));});
app.post('/api/catalog/research/preview',(req,res)=>{const {file,selected}=researchPreviewSchema.parse(req.body),result=previewResearch(store.db,file,store.revision,selected);if(result.preview.valid)try{store.validateReplacement('components',result.components);}catch(error){result.preview.valid=false;result.preview.error=error instanceof Error?error.message:String(error);}res.json(result.preview);});
app.put('/api/catalog/research/apply',(req,res)=>{const input=researchPreviewSchema.extend({token:z.string().regex(/^[a-f0-9]{64}$/)}).parse(req.body);if(!input.selected?.length)throw Error('Select at least one fillable proposal and preview it.');const result=previewResearch(store.db,input.file,store.revision,input.selected);if(result.preview.token!==input.token||input.selected.length!==result.preview.selected.length)return res.status(409).json({error:'The file or selection changed. Preview the proposals again.'});if(!result.preview.valid)throw Error(result.preview.error);store.replace('components',result.components);res.json({components:result.preview.components,fields:result.preview.fields});});
app.put('/api/catalog/bulk-fill',(req,res)=>{const input=z.object({componentIds:z.array(z.string()).min(1).max(100),patch:z.record(z.string(),z.unknown()).refine(p=>Object.keys(p).length>0)}).strict().parse(req.body);if(new Set(input.componentIds).size!==input.componentIds.length||input.componentIds.some(id=>!store.db.components.some(c=>c.id===id)))throw Error('Select unique existing components.');const selected=new Set(input.componentIds);store.replace('components',store.db.components.map(c=>selected.has(c.id)?patchMissing(c,input.patch,store.db):c));res.json({updated:input.componentIds.length});});
app.put('/api/enrichment/enqueue',(req,res)=>{const input=z.object({items:z.array(z.object({componentId:z.string(),url:z.string().max(2000)}).strict()).min(1).max(100)}).strict().parse(req.body);res.json({added:enrichment.enqueue(input.items)});});
app.put('/api/enrichment/control',(req,res)=>{const input=z.object({action:z.enum(['start','pause','clear'])}).strict().parse(req.body);if(input.action==='start')enrichment.start();else if(input.action==='pause')enrichment.pause();else enrichment.clear();res.json({running:enrichment.running});});
app.put('/api/enrichment/:id/action',(req,res)=>{const input=z.discriminatedUnion('action',[z.object({action:z.literal('apply'),keys:z.array(z.string()).min(1).max(100),proposalId:z.string().min(1).max(100)}).strict(),z.object({action:z.literal('upload'),html:z.string().max(2*1024*1024)}).strict(),z.object({action:z.enum(['retry','cancel'])}).strict()]).parse(req.body);if(input.action==='apply')enrichment.apply(req.params.id,input.keys,input.proposalId);else if(input.action==='upload')enrichment.upload(req.params.id,input.html);else if(input.action==='retry')enrichment.retry(req.params.id);else enrichment.cancel(req.params.id);res.json({jobs:enrichment.jobs});});
app.post('/api/bulk/preview',(req,res)=>{const request=bulkSchema.parse(req.body),revision=store.revision,token=bulkToken(request,revision);try{const candidate=buildBulkCandidate(request,store.db);store.validateBackup(candidate.next);const {next:_,...summary}=candidate;res.json({valid:true,revision,token,...summary});}catch(error){res.json({valid:false,revision,token,rows:[],affectedPCs:0,pathChanges:0,historicalPCs:0,error:error instanceof Error?error.message:String(error)});}});
app.put('/api/bulk/apply',(req,res)=>{const input=z.object({request:bulkSchema,token:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(req.body);if(input.token!==bulkToken(input.request,store.revision))return res.status(409).json({error:'Bulk request changed. Preview the current selection and edits again.'});const candidate=buildBulkCandidate(input.request,store.db);store.validateBackup(candidate.next);if(input.request.collection==='components'&&input.request.action==='delete')store.deleteComponents(input.request.ids);else store.replace(input.request.collection,candidate.next[input.request.collection]);res.json({updated:input.request.ids.length});});
app.post('/api/import/preview',(req,res)=>{const input=z.object({collection:z.enum(collections as [Collection,...Collection[]]),csv:z.string().max(8*1024*1024)}).strict().parse(req.body);const {candidate:_,...preview}=previewImport(store,input.collection,input.csv);res.json(preview);});
app.post('/api/import/apply',(req,res)=>{const input=z.object({collection:z.enum(collections as [Collection,...Collection[]]),csv:z.string().max(8*1024*1024),token:z.string()}).strict().parse(req.body);if(input.token!==importToken(input.collection,input.csv,store.revision))return res.status(409).json({error:'Import changed. Preview this file again.'});const preview=previewImport(store,input.collection,input.csv);if(!preview.valid)throw Error(preview.error);const changed=preview.rows.filter(r=>r.status!=='Unchanged').length;if(changed)store.replace(input.collection,preview.candidate);res.json({imported:changed,unchanged:preview.rows.length-changed});});
app.post('/api/pcs/register-unsurveyed',(req,res)=>{const pcs=registerUnsurveyedPCs(req.body,store.db);store.replace('pcs',[...store.db.pcs,...pcs]);res.json({created:pcs.length});});
app.get('/api/state',(_req,res)=>res.json({...store.db,revision:store.revision,recoveryRequired:store.recoveryRequired}));
app.get('/api/report/:id',(req,res)=>{const cfg=store.db.configurations.find(c=>c.id===req.params.id);if(!cfg)return res.status(404).json({error:'Configuration not found'});res.json(checkConfiguration(cfg,store.db));});
app.get('/api/pcs/:id/build',(req,res)=>{const pc=store.db.pcs.find(p=>p.id===req.params.id);if(!pc)return res.status(404).json({error:'PC not found'});const template=store.db.configurations.find(c=>c.id===pc.configurationId);res.json({report:checkInstalledPC(pc,store.db),allocations:pcAllocations(pc.id,store.db),differences:planDifferences(pc,store.db),readiness:template?stockReadiness(template,store.db,pc.id):[]});});
app.post('/api/pcs/:id/commission',(req,res)=>{const pc=store.db.pcs.find(p=>p.id===req.params.id);if(!pc)return res.status(404).json({error:'PC not found'});const updated=commissionPCRecord(pc,req.body,store.db);store.replace('pcs',store.db.pcs.map(p=>p.id===updated.id?updated:p));res.json(updated);});
app.post('/api/pcs/:id/decommission',(req,res)=>{const pc=store.db.pcs.find(p=>p.id===req.params.id);if(!pc)return res.status(404).json({error:'PC not found'});const next=decommissionPC(pc,req.body,store.db);store.restore(next,true);res.json(next.pcs.find(p=>p.id===pc.id));});
app.post('/api/inventory/:id/serialize',(req,res)=>{const original=store.db.inventory.find(s=>s.id===req.params.id);if(!original)return res.status(404).json({error:'Stock record not found'});const {source,targets}=convertBulkToSerialized(original,req.body,store.db);store.replace('inventory',[...store.db.inventory.map(s=>s.id===source.id?source:s),...targets]);res.json({source,targets});});
app.get('/api/export/movements',(_req,res)=>res.type('text/csv').attachment('movements.csv').send(encodeMovements(store.db,_req.query.spreadsheet==='true',store.archivedInventory())));
app.post('/api/inventory/:id/action',(req,res)=>{const stock=store.db.inventory.find(s=>s.id===req.params.id);if(!stock)return res.status(404).json({error:'Stock record not found'});const {stock:updated,additionalStock}=applyStockOperation(stock,req.body,store.db);store.replace('inventory',[...store.db.inventory.map(s=>s.id===updated.id?updated:s),...(additionalStock?[additionalStock]:[])]);res.json(updated);});
app.post('/api/inventory/:id/adjust',(req,res)=>{const stock=store.db.inventory.find(s=>s.id===req.params.id);if(!stock)return res.status(404).json({error:'Stock record not found'});const updated=adjustStockCount(stock,req.body,store.db);store.replace('inventory',store.db.inventory.map(s=>s.id===updated.id?updated:s));res.json(updated);});
app.post('/api/inventory/:id/transfer',(req,res)=>{const stock=store.db.inventory.find(s=>s.id===req.params.id);if(!stock)return res.status(404).json({error:'Stock record not found'});const {source,target}=transferBulkStock(stock,req.body,store.db);store.replace('inventory',[...store.db.inventory.map(s=>s.id===source.id?source:s),target]);res.json({source,target});});
app.get('/api/export/:collection',(req,res)=>{const c=req.params.collection as Collection;if(!collections.includes(c))return res.status(404).json({error:'Unknown collection'});res.type('text/csv').attachment(`${c}.csv`).send(encodeCSV(c,store.db[c],req.query.spreadsheet==='true'));});
app.get('/api/backup',(_req,res)=>res.attachment('bench-backup.json').json(store.backup()));
app.post('/api/restore/preview',(req,res)=>{const db=store.validateBackup(req.body.backup);res.json({counts:Object.fromEntries(collections.map(c=>[c,db[c].length])),revision:store.revision,transitionPlans:(req.body.backup.transitionPlans||[]).length,archivedInventory:(req.body.backup.archivedInventory||[]).length,backupRevision:store.backupRevision});});
app.post('/api/restore',(req,res)=>{if(req.body.backupRevision!==undefined&&req.body.backupRevision!==store.backupRevision)return res.status(409).json({error:'Workspace plans or drafts changed. Preview the restore again.'});const backupFile=store.restore(req.body.backup);res.json({restored:true,backupFile,revision:store.revision});});
app.post('/api/inventory/batch',(req,res)=>{if(!Array.isArray(req.body.records)||!req.body.records.length||req.body.records.length>1000)throw Error('Receive 1–1,000 stock records at a time.');const next=structuredClone(store.db);for(const input of req.body.records){if(next.inventory.some(s=>s.id===input.id))throw Error('Batch receipt requires new stock IDs.');next.inventory.push(saveStockRecord(input,next));}store.replace('inventory',next.inventory);res.json({received:req.body.records.length});});
app.post('/api/:collection/import',(req,res)=>{const c=req.params.collection as Collection;if(!collections.includes(c))return res.status(404).json({error:'Unknown collection'});if(typeof req.body.csv!=='string')return res.status(400).json({error:'CSV text required'});const rows=decodeCSV(c,req.body.csv,store.db.components,store.db.pcs) as {id:string}[];const merged=new Map((store.db[c] as {id:string}[]).map(r=>[r.id,r]));for(const row of rows)merged.set(row.id,prepareImportedRecord(c,row,store.db) as {id:string});store.replace(c,[...merged.values()]);res.json({imported:rows.length});});
app.put('/api/:collection/:id',(req,res)=>{const c=req.params.collection as Collection;if(!collections.includes(c))return res.status(404).json({error:'Unknown collection'});if(req.body.id!==req.params.id)return res.status(400).json({error:'Record ID mismatch'});const prepared=prepareInstallationRecord(c,req.body,store.db);let record:any=c==='inventory'?saveStockRecord(prepared,store.db):c==='pcs'?savePCRecord(prepared,store.db):prepared as Record<string,any>;if(c==='configurations')record=saveConfigurationRecord(record,store.db);const rows=[...store.db[c]] as {id:string}[];const i=rows.findIndex(r=>r.id===req.params.id);if(i<0)rows.push(record);else rows[i]=record;store.replace(c,rows);res.json(record);});
app.delete('/api/:collection/:id',(req,res)=>{const c=req.params.collection as Collection;if(!collections.includes(c))return res.status(404).json({error:'Unknown collection'});if(c==='inventory')store.archiveInventory(req.params.id);else if(c==='components')store.deleteComponent(req.params.id);else store.replace(c,store.db[c].filter(r=>r.id!==req.params.id));res.json({ok:true});});
if(options.assets){
 const assets=options.assets;
 app.use((req,res,next)=>{if(req.method!=='GET'&&req.method!=='HEAD')return next();const key=req.path==='/'?'/index.html':req.path;const asset=Object.hasOwn(assets,key)?assets[key]:undefined;if(!asset)return next();res.type(asset.mime).send(asset.data);});
}else {
 app.use(express.static(path.join(root,'dist')));
 app.get('/',(_req,res)=>res.sendFile(path.join(root,'dist/index.html')));
}
app.use((err:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{res.status(err instanceof SettingsConflict||err instanceof PlanConflict?409:err instanceof WorkspaceRecoveryError?503:400).json({error:err instanceof Error?err.message:'Request failed'});});
return app;
}
