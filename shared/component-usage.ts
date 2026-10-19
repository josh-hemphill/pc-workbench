import type {Database} from './types.ts';
export interface ComponentUsage {kind:'configuration'|'stock'|'requirementsSet';id:string;name:string;detail:string}
/** Current references block deletion; self-contained historical snapshots do not. */
export function componentUsage(componentId:string,db:Database):ComponentUsage[]{
 const uses:ComponentUsage[]=[];
 for(const config of db.configurations)if(config.placements.some(p=>p.componentId===componentId))uses.push({kind:'configuration',id:config.id,name:config.name,detail:'Configuration still includes this component type.'});
 for(const stock of db.inventory)if(stock.componentId===componentId){
  const pcs=[...new Set(stock.allocations.map(a=>`${db.pcs.find(p=>p.id===a.pcId)?.name||a.pcId} (${a.state})`))];
  uses.push({kind:'stock',id:stock.id,name:stock.assetTag||stock.serial||stock.id,detail:`Inventory record: ${stock.quantity} unit(s), ${stock.condition}${pcs.length?`; ${pcs.join(', ')}`:''}. Changing a PC’s planned configuration does not change its stock records or installed parts.`});
 }
 for(const set of db.requirementsSets){const revisions=set.versions.filter(v=>v.constraints?.requiredComponents?.some(c=>c.componentId===componentId)||Object.hasOwn(v.software?.drivers||{},componentId)||Object.hasOwn(v.software?.firmware||{},componentId)).map(v=>v.revision);if(revisions.length)uses.push({kind:'requirementsSet',id:set.id,name:set.name,detail:`Published requirements revision(s) ${revisions.join(', ')} require this component type.`});}
 return uses;
}

/** Empty lots can be archived together with a catalog deletion. */
export function componentDeletionBlockers(componentId:string,db:Database):ComponentUsage[]{const emptyIds=new Set(db.inventory.filter(s=>s.componentId===componentId&&s.quantity===0&&!s.allocations.length).map(s=>s.id));return componentUsage(componentId,db).filter(use=>use.kind!=='stock'||!emptyIds.has(use.id));}
