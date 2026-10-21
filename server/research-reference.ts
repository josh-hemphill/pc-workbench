import {z} from 'zod';
import type {Component,Specs} from '../shared/types.ts';
import {categories} from '../shared/types.ts';
import {componentSchema,componentSpecsSchema} from '../shared/component-schema.ts';
import {catalogFields,missingFields,fieldValue,isMissing,type CatalogField} from '../shared/catalog-quality.ts';
import {researchPackLimit} from '../shared/catalog-research.ts';
import {engineeringFields,isResearchCollectionPath,researchCollectionSchemas,type ResearchCollection} from './research-engineering.ts';
import {researchFileSchema,fieldPath} from './research-format.ts';
type Schema=Record<string,unknown>;
export interface ResearchFieldReference {path:string;label:string;mode:'fill-missing'|'merge-missing-by-id';optional:boolean;valueSchemaRef:string;newRecordSchemaRef?:string;updateRecordSchemaRef?:string;choices?:string[]}
const definition=(path:string,kind='value')=>`${kind}_${path.replace(/\./g,'_')}`;
const reference=(path:string,kind='value')=>`#/$defs/${definition(path,kind)}`;
const json=(schema:z.ZodType):Schema=>{const {$schema:_,...value}=z.toJSONSchema(schema,{io:'input'});return value;};
export function researchFieldReferences(component:Component):ResearchFieldReference[]{
 if(component.identityKind==='placeholder')return [];
 const missing=[...missingFields(component),...catalogFields(component).filter(field=>field.optional&&isMissing(fieldValue(component,field.key)))];
 return [...missing.map(field=>({path:fieldPath(field.key),label:field.label,mode:'fill-missing' as const,optional:!!field.optional,valueSchemaRef:reference(fieldPath(field.key)),...(field.choices?{choices:field.choices}:{})})),...engineeringFields(component).filter(field=>field.collection||component.specs.bifurcation===undefined).map(field=>{const path=`specs.${field.key}`;return {path,label:field.label,mode:field.collection?'merge-missing-by-id' as const:'fill-missing' as const,optional:true,valueSchemaRef:reference(path),...(field.collection?{newRecordSchemaRef:reference(path,'new'),updateRecordSchemaRef:reference(path,'update')}:{})};})];
}
function allFields(){
 const fields=new Map<string,CatalogField>();
 const variants:Specs[]=[{}, {slotBus:'PCI'}, {driveKind:'optical',driveSize:'5.25'}, {driveSize:'M.2',driveInterface:'NVMe'},...(['controller','pcie-sled','bay-cage','mount-adapter','m2-converter'] as const).map(storageAdapterKind=>({storageAdapterKind})),{coolingDevices:[],coolingHeaders:[],coolingHeaderGroups:[]}];
 for(const category of categories)for(const specs of variants){const component:Component={id:'schema',name:'Schema reference',category,manufacturer:'',source:'',verified:false,specs};for(const field of catalogFields(component))fields.set(fieldPath(field.key),field);for(const field of engineeringFields(component))fields.set(`specs.${field.key}`,{key:field.key,label:field.label,kind:field.collection?'array':'boolean'});}
 return fields;
}
const supported=allFields();
const sourceURL:Schema={type:'string',pattern:'^[hH][tT][tT][pP][sS]?://[^\\s/?#@]+(?:[/?#][^\\s]*)?$'};
function headerConstraints(schema:Schema){return {...schema,allOf:[{if:{required:['connector','controlModes'],properties:{connector:{const:'Fan 3-pin'}}},then:{properties:{controlModes:{not:{contains:{const:'PWM'}}}}}}]};}
export function researchDefinitions(paths:Iterable<string>){
 const defs:Record<string,Schema>={};
 for(const path of [...new Set(paths)].sort()){
  const field=supported.get(path);if(!field)throw Error(`Unknown research schema path ${path}.`);
  if(isResearchCollectionPath(path)){
   const key=path.slice(6) as ResearchCollection,{record,update,limit}=researchCollectionSchemas(key);
   let newRecord=json(record),updateRecord=json(update);
   if(key==='ports')newRecord={...newRecord,allOf:[{if:{required:['kind'],properties:{kind:{const:'Custom'}}},then:{required:['customType'],properties:{customType:{type:'string',pattern:'\\S'}}}}]};
   if(key==='coolingHeaders'){newRecord=headerConstraints(newRecord);updateRecord=headerConstraints(updateRecord);}
   defs[definition(path,'new')]=newRecord;defs[definition(path,'update')]=updateRecord;
   defs[definition(path)]={type:'array',maxItems:limit,items:{$ref:reference(path,'update')},description:'Reuse existing IDs for partial updates. Validate newly added records with the corresponding new-record schema.'};
  }else{
   const schema=['manufacturer','source','model','family'].includes(path)?componentSchema.shape[path as 'manufacturer'|'source'|'model'|'family']:componentSpecsSchema.shape[path.slice(6) as keyof Specs];
   let value=json(schema);if(field.choices)value={...value,enum:field.choices};if(path==='source')value={allOf:[value,sourceURL]};defs[definition(path)]=value;
  }
 }
 return defs;
}
const exampleEvidence={sourceUrl:'https://manufacturer.example/manual.pdf',evidence:'Manufacturer specification table; replace with the actual source and relevant evidence.'};
export function researchReference(components:Component[]){
 const fields=components.map(researchFieldReferences),paths=fields.flatMap(fields=>fields.map(field=>field.path));
 return {
  guide:{
   readFirst:'Use componentIndex to choose records and paths before reading existing data. Shared JSON Schema definitions appear once in $defs. All references are JSON Pointers into this document.',
   indexSemantics:{availablePaths:'Use only these proposal paths for this component.',missingPaths:'Core gaps, excluding optional research opportunities.',existingRecordIds:'An absent path is an unknown inventory; an empty array is an explicitly recorded empty inventory. Reuse listed IDs for enrichment.'},
   navigation:{index:'#/componentIndex',schemas:'#/$defs',records:'#/components',instructions:'#/instructions'},
   writable:['components[*].proposals[*].value','components[*].proposals[*].sourceUrl','components[*].proposals[*].evidence'],
   returnFile:{required:['format','version','components'],componentRequired:['id','name','category','proposals'],preserve:'Keep each exported identity, including model when present. A compact response can omit guide, componentIndex, $defs, existing and missingFields.'},
   merge:{scalar:'Fill missing only.',collections:'Merge by stable ID; retain omitted records and fill unknown properties. A known-property conflict withholds the entire collection.',newRecords:'Validate against newRecordSchemaRef; partial updates use updateRecordSchemaRef. New IDs must represent genuinely additional physical records.',knownValues:'Zero, false and explicitly empty inventories/control lists are known. Do not clear, delete, rename IDs or overwrite known properties.',unresolved:'Omit value or use null, a blank string, or [] to leave a proposal unresolved. Do not guess.'},
   evidence:{requiredForNonblank:true,sourceProtocols:['http','https'],credentialsAllowed:false,description:'Provide a source URL and concise evidence for each proposal. Source URLs are recorded, not fetched. Applied changes remain unverified.'},
   limits:{components:researchPackLimit,proposalsPerComponent:100,totalProposals:20000,importBytes:8*1024*1024,evidenceCharacters:2000,sourceUrlCharacters:2000},
   validation:{filename:'component-research.schema.json',download:'/api/catalog/research/schema',draft:'2020-12',local:'Validate the returned envelope, supported paths, value types and evidence. Use new-record definitions for new IDs.',preview:'POST /api/catalog/research/preview',workspaceChecks:'Current identity/applicability, known-value conflicts, duplicate IDs/positions, merged-record constraints, collection references and selected-batch dependencies require workbench preview.'},
   exampleUsage:'Examples illustrate structure. Apply them only to matching availablePaths and replace example IDs, values and sources with documented facts.',
   examples:{scalarFill:{path:'specs.threadCount',value:16,...exampleEvidence},existingRecordEnrichment:{path:'specs.coolingDevices',value:[{id:'FAN_1',currentA:0.25}],...exampleEvidence},newRecordAddition:{path:'specs.coolingDevices',value:[{id:'PUMP_1',kind:'pump',powerConnector:'SATA power',controlConnector:'Fan 4-pin'}],...exampleEvidence}},
  },
  componentIndex:components.map((component,index)=>({id:component.id,identityKind:component.identityKind,...(component.identityKind==='placeholder'?{identificationNeeded:'Collect a part/asset label, CPU ID, memory SPD or inventory report tied to a PC. Do not guess a model or specifications. Resolve selected uses in Workbench; this catchall may cover multiple models.'}:{}),name:component.name,manufacturer:component.manufacturer,model:component.model,family:component.family,category:component.category,componentRef:`#/components/${index}`,proposalsRef:`#/components/${index}/proposals`,existingRef:`#/components/${index}/existing`,...(component.specs.notes?{notesRef:`#/components/${index}/existing/specs/notes`}:{}),availablePaths:fields[index].map(field=>field.path),missingPaths:fields[index].filter(field=>!field.optional).map(field=>field.path),optionalPaths:fields[index].filter(field=>field.optional).map(field=>field.path),existingRecordIds:Object.fromEntries(fields[index].filter(field=>isResearchCollectionPath(field.path)&&component.specs[field.path.slice(6) as keyof Specs]!==undefined).map(field=>[field.path,((component.specs[field.path.slice(6) as keyof Specs]||[]) as {id:string}[]).map(row=>row.id)]))})),
  $defs:researchDefinitions(paths),fields,
 };
}
/** Standalone authoring schema. Live identity and referential checks remain in preview. */
export function researchJSONSchema(){
 const schema=z.toJSONSchema(researchFileSchema,{io:'input'}) as Schema,properties=schema.properties as Record<string,Schema>,component=(properties.components.items as Schema),proposal=(((component.properties as Record<string,Schema>).proposals).items as Schema),proposalProperties=proposal.properties as Record<string,Schema>;
 const paths=[...supported.keys()].sort(),blank={anyOf:[{type:'null'},{type:'string',pattern:'^\\s*$'},{type:'array',maxItems:0}]};
 proposalProperties.path={type:'string',enum:paths};
 proposal.allOf=[{if:{required:['value'],properties:{value:{not:blank}}},then:{required:['sourceUrl','evidence'],properties:{sourceUrl:sourceURL,evidence:{type:'string',pattern:'\\S'}}}},...paths.map(path=>({if:{required:['path'],properties:{path:{const:path}}},then:{properties:{value:{anyOf:[{$ref:reference(path)},blank]}}}}))];
 return {...schema,title:'PC Workbench research handoff',description:'Authoring validation for research responses, including typed proposals and source evidence. Workbench preview checks live applicability, existing IDs/values, uniqueness, references and selected dependencies. New records must also satisfy their new-record definition.',$defs:researchDefinitions(paths)};
}
