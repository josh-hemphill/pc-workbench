import fs from 'node:fs';
import path from 'node:path';
import {parse} from 'csv-parse/sync';
import {stringify} from 'csv-stringify/sync';
import {schemas, type Collection} from './schema';
import {seed} from './seed';
import type {Database} from '../shared/types';
import {checkConfiguration} from '../shared/compatibility';
export const collections:Collection[]=['components','systems','configurations','pcs'];
const fields:Record<Collection,string[]>={components:['id','name','category','manufacturer','specs','source','verified'],systems:['id','name','location','description','connections'],configurations:['id','name','description','systemId','status','updatedAt','placements','storage','notes'],pcs:['id','name','serial','location','configurationId','notes']};
const nested=new Set(['specs','connections','placements','storage']);
export function encodeCSV(collection:Collection,rows:unknown[]):string {return stringify(rows.map(row=>Object.fromEntries(Object.entries(row as object).map(([k,v])=>[k,nested.has(k)?JSON.stringify(v):typeof v==='boolean'?String(v):v]))),{header:true,columns:fields[collection]});}
export function decodeCSV(collection:Collection,text:string):unknown[] {
 const rows=parse(text,{columns:true,bom:true,skip_empty_lines:true,max_record_size:2000000}) as Record<string,string>[];
 if(rows.length>10000)throw Error('CSV limit is 10,000 records.');
 if(new Set(rows.map(r=>r.id)).size!==rows.length)throw Error('CSV contains duplicate record IDs.');
 return rows.map((row:Record<string,string>,i:number)=>{try{const item:Record<string,unknown>={...row};for(const k of Object.keys(item)){if(nested.has(k))item[k]=JSON.parse(row[k]);if(k==='verified'){if(!['true','false','1','0'].includes(row[k]))throw Error('verified must be true or false');item[k]=['true','1'].includes(row[k]);}}return schemas[collection].parse(item);}catch(e){throw Error(`CSV row ${i+2}: ${e instanceof Error?e.message:e}`);}});
}
export class Store {
 db:Database;
 constructor(public dir:string){fs.mkdirSync(dir,{recursive:true});this.db=structuredClone(seed);for(const collection of collections){const filename=path.join(dir,`${collection}.csv`);if(fs.existsSync(filename))(this.db[collection] as unknown[])=decodeCSV(collection,fs.readFileSync(filename,'utf8'));else this.persist(collection,this.db[collection]);}this.validateReferences(this.db);}
 persist(collection:Collection,rows:unknown[]){const file=path.join(this.dir,`${collection}.csv`),temp=`${file}.tmp`;fs.writeFileSync(temp,encodeCSV(collection,rows));fs.renameSync(temp,file);}
 validateReferences(db:Database){for(const cfg of db.configurations){if(cfg.systemId&&!db.systems.some(s=>s.id===cfg.systemId))throw Error(`${cfg.name}: equipment system not found`);for(const p of cfg.placements)if(!db.components.some(c=>c.id===p.componentId))throw Error(`${cfg.name}: component ${p.componentId} not found`);}for(const pc of db.pcs)if(pc.configurationId&&!db.configurations.some(c=>c.id===pc.configurationId))throw Error(`${pc.name}: configuration not found`);}
 replace(collection:Collection,rows:unknown[]){const parsed=rows.map(row=>schemas[collection].parse(row));if(new Set(parsed.map(r=>r.id)).size!==parsed.length)throw Error('Duplicate record IDs');const next={...this.db,[collection]:parsed};this.validateReferences(next);if(collection==='configurations')for(const config of next.configurations)if(config.status==='Approved'&&checkConfiguration(config,next).status==='Conflicts')throw Error(`${config.name}: resolve compatibility conflicts before approval`);this.persist(collection,parsed);this.db=next;}
}
