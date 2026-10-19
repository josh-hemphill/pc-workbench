import {z} from 'zod';
import type {Component} from '../shared/types.ts';
import {componentSpecsSchema} from '../shared/component-schema.ts';
import {componentCapabilities} from '../shared/component-capabilities.ts';
import {sameValue} from '../shared/component-bulk.ts';
const collections={ports:'Named physical ports / back-panel connectors',slots:'PCIe / PCI slots and lane wiring',laneRules:'Lane sharing and disabled endpoints'} as const;
export type ResearchCollection=keyof typeof collections;
export function engineeringFields(component:Component){
 const cap=componentCapabilities(component),fields:{key:ResearchCollection|'bifurcation';label:string;collection:boolean}[]=[];
 if(cap.ports)fields.push({key:'ports',label:collections.ports,collection:true});
 if(component.category==='Motherboard')fields.push({key:'slots',label:collections.slots,collection:true},{key:'laneRules',label:collections.laneRules,collection:true},{key:'bifurcation',label:'Motherboard bifurcation support',collection:false});
 return fields;
}
export class ResearchConflict extends Error {}
/** Existing list entries are never removed, renamed or overwritten. Omitted fields remain intact. */
export function mergeResearchRecords(component:Component,key:ResearchCollection,value:unknown){
 if(!Array.isArray(value)||!value.length)throw Error('Provide a nonempty array of named records.');
 const schema=componentSpecsSchema.shape[key].unwrap(),element=schema.element;
 // Build a partial record schema; validate all complete merged records and refinements below.
 const partial=z.object({...Object.fromEntries(Object.entries(element.shape).map(([key,schema])=>[key,(schema as z.ZodType).optional()])),id:element.shape.id}).strict();
 const input=z.array(partial).max(key==='slots'?32:key==='ports'?1000:100).parse(value) as Record<string,unknown>[];
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
 const parsed=schema.parse(rows);
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
