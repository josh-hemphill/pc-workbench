import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {durableWrite} from './persistence';
import path from 'node:path';
import {parse} from 'csv-parse/sync';
import {stringify} from 'csv-stringify/sync';
import {schemas, type Collection} from './schema';
import {seed} from './seed';
import type {Database} from '../shared/types';
import {checkConfiguration} from '../shared/compatibility';
export const collections:Collection[]=['components','systems','configurations','pcs','inventory','requirementsSets','installationLocations'];
const fields:Record<Collection,string[]>={requirementsSets:['id','name','description','versions'],installationLocations:['id','name','kind','parentId','requirementSetId','requirementRevision','targetConfigurationId','notes','requirementSnapshot'],components:['id','name','category','manufacturer','specs','source','verified'],systems:['id','name','location','description','connections'],configurations:['id','name','description','systemId','status','updatedAt','placements','storage','notes','software','portMappings','revision','approvalSnapshot','approvalHistory','requirementSetId','requirementRevision','requirementSnapshot'],pcs:['id','name','serial','location','configurationId','notes','buildSettings','lifecycle','software','commissioning','timeline','snapshot','snapshots','installationLocationId'],inventory:['id','componentId','tracking','serial','assetTag','quantity','location','condition','notes','allocations','history','supplier','purchaseOrder','reorderLevel','repairReference','supplierReturnReference']};
const nested=new Set(['specs','connections','placements','storage','buildSettings','allocations','history','software','portMappings','approvalSnapshot','approvalHistory','commissioning','timeline','snapshot','snapshots','versions','requirementSnapshot']);
const maxCSVRecordSize=64*1024*1024;
function spreadsheetCell(value:unknown) {return typeof value==='string'&&/^[\s]*[=+@-]/.test(value)?`'${value}`:value;}
export function encodeCSV(collection:Collection,rows:unknown[],spreadsheet=false):string {return stringify(rows.map(row=>Object.fromEntries(Object.entries(row as object).map(([k,v])=>[k,spreadsheet?spreadsheetCell(nested.has(k)?JSON.stringify(v):typeof v==='boolean'?String(v):v):nested.has(k)?JSON.stringify(v):typeof v==='boolean'?String(v):v]))),{header:true,columns:fields[collection]});}
export function decodeCSV(collection:Collection,text:string):unknown[] {
 const rows=parse(text,{columns:true,bom:true,skip_empty_lines:true,max_record_size:maxCSVRecordSize}) as Record<string,string>[];
 if(rows.length>10000)throw Error('CSV limit is 10,000 records.');
 if(new Set(rows.map(r=>r.id)).size!==rows.length)throw Error('CSV contains duplicate record IDs.');
 return rows.map((row:Record<string,string>,i:number)=>{try{const item:Record<string,unknown>={...row};for(const k of Object.keys(item)){if(nested.has(k)){if(!row[k]&&k!=='buildSettings'){delete item[k];continue;}item[k]=k==='buildSettings'&&!row[k]?null:JSON.parse(row[k]);}if(k==='requirementSetId'&&!row[k]&&collection!=='installationLocations'){delete item[k];continue;}if(['revision','lifecycle','reorderLevel','requirementRevision','installationLocationId'].includes(k)&&!row[k]){delete item[k];continue;}if(['revision','reorderLevel','requirementRevision'].includes(k)){if(!/^\d+$/.test(row[k]))throw Error(`${k} must be a nonnegative whole number`);item[k]=Number(row[k]);}if(k==='quantity'){if(!/^\d+$/.test(row[k]))throw Error('quantity must be a nonnegative whole number');item[k]=Number(row[k]);}if(k==='verified'){if(!['true','false','1','0'].includes(row[k]))throw Error('verified must be true or false');item[k]=['true','1'].includes(row[k]);}}return schemas[collection].parse(item);}catch(e){throw Error(`CSV row ${i+2}: ${e instanceof Error?e.message:e}`);}});
}
export class WorkspaceRecoveryError extends Error {constructor(reason:string){super(`${reason} Stop and restart the server to recover the workspace before making more changes.`);}}
export class Store {
 db:Database;
 private snapshotTime=0;
 private recoveryReason='';
 get recoveryRequired(){return !!this.recoveryReason;}
 assertWritable(){if(this.closed)throw new WorkspaceRecoveryError('The SQLite workspace is closed.');if(this.recoveryReason)throw new WorkspaceRecoveryError(this.recoveryReason);}
 private requireRecovery(reason:string){this.recoveryReason=reason;return new WorkspaceRecoveryError(reason);}
 private sqlite:DatabaseSync;
 private storedRevision='';
 private closed=false;
 constructor(public dir:string){
  if(Number(process.versions.node.split('.')[0])<24)throw Error('Native SQLite requires Node.js 24 or later.');
  fs.mkdirSync(dir,{recursive:true});this.db=structuredClone(seed);
  this.sqlite=new DatabaseSync(path.join(dir,'workbench.sqlite'));
  try {
   this.sqlite.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS workspace_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS records(collection TEXT NOT NULL,id TEXT NOT NULL,ordinal INTEGER NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload)),PRIMARY KEY(collection,id));
    CREATE TABLE IF NOT EXISTS record_references(source_collection TEXT NOT NULL,source_id TEXT NOT NULL,field TEXT NOT NULL,target_collection TEXT NOT NULL,target_id TEXT NOT NULL,
     FOREIGN KEY(source_collection,source_id) REFERENCES records(collection,id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
     FOREIGN KEY(target_collection,target_id) REFERENCES records(collection,id) DEFERRABLE INITIALLY DEFERRED);`);
   const initialized=this.sqlite.prepare("SELECT value FROM workspace_meta WHERE key='initialized'").get();
   if(!initialized){
    let initial:unknown=structuredClone(seed);const journal=path.join(dir,'.restore-journal.json');
    if(fs.existsSync(journal))initial=JSON.parse(fs.readFileSync(journal,'utf8'));
    else for(const collection of collections){const filename=path.join(dir,`${collection}.csv`);if(fs.existsSync(filename))(initial as Record<string,unknown>)[collection]=decodeCSV(collection,fs.readFileSync(filename,'utf8'));}
    const validated=this.validateBackup(initial);this.commit(validated,true);this.db=validated;
   }else{
    const loaded={} as Database;for(const collection of collections)(loaded[collection] as unknown[])=this.sqlite.prepare('SELECT payload FROM records WHERE collection=? ORDER BY ordinal').all(collection).map(row=>schemas[collection].parse(JSON.parse(row.payload as string)));
    this.validateReferences(loaded);this.db=loaded;this.storedRevision=(this.sqlite.prepare("SELECT value FROM workspace_meta WHERE key='revision'").get()?.value as string)||this.revision;
   }
  }catch(error){this.sqlite.close();throw error;}
 }
 close(){if(this.closed)return;this.sqlite.close();this.closed=true;}
 /** Called only inside a transaction; tests can inject failures between collection writes. */
 persist(collection:Collection,rows:unknown[]){
  for(const row of rows)if(Buffer.byteLength(encodeCSV(collection,[row]))>maxCSVRecordSize)throw Error('A CSV record exceeds the 64 MiB limit; archive or split history before continuing.');
  if(!this.sqlite.isTransaction)throw Error('Collection writes require a SQLite transaction.');
  this.sqlite.prepare('DELETE FROM records WHERE collection=?').run(collection);
  const insert=this.sqlite.prepare('INSERT INTO records(collection,id,ordinal,payload) VALUES(?,?,?,?)');
  rows.forEach((row,index)=>insert.run(collection,(row as {id:string}).id,index,JSON.stringify(row)));
 }
 private commit(next:Database,initial=false){
  this.assertWritable();
  this.sqlite.exec('BEGIN IMMEDIATE');
  try{
   const revision=this.sqlite.prepare("SELECT value FROM workspace_meta WHERE key='revision'").get()?.value;
   if(!initial&&revision!==this.storedRevision)throw Error('Workspace changed in another connection. Reload before saving.');
   this.sqlite.exec('DELETE FROM record_references');
   for(const collection of collections)this.persist(collection,next[collection]);
   this.writeReferences(next);
   const nextRevision=createHash('sha256').update(JSON.stringify(next)).digest('hex');
   this.sqlite.prepare('INSERT OR REPLACE INTO workspace_meta(key,value) VALUES(?,?)').run('revision',nextRevision);
   this.sqlite.prepare('INSERT OR REPLACE INTO workspace_meta(key,value) VALUES(?,?)').run('initialized','1');
   this.sqlite.exec('COMMIT');this.storedRevision=nextRevision;
  }catch(error){try{this.sqlite.exec('ROLLBACK');}catch{throw this.requireRecovery('SQLite rollback could not be confirmed.');}throw error;}
 }
 private writeReferences(db:Database){
  const insert=this.sqlite.prepare('INSERT INTO record_references(source_collection,source_id,field,target_collection,target_id) VALUES(?,?,?,?,?)');
  const link=(collection:Collection,id:string,field:string,target:Collection,targetId?:string)=>{if(targetId)insert.run(collection,id,field,target,targetId);};
  for(const set of db.requirementsSets)for(const version of set.versions)for(const required of version.constraints?.requiredComponents||[])link('requirementsSets',set.id,`required:${version.revision}:${required.componentId}`,'components',required.componentId);
  for(const location of db.installationLocations){link('installationLocations',location.id,'parentId','installationLocations',location.parentId);link('installationLocations',location.id,'requirementSetId','requirementsSets',location.requirementSetId);link('installationLocations',location.id,'targetConfigurationId','configurations',location.targetConfigurationId);}
  for(const config of db.configurations){link('configurations',config.id,'requirementSetId','requirementsSets',config.requirementSetId);link('configurations',config.id,'systemId','systems',config.systemId);for(const placement of config.placements)link('configurations',config.id,`placement:${placement.id}`,'components',placement.componentId);}
  for(const pc of db.pcs){link('pcs',pc.id,'installationLocationId','installationLocations',pc.installationLocationId);link('pcs',pc.id,'buildSettings.requirementSetId','requirementsSets',pc.buildSettings?.requirementSetId);link('pcs',pc.id,'configurationId','configurations',pc.configurationId);link('pcs',pc.id,'buildSettings.systemId','systems',pc.buildSettings?.systemId);}
  for(const stock of db.inventory){link('inventory',stock.id,'componentId','components',stock.componentId);for(const allocation of stock.allocations)link('inventory',stock.id,`allocation:${allocation.id}`,'pcs',allocation.pcId);}
 }
 validateReferences(db:Database){
  for(const set of db.requirementsSets)if(set.versions.some((version,index)=>index>0&&version.revision<=set.versions[index-1].revision))throw Error(`${set.name}: requirements revisions must increase`);
  const binding=(record:{requirementSetId?:string;requirementRevision?:number;requirementSnapshot?:Database['requirementsSets'][number]['versions'][number]},name:string)=>{if(!record.requirementSetId){if(record.requirementRevision)throw Error(`${name}: select a requirements set for the revision`);return;}const set=db.requirementsSets.find(set=>set.id===record.requirementSetId);const version=set?.versions.find(v=>v.revision===record.requirementRevision);if(!version)throw Error(`${name}: requirements set or revision not found`);if(record.requirementSnapshot&&JSON.stringify(record.requirementSnapshot)!==JSON.stringify(version))throw Error(`${name}: requirements snapshot does not match the published revision`);};
  for(const set of db.requirementsSets)for(const version of set.versions)for(const required of version.constraints?.requiredComponents||[])if(!db.components.some(c=>c.id===required.componentId))throw Error(`${set.name}: required component not found`);
  for(const location of db.installationLocations){binding(location,location.name);if(location.targetConfigurationId&&!db.configurations.some(c=>c.id===location.targetConfigurationId))throw Error(`${location.name}: target configuration not found`);const visited=new Set<string>([location.id]);let parent=location.parentId;while(parent){if(visited.has(parent))throw Error(`${location.name}: installation location hierarchy contains a cycle`);visited.add(parent);const found=db.installationLocations.find(l=>l.id===parent);if(!found)throw Error(`${location.name}: parent installation location not found`);parent=found.parentId;}}
  for(const config of db.configurations)binding(config,config.name);
  for(const pc of db.pcs){if(pc.buildSettings)binding(pc.buildSettings,pc.name);if(pc.installationLocationId){const location=db.installationLocations.find(l=>l.id===pc.installationLocationId);if(!location)throw Error(`${pc.name}: installation location not found`);if(!['Bench','System'].includes(location.kind))throw Error(`${pc.name}: PCs can only be installed at a Bench or System location`);}}
 for(const cfg of db.configurations){if(cfg.systemId&&!db.systems.some(s=>s.id===cfg.systemId))throw Error(`${cfg.name}: equipment system not found`);for(const p of cfg.placements)if(!db.components.some(c=>c.id===p.componentId))throw Error(`${cfg.name}: component ${p.componentId} not found`);}for(const pc of db.pcs){if(pc.configurationId&&!db.configurations.some(c=>c.id===pc.configurationId))throw Error(`${pc.name}: configuration not found`);if(pc.buildSettings?.systemId&&!db.systems.some(s=>s.id===pc.buildSettings!.systemId))throw Error(`${pc.name}: recorded equipment system not found`);}
  const serials=new Set<string>(),tags=new Set<string>(),allocations=new Set<string>(),movements=new Set<string>();
  for(const stock of db.inventory){if(!db.components.some(c=>c.id===stock.componentId))throw Error(`Stock ${stock.id}: component not found`);if(stock.tracking==='serialized'){const key=`${stock.componentId}:${stock.serial.trim().toLowerCase()}`;if(serials.has(key))throw Error('Duplicate serial number for this component type');serials.add(key);}if(stock.assetTag.trim()){const key=stock.assetTag.trim().toLowerCase();if(tags.has(key))throw Error('Duplicate inventory asset / lot tag');tags.add(key);}for(const a of stock.allocations){const pc=db.pcs.find(p=>p.id===a.pcId);if(!pc)throw Error(`Stock ${stock.id}: allocated PC not found; remove or release its components first`);if(pc.lifecycle==='Retired')throw Error(`Stock ${stock.id}: retired PC ${pc.name} cannot have current reservations or installations`);if(allocations.has(a.id))throw Error('Duplicate allocation ID across inventory records');allocations.add(a.id);}for(const e of stock.history){if(movements.has(e.id))throw Error('Duplicate movement ID across inventory records');movements.add(e.id);}}
 }
 replace(collection:Collection,rows:unknown[]){this.assertWritable();if(rows.length>10000)throw Error('CSV limit is 10,000 records.');const parsed=rows.map(row=>schemas[collection].parse(row));if(new Set(parsed.map(r=>r.id)).size!==parsed.length)throw Error('Duplicate record IDs');if(collection==='inventory')for(const stock of this.db.inventory){const replacement=parsed.find(r=>r.id===stock.id) as Database['inventory'][number]|undefined;if(!replacement&&(stock.history.length||stock.allocations.length))throw Error('Inventory with history cannot be deleted; retire the stock record instead');if(replacement&&(replacement.componentId!==stock.componentId||replacement.tracking!==stock.tracking))throw Error('Existing stock component identity and tracking mode cannot change; use whole-workspace restore for recovery.');}const next={...this.db,[collection]:parsed};this.validateReferences(next);if(collection==='configurations')for(const config of next.configurations)if(config.status==='Approved'&&checkConfiguration(config,next).status==='Conflicts')throw Error(`${config.name}: resolve compatibility conflicts before approval`);if(collection==='requirementsSets')for(const existing of this.db.requirementsSets){const updated=next.requirementsSets.find(set=>set.id===existing.id);if(!updated&&existing.versions.length)throw Error('Published requirement revisions cannot be deleted.');if(updated&&JSON.stringify(updated.versions.slice(0,existing.versions.length))!==JSON.stringify(existing.versions))throw Error('Published requirement revisions are immutable; append a new revision.');}this.snapshot();this.commit(next);this.db=next;}
 snapshot(){this.snapshotTime=Math.max(Date.now(),this.snapshotTime+1);const dir=path.join(this.dir,'backups');fs.mkdirSync(dir,{recursive:true});durableWrite(path.join(dir,`rolling-${this.snapshotTime}-${randomUUID()}.json`),JSON.stringify(this.db));const files=fs.readdirSync(dir).filter(name=>name.startsWith('rolling-')).sort();for(const name of files.slice(0,Math.max(0,files.length-10)))fs.unlinkSync(path.join(dir,name));}
 get revision(){return createHash('sha256').update(JSON.stringify(this.db)).digest('hex');}
 validateBackup(input:unknown):Database {
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Backup must contain a whole workspace object.');
  const object={...(input as Record<string,unknown>)};
  if(Object.keys(object).some(k=>!collections.includes(k as Collection)))throw Error('Backup contains unexpected collections.');
  const parsed={} as Database;
  for(const collection of collections){if(['requirementsSets','installationLocations'].includes(collection)&&object[collection]===undefined)object[collection]=[];if(!Array.isArray(object[collection]))throw Error(`Backup is missing ${collection}.`);const rows=object[collection] as unknown[];if(rows.length>10000)throw Error('CSV limit is 10,000 records.');(parsed[collection] as unknown[])=rows.map(row=>schemas[collection].parse(row));if(new Set(parsed[collection].map(row=>row.id)).size!==rows.length)throw Error(`Duplicate record IDs in ${collection}`);for(const row of parsed[collection])if(Buffer.byteLength(encodeCSV(collection,[row]))>maxCSVRecordSize)throw Error('Backup CSV record exceeds 64 MiB.');}
  this.validateReferences(parsed);
  return parsed;
 }
 restore(input:unknown){
  this.assertWritable();
  const next=this.validateBackup(input);
  const backupDir=path.join(this.dir,'backups');fs.mkdirSync(backupDir,{recursive:true});
  const backupFile=path.join(backupDir,`before-restore-${Date.now()}-${randomUUID()}.json`);
  durableWrite(backupFile,JSON.stringify(this.db,null,2));
  this.commit(next);this.db=next;
  return backupFile;
 }

}
export function encodeMovements(db:Database,spreadsheet=false){return stringify(db.inventory.flatMap(stock=>stock.history.map(event=>({stockId:stock.id,componentId:stock.componentId,componentName:db.components.find(c=>c.id===stock.componentId)?.name||'',serial:stock.serial,assetTag:stock.assetTag,...event}))).map(row=>spreadsheet?Object.fromEntries(Object.entries(row).map(([k,v])=>[k,spreadsheetCell(v)])):row),{header:true,columns:['id','at','action','stockId','componentId','componentName','serial','assetTag','quantity','pcId','pcName','allocationId','sourceAllocationId','targetStockId','sourceStockId','actor','notes']});}
