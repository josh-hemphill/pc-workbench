import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Component,Database,Specs} from '../shared/types.ts';
import {categories} from '../shared/types.ts';
import {componentSchema,componentSpecsSchema} from '../shared/component-schema.ts';
import {catalogFields,missingFields,fieldValue,isMissing,patchMissing} from '../shared/catalog-quality.ts';
import {sameValue} from '../shared/component-bulk.ts';
import {researchFormat,researchPackLimit,type ResearchFile,type ResearchRow,type ResearchPreview} from '../shared/catalog-research.ts';
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const researchExportSchema=z.object({componentIds:z.array(id).min(1).max(researchPackLimit).refine(ids=>new Set(ids).size===ids.length,'Select unique component IDs.')}).strict();
export const researchFileSchema=z.object({format:z.literal(researchFormat),version:z.literal(1),exportedAt:z.string().optional(),workspaceRevision:z.string().optional(),instructions:z.unknown().optional(),components:z.array(z.object({id,name:z.string().min(1).max(200),category:z.enum(categories),existing:z.unknown().optional(),missingFields:z.unknown().optional(),proposals:z.array(z.object({path:z.string().min(1).max(100),value:z.unknown().optional(),sourceUrl:z.string().max(2000).default(''),evidence:z.string().max(2000).default('')}).strict()).max(100).refine(fields=>new Set(fields.map(field=>field.path)).size===fields.length,'A component has duplicate proposed fields.')}).strict()).min(1).max(researchPackLimit).refine(components=>new Set(components.map(component=>component.id)).size===components.length,'The file has duplicate component IDs.').refine(components=>components.reduce((total,c)=>total+c.proposals.length,0)<=20000,'Use at most 20,000 proposals per file.')}).strict();
export const researchPreviewSchema=z.object({file:researchFileSchema,selected:z.array(z.string().max(200)).max(20000).refine(keys=>new Set(keys).size===keys.length,'Choose unique proposal keys.').optional()}).strict();
const fieldPath=(key:string)=>['manufacturer','source'].includes(key)?key:`specs.${key}`;
function errorMessage(error:unknown){return error instanceof z.ZodError?error.issues.map(issue=>`${issue.path.join('.')}: ${issue.message}`).join('; '):error instanceof Error?error.message:String(error);}
function sourceURL(value:unknown){if(typeof value!=='string')throw Error('Provide an HTTP or HTTPS source URL.');const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('Provide an HTTP or HTTPS source URL without credentials.');return url.href;}
export function exportResearchPack(db:Database,ids:string[],revision:string):ResearchFile{
 researchExportSchema.parse({componentIds:ids});const byId=new Map(db.components.map(c=>[c.id,c]));
 return {format:researchFormat,version:1,exportedAt:new Date().toISOString(),workspaceRevision:revision,instructions:[
  'Research each exact component using manufacturer documentation. existing and missingFields are read-only context; edit only proposals. Return this JSON file, or retain format/version/components with id/name/category/proposals.',
  'Keep component IDs, names, categories and proposal paths unchanged. Do not infer identity from a similar model. Do not change known specifications or claim verification.',
  'Set proposal.value to a JSON value matching its valueSchema. Zero and false are known values. Leave null, empty strings or empty arrays for unresolved fields; do not guess.',
  'For every proposed value provide sourceUrl (HTTP/HTTPS) and evidence (a concise source quote or explanation, including page/table when useful). URLs are recorded, not fetched by the importer.',
  'Core gap checks are not a complete engineering audit. Named connector inventories override numeric counts. Unverified records with no core gaps require human review.',
  'Import fills only fields still missing on the same component identity. Existing values are kept, conflicting/invalid proposals are shown, and applied components remain unverified.'],components:ids.map(id=>{
   const component=byId.get(id);if(!component)throw Error(`Component ${id} no longer exists. Reload before exporting.`);
   const missing=missingFields(component);
   return {id:component.id,name:component.name,category:component.category,existing:structuredClone(component),missingFields:missing.map(field=>({path:fieldPath(field.key),label:field.label,valueSchema:['manufacturer','source'].includes(field.key)?{type:'string'}:z.toJSONSchema(componentSpecsSchema.shape[field.key as keyof Specs]),...(field.choices?{choices:field.choices}:{})})),proposals:missing.map(field=>({path:fieldPath(field.key),value:null,sourceUrl:'',evidence:''}))};
  })};
}
export function researchToken(file:ResearchFile,selected:string[],revision:string){return createHash('sha256').update(JSON.stringify({file,selected:[...selected].sort(),revision})).digest('hex');}
export function previewResearch(db:Database,input:ResearchFile,revision:string,selection?:string[]):{preview:ResearchPreview;components:Component[]}{
 const file=researchFileSchema.parse(input),byId=new Map(db.components.map(c=>[c.id,c])),rows:ResearchRow[]=[];let blank=0;
 for(const entry of file.components)for(const proposal of entry.proposals){
  if(isMissing(proposal.value)){blank++;continue;}
  const component=byId.get(entry.id),row:ResearchRow={key:`${entry.id}:${proposal.path}`,componentId:entry.id,name:entry.name,path:proposal.path,field:proposal.path,after:proposal.value,sourceUrl:proposal.sourceUrl,evidence:proposal.evidence,status:'Invalid',reason:''};rows.push(row);
  if(!component){row.reason='Component no longer exists. Export a fresh pack.';continue;}
  if(component.name!==entry.name||component.category!==entry.category){row.status='Conflict';row.reason='Component identity changed. Export a fresh pack.';continue;}
  const field=catalogFields(component).find(field=>fieldPath(field.key)===proposal.path);
  if(!field){row.reason='This is not a supported core research field for this component. Edit advanced specifications in the component editor.';continue;}
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
  for(const row of rows.filter(row=>chosen.has(row.key))){
   const current=updated.get(row.componentId)||byId.get(row.componentId)!,key=row.path.replace(/^specs\./,'');
   updated.set(current.id,patchMissing(current,{[key]:row.after},db));
  }
  for(const [id,component] of updated){
   const evidence=rows.filter(row=>chosen.has(row.key)&&row.componentId===id).map(row=>`${row.path}=${JSON.stringify(row.after)} | ${row.sourceUrl} | ${row.evidence.trim()}`);
   const notes=[component.specs.notes,`Unverified research (${new Date().toISOString().slice(0,10)}):\n${evidence.join('\n')}`].filter(Boolean).join('\n');
   updated.set(id,componentSchema.parse({...component,verified:false,specs:{...component.specs,notes}}));
  }
 }catch(reason){error=errorMessage(reason);}
 return {preview:{valid:!error,...(error?{error}:{}),revision,token:researchToken(file,selected,revision),rows,selected,components:updated.size,fields:selected.length,blank},components:db.components.map(c=>updated.get(c.id)||c)};
}
