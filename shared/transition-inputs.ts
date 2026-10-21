import {z} from 'zod';
import type {Configuration,Database} from './types.ts';
import {segmentsFor} from './transitions.ts';
import type {Segment,TransitionCohort,TransitionScenario} from './transitions.ts';
const raid=z.enum(['none','mirror','raid5','raid6','raid10']);
// Older plans already encode their source layout in each group key. Read only
// the fields needed for an explicit copy action; arbitrary imported keys are ignored.
const groupKey=z.object({source:z.string().optional(),placements:z.array(z.object({componentId:z.string(),quantity:z.number().int().min(1).max(10000),role:z.enum(['boot','data','general']),group:z.string().default('')})).max(200),storage:z.object({raid,bootMirror:z.boolean(),groups:z.array(z.object({id:z.string(),name:z.string(),raid})).optional()})});
type Policy=TransitionScenario['policies'][string][string];
export interface ReusableTransitionInputs {key:string;name:string;destinationId?:string;policies:Record<string,Policy>;skipped:number}
function hasInput(policy:Policy|undefined){return !!policy&&(policy.usedGb!==undefined||!!policy.replacementId||!!policy.targetSegmentId||!!policy.evidence.trim());}
function storageShape(segment:Segment){
 const counts=new Map<string,number>();for(const p of segment.placements)counts.set(p.componentId,(counts.get(p.componentId)||0)+p.quantity);
 return JSON.stringify({role:segment.role,raid:segment.raid,drives:[...counts].sort(([a],[b])=>a.localeCompare(b))});
}
/** Offer copyable inputs. Nothing transfers until the user selects this action. */
export function reusableTransitionInputs(cohort:TransitionCohort,scenario:TransitionScenario,db:Database):ReusableTransitionInputs[]{
 const options:ReusableTransitionInputs[]=[],seen=new Set<string>();
 for(const key of new Set([...Object.keys(scenario.destinationIds),...Object.keys(scenario.policies)])){
  if(key===cohort.id)continue;
  let raw:unknown;try{raw=JSON.parse(key);}catch{continue;}
  const parsed=groupKey.safeParse(raw);if(!parsed.success)continue;
  const source=parsed.data,sourceDestination=scenario.destinationIds[key];
  const destinationExists=db.configurations.some(c=>c.id===sourceDestination);
  const sameDestination=destinationExists&&(!scenario.destinationIds[cohort.id]||scenario.destinationIds[cohort.id]===sourceDestination);
  const configuration:Configuration={id:'previous-group',name:'Previous group',description:'',systemId:'',status:'Draft',updatedAt:new Date(0).toISOString(),storage:source.storage,notes:'',placements:source.placements.map((p,i)=>({...p,id:`previous-${i}`,slotId:'',mount:'auto'}))};
  const segments=segmentsFor({...cohort.members[0],configuration},db),policies:Record<string,Policy>={};let skipped=0;
  for(const [id,policy] of Object.entries(scenario.policies[key]||{})){
   if(!hasInput(policy))continue;
   const before=segments.find(s=>s.id===id),after=cohort.segments.find(s=>s.id===id);
   if(before&&after&&storageShape(before)===storageShape(after)&&!hasInput(scenario.policies[cohort.id]?.[id])){
    const copy:Policy={evidence:policy.evidence};
    if(policy.usedGb!==undefined)copy.usedGb=policy.usedGb;
    if(scenario.mode==='ssd'&&policy.replacementId&&db.components.some(c=>c.id===policy.replacementId&&c.category==='Drive'&&c.specs.storageMedium==='SSD'))copy.replacementId=policy.replacementId;
    if(scenario.mode==='configuration'&&policy.targetSegmentId&&sameDestination)copy.targetSegmentId=policy.targetSegmentId;
    if(hasInput(copy))policies[id]=copy;
   }
   else if(!before||!after||storageShape(before)!==storageShape(after))skipped++;
  }
  const destinationId=scenario.mode==='configuration'&&!scenario.destinationIds[cohort.id]&&destinationExists?sourceDestination:undefined;
  if(!destinationId&&!Object.keys(policies).length)continue;
  const signature=JSON.stringify({destinationId,policies,skipped});if(seen.has(signature))continue;seen.add(signature);
  options.push({key,name:db.configurations.find(c=>c.id===source.source)?.name||'Previously configured group',destinationId,policies,skipped});
 }
 return options;
}
/** Preserve user edits; compatibility/capacity and the current workspace still require review. */
export function reuseTransitionInputs(cohort:TransitionCohort,key:string,scenario:TransitionScenario,db:Database){
 const option=reusableTransitionInputs(cohort,scenario,db).find(o=>o.key===key);if(!option)return null;
 if(option.destinationId)scenario.destinationIds[cohort.id]=option.destinationId;
 if(Object.keys(option.policies).length)Object.assign(scenario.policies[cohort.id]??={},option.policies);
 return option;
}
