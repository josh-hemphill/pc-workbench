import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import type {Database,Component,SoftwareSettings} from '../shared/types.ts';
import type {ComponentMergeInput,ComponentMergePreview} from '../shared/component-merge.ts';
import type {StoredPlan} from '../shared/transition-plans.ts';
import {componentReferences,type ComponentCollection} from '../shared/component-editor.ts';
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const componentMergeSchema=z.object({sourceIds:z.array(id).min(1).max(100).refine(ids=>new Set(ids).size===ids.length,'Select unique duplicate types.'),targetId:id,notes:z.string().max(2000).default('')}).strict();
export function buildComponentMerge(db:Database,input:ComponentMergeInput,plans:StoredPlan[]){
 const target=db.components.find(c=>c.id===input.targetId);if(!target)throw Error('Canonical component type not found.');
 const selected=new Set(input.sourceIds);if(selected.has(target.id))throw Error('The canonical component cannot also be a duplicate.');
 const sources=input.sourceIds.map(id=>{const c=db.components.find(c=>c.id===id);if(!c)throw Error(`Duplicate component ${id} not found.`);if(c.category!==target.category)throw Error(`Cannot merge ${c.name}: its category differs from ${target.name}.`);return c;});
 // Immutable baselines must never be silently rewritten by a catalog correction.
 for(const set of db.requirementsSets)for(const v of set.versions)if(v.constraints?.requiredComponents?.some(c=>selected.has(c.componentId))||['drivers','firmware'].some(k=>Object.keys(v.software?.[k as 'drivers'|'firmware']||{}).some(id=>selected.has(id))))throw Error(`Cannot merge: ${set.name} revision ${v.revision} names a duplicate component in immutable requirements. Retain that component type.`);
 const collections:ComponentCollection[]=['ports','slots','bayTargets','driveTargets','sataDataPorts','sataPowerConnectors','sataDataInputs','sataPowerInputs','sffPorts','sffInputs','coolingDevices','coolingHeaders','coolingHeaderGroups','laneRules'];
 const referenceDB:Database={...db,inventory:db.inventory.map(stock=>({...stock,allocations:stock.allocations.map(a=>({...a,state:'installed' as const}))}))};
 for(const source of sources)for(const key of collections)for(const row of (source.specs[key]||[]) as {id:string}[]){
  const refs=componentReferences(source,key,row.id,referenceDB);if(refs.length&&!((target.specs[key]||[]) as {id:string}[]).some(r=>r.id===row.id))throw Error(`Cannot merge ${source.name}: referenced ${key} ID ${row.id} is absent on ${target.name}. Update those bindings or the canonical connector catalog first. Used by ${refs.join(', ')}.`);
 }
 const next=structuredClone(db),at=new Date().toISOString();
 function software(settings:SoftwareSettings|undefined){if(!settings)return false;let changed=false;for(const kind of ['drivers','firmware'] as const){const values=settings[kind];if(!values)continue;for(const source of sources)if(Object.hasOwn(values,source.id)){if(Object.hasOwn(values,target!.id)&&values[target!.id]!==values[source.id])throw Error(`Conflicting ${kind} versions for ${source.name} and ${target!.name}; resolve the recorded versions before merging.`);Object.defineProperty(values,target!.id,{value:values[source.id],enumerable:true,writable:true,configurable:true});delete values[source.id];changed=true;}}return changed;}
 const configurations:ComponentMergePreview['configurations']=[],inventory:ComponentMergePreview['inventory']=[],pcs:ComponentMergePreview['pcs']=[];
 for(const cfg of next.configurations){let changed=software(cfg.software);for(const p of cfg.placements)if(selected.has(p.componentId)){p.componentId=target.id;changed=true;}if(changed){configurations.push({id:cfg.id,name:cfg.name});cfg.revision=(cfg.revision||0)+1;cfg.updatedAt=at;cfg.status='Draft';}}
 const affectedPCs=new Set<string>();
 for(const stock of next.inventory)if(selected.has(stock.componentId)){
  const source=sources.find(c=>c.id===stock.componentId)!;stock.componentId=target.id;
  stock.history.push({id:randomUUID(),at,action:'edit',quantity:0,pcId:'',pcName:'',allocationId:'',notes:`Component type merge: ${source.name} (${source.id}) → ${target.name} (${target.id}). ${input.notes}`});
  inventory.push({id:stock.id,identity:stock.serial||stock.assetTag||stock.id,quantity:stock.quantity});for(const a of stock.allocations)affectedPCs.add(a.pcId);
 }
 const serials=new Set<string>();for(const stock of next.inventory.filter(s=>s.componentId===target.id&&s.tracking==='serialized')){const serial=stock.serial.trim().toLowerCase();if(serials.has(serial))throw Error(`Cannot merge: serial number “${stock.serial}” would occur twice for ${target.name}. Resolve the duplicate stock records first.`);serials.add(serial);}
 const changedConfigIds=new Set(configurations.map(c=>c.id));
 for(const pc of next.pcs){const a=software(pc.software),b=software(pc.buildSettings?.software);if(a||b||affectedPCs.has(pc.id)||changedConfigIds.has(pc.configurationId)){pcs.push({id:pc.id,name:pc.name});(pc.timeline??=[]).push({id:randomUUID(),at,kind:'component-merge',summary:`Catalog correction: ${sources.length} duplicate component type(s) merged into ${target.name} (${target.id}). ${input.notes}`,actor:''});}}
 let transitionPlans=0;const updatedPlans=structuredClone(plans);for(const plan of updatedPlans){let changed=false;for(const scenario of [plan.scenario,plan.draft])if(scenario)for(const policies of Object.values(scenario.policies))for(const policy of Object.values(policies))if(policy.replacementId&&selected.has(policy.replacementId)){policy.replacementId=target.id;changed=true;}if(changed){transitionPlans++;plan.updatedAt=at;}}
 next.components=next.components.filter(c=>!selected.has(c.id));
 const warnings=['The canonical name and specifications are retained. Stock records remain separate; quantities, serials and allocations are not combined.','Affected configurations return to Draft for compatibility review. Commissioning and approval snapshots retain the original component data.','Saved transition cohorts may need review after the catalog correction.'];
 const preview:Omit<ComponentMergePreview,'token'>={target:structuredClone(target),sources:sources.map(source=>({...structuredClone(source),differentSpecs:[...new Set([...Object.keys(source.specs),...Object.keys(target.specs)])].filter(key=>JSON.stringify(source.specs[key as keyof Component['specs']])!==JSON.stringify(target.specs[key as keyof Component['specs']]))})),configurations,inventory,pcs,transitionPlans,warnings};
 return {next,plans:updatedPlans,preview};
}
