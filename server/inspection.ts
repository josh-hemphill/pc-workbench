import {z} from 'zod';
import {randomUUID,createHash} from 'node:crypto';
import {componentSchema} from '../shared/component-schema.ts';
import {coverageSchema,inspectionCategories,type InspectionRecord} from '../shared/inspection.ts';
import {locationPath} from '../shared/installations.ts';
import type {Database,StockRecord} from '../shared/types.ts';
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const inspectionInputSchema=z.object({id,sessionId:id,pcId:id,observedAt:z.iso.datetime(),actor:z.string().trim().min(1).max(200),method:z.enum(['exterior','os-report','opened-case','test-bench','historical']),evidence:z.string().trim().min(1).max(8000),reportedLocation:z.string().max(1000),finished:z.boolean(),coverage:coverageSchema,discoveries:z.array(z.object({componentId:id.optional(),newComponent:componentSchema.optional(),stockId:id.optional(),quantity:z.number().int().min(1).max(32),serial:z.string().trim().max(200),assetTag:z.string().trim().max(200),notes:z.string().max(2000)}).strict()).max(100)}).strict();
export type InspectionInput=z.infer<typeof inspectionInputSchema>;
export const inspectionFingerprint=(input:InspectionInput)=>createHash('sha256').update(JSON.stringify(input)).digest('hex');
export function buildInspection(db:Database,input:InspectionInput){
 const next=structuredClone(db),pc=next.pcs.find(p=>p.id===input.pcId);if(!pc)throw Error('PC no longer exists.');
 const fingerprint=inspectionFingerprint(input),prior=pc.inspections?.find(s=>s.id===input.id);
 if(prior){if(prior.fingerprint!==fingerprint)throw Error('This inspection save ID was already used with different observations.');return {next,duplicate:true,preview:{units:0,discoveries:prior.discoveries.length,finished:prior.finished,warnings:['This inspection save is already recorded. No units will be added.']}};}
 if(Date.parse(input.observedAt)>Date.now()+300000)throw Error('Observation date cannot be in the future.');
 const historical=input.method==='historical';
 if(historical&&(input.discoveries.length||input.finished))throw Error('Historical evidence cannot create stock or complete a physical survey.');
 if(pc.lifecycle==='Retired'&&!historical)throw Error('Retired PC: record historical evidence, or reconcile its lifecycle before recording physical discoveries.');
 const at=new Date().toISOString(),record:InspectionRecord={id:input.id,sessionId:input.sessionId,fingerprint,observedAt:input.observedAt,recordedAt:at,actor:input.actor,method:input.method,evidence:input.evidence,reportedLocation:input.reportedLocation,locationId:pc.installationLocationId||'',locationPath:locationPath(pc.installationLocationId||'',db)||pc.location,finished:input.finished,coverage:input.coverage,discoveries:[]};
 for(const item of input.discoveries){
  if(!!item.componentId===!!item.newComponent)throw Error('Choose an existing component or create one for each discovery.');
  const component=item.newComponent||next.components.find(c=>c.id===item.componentId);if(!component)throw Error('Component not found.');
  if(item.newComponent){if(next.components.some(c=>c.id===component.id))throw Error('New component ID already exists.');next.components.push(componentSchema.parse(item.newComponent));}
  let stock:StockRecord|undefined=item.stockId?next.inventory.find(s=>s.id===item.stockId):undefined;
  if(item.stockId&&!stock)throw Error('Selected stock record no longer exists.');
  if(stock){if(item.newComponent||stock.componentId!==component.id)throw Error('Selected stock does not match the component.');if(stock.condition==='Retired')throw Error('Reconcile retired stock before recording physical presence.');if(item.serial||item.assetTag)throw Error('Existing stock retains its serial and asset tag; leave new identity fields empty.');if(stock.allocations.some(a=>a.pcId===pc.id))throw Error('This stock is already recorded on this PC. Review the existing allocation instead of duplicating it.');if(stock.quantity-stock.allocations.reduce((n,a)=>n+a.quantity,0)<item.quantity)throw Error('Stock is already assigned or insufficient. Reconcile its custody before recording it here.');}
  else{
   if(item.serial&&item.quantity!==1)throw Error('Serialized discoveries have quantity 1.');
   const serial=item.serial.toLowerCase();if(serial&&next.inventory.some(s=>s.serial.trim().toLowerCase()===serial))throw Error('This serial is already recorded. Choose its existing stock record or reconcile the identity; do not receive it twice.');
   if(item.assetTag&&next.inventory.some(s=>s.assetTag.trim().toLowerCase()===item.assetTag.toLowerCase()))throw Error('This asset tag is already recorded. Choose the existing stock record.');
   stock={id:randomUUID(),componentId:component.id,tracking:item.serial?'serialized':'bulk',serial:item.serial,assetTag:item.assetTag,quantity:item.quantity,condition:'Quarantined',location:record.locationPath||`Inside ${pc.name}`,notes:`Discovered inside ${pc.name}. ${input.evidence}`,allocations:[],history:[]};next.inventory.push(stock);
   stock.history.push({id:randomUUID(),at,action:'receive',quantity:item.quantity,pcId:pc.id,pcName:pc.name,allocationId:'',actor:input.actor,notes:`Physical discovery, untested. Inspection ${input.id}. Observed ${input.observedAt}. ${input.evidence}`});
  }
  const allocationId=randomUUID();stock.allocations.push({id:allocationId,pcId:pc.id,quantity:item.quantity,state:'installed',plannedPlacementId:'',role:'general',mount:'auto',slotId:'',notes:`Observed present; not an installation or functional test. ${item.notes}`,createdAt:at,updatedAt:at});
  stock.history.push({id:randomUUID(),at,action:'configure',quantity:0,pcId:pc.id,pcName:pc.name,allocationId,actor:input.actor,notes:`Discovery custody recorded, no physical installation. Inspection ${input.id}. ${input.evidence}`});
  record.discoveries.push({stockId:stock.id,allocationId,componentId:component.id,name:component.name,quantity:item.quantity,notes:item.notes});
 }
 if(!historical){
  for(const row of input.coverage){const owned=next.inventory.filter(s=>next.components.find(c=>c.id===s.componentId)?.category===row.category&&s.allocations.some(a=>a.pcId===pc.id&&a.state==='installed'));
   if(row.status==='absent'&&owned.length)throw Error(`${row.category}: installed records still exist. Reconcile or remove them before confirming absence.`);
   if(['recorded','unidentified'].includes(row.status)&&!owned.length)throw Error(`${row.category}: record the physical parts, or leave this category unchecked/inaccessible.`);
   if(row.status==='recorded'&&owned.some(s=>next.components.find(c=>c.id===s.componentId)?.identityKind==='placeholder'))throw Error(`${row.category}: identities remain unresolved; choose Present, identity needed.`);
  }
  if(input.finished&&(input.coverage.length!==inspectionCategories.length||input.coverage.some(r=>['unchecked','inaccessible'].includes(r.status))))throw Error('Account for every category before finishing: present, identity needed or confirmed absent.');
  pc.hardwareSurvey={status:input.finished?'complete':'partial',configurationId:input.finished?'':pc.hardwareSurvey?.configurationId||'',evidence:pc.hardwareSurvey?.evidence||input.evidence};
 }
 pc.inspections??=[];pc.inspections.push(record);pc.timeline??=[];pc.timeline.push({id:randomUUID(),at,kind:'inspection',actor:input.actor,summary:`${historical?'Historical evidence':input.finished?'Inspection completed':'Inspection progress saved'}: ${record.discoveries.length} discoveries. ${input.evidence}`});
 return {next,duplicate:false,preview:{units:record.discoveries.reduce((n,d)=>n+d.quantity,0),discoveries:record.discoveries.length,finished:input.finished,warnings:['New physical units remain quarantined and unavailable until tested. Presence does not prove compatibility or correct wiring.','Lifecycle, shared configurations and accepted commissioning snapshots remain unchanged.','Earlier assumptions remain evidence. Planning flags contradictions; revise the assumption or finish enumeration before relying on it.']}};
}
