import {componentFieldPaths,applyComponentFieldEdits,sharedComponentPaths,componentFieldValue,componentFieldLabel,sameValue} from '../shared/component-bulk.ts';
import {sataConnectorKinds,ensureConnectors,describeConnectors} from '../shared/bulk-connectors.ts';
import {componentDeletionBlockers} from '../shared/component-usage.ts';
import {checkConfiguration} from '../shared/compatibility.ts';
import {saveConfigurationRecord} from './configuration-record.ts';
import {saveStockRecord} from './inventory.ts';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Database,InstallationLocation,InventoryPC} from '../shared/types.ts';
import {locationKinds} from '../shared/types.ts';
import {locationPath,installationLocationIds} from '../shared/installations.ts';
import type {BulkRequest,BulkPreviewRow,NotesEdit} from '../shared/bulk-records.ts';
import {prepareInstallationRecord} from './installation-requirements.ts';
import {savePCRecord} from './pc-lifecycle.ts';
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),reference=z.union([id,z.literal('')]);
const ids=z.array(id).min(1).max(500).refine(v=>new Set(v).size===v.length,'Select unique record IDs.');
const notes=z.object({mode:z.enum(['replace','append']),value:z.string().max(10000)}).strict();
const locationPatch=z.object({kind:z.enum(locationKinds).optional(),parentId:reference.optional(),targetConfigurationId:reference.optional(),requirements:z.object({setId:reference,revision:z.number().int().min(0).max(1000000)}).strict().optional(),notes:notes.optional()}).strict().refine(p=>Object.keys(p).length>0,'Choose at least one field to edit.');
const pcPatch=z.object({installationLocationId:reference.optional(),lifecycle:z.enum(['Planning','Building','Maintenance','Parts only','Retired']).optional(),notes:notes.optional()}).strict().refine(p=>Object.keys(p).length>0,'Choose at least one field to edit.');
const nonempty=(p:object)=>Object.keys(p).length>0;
const text=z.string().max(10000);
export const bulkSchema=z.union([
 z.object({collection:z.literal('components'),action:z.literal('edit'),ids,patch:z.object({manufacturer:text.optional(),source:text.optional(),verified:z.boolean().optional(),connectors:z.object({kind:z.enum(sataConnectorKinds),minimum:z.number().int().min(1).max(1000)}).strict().optional(),fields:z.array(z.object({path:z.enum(componentFieldPaths as [string,...string[]]),mode:z.enum(['set','fill','merge','clear']),value:z.unknown().optional()}).strict()).min(1).max(componentFieldPaths.length).refine(fields=>new Set(fields.map(field=>field.path)).size===fields.length,'Choose unique fields.').optional()}).strict().refine(nonempty)}).strict(),
 z.object({collection:z.literal('inventory'),action:z.literal('edit'),ids,patch:z.object({location:text.optional(),condition:z.enum(['Serviceable','Quarantined','Repair','Retired']).optional(),supplier:text.optional(),reorderLevel:z.number().int().min(0).max(1000000).optional(),notes:notes.optional()}).strict().refine(nonempty)}).strict(),
 z.object({collection:z.literal('requirementsSets'),action:z.literal('edit'),ids,patch:z.object({description:text.optional()}).strict().refine(nonempty)}).strict(),
 z.object({collection:z.literal('configurations'),action:z.literal('edit'),ids,patch:z.object({description:text.optional(),notes:notes.optional()}).strict().refine(nonempty)}).strict(),
 z.object({collection:z.literal('installationLocations'),action:z.literal('edit'),ids,patch:locationPatch}).strict(),
 z.object({collection:z.literal('pcs'),action:z.literal('edit'),ids,patch:pcPatch}).strict(),
 z.object({collection:z.enum(['installationLocations','pcs','components','requirementsSets','configurations']),action:z.literal('delete'),ids}).strict(),
]);
export const bulkToken=(request:BulkRequest,revision:string)=>createHash('sha256').update(JSON.stringify({request,revision})).digest('hex');
const editNotes=(before:string,edit:NotesEdit)=>edit.mode==='append'?[before,edit.value].filter(Boolean).join('\n'):edit.value;
/** Build candidates through the same canonical binding and lifecycle rules as individual editors. */
export function buildBulkCandidate(input:BulkRequest,db:Database){
 const request=bulkSchema.parse(input),selected=new Set(request.ids);
 if(request.ids.some(id=>!db[request.collection].some(r=>r.id===id)))throw Error('A selected record no longer exists. Reload and select again.');
 const next:Database={...db};
 if(request.collection==='components'&&request.action==='edit'&&request.patch.fields){
  if(Object.keys(request.patch).length!==1)throw Error('Use one component edit format per request.');
  const allowed=sharedComponentPaths(db.components.filter(c=>selected.has(c.id)));
  if(request.patch.fields.some(edit=>!allowed.includes(edit.path)))throw Error('Choose fields shared by all selected component categories and roles.');
 }
 if(request.collection==='installationLocations'){
  if(request.action==='delete'){
   const children=db.installationLocations.filter(l=>!selected.has(l.id)&&selected.has(l.parentId)),pcs=db.pcs.filter(p=>selected.has(p.installationLocationId||''));
   if(children.length||pcs.length)throw Error(`Cannot delete: ${children.length} unselected child locations and ${pcs.length} assigned PCs depend on this selection. Children: ${children.slice(0,5).map(l=>locationPath(l.id,db)).join(", ")||"None"}. PCs: ${pcs.slice(0,5).map(p=>p.name).join(", ")||"None"}. Select children explicitly and move/unassign PCs first.`);
   next.installationLocations=db.installationLocations.filter(l=>!selected.has(l.id));
  }else next.installationLocations=db.installationLocations.map(l=>{
   if(!selected.has(l.id))return l;const {requirements,notes,...patch}=request.patch;const updated={...l,...patch,...(notes?{notes:editNotes(l.notes,notes)}:{}),...(requirements?{requirementSetId:requirements.setId,requirementRevision:requirements.revision}: {})};
   return prepareInstallationRecord('installationLocations',updated,db) as InstallationLocation;
  });
 }else if(request.collection==='pcs'){
  if(request.action==='delete'){
   const allocations=db.inventory.flatMap(s=>s.allocations).filter(a=>selected.has(a.pcId));
   if(allocations.length)throw Error(`Cannot delete: ${allocations.length} reservations or installed allocations still reference selected PCs. PCs: ${[...new Set(allocations.map(a=>db.pcs.find(p=>p.id===a.pcId)?.name||a.pcId))].slice(0,5).join(", ")}. Remove installed parts and release reservations first.`);
   next.pcs=db.pcs.filter(p=>!selected.has(p.id));
  }else next.pcs=db.pcs.map(pc=>{
   if(!selected.has(pc.id))return pc;const {notes,...patch}=request.patch;
   return savePCRecord({...pc,...patch,...(notes?{notes:editNotes(pc.notes,notes)}:{})},db);
  });
 }
 if(!['installationLocations','pcs'].includes(request.collection)){
  if(request.action==='delete'){
   if(request.collection==='components'){for(const id of request.ids){const blockers=componentDeletionBlockers(id,db);if(blockers.length)throw Error(`Cannot delete ${db.components.find(c=>c.id===id)!.name}: still referenced by ${blockers.map(u=>`${u.kind} ${u.name} (${u.id})`).join(', ')}.`);}next.inventory=db.inventory.filter(stock=>!selected.has(stock.componentId)||stock.quantity!==0||stock.allocations.length>0);}
   if(request.collection==='requirementsSets'&&db.requirementsSets.some(s=>selected.has(s.id)&&s.versions.length))throw Error('Published requirement revisions cannot be deleted. Retain their history and edit metadata instead.');
   (next[request.collection] as {id:string}[])=db[request.collection].filter(r=>!selected.has(r.id));
  }else{
   const records=db[request.collection].map(record=>{
    if(!selected.has(record.id))return record;
    const patch=request.patch as Record<string,unknown>,notes=patch.notes as NotesEdit|undefined;
    const {connectors,fields,...metadata}=patch;
    const updated={...record,...metadata,...(notes?{notes:editNotes('notes' in record?String(record.notes):'',notes)}:{})};
    if(request.collection==='components'&&request.patch.fields)return applyComponentFieldEdits(record as Database['components'][number],request.patch.fields,db);
    if(request.collection==='components'&&request.patch.connectors)return ensureConnectors(updated as Database['components'][number],request.patch.connectors);
    if(request.collection==='inventory')return saveStockRecord(updated,db);
    if(request.collection==='configurations')return saveConfigurationRecord({...updated,updatedAt:new Date().toISOString()} as Database['configurations'][number],db);
    return prepareInstallationRecord(request.collection,updated,db);
   });
   (next[request.collection] as unknown[])=records;
  }
 }
 if(request.collection==='configurations')for(const config of next.configurations)if(config.status==='Approved'&&checkConfiguration(config,next).status==='Conflicts')throw Error(`${config.name}: resolve compatibility conflicts before approval`);
 const rows:BulkPreviewRow[]=request.ids.map(id=>{
  if(request.collection==='installationLocations'){
   const before=db.installationLocations.find(l=>l.id===id)!,after=next.installationLocations.find(l=>l.id===id);
   const describe=(l:InstallationLocation,d:Database)=>`${locationPath(l.id,d)} | ${l.kind} | target: ${d.configurations.find(c=>c.id===l.targetConfigurationId)?.name||'None'} | requirements: ${d.requirementsSets.find(s=>s.id===l.requirementSetId)?.name||'None'} r${l.requirementRevision} | notes: ${l.notes||'None'}`;
   return {id,name:before.name,before:describe(before,db),after:after?describe(after,next):'Delete location record'};
  }
  if(request.collection!=='pcs'){
   const before=db[request.collection].find(r=>r.id===id)!,after=next[request.collection].find(r=>r.id===id);
   const describe=(r:typeof before)=>{
    if('componentId' in r)return `${r.serial||r.assetTag||r.id} | ${r.quantity} units | stock location: ${r.location||'None'} | ${r.condition} | supplier: ${r.supplier||'None'} | reorder level: ${r.reorderLevel||0} | notes: ${r.notes||'None'}`;
    if('manufacturer' in r)return `${r.name} | manufacturer: ${r.manufacturer||'None'} | source: ${r.source||'None'} | ${r.verified?'Verified':'Needs verification'}${request.collection==='components'&&request.action==='edit'&&request.patch.connectors?' | '+describeConnectors(r,request.patch.connectors.kind):''}${request.collection==='components'&&request.action==='edit'&&request.patch.fields?' | '+request.patch.fields.map(edit=>`${componentFieldLabel(edit.path,r)}: ${JSON.stringify(componentFieldValue(r,edit.path))??'Unknown'}`).join(' | '):''}`;
    if('versions' in r)return `${r.name} | description: ${r.description||'None'} | ${r.versions.length} published revisions (unchanged)`;
    return `${r.name} | ${r.status} | revision ${r.revision||0} | description: ${r.description||'None'} | notes: ${r.notes||'None'} | ${r.approvalHistory?.length||0} approved revisions retained`;
   };
   const changes=request.collection==='components'&&request.action==='edit'&&request.patch.fields&&after&&'specs' in before&&'specs' in after?[...new Set([...request.patch.fields.map(edit=>edit.path),...componentFieldPaths.filter(path=>!sameValue(componentFieldValue(before,path),componentFieldValue(after,path)))])].map(path=>({path,label:componentFieldLabel(path,before),before:componentFieldValue(before,path),after:componentFieldValue(after,path),changed:!sameValue(componentFieldValue(before,path),componentFieldValue(after,path))})):undefined;
   return {id,changes,name:'name' in before?String(before.name):'componentId' in before?`${db.components.find(c=>c.id===before.componentId)?.name||before.componentId} · ${before.serial||before.assetTag||id}`:id,before:describe(before),after:after?describe(after):'Delete record'};
  }
  const before=db.pcs.find(p=>p.id===id)!,after=next.pcs.find(p=>p.id===id);
  const describe=(pc:InventoryPC)=>`${pc.name} | ${locationPath(pc.installationLocationId||'',db)||'Unassigned'} | ${pc.lifecycle||'Planning'} | notes: ${pc.notes||'None'}`;
  return {id,name:before.name,before:describe(before),after:after?describe(after):'Delete PC record, including its timeline and commissioning snapshots'};
 });
 const affectedIds=new Set<string>();if(request.collection==='installationLocations')for(const id of request.ids)for(const child of installationLocationIds(id,db))affectedIds.add(child);
 return {next,rows,affectedPCs:request.collection==='pcs'?request.ids.length:db.pcs.filter(p=>affectedIds.has(p.installationLocationId||'')).length,pathChanges:request.collection==='installationLocations'?db.installationLocations.filter(l=>!selected.has(l.id)&&next.installationLocations.some(n=>n.id===l.id)&&locationPath(l.id,db)!==locationPath(l.id,next)).length:0,historicalPCs:request.collection==='pcs'&&request.action==='delete'?db.pcs.filter(p=>selected.has(p.id)&&(p.timeline?.length||p.snapshot||p.snapshots?.length||p.commissioning)).length:0};
}
