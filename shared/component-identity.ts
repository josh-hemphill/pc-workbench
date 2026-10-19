import type {Component} from './types.ts';
/** Formatting equivalence is a review hint, never permission to combine stock. */
export const normalizedModel=(value:string|undefined)=>(value||'').normalize('NFKC').toLowerCase().replace(/[\s_-]+/g,'');
const manufacturer=(c:Component)=>c.manufacturer.trim().toLowerCase().replace(/\s+/g,' ');
export function identityDifferences(a:Component,b:Component){
 const differences:string[]=[];
 if(manufacturer(a)&&manufacturer(b)&&manufacturer(a)!==manufacturer(b))differences.push('Manufacturer');
 if(a.model?.trim()&&normalizedModel(a.model)!==normalizedModel(b.model))differences.push('Model / part number');
 if(['Drive','Memory'].includes(a.category)&&a.specs.capacityGb!==undefined&&b.specs.capacityGb!==undefined&&a.specs.capacityGb!==b.specs.capacityGb)differences.push('Capacity');
 return differences;
}
export function duplicateModelGroups(components:Component[]){
 const groups=new Map<string,Component[]>();
 for(const component of components){if(!manufacturer(component)||!normalizedModel(component.model))continue;const key=JSON.stringify([component.category,manufacturer(component),normalizedModel(component.model),['Drive','Memory'].includes(component.category)?component.specs.capacityGb??null:null]);const group=groups.get(key)||[];group.push(component);groups.set(key,group);}
 return [...groups.values()].filter(group=>group.length>1);
}
export const componentIdentityLabel=(c:Component)=>[c.name,c.model&&`Model: ${c.model}`,c.family&&`Family: ${c.family}`,c.category==='Drive'||c.category==='Memory'?c.specs.capacityGb!==undefined?`${c.specs.capacityGb} GB`:undefined:undefined].filter(Boolean).join(' · ');
