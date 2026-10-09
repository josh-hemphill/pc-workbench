import express from 'express';
import {resolveRuntimeConfig} from './runtime-config';
import {prepareInstallationRecord} from './installation-requirements';
import {savePCRecord,commissionPCRecord,decommissionPC} from './pc-lifecycle';
import {lockWorkspace} from './persistence';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Store,collections,encodeCSV,decodeCSV,encodeMovements,WorkspaceRecoveryError} from './store';
import type {Collection} from './schema';
import {checkConfiguration} from '../shared/compatibility';
import {checkInstalledPC,pcAllocations,planDifferences,stockReadiness} from '../shared/inventory';
import {saveStockRecord,applyStockOperation,convertBulkToSerialized,adjustStockCount,transferBulkStock} from './inventory';
export interface AppOptions { assets?:Record<string,{data:Buffer;mime:string}>; sourceRoot?:string }
export function createApp(dataDir?:string,options:AppOptions={}) {
const root=options.sourceRoot??(import.meta.url?path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'):process.cwd());
dataDir??=resolveRuntimeConfig({sourceRoot:root,standalone:false}).dataDir;
const release=lockWorkspace(dataDir);
let store:Store;try{store=new Store(dataDir);}catch(error){release();throw error;}
const app=express();
const closeStore=()=>{store.close();release();};
app.locals.closeStore=closeStore;
app.locals.store=store;
const listen=app.listen.bind(app);
app.listen=((...args:Parameters<typeof app.listen>)=>{const server=listen(...args);server.once('close',closeStore);server.once('error',closeStore);return server;}) as typeof app.listen;
app.use((req,res,next)=>{
 const host=(req.headers.host||'').split(':')[0];
 if(!['localhost','127.0.0.1','['].includes(host))return res.status(403).json({error:'Local connections only'});
 if(req.headers.origin){try{const url=new URL(req.headers.origin);if(!['localhost','127.0.0.1'].includes(url.hostname))return res.status(403).json({error:'Untrusted request origin'});}catch{return res.status(403).json({error:'Invalid origin'});}}
 res.setHeader('X-Content-Type-Options','nosniff');next();
});
app.use(express.json({limit:'10mb'}));
app.use('/api',(req,res,next)=>{const json=res.json.bind(res),send=res.send.bind(res);res.json=((body:unknown)=>{res.setHeader('X-Workspace-Revision',store.revision);return json(body);}) as typeof res.json;res.send=((body:unknown)=>{res.setHeader('X-Workspace-Revision',store.revision);return send(body);}) as typeof res.send;if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.path!=='/restore/preview')store.assertWritable();const protectedEdit=req.method==='PUT'||req.method==='DELETE'||(req.method==='POST'&&(req.path.endsWith('/import')||req.path.endsWith('/commission')||req.path.endsWith('/decommission')||req.path==='/restore'));if(protectedEdit){if(!req.headers['if-match'])return res.status(428).json({error:'Read the workspace revision and send it in If-Match before editing.'});if(req.headers['if-match']!==store.revision)return res.status(409).json({error:'Workspace changed. Reload before saving.'});}next();});
app.get('/api/state',(_req,res)=>res.json({...store.db,revision:store.revision,recoveryRequired:store.recoveryRequired}));
app.get('/api/report/:id',(req,res)=>{const cfg=store.db.configurations.find(c=>c.id===req.params.id);if(!cfg)return res.status(404).json({error:'Configuration not found'});res.json(checkConfiguration(cfg,store.db));});
app.get('/api/pcs/:id/build',(req,res)=>{const pc=store.db.pcs.find(p=>p.id===req.params.id);if(!pc)return res.status(404).json({error:'PC not found'});const template=store.db.configurations.find(c=>c.id===pc.configurationId);res.json({report:checkInstalledPC(pc,store.db),allocations:pcAllocations(pc.id,store.db),differences:planDifferences(pc,store.db),readiness:template?stockReadiness(template,store.db,pc.id):[]});});
app.post('/api/pcs/:id/commission',(req,res)=>{const pc=store.db.pcs.find(p=>p.id===req.params.id);if(!pc)return res.status(404).json({error:'PC not found'});const updated=commissionPCRecord(pc,req.body,store.db);store.replace('pcs',store.db.pcs.map(p=>p.id===updated.id?updated:p));res.json(updated);});
app.post('/api/pcs/:id/decommission',(req,res)=>{const pc=store.db.pcs.find(p=>p.id===req.params.id);if(!pc)return res.status(404).json({error:'PC not found'});const next=decommissionPC(pc,req.body,store.db);store.restore(next);res.json(next.pcs.find(p=>p.id===pc.id));});
app.post('/api/inventory/:id/serialize',(req,res)=>{const original=store.db.inventory.find(s=>s.id===req.params.id);if(!original)return res.status(404).json({error:'Stock record not found'});const {source,targets}=convertBulkToSerialized(original,req.body,store.db);store.replace('inventory',[...store.db.inventory.map(s=>s.id===source.id?source:s),...targets]);res.json({source,targets});});
app.get('/api/export/movements',(_req,res)=>res.type('text/csv').attachment('movements.csv').send(encodeMovements(store.db,_req.query.spreadsheet==='true')));
app.post('/api/inventory/:id/action',(req,res)=>{const stock=store.db.inventory.find(s=>s.id===req.params.id);if(!stock)return res.status(404).json({error:'Stock record not found'});const {stock:updated,additionalStock}=applyStockOperation(stock,req.body,store.db);store.replace('inventory',[...store.db.inventory.map(s=>s.id===updated.id?updated:s),...(additionalStock?[additionalStock]:[])]);res.json(updated);});
app.post('/api/inventory/:id/adjust',(req,res)=>{const stock=store.db.inventory.find(s=>s.id===req.params.id);if(!stock)return res.status(404).json({error:'Stock record not found'});const updated=adjustStockCount(stock,req.body,store.db);store.replace('inventory',store.db.inventory.map(s=>s.id===updated.id?updated:s));res.json(updated);});
app.post('/api/inventory/:id/transfer',(req,res)=>{const stock=store.db.inventory.find(s=>s.id===req.params.id);if(!stock)return res.status(404).json({error:'Stock record not found'});const {source,target}=transferBulkStock(stock,req.body,store.db);store.replace('inventory',[...store.db.inventory.map(s=>s.id===source.id?source:s),target]);res.json({source,target});});
app.get('/api/export/:collection',(req,res)=>{const c=req.params.collection as Collection;if(!collections.includes(c))return res.status(404).json({error:'Unknown collection'});res.type('text/csv').attachment(`${c}.csv`).send(encodeCSV(c,store.db[c],req.query.spreadsheet==='true'));});
app.get('/api/backup',(_req,res)=>res.attachment('bench-backup.json').json(store.db));
app.post('/api/restore/preview',(req,res)=>{const db=store.validateBackup(req.body.backup);res.json({counts:Object.fromEntries(collections.map(c=>[c,db[c].length])),revision:store.revision});});
app.post('/api/restore',(req,res)=>{const backupFile=store.restore(req.body.backup);res.json({restored:true,backupFile,revision:store.revision});});
app.post('/api/inventory/batch',(req,res)=>{if(!Array.isArray(req.body.records)||!req.body.records.length||req.body.records.length>1000)throw Error('Receive 1–1,000 stock records at a time.');const next=structuredClone(store.db);for(const input of req.body.records){if(next.inventory.some(s=>s.id===input.id))throw Error('Batch receipt requires new stock IDs.');next.inventory.push(saveStockRecord(input,next));}store.replace('inventory',next.inventory);res.json({received:req.body.records.length});});
app.post('/api/:collection/import',(req,res)=>{const c=req.params.collection as Collection;if(!collections.includes(c))return res.status(404).json({error:'Unknown collection'});if(typeof req.body.csv!=='string')return res.status(400).json({error:'CSV text required'});const rows=decodeCSV(c,req.body.csv) as {id:string}[];const merged=new Map((store.db[c] as {id:string}[]).map(r=>[r.id,r]));for(const row of rows)merged.set(row.id,prepareInstallationRecord(c,row,store.db) as {id:string});store.replace(c,[...merged.values()]);res.json({imported:rows.length});});
app.put('/api/:collection/:id',(req,res)=>{const c=req.params.collection as Collection;if(!collections.includes(c))return res.status(404).json({error:'Unknown collection'});if(req.body.id!==req.params.id)return res.status(400).json({error:'Record ID mismatch'});const prepared=prepareInstallationRecord(c,req.body,store.db);let record:any=c==='inventory'?saveStockRecord(prepared,store.db):c==='pcs'?savePCRecord(prepared,store.db):prepared as Record<string,any>;if(c==='configurations'){const existing=store.db.configurations.find(cfg=>cfg.id===req.params.id);record={...record,revision:(existing?.revision||0)+1,approvalSnapshot:record.status==='Approved'?{at:new Date().toISOString(),components:structuredClone(store.db.components.filter(component=>record.placements.some((p:{componentId:string})=>p.componentId===component.id))),system:structuredClone(store.db.systems.find(system=>system.id===record.systemId)||null)}:existing?.approvalSnapshot,approvalHistory:existing?.approvalHistory||[]};if(record.status==='Approved'){const {approvalHistory,approvalSnapshot,revision,...configuration}=record;record.approvalHistory=[...record.approvalHistory,{revision,at:approvalSnapshot.at,configuration,components:approvalSnapshot.components,system:approvalSnapshot.system}];}}const rows=[...store.db[c]] as {id:string}[];const i=rows.findIndex(r=>r.id===req.params.id);if(i<0)rows.push(record);else rows[i]=record;store.replace(c,rows);res.json(record);});
app.delete('/api/:collection/:id',(req,res)=>{const c=req.params.collection as Collection;if(!collections.includes(c))return res.status(404).json({error:'Unknown collection'});store.replace(c,store.db[c].filter(r=>r.id!==req.params.id));res.json({ok:true});});
if(options.assets){
 const assets=options.assets;
 app.use((req,res,next)=>{if(req.method!=='GET'&&req.method!=='HEAD')return next();const key=req.path==='/'?'/index.html':req.path;const asset=Object.hasOwn(assets,key)?assets[key]:undefined;if(!asset)return next();res.type(asset.mime).send(asset.data);});
}else {
 app.use(express.static(path.join(root,'dist')));
 app.get('/',(_req,res)=>res.sendFile(path.join(root,'dist/index.html')));
}
app.use((err:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{res.status(err instanceof WorkspaceRecoveryError?503:400).json({error:err instanceof Error?err.message:'Request failed'});});
return app;
}
