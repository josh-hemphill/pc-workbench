import express from 'express';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Store,collections,encodeCSV,decodeCSV,encodeMovements} from './store';
import type {Collection} from './schema';
import {checkConfiguration} from '../shared/compatibility';
import {checkInstalledPC,pcAllocations,planDifferences,stockReadiness} from '../shared/inventory';
import {saveStockRecord,applyStockAction,adjustStockCount,transferBulkStock} from './inventory';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function createApp(dataDir=process.env.BENCH_DATA_DIR||path.join(root,'data')) {
const store=new Store(dataDir);
const app=express();
app.use((req,res,next)=>{
 const host=(req.headers.host||'').split(':')[0];
 if(!['localhost','127.0.0.1','['].includes(host))return res.status(403).json({error:'Local connections only'});
 if(req.headers.origin){try{const url=new URL(req.headers.origin);if(!['localhost','127.0.0.1'].includes(url.hostname))return res.status(403).json({error:'Untrusted request origin'});}catch{return res.status(403).json({error:'Invalid origin'});}}
 res.setHeader('X-Content-Type-Options','nosniff');next();
});
app.use(express.json({limit:'10mb'}));
app.get('/api/state',(_req,res)=>res.json(store.db));
app.get('/api/report/:id',(req,res)=>{const cfg=store.db.configurations.find(c=>c.id===req.params.id);if(!cfg)return res.status(404).json({error:'Configuration not found'});res.json(checkConfiguration(cfg,store.db));});
app.get('/api/pcs/:id/build',(req,res)=>{const pc=store.db.pcs.find(p=>p.id===req.params.id);if(!pc)return res.status(404).json({error:'PC not found'});const template=store.db.configurations.find(c=>c.id===pc.configurationId);res.json({report:checkInstalledPC(pc,store.db),allocations:pcAllocations(pc.id,store.db),differences:planDifferences(pc,store.db),readiness:template?stockReadiness(template,store.db,pc.id):[]});});
app.get('/api/export/movements',(_req,res)=>res.type('text/csv').attachment('movements.csv').send(encodeMovements(store.db)));
app.post('/api/inventory/:id/action',(req,res)=>{const stock=store.db.inventory.find(s=>s.id===req.params.id);if(!stock)return res.status(404).json({error:'Stock record not found'});const updated=applyStockAction(stock,req.body,store.db);store.replace('inventory',store.db.inventory.map(s=>s.id===updated.id?updated:s));res.json(updated);});
app.post('/api/inventory/:id/adjust',(req,res)=>{const stock=store.db.inventory.find(s=>s.id===req.params.id);if(!stock)return res.status(404).json({error:'Stock record not found'});const updated=adjustStockCount(stock,req.body,store.db);store.replace('inventory',store.db.inventory.map(s=>s.id===updated.id?updated:s));res.json(updated);});
app.post('/api/inventory/:id/transfer',(req,res)=>{const stock=store.db.inventory.find(s=>s.id===req.params.id);if(!stock)return res.status(404).json({error:'Stock record not found'});const {source,target}=transferBulkStock(stock,req.body,store.db);store.replace('inventory',[...store.db.inventory.map(s=>s.id===source.id?source:s),target]);res.json({source,target});});
app.get('/api/export/:collection',(req,res)=>{const c=req.params.collection as Collection;if(!collections.includes(c))return res.status(404).json({error:'Unknown collection'});res.type('text/csv').attachment(`${c}.csv`).send(encodeCSV(c,store.db[c]));});
app.get('/api/backup',(_req,res)=>res.attachment('bench-backup.json').json(store.db));
app.post('/api/:collection/import',(req,res)=>{const c=req.params.collection as Collection;if(!collections.includes(c))return res.status(404).json({error:'Unknown collection'});if(typeof req.body.csv!=='string')return res.status(400).json({error:'CSV text required'});const rows=decodeCSV(c,req.body.csv) as {id:string}[];const merged=new Map((store.db[c] as {id:string}[]).map(r=>[r.id,r]));for(const row of rows)merged.set(row.id,row);store.replace(c,[...merged.values()]);res.json({imported:rows.length});});
app.put('/api/:collection/:id',(req,res)=>{const c=req.params.collection as Collection;if(!collections.includes(c))return res.status(404).json({error:'Unknown collection'});if(req.body.id!==req.params.id)return res.status(400).json({error:'Record ID mismatch'});const record=c==='inventory'?saveStockRecord(req.body,store.db):req.body;const rows=[...store.db[c]] as {id:string}[];const i=rows.findIndex(r=>r.id===req.params.id);if(i<0)rows.push(record);else rows[i]=record;store.replace(c,rows);res.json(record);});
app.delete('/api/:collection/:id',(req,res)=>{const c=req.params.collection as Collection;if(!collections.includes(c))return res.status(404).json({error:'Unknown collection'});store.replace(c,store.db[c].filter(r=>r.id!==req.params.id));res.json({ok:true});});
app.use(express.static(path.join(root,'dist')));
app.get('/',(_req,res)=>res.sendFile(path.join(root,'dist/index.html')));
app.use((err:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{res.status(400).json({error:err instanceof Error?err.message:'Request failed'});});
return app;
}
const port=Number(process.env.PORT||3001);
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)createApp().listen(port,'127.0.0.1',()=>console.log(`Bench API / production app: http://127.0.0.1:${port}`));
