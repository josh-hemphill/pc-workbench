import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Database,InstallationLocation,InventoryPC} from '../shared/types';
import {locationKinds} from '../shared/types';
import {locationPath,installationLocationIds} from '../shared/installations';
import type {BulkRequest,BulkPreviewRow,NotesEdit} from '../shared/bulk-records';
import {prepareInstallationRecord} from './installation-requirements';
import {savePCRecord} from './pc-lifecycle';
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),reference=z.union([id,z.literal('')]);
const ids=z.array(id).min(1).max(500).refine(v=>new Set(v).size===v.length,'Select unique record IDs.');
const notes=z.object({mode:z.enum(['replace','append']),value:z.string().max(10000)}).strict();
const locationPatch=z.object({kind:z.enum(locationKinds).optional(),parentId:reference.optional(),targetConfigurationId:reference.optional(),requirements:z.object({setId:reference,revision:z.number().int().min(0).max(1000000)}).strict().optional(),notes:notes.optional()}).strict().refine(p=>Object.keys(p).length>0,'Choose at least one field to edit.');
const pcPatch=z.object({installationLocationId:reference.optional(),lifecycle:z.enum(['Planning','Building','Maintenance','Parts only','Retired']).optional(),notes:notes.optional()}).strict().refine(p=>Object.keys(p).length>0,'Choose at least one field to edit.');
export const bulkSchema=z.union([
 z.object({collection:z.literal('installationLocations'),action:z.literal('edit'),ids,patch:locationPatch}).strict(),
 z.object({collection:z.literal('pcs'),action:z.literal('edit'),ids,patch:pcPatch}).strict(),
 z.object({collection:z.enum(['installationLocations','pcs']),action:z.literal('delete'),ids}).strict(),
]);
export const bulkToken=(request:BulkRequest,revision:string)=>createHash('sha256').update(JSON.stringify({request,revision})).digest('hex');
const editNotes=(before:string,edit:NotesEdit)=>edit.mode==='append'?[before,edit.value].filter(Boolean).join('\n'):edit.value;
/** Build candidates through the same canonical binding and lifecycle rules as individual editors. */
export function buildBulkCandidate(input:BulkRequest,db:Database){
 const request=bulkSchema.parse(input),selected=new Set(request.ids);
 if(request.ids.some(id=>!db[request.collection].some(r=>r.id===id)))throw Error('A selected record no longer exists. Reload and select again.');
 const next:Database={...db};
 if(request.collection==='installationLocations'){
  if(request.action==='delete'){
   const children=db.installationLocations.filter(l=>!selected.has(l.id)&&selected.has(l.parentId)),pcs=db.pcs.filter(p=>selected.has(p.installationLocationId||''));
   if(children.length||pcs.length)throw Error(`Cannot delete: ${children.length} unselected child locations and ${pcs.length} assigned PCs depend on this selection. Children: ${children.slice(0,5).map(l=>locationPath(l.id,db)).join(", ")||"None"}. PCs: ${pcs.slice(0,5).map(p=>p.name).join(", ")||"None"}. Select children explicitly and move/unassign PCs first.`);
   next.installationLocations=db.installationLocations.filter(l=>!selected.has(l.id));
  }else next.installationLocations=db.installationLocations.map(l=>{
   if(!selected.has(l.id))return l;const {requirements,notes,...patch}=request.patch;const updated={...l,...patch,...(notes?{notes:editNotes(l.notes,notes)}:{}),...(requirements?{requirementSetId:requirements.setId,requirementRevision:requirements.revision}: {})};
   return prepareInstallationRecord('installationLocations',updated,db) as InstallationLocation;
  });
 }else{
  if(request.action==='delete'){
   const allocations=db.inventory.flatMap(s=>s.allocations).filter(a=>selected.has(a.pcId));
   if(allocations.length)throw Error(`Cannot delete: ${allocations.length} reservations or installed allocations still reference selected PCs. PCs: ${[...new Set(allocations.map(a=>db.pcs.find(p=>p.id===a.pcId)?.name||a.pcId))].slice(0,5).join(", ")}. Remove installed parts and release reservations first.`);
   next.pcs=db.pcs.filter(p=>!selected.has(p.id));
  }else next.pcs=db.pcs.map(pc=>{
   if(!selected.has(pc.id))return pc;const {notes,...patch}=request.patch;
   return savePCRecord({...pc,...patch,...(notes?{notes:editNotes(pc.notes,notes)}:{})},db);
  });
 }
 const rows:BulkPreviewRow[]=request.ids.map(id=>{
  if(request.collection==='installationLocations'){
   const before=db.installationLocations.find(l=>l.id===id)!,after=next.installationLocations.find(l=>l.id===id);
   const describe=(l:InstallationLocation,d:Database)=>`${locationPath(l.id,d)} | ${l.kind} | target: ${d.configurations.find(c=>c.id===l.targetConfigurationId)?.name||'None'} | requirements: ${d.requirementsSets.find(s=>s.id===l.requirementSetId)?.name||'None'} r${l.requirementRevision} | notes: ${l.notes||'None'}`;
   return {id,name:before.name,before:describe(before,db),after:after?describe(after,next):'Delete location record'};
  }
  const before=db.pcs.find(p=>p.id===id)!,after=next.pcs.find(p=>p.id===id);
  const describe=(pc:InventoryPC)=>`${pc.name} | ${locationPath(pc.installationLocationId||'',db)||'Unassigned'} | ${pc.lifecycle||'Planning'} | notes: ${pc.notes||'None'}`;
  return {id,name:before.name,before:describe(before),after:after?describe(after):'Delete PC record, including its timeline and commissioning snapshots'};
 });
 const affectedIds=new Set<string>();if(request.collection==='installationLocations')for(const id of request.ids)for(const child of installationLocationIds(id,db))affectedIds.add(child);
 return {next,rows,affectedPCs:request.collection==='pcs'?request.ids.length:db.pcs.filter(p=>affectedIds.has(p.installationLocationId||'')).length,pathChanges:request.collection==='installationLocations'?db.installationLocations.filter(l=>!selected.has(l.id)&&next.installationLocations.some(n=>n.id===l.id)&&locationPath(l.id,db)!==locationPath(l.id,next)).length:0,historicalPCs:request.collection==='pcs'&&request.action==='delete'?db.pcs.filter(p=>selected.has(p.id)&&(p.timeline?.length||p.snapshot||p.snapshots?.length||p.commissioning)).length:0};
}
