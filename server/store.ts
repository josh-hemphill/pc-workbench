import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {durableWrite,CommittedWriteError} from './persistence';
import path from 'node:path';
import {parse} from 'csv-parse/sync';
import {stringify} from 'csv-stringify/sync';
import {schemas, type Collection} from './schema';
import {seed} from './seed';
import type {Database} from '../shared/types';
import {checkConfiguration} from '../shared/compatibility';
export const collections:Collection[]=['components','systems','configurations','pcs','inventory'];
const fields:Record<Collection,string[]>={components:['id','name','category','manufacturer','specs','source','verified'],systems:['id','name','location','description','connections'],configurations:['id','name','description','systemId','status','updatedAt','placements','storage','notes','software','portMappings','revision','approvalSnapshot','approvalHistory'],pcs:['id','name','serial','location','configurationId','notes','buildSettings','lifecycle','software','commissioning','timeline','snapshot','snapshots'],inventory:['id','componentId','tracking','serial','assetTag','quantity','location','condition','notes','allocations','history','supplier','purchaseOrder','reorderLevel','repairReference','supplierReturnReference']};
const nested=new Set(['specs','connections','placements','storage','buildSettings','allocations','history','software','portMappings','approvalSnapshot','approvalHistory','commissioning','timeline','snapshot','snapshots']);
const maxCSVRecordSize=64*1024*1024;
function spreadsheetCell(value:unknown) {return typeof value==='string'&&/^[\s]*[=+@-]/.test(value)?`'${value}`:value;}
export function encodeCSV(collection:Collection,rows:unknown[],spreadsheet=false):string {return stringify(rows.map(row=>Object.fromEntries(Object.entries(row as object).map(([k,v])=>[k,spreadsheet?spreadsheetCell(nested.has(k)?JSON.stringify(v):typeof v==='boolean'?String(v):v):nested.has(k)?JSON.stringify(v):typeof v==='boolean'?String(v):v]))),{header:true,columns:fields[collection]});}
export function decodeCSV(collection:Collection,text:string):unknown[] {
 const rows=parse(text,{columns:true,bom:true,skip_empty_lines:true,max_record_size:maxCSVRecordSize}) as Record<string,string>[];
 if(rows.length>10000)throw Error('CSV limit is 10,000 records.');
 if(new Set(rows.map(r=>r.id)).size!==rows.length)throw Error('CSV contains duplicate record IDs.');
 return rows.map((row:Record<string,string>,i:number)=>{try{const item:Record<string,unknown>={...row};for(const k of Object.keys(item)){if(nested.has(k)){if(!row[k]&&k!=='buildSettings'){delete item[k];continue;}item[k]=k==='buildSettings'&&!row[k]?null:JSON.parse(row[k]);}if(['revision','lifecycle','reorderLevel'].includes(k)&&!row[k]){delete item[k];continue;}if(['revision','reorderLevel'].includes(k)){if(!/^\d+$/.test(row[k]))throw Error(`${k} must be a nonnegative whole number`);item[k]=Number(row[k]);}if(k==='quantity'){if(!/^\d+$/.test(row[k]))throw Error('quantity must be a nonnegative whole number');item[k]=Number(row[k]);}if(k==='verified'){if(!['true','false','1','0'].includes(row[k]))throw Error('verified must be true or false');item[k]=['true','1'].includes(row[k]);}}return schemas[collection].parse(item);}catch(e){throw Error(`CSV row ${i+2}: ${e instanceof Error?e.message:e}`);}});
}
export class WorkspaceRecoveryError extends Error {constructor(reason:string){super(`${reason} Stop and restart the server to recover the workspace before making more changes.`);}}
export class Store {
 db:Database;
 private snapshotTime=0;
 private recoveryReason='';
 get recoveryRequired(){return !!this.recoveryReason;}
 assertWritable(){if(this.recoveryReason)throw new WorkspaceRecoveryError(this.recoveryReason);}
 private requireRecovery(reason:string){this.recoveryReason=reason;return new WorkspaceRecoveryError(reason);}
 constructor(public dir:string){fs.mkdirSync(dir,{recursive:true});this.db=structuredClone(seed);const journal=path.join(dir,'.restore-journal.json');if(fs.existsSync(journal)){const recovered=this.validateBackup(JSON.parse(fs.readFileSync(journal,'utf8')));for(const collection of collections)this.persist(collection,recovered[collection]);fs.unlinkSync(journal);}for(const collection of collections){const filename=path.join(dir,`${collection}.csv`);if(fs.existsSync(filename))(this.db[collection] as unknown[])=decodeCSV(collection,fs.readFileSync(filename,'utf8'));else this.persist(collection,this.db[collection]);}this.validateReferences(this.db);}
 persist(collection:Collection,rows:unknown[]){if(rows.length>10000)throw Error('CSV limit is 10,000 records.');for(const row of rows)if(Buffer.byteLength(encodeCSV(collection,[row]))>maxCSVRecordSize)throw Error('A CSV record exceeds the 64 MiB limit; archive or split inventory history before continuing');durableWrite(path.join(this.dir,`${collection}.csv`),encodeCSV(collection,rows));}
 validateReferences(db:Database){for(const cfg of db.configurations){if(cfg.systemId&&!db.systems.some(s=>s.id===cfg.systemId))throw Error(`${cfg.name}: equipment system not found`);for(const p of cfg.placements)if(!db.components.some(c=>c.id===p.componentId))throw Error(`${cfg.name}: component ${p.componentId} not found`);}for(const pc of db.pcs){if(pc.configurationId&&!db.configurations.some(c=>c.id===pc.configurationId))throw Error(`${pc.name}: configuration not found`);if(pc.buildSettings?.systemId&&!db.systems.some(s=>s.id===pc.buildSettings!.systemId))throw Error(`${pc.name}: recorded equipment system not found`);}
  const serials=new Set<string>(),tags=new Set<string>(),allocations=new Set<string>(),movements=new Set<string>();
  for(const stock of db.inventory){if(!db.components.some(c=>c.id===stock.componentId))throw Error(`Stock ${stock.id}: component not found`);if(stock.tracking==='serialized'){const key=`${stock.componentId}:${stock.serial.trim().toLowerCase()}`;if(serials.has(key))throw Error('Duplicate serial number for this component type');serials.add(key);}if(stock.assetTag.trim()){const key=stock.assetTag.trim().toLowerCase();if(tags.has(key))throw Error('Duplicate inventory asset / lot tag');tags.add(key);}for(const a of stock.allocations){const pc=db.pcs.find(p=>p.id===a.pcId);if(!pc)throw Error(`Stock ${stock.id}: allocated PC not found; remove or release its components first`);if(pc.lifecycle==='Retired')throw Error(`Stock ${stock.id}: retired PC ${pc.name} cannot have current reservations or installations`);if(allocations.has(a.id))throw Error('Duplicate allocation ID across inventory records');allocations.add(a.id);}for(const e of stock.history){if(movements.has(e.id))throw Error('Duplicate movement ID across inventory records');movements.add(e.id);}}
 }
 replace(collection:Collection,rows:unknown[]){this.assertWritable();if(rows.length>10000)throw Error('CSV limit is 10,000 records.');const parsed=rows.map(row=>schemas[collection].parse(row));if(new Set(parsed.map(r=>r.id)).size!==parsed.length)throw Error('Duplicate record IDs');if(collection==='inventory')for(const stock of this.db.inventory){const replacement=parsed.find(r=>r.id===stock.id) as Database['inventory'][number]|undefined;if(!replacement&&(stock.history.length||stock.allocations.length))throw Error('Inventory with history cannot be deleted; retire the stock record instead');if(replacement&&(replacement.componentId!==stock.componentId||replacement.tracking!==stock.tracking))throw Error('Existing stock component identity and tracking mode cannot change; use whole-workspace restore for recovery.');}const next={...this.db,[collection]:parsed};this.validateReferences(next);if(collection==='configurations')for(const config of next.configurations)if(config.status==='Approved'&&checkConfiguration(config,next).status==='Conflicts')throw Error(`${config.name}: resolve compatibility conflicts before approval`);this.snapshot();try{this.persist(collection,parsed);}catch(error){if(error instanceof CommittedWriteError)throw this.requireRecovery('A file changed on disk but its durability could not be confirmed.');throw error;}this.db=next;}
 snapshot(){this.snapshotTime=Math.max(Date.now(),this.snapshotTime+1);const dir=path.join(this.dir,'backups');fs.mkdirSync(dir,{recursive:true});durableWrite(path.join(dir,`rolling-${this.snapshotTime}-${randomUUID()}.json`),JSON.stringify(this.db));const files=fs.readdirSync(dir).filter(name=>name.startsWith('rolling-')).sort();for(const name of files.slice(0,Math.max(0,files.length-10)))fs.unlinkSync(path.join(dir,name));}
 get revision(){return createHash('sha256').update(JSON.stringify(this.db)).digest('hex');}
 validateBackup(input:unknown):Database {
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Backup must contain a whole workspace object.');
  const object=input as Record<string,unknown>;
  if(Object.keys(object).some(k=>!collections.includes(k as Collection)))throw Error('Backup contains unexpected collections.');
  const parsed={} as Database;
  for(const collection of collections){if(!Array.isArray(object[collection]))throw Error(`Backup is missing ${collection}.`);const rows=object[collection] as unknown[];if(rows.length>10000)throw Error('CSV limit is 10,000 records.');(parsed[collection] as unknown[])=rows.map(row=>schemas[collection].parse(row));if(new Set(parsed[collection].map(row=>row.id)).size!==rows.length)throw Error(`Duplicate record IDs in ${collection}`);for(const row of parsed[collection])if(Buffer.byteLength(encodeCSV(collection,[row]))>maxCSVRecordSize)throw Error('Backup CSV record exceeds 64 MiB.');}
  this.validateReferences(parsed);
  return parsed;
 }
 restore(input:unknown){
  this.assertWritable();
  const next=this.validateBackup(input);
  const backupDir=path.join(this.dir,'backups');fs.mkdirSync(backupDir,{recursive:true});
  const backupFile=path.join(backupDir,`before-restore-${Date.now()}-${randomUUID()}.json`);
  durableWrite(backupFile,JSON.stringify(this.db,null,2));
  // A flushed journal completes an interrupted multi-file restore on next startup.
  const journal=path.join(this.dir,'.restore-journal.json');try{durableWrite(journal,JSON.stringify(next));}catch(error){if(error instanceof CommittedWriteError)throw this.requireRecovery('The restore journal changed but its durability could not be confirmed.');throw error;}
  try{for(const collection of collections)this.persist(collection,next[collection]);}catch(error){try{durableWrite(journal,JSON.stringify(this.db));for(const collection of collections)this.persist(collection,this.db[collection]);fs.unlinkSync(journal);}catch{throw this.requireRecovery('Restore failed and rollback could not finish. The recovery journal must be processed before further edits.');}throw error;}
  this.db=next;try{fs.unlinkSync(journal);}catch{throw this.requireRecovery('Restore committed but its recovery journal could not be removed.');}
  return backupFile;
 }

}
export function encodeMovements(db:Database,spreadsheet=false){return stringify(db.inventory.flatMap(stock=>stock.history.map(event=>({stockId:stock.id,componentId:stock.componentId,componentName:db.components.find(c=>c.id===stock.componentId)?.name||'',serial:stock.serial,assetTag:stock.assetTag,...event}))).map(row=>spreadsheet?Object.fromEntries(Object.entries(row).map(([k,v])=>[k,spreadsheetCell(v)])):row),{header:true,columns:['id','at','action','stockId','componentId','componentName','serial','assetTag','quantity','pcId','pcName','allocationId','sourceAllocationId','targetStockId','sourceStockId','actor','notes']});}
