import {z} from 'zod';
import type {Component} from '../shared/types.ts';
import {componentSpecsSchema} from '../shared/component-schema.ts';
import {componentCapabilities} from '../shared/component-capabilities.ts';
import {sameValue} from '../shared/component-bulk.ts';
const collections={ports:'Named physical ports / back-panel connectors',slots:'PCIe / PCI slots and lane wiring',laneRules:'Lane sharing and disabled endpoints',coolingDevices:'Fans and pumps',coolingHeaders:'Cooling headers',coolingHeaderGroups:'Shared cooling current budgets'} as const;
export type ResearchCollection=keyof typeof collections;
const collectionLimits:Record<ResearchCollection,number>={ports:1000,slots:32,laneRules:100,coolingDevices:32,coolingHeaders:64,coolingHeaderGroups:32};
export const isResearchCollectionPath=(path:string)=>path.startsWith('specs.')&&Object.hasOwn(collections,path.slice(6));
export function engineeringFields(component:Component){
 const cap=componentCapabilities(component),fields:{key:ResearchCollection|'bifurcation';label:string;collection:boolean}[]=[];
 if(cap.ports)fields.push({key:'ports',label:collections.ports,collection:true});
 if(component.category==='Motherboard')fields.push({key:'slots',label:collections.slots,collection:true},{key:'laneRules',label:collections.laneRules,collection:true},{key:'bifurcation',label:'Motherboard bifurcation support',collection:false});
 if(['Fan','Cooler'].includes(component.category)||component.specs.coolingDevices!==undefined)fields.push({key:'coolingDevices',label:collections.coolingDevices,collection:true});
 if(['Motherboard','Bay accessory'].includes(component.category)||component.specs.coolingHeaders!==undefined)fields.push({key:'coolingHeaders',label:collections.coolingHeaders,collection:true},{key:'coolingHeaderGroups',label:collections.coolingHeaderGroups,collection:true});
 else if(component.specs.coolingHeaderGroups!==undefined)fields.push({key:'coolingHeaderGroups',label:collections.coolingHeaderGroups,collection:true});
 return fields;
}
export function researchCollectionSchemas(key:ResearchCollection){
 const complete=componentSpecsSchema.shape[key].unwrap(),record=complete.element;
 // Validate complete merged records with refinements after accepting partial existing records.
 const update=z.object({...Object.fromEntries(Object.entries(record.shape).map(([key,schema])=>[key,(schema as z.ZodType).optional()])),id:record.shape.id}).strict();
 return {complete,record,update,limit:collectionLimits[key]};
}
export class ResearchConflict extends Error {}
/** Existing list entries are never removed, renamed or overwritten. Omitted fields remain intact. */
export function mergeResearchRecords(component:Component,key:ResearchCollection,value:unknown){
 if(!Array.isArray(value)||!value.length)throw Error('Provide a nonempty array of named records.');
 const {complete,update}=researchCollectionSchemas(key);
 const input=z.array(update).max(collectionLimits[key]).parse(value) as Record<string,unknown>[];
 if(new Set(input.map(row=>row.id)).size!==input.length)throw Error('Use unique IDs in each proposed collection.');
 const before=component.specs[key] as unknown as Record<string,unknown>[]|undefined;
 if(before?.length===0)throw new ResearchConflict('An explicitly empty named inventory is already recorded. Edit it in the component editor.');
 const rows=structuredClone(before||[]);
 for(const proposed of input){
  const current=rows.find(row=>row.id===proposed.id);
  if(!current){rows.push(proposed);continue;}
  for(const [field,value] of Object.entries(proposed)){
   const known=current[field]!==undefined&&current[field]!==null&&!(typeof current[field]==='string'&&!String(current[field]).trim());
   if(known&&!sameValue(current[field],value))throw new ResearchConflict(`${key}.${String(proposed.id)}.${field} already has a known value; the whole collection proposal is withheld.`);
   if(!known)current[field]=value;
  }
 }
 const parsed=complete.parse(rows);
 if(key==='ports'&&before===undefined)for(const [count,kind] of [['usbA','USB-A'],['usbC','USB-C'],['ethernet','Ethernet']] as const){
  const known=component.specs[count],actual=(parsed as {kind?:string}[]).filter(row=>row.kind===kind).length;
  if(known!==undefined&&actual!==known)throw new ResearchConflict(`Named ports must match the recorded ${count} count (${known}); the proposal has ${actual}. Supply the complete inventory or correct the count in the component editor.`);
 }
 return parsed;
}

export function changedResearchRecords(before:unknown,after:unknown){
 return (after as Record<string,unknown>[]).flatMap(record=>{
  const current=(before as Record<string,unknown>[]|undefined)?.find(item=>item.id===record.id);
  if(!current)return [record];
  const changes=Object.fromEntries(Object.entries(record).filter(([key,value])=>key==='id'||!sameValue(current[key],value)));
  return Object.keys(changes).length>1?[changes]:[];
 });
}

/** Research must not introduce dangling shared-budget references in a selected cooling batch. */
export function validateResearchCooling(component:Component){
 for(const header of component.specs.coolingHeaders||[])if(header.limitGroup&&!component.specs.coolingHeaderGroups?.some(group=>group.id===header.limitGroup))throw Error(`Cooling header ${header.id}: shared current budget ${header.limitGroup} does not exist. Select its budget proposal too, or correct the header reference.`);
}
