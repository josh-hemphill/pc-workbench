import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Component,Database} from '../shared/types.ts';
import {componentSchema,componentSpecsSchema} from '../shared/component-schema.ts';
import {catalogFields,fieldValue,isMissing,patchMissing} from '../shared/catalog-quality.ts';
import {engineeringFields,mergeResearchRecords,changedResearchRecords,isResearchCollectionPath,validateResearchCooling,ResearchConflict,type ResearchCollection} from './research-engineering.ts';
import {applyComponentFieldEdits,type ComponentFieldEdit,sameValue} from '../shared/component-bulk.ts';
import {researchFormat,type ResearchFile,type ResearchRow,type ResearchPreview} from '../shared/catalog-research.ts';
import {researchReference} from './research-reference.ts';
import {researchExportSchema,researchFileSchema,fieldPath} from './research-format.ts';
export {researchExportSchema,researchFileSchema,researchPreviewSchema} from './research-format.ts';
function errorMessage(error:unknown){return error instanceof z.ZodError?error.issues.map(issue=>`${issue.path.join('.')}: ${issue.message}`).join('; '):error instanceof Error?error.message:String(error);}
function sourceURL(value:unknown){if(typeof value!=='string')throw Error('Provide an HTTP or HTTPS source URL.');const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('Provide an HTTP or HTTPS source URL without credentials.');return url.href;}
export function exportResearchPack(db:Database,ids:string[],revision:string):ResearchFile{
 researchExportSchema.parse({componentIds:ids});const byId=new Map(db.components.map(c=>[c.id,c]));
 const selected=ids.map(id=>{const component=byId.get(id);if(!component)throw Error(`Component ${id} no longer exists. Reload before exporting.`);return component;}),reference=researchReference(selected);
 return {format:researchFormat,version:1,$schema:'component-research.schema.json',exportedAt:new Date().toISOString(),workspaceRevision:revision,guide:reference.guide,componentIndex:reference.componentIndex,$defs:reference.$defs,instructions:[
  'Explicit placeholders have no specification proposals. Collect identification evidence tied to a PC or stock lot (part labels, CPU IDs, memory SPD). Resolve selected uses in Workbench before model research; never choose a plausible model for a catchall.',
  'Research each exact component using manufacturer documentation. existing and missingFields are read-only context; edit only proposals. Return this JSON file, or retain format/version/components with id/name/category/proposals.',
  'Keep component IDs, names, categories, the top-level model identity (when present), and proposal paths unchanged. Do not infer identity from a similar model. Do not change known specifications or claim verification.',
  'Set proposal.value to a JSON value matching the schema referenced by valueSchemaRef. Zero and false are known values. Leave null, empty strings or empty arrays for unresolved fields; do not guess.',
  'For every proposed value provide sourceUrl (HTTP/HTTPS) and evidence (a concise source quote or explanation, including page/table when useful). URLs are recorded, not fetched by the importer.',
  'Core gap checks are not a complete engineering audit. Named connector inventories override numeric counts. Unverified records with no core gaps require human review.',
  'Named ports, slots, laneRules, coolingDevices, coolingHeaders and coolingHeaderGroups are optional engineering proposals: submit arrays of records with stable IDs. Reuse existing IDs for the same physical connector/slot/rule. Existing records may supply only id and missing properties; new records must supply all required properties in newRecordSchemaRef. Omitted records are preserved. Do not renumber, delete, replace known values, or infer CPU/chipset source from slot width.',
  'Named ports are the complete physical inventory, not just rear connectors; retain known internal/front-panel ports. When converting numeric USB/Ethernet counts to a named list, match every recorded count. Lists cannot clear an explicitly empty inventory. Each collection is reviewed as one proposal; a conflicting property withholds that collection. Lane rules must reference existing or simultaneously proposed slots and named SATA endpoints.',
  'For fans/pumps, research motor kind/count, power connector, voltage, maximum/startup current per motor, DC/PWM/fixed-speed control, separate control connector and RPM feedback. Header proposals describe connector, supported control modes, voltage, per-header current limit, documented device limit and shared-budget ID. A 4-pin connector alone does not establish PWM/DC support or current ratings; leave undocumented properties absent. Do not infer splitter capacity or startup current from typical running current.',
  'Cooling header limitGroup must name an existing or simultaneously selected coolingHeaderGroups record on the same component. Shared budgets record the combined documented current limit. Keep motor/header IDs stable so existing configuration and installed wiring remains valid; research imports never create wiring assignments.',
  'Import fills only fields still missing on the same component identity. Existing values are kept, conflicting/invalid proposals are shown, and applied components remain unverified.'],components:selected.map((component,index)=>({id:component.id,name:component.name,model:component.model,...(component.identityKind?{identityKind:component.identityKind}:{}),category:component.category,existing:structuredClone(component),missingFields:reference.fields[index],proposals:reference.fields[index].map(field=>({path:field.path,value:null,sourceUrl:'',evidence:''}))}))};
}

