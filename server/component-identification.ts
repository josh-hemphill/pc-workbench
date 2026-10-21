import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {componentSchema} from '../shared/component-schema.ts';
import {componentReferences,type ComponentCollection} from '../shared/component-editor.ts';
import type {Database} from '../shared/types.ts';
import type {IdentificationInput} from '../shared/component-identification.ts';
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const ids=z.array(id).max(1000).refine(v=>new Set(v).size===v.length,'Select unique IDs.');
export const identificationSchema=z.object({sourceId:id,targetId:id.optional(),newComponent:componentSchema.optional(),evidence:z.string().trim().min(1).max(2000),actor:z.string().trim().max(200).default(''),stock:z.array(z.object({stockId:id,availableQuantity:z.number().int().min(0),allocationIds:ids}).strict()).max(1000),configurations:z.array(z.object({configurationId:id,placementIds:ids,pcIds:ids,updateTemplate:z.boolean()}).strict()).max(1000)}).strict().refine(v=>!!v.targetId!==!!v.newComponent,'Choose an existing model or create one.');
/** Identity corrections preserve allocation IDs and bindings; only whole allocations can move. */
export function buildIdentification(db:Database,input:IdentificationInput){
 const source=db.components.find(c=>c.id===input.sourceId);
 if(!source||source.identityKind!=='placeholder')throw Error('Select an explicitly marked placeholder.');
 const target=input.newComponent||db.components.find(c=>c.id===input.targetId);
 if(!target||target.id===source.id||target.identityKind==='placeholder'||target.category!==source.category)throw Error('Choose a different, identified component in the same category.');
 if(!target.model?.trim())throw Error('Record the exact target model / part number before identifying uses.');
 if(input.newComponent&&db.components.some(c=>c.id===target.id))throw Error('New component ID already exists.');
 if(new Set(input.stock.map(s=>s.stockId)).size!==input.stock.length||new Set(input.configurations.map(c=>c.configurationId)).size!==input.configurations.length)throw Error('Select each stock record and configuration once.');
 const next=structuredClone(db),at=new Date().toISOString(),affected=new Set<string>();
 if(input.newComponent)next.components.push(componentSchema.parse(input.newComponent));
 let quantity=0,allocations=0,configurations=0;
 const selectedConfigurationIds=new Set<string>(),changedPlacements=new Map<string,Set<string>>();
 const checkSoftware=(settings:{drivers?:Record<string,string>;firmware?:Record<string,string>}|undefined)=>{if(settings&&['drivers','firmware'].some(k=>Object.hasOwn(settings[k as 'drivers'|'firmware']||{},source.id)))throw Error('Remove or reconcile software versions keyed to the placeholder before identification; they cannot be assumed valid for the identified model.');};
 for(const selection of input.configurations){
  const original=next.configurations.find(c=>c.id===selection.configurationId);
  if(!original||!selection.placementIds.length)throw Error('Select existing configuration placements.');
  if(selection.placementIds.some(id=>!original.placements.some(p=>p.id===id&&p.componentId===source.id)))throw Error('A selected placement is no longer a use of this placeholder.');
  if(selection.updateTemplate&&selection.pcIds.length)throw Error('Choose the shared template or selected PCs, not both.');
  if(!selection.updateTemplate&&!selection.pcIds.length)throw Error('Select PCs for the configuration copy.');
  const pcs=selection.updateTemplate?next.pcs.filter(pc=>pc.configurationId===original.id):selection.pcIds.map(id=>{const pc=next.pcs.find(pc=>pc.id===id);if(!pc||pc.configurationId!==original.id)throw Error('A selected PC no longer uses this configuration.');return pc;});
  const cfg=selection.updateTemplate?original:{...structuredClone(original),id:randomUUID(),name:`${original.name} · ${target.model}`};
  if(!selection.updateTemplate){delete cfg.approvalHistory;delete cfg.approvalSnapshot;next.configurations.push(cfg);for(const pc of pcs){pc.configurationId=cfg.id;if(pc.hardwareSurvey?.configurationId===original.id){pc.hardwareSurvey.configurationId=cfg.id;pc.hardwareSurvey.evidence+=`\nIdentification: ${input.evidence}`;}}}
  checkSoftware(cfg.software);
  for(const p of cfg.placements)if(selection.placementIds.includes(p.id))p.componentId=target.id;
  cfg.status='Draft';cfg.revision=(cfg.revision||0)+1;cfg.updatedAt=at;configurations++;selectedConfigurationIds.add(cfg.id);changedPlacements.set(cfg.id,new Set(selection.placementIds));
  for(const pc of pcs)affected.add(pc.id);
 }
 const changedAllocations=new Set<string>();
 for(const selection of input.stock){
  const stock=next.inventory.find(s=>s.id===selection.stockId);
  if(!stock||stock.componentId!==source.id)throw Error('A stock record no longer uses this placeholder.');
  const chosen=selection.allocationIds.map(id=>{const a=stock.allocations.find(a=>a.id===id);if(!a)throw Error('Selected allocation no longer exists.');return a;});
  const free=stock.quantity-stock.allocations.reduce((n,a)=>n+a.quantity,0);
  if(selection.availableQuantity>free)throw Error('Selected unallocated quantity exceeds this stock record.');
  const count=selection.availableQuantity+chosen.reduce((n,a)=>n+a.quantity,0);
  if(!count)throw Error('Select a positive stock quantity or a whole allocation.');
  if(stock.tracking==='serialized'&&count!==stock.quantity)throw Error('Serialized records must be identified as a whole.');
  const entire=count===stock.quantity,targetStockId=entire?stock.id:randomUUID();
  const note=`Identity identified: ${source.name} (${source.id}) → ${target.name} (${target.id}). Evidence: ${input.evidence}. Selected allocations: ${chosen.map(a=>a.id).join(', ')||'none'}.`;
  const event={id:randomUUID(),at,action:'edit' as const,quantity:0,pcId:'',pcName:'',allocationId:'',actor:input.actor,notes:note};
  if(entire){stock.componentId=target.id;stock.history.push(event);}
  else{
   const moved={...structuredClone(stock),id:targetStockId,componentId:target.id,quantity:count,serial:'',assetTag:'',allocations:structuredClone(chosen),history:[{...event,id:randomUUID(),action:'transfer-in' as const,quantity:count,sourceStockId:stock.id}]};
   delete moved.reorderLevel;
   stock.quantity-=count;stock.allocations=stock.allocations.filter(a=>!selection.allocationIds.includes(a.id));stock.history.push({...event,action:'transfer-out',quantity:-count,targetStockId});next.inventory.push(moved);
  }
  for(const a of chosen){changedAllocations.add(a.id);affected.add(a.pcId);const pc=next.pcs.find(pc=>pc.id===a.pcId);if(a.plannedPlacementId&&pc&&!next.configurations.find(c=>c.id===pc.configurationId)?.placements.some(p=>p.id===a.plannedPlacementId&&p.componentId===target.id))throw Error('Also identify the planned placement for each selected allocation, or remove its plan link before identification.');}
  quantity+=count;allocations+=chosen.length;
 }
 if(!quantity&&!configurations)throw Error('Select stock or configuration uses to identify.');
 // Preserve every referenced physical connector ID. Scope checks to the uses being changed.
 const scope:Database={...db,configurations:next.configurations.filter(c=>selectedConfigurationIds.has(c.id)).map(c=>({...c,placements:c.placements.map(p=>({...p,componentId:changedPlacements.get(c.id)?.has(p.id)?source.id:p.componentId===source.id?'scope-unselected':p.componentId}))})),inventory:next.inventory.flatMap(s=>s.allocations.filter(a=>affected.has(a.pcId)).map(a=>({...s,componentId:changedAllocations.has(a.id)?source.id:s.componentId===source.id?'scope-unselected':s.componentId,allocations:[{...a,state:'installed' as const}]})))};
 const collections:ComponentCollection[]=['ports','slots','laneRules','bayTargets','driveTargets','sataDataPorts','sataPowerConnectors','sataDataInputs','sataPowerInputs','sffPorts','sffInputs','coolingDevices','coolingHeaders','coolingHeaderGroups'];
 for(const key of collections)for(const row of (source.specs[key]||[]) as {id:string}[])if(componentReferences(source,key,row.id,scope).length&&!((target.specs[key]||[]) as {id:string}[]).some(r=>r.id===row.id))throw Error(`Target is missing referenced ${key} ID ${row.id}. Reconcile connector IDs and wiring before identifying these uses.`);
 const serials=new Set<string>();for(const s of next.inventory.filter(s=>s.componentId===target.id&&s.tracking==='serialized')){const serial=s.serial.trim().toLowerCase();if(serial&&serials.has(serial))throw Error('Identification would duplicate a serial number on the target model.');if(serial)serials.add(serial);}
 for(const pc of next.pcs)if(affected.has(pc.id)){checkSoftware(pc.software);checkSoftware(pc.buildSettings?.software);pc.timeline??=[];pc.timeline.push({id:randomUUID(),at,kind:'component-identification',actor:input.actor,summary:`${source.name} → ${target.name}. ${input.evidence}`});}
 return {next,preview:{source:source.name,target:target.name,quantity,remainingQuantity:next.inventory.filter(s=>s.componentId===source.id).reduce((n,s)=>n+s.quantity,0),allocations,configurations,pcs:[...affected].map(id=>next.pcs.find(pc=>pc.id===id)?.name||id),warnings:['Only selected uses change. Remaining placeholder stock and templates keep their identity.','Changed configurations are drafts. Review compatibility, installed-PC drift, wiring and saved transition plans. Accepted historical snapshots remain unchanged.','Allocations move whole, retaining IDs and wiring. Split stock history links both lots; the original lot retains its movement history.']}};
}
