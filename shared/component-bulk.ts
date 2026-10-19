import type {Component,Database,Specs} from './types.ts';
import {componentSchema,componentSpecsSchema} from './component-schema.ts';
import {componentCapabilities} from './component-capabilities.ts';
import {componentFields} from './component-fields.ts';
import {componentReferences,type ComponentCollection} from './component-editor.ts';
export type ComponentFieldMode='set'|'fill'|'merge'|'clear';
export interface ComponentFieldEdit {path:string;mode:ComponentFieldMode;value?:unknown}
export const componentSpecKeys=Object.keys(componentSpecsSchema.shape) as (keyof Specs)[];
export const componentCollections:ComponentCollection[]=['ports','slots','laneRules','bayTargets','driveTargets','sataDataPorts','sataPowerConnectors','sataDataInputs','sataPowerInputs','sffPorts','sffInputs','coolingDevices','coolingHeaders','coolingHeaderGroups'];
export const componentFieldPaths=['manufacturer','model','family','source','verified',...componentSpecKeys.map(key=>`specs.${key}`)];
export const sameValue=(a:unknown,b:unknown):boolean=>{
 if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
 if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>sameValue(v,b[i]));
 const aa=a as Record<string,unknown>,bb=b as Record<string,unknown>,keys=Object.keys(aa);return keys.length===Object.keys(bb).length&&keys.every(key=>Object.hasOwn(bb,key)&&sameValue(aa[key],bb[key]));
};
export function componentDraftValue(c:Component,path:string):unknown{return path.startsWith('specs.')?(c.specs as Record<string,unknown>)[path.slice(6)]:(c as unknown as Record<string,unknown>)[path];}
export function componentFieldValue(c:Component,path:string):unknown{
 if(path==='specs.storageAdapterKind'&&c.category==='Storage adapter')return componentCapabilities(c).adapter;
 if(path==='specs.driveKind'&&c.category==='Drive')return c.specs.driveKind||(componentCapabilities(c).optical?'optical':'disk');
 if(path==='specs.slotBus'&&componentCapabilities(c).slotCard)return c.specs.slotBus||'PCIe';
 return path.startsWith('specs.')?(c.specs as Record<string,unknown>)[path.slice(6)]:(c as unknown as Record<string,unknown>)[path];
}
export function fullBulkEditor(components:Component[]){const first=components[0];return !!first&&components.every(c=>c.category===first.category&&sameValue(componentCapabilities(c),componentCapabilities(first)));}
function applicableSpecKeys(c:Component){
 const cap=componentCapabilities(c),keys=new Set<string>([...componentFields(c).map(f=>f.key),...Object.keys(c.specs),'notes']);
 const add=(...fields:string[])=>fields.forEach(key=>keys.add(key));
 if(c.category==='Storage adapter')add('storageAdapterKind');if(c.category==='Drive')add('driveKind');
 if(cap.ports)add('ports');if(c.category==='Motherboard')add('slots','laneRules','m2Slots','m2Lengths','driveTargets');
 if(['Fan','Cooler'].includes(c.category)||c.specs.coolingDevices!==undefined)add('coolingDevices','sataPowerPlugs');
 if(['Motherboard','Bay accessory'].includes(c.category)||c.specs.coolingHeaders!==undefined)add('coolingHeaders','coolingHeaderGroups');
 if(cap.software)add('supportedOS','requiredDriver','requiredFirmware');if(cap.controller)add('bootable','hotPlug');
 if(cap.pci)add('pciVoltage','pciBits');if(cap.nvmeSled)add('bifurcationMode');
 if(cap.bayProvider)add('bayTargets');if(cap.driveTargets)add('driveTargets');if(cap.bayConsumer)add('baySize','bayUnits','lengthMm');
 if(cap.sataController)add('sataPorts','sataDataPorts');if(c.category==='PSU')add('sataPower','sataPowerConnectors');
 if(cap.sataDataConsumer)add('sataDataInputs');if(cap.adapter==='bay-cage'||c.category==='Bay accessory')add('sataPowerInputs','sataPowerPlugs');
 if(cap.sffProvider)add('sffPorts');if(cap.sff&&!cap.m2Converter&&c.category!=='Motherboard')add('sffInputs');
 return keys;
}
export function sharedComponentPaths(components:Component[]){
 if(!components.length)return [];
 if(fullBulkEditor(components))return componentFieldPaths;
 const sets=components.map(applicableSpecKeys);return componentFieldPaths.filter(path=>!path.startsWith('specs.')||sets.every(keys=>keys.has(path.slice(6))));
}
export function commonComponentDraft(components:Component[]):Component{
 const first=components[0];if(!first)throw Error('Select existing components.');
 const draft:Component={id:'bulk-template',name:'Selected components',category:first.category,manufacturer:'',source:'',verified:false,specs:{}};
 for(const path of sharedComponentPaths(components)){
  const value=componentFieldValue(first,path);if(value===undefined||!components.every(c=>sameValue(componentFieldValue(c,path),value)))continue;
  if(path.startsWith('specs.'))(draft.specs as Record<string,unknown>)[path.slice(6)]=structuredClone(value);
  else (draft as unknown as Record<string,unknown>)[path]=structuredClone(value);
 }
 return draft;
}
const labels:Record<string,string>={model:'Model / part number',family:'Family / series',source:'Source / documentation URL',verified:'Verified',manufacturer:'Manufacturer',ports:'Physical ports',slots:'Expansion slots',laneRules:'Lane sharing rules',bayTargets:'Mounting bays',driveTargets:'Drive / M.2 positions',sataDataPorts:'SATA data ports provided',sataPowerConnectors:'SATA power plugs provided',sataDataInputs:'SATA data inputs consumed',sataPowerInputs:'SATA power inputs consumed',sffPorts:'SFF output ports',sffInputs:'SFF input connectors',coolingDevices:'Fans and pumps',coolingHeaders:'Cooling headers',coolingHeaderGroups:'Shared cooling budgets',notes:'Specification notes'};
export function componentFieldLabel(path:string,c?:Component){const key=path.replace(/^specs\./,'');return labels[key]||c&&componentFields(c).find(field=>field.key===key)?.label||key.replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/^./,v=>v.toUpperCase());}
export const collectionPath=(path:string)=>path.startsWith('specs.')&&componentCollections.includes(path.slice(6) as ComponentCollection);
const countSources:Partial<Record<keyof Specs,keyof Specs>>={sataPorts:'sataDataPorts',sataPower:'sataPowerConnectors',sataPowerPlugs:'sataPowerInputs',m2Slots:'driveTargets',m2Lengths:'driveTargets',usbA:'ports',usbC:'ports',ethernet:'ports'};
export function changedComponentPaths(before:Component,after:Component,allowed:string[]){
 const changed=allowed.filter(path=>!sameValue(componentDraftValue(before,path),componentDraftValue(after,path)));
 return changed.filter(path=>{const source=countSources[path.slice(6) as keyof Specs];return !path.startsWith('specs.')||!source||!changed.includes(`specs.${source}`);});
}
function missing(value:unknown){return value==null||typeof value==='string'&&!value.trim();}
function effectiveValue(c:Component,path:string){
 const key=path.slice(6) as keyof Specs,source=path.startsWith('specs.')?countSources[key]:undefined;
 return source&&c.specs[source]!==undefined?c.specs[source]:componentFieldValue(c,path);
}
export function applyComponentFieldEdits(component:Component,edits:ComponentFieldEdit[],db:Database):Component{
 const next=structuredClone(component),namedTouched=new Set<string>();let verificationChosen=false;
 for(const edit of edits){
  const isSpec=edit.path.startsWith('specs.'),key=isSpec?edit.path.slice(6):edit.path;
  if(!componentFieldPaths.includes(edit.path))throw Error(`Unsupported component field: ${edit.path}`);
  const target=(isSpec?next.specs:next) as unknown as Record<string,unknown>,before=target[key];
  if(edit.mode==='fill'&&!missing(effectiveValue(next,edit.path)))continue;
  if(edit.mode==='clear'){
   if(!isSpec&&!['model','family'].includes(key))target[key]=key==='verified'?false:'';else delete target[key];
  }else if(edit.mode==='merge'){
   if(!collectionPath(edit.path)||!Array.isArray(edit.value))throw Error('Merge requires a named record list.');
   const entries=edit.value as {id:string}[];if(entries.some(row=>!row||typeof row.id!=='string')||new Set(entries.map(row=>row.id)).size!==entries.length)throw Error('Use unique IDs in each list.');
   const rows=(Array.isArray(before)?before:[]) as {id:string}[],updates=new Map(entries.map(row=>[row.id,row]));
   target[key]=[...rows.map(row=>updates.has(row.id)?{...row,...updates.get(row.id)}:row),...entries.filter(row=>!rows.some(existing=>existing.id===row.id))];
  }else{
   if(edit.value===undefined)throw Error(`Provide a value for ${componentFieldLabel(edit.path,component)}.`);
   if(isSpec&&countSources[key as keyof Specs]&&effectiveValue(next,edit.path)!==before&&!edits.some(e=>e.path===`specs.${countSources[key as keyof Specs]}`))throw Error(`${component.name}: edit the named list instead of its derived ${key} count.`);
   target[key]=structuredClone(edit.value);
  }
  if(edit.path==='verified'&&(edit.mode==='set'||edit.mode==='clear'))verificationChosen=true;
  if(collectionPath(edit.path))namedTouched.add(key);
 }
 for(const [count,source] of Object.entries(countSources))if(namedTouched.has(source)&&Array.isArray((next.specs as Record<string,unknown>)[source])){
  const rows=(next.specs as Record<string,unknown>)[source] as {kind?:string;driveSizes?:string[];m2Lengths?:number[]}[];
  if(['usbA','usbC','ethernet'].includes(count))(next.specs as Record<string,unknown>)[count]=rows.filter(row=>row.kind===({usbA:'USB-A',usbC:'USB-C',ethernet:'Ethernet'} as Record<string,string>)[count]).length;
  else if(count==='m2Slots'||count==='m2Lengths'){if(next.category==='Motherboard')(next.specs as Record<string,unknown>)[count]=count==='m2Slots'?rows.filter(row=>row.driveSizes?.includes('M.2')).length:[...new Set(rows.filter(row=>row.driveSizes?.includes('M.2')).flatMap(row=>row.m2Lengths||[]))];}
  else (next.specs as Record<string,unknown>)[count]=rows.length;
  const originalCount=(component.specs as Record<string,unknown>)[count],derivedCount=(next.specs as Record<string,unknown>)[count];
  if(component.specs[source as keyof Specs]===undefined&&typeof originalCount==='number'&&typeof derivedCount==='number'&&derivedCount<originalCount&&edits.find(edit=>edit.path===`specs.${source}`)?.mode!=='set')throw Error(`${component.name}: the named ${source} list would reduce the recorded ${count} count (${originalCount} to ${derivedCount}). Provide the complete inventory or choose Replace value explicitly.`);
 }
 const parsed=componentSchema.safeParse(next);if(!parsed.success)throw Error(`${component.name}: ${parsed.error.issues.map(issue=>`${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
 const referenceDB={...db,components:db.components.map(c=>c.id===component.id?next:c)};
 for(const key of componentCollections)for(const row of (component.specs[key]||[]) as {id:string}[])if(!((next.specs[key]||[]) as {id:string}[]).some(item=>item.id===row.id)){
  const refs=componentReferences(next,key,row.id,referenceDB);if(refs.length)throw Error(`${component.name}: keep ${row.id}; used by ${refs.join(', ')}.`);
 }
 if(!verificationChosen&&(!sameValue(component.specs,next.specs)||!sameValue(component.model,next.model)))next.verified=false;
 return next;
}