export function researchToken(file:ResearchFile,selected:string[],revision:string){return createHash('sha256').update(JSON.stringify({file,selected:[...selected].sort(),revision})).digest('hex');}
export function previewResearch(db:Database,input:ResearchFile,revision:string,selection?:string[]):{preview:ResearchPreview;components:Component[]}{
 const file=researchFileSchema.parse(input),byId=new Map(db.components.map(c=>[c.id,c])),rows:ResearchRow[]=[];let blank=0;
 for(const entry of file.components)for(const proposal of entry.proposals){
  if(isMissing(proposal.value)){blank++;continue;}
  const component=byId.get(entry.id),row:ResearchRow={key:`${entry.id}:${proposal.path}`,componentId:entry.id,name:entry.name,path:proposal.path,field:proposal.path,after:proposal.value,sourceUrl:proposal.sourceUrl,evidence:proposal.evidence,status:'Invalid',reason:''};rows.push(row);
  if(!component){row.reason='Component no longer exists. Export a fresh pack.';continue;}
  if(component.identityKind==='placeholder'){row.status='Conflict';row.reason='Identity needed. Identify selected uses before model-specific research.';continue;}
  if(entry.identityKind!==undefined&&(component.identityKind||'model')!==entry.identityKind||component.name!==entry.name||component.category!==entry.category||entry.model!==undefined&&component.model!==entry.model){row.status='Conflict';row.reason='Component identity changed. Export a fresh pack.';continue;}
  const engineering=engineeringFields(component).find(field=>`specs.${field.key}`===proposal.path);
  if(engineering){
   row.field=engineering.label;row.before=component.specs[engineering.key];
   try{
    row.sourceUrl=sourceURL(proposal.sourceUrl);if(!proposal.evidence.trim())throw Error('Include source evidence for this value.');
    if(engineering.collection){
     row.after=mergeResearchRecords(component,engineering.key as ResearchCollection,proposal.value);row.changes=changedResearchRecords(row.before,row.after);
     row.status=sameValue(row.before,row.after)?'Unchanged':'Fill';row.reason=row.status==='Unchanged'?'These records are already recorded.':'Merge by stable ID: add records and fill unknown properties; keep omitted records.';
    }else{
     row.after=componentSpecsSchema.shape.bifurcation.parse(proposal.value);
     row.status=row.before===undefined?'Fill':sameValue(row.before,row.after)?'Unchanged':'Conflict';row.reason=row.status==='Fill'?'Still missing; ready for review.':row.status==='Unchanged'?'This value is already recorded.':'A known value is already recorded and will be kept.';
    }
   }catch(error){row.status=error instanceof ResearchConflict?'Conflict':'Invalid';row.reason=errorMessage(error);}
   continue;
  }
  const field=catalogFields(component).find(field=>fieldPath(field.key)===proposal.path);
  if(!field){row.reason='This is not a supported research field for this component.';continue;}
  row.field=field.label;row.before=fieldValue(component,field.key);
  if(!isMissing(row.before)){row.status=sameValue(row.before,proposal.value)?'Unchanged':'Conflict';row.reason=row.status==='Unchanged'?'This value is already recorded.':'A known value is already recorded and will be kept.';continue;}
  try{
   row.sourceUrl=sourceURL(proposal.sourceUrl);if(!proposal.evidence.trim())throw Error('Include source evidence for this value.');
   if(field.key==='source')sourceURL(proposal.value);
   const next=patchMissing(component,{[field.key]:proposal.value},db);componentSchema.parse(next);row.after=fieldValue(next,field.key);row.status='Fill';row.reason='Still missing; ready for review.';
  }catch(error){row.reason=errorMessage(error);}
 }
 const keys=new Set(rows.map(row=>row.key));if(selection?.some(key=>!keys.has(key)))throw Error('A selected proposal is absent from this file. Preview again.');
 const selected=rows.filter(row=>row.status==='Fill'&&(!selection||selection.includes(row.key))).map(row=>row.key).sort(),chosen=new Set(selected),updated=new Map<string,Component>();
 let error='';
 try{
  const selectedRows=rows.filter(row=>chosen.has(row.key));
  for(const componentId of new Set(selectedRows.map(row=>row.componentId))){
   const current=byId.get(componentId)!,edits:ComponentFieldEdit[]=selectedRows.filter(row=>row.componentId===componentId).map(row=>({path:row.path,mode:isResearchCollectionPath(row.path)?'merge':'set',value:row.after}));
   const next=applyComponentFieldEdits(current,edits,db);
   if(edits.some(edit=>['specs.coolingHeaders','specs.coolingHeaderGroups'].includes(edit.path)))validateResearchCooling(next);
   for(const row of selectedRows.filter(row=>row.componentId===componentId&&!engineeringFields(current).some(field=>`specs.${field.key}`===row.path)))if(!sameValue(fieldValue(next,row.path.replace(/^specs\./,'')),row.after))throw Error(`${row.field}: selected value disagrees with the named inventory. Deselect the conflicting count proposal.`);
   updated.set(componentId,next);
  }
  for(const [id,component] of updated){
   const evidence=rows.filter(row=>chosen.has(row.key)&&row.componentId===id).map(row=>`${row.path}=${JSON.stringify(row.changes??row.after)} | ${row.sourceUrl} | ${row.evidence.trim()}`);
   const notes=[component.specs.notes,`Unverified research (${new Date().toISOString().slice(0,10)}):\n${evidence.join('\n')}`].filter(Boolean).join('\n');
   updated.set(id,componentSchema.parse({...component,verified:false,specs:{...component.specs,notes}}));
  }
 }catch(reason){error=errorMessage(reason);}
 return {preview:{valid:!error,...(error?{error}:{}),revision,token:researchToken(file,selected,revision),rows,selected,components:updated.size,fields:selected.length,blank},components:db.components.map(c=>updated.get(c.id)||c)};
}
