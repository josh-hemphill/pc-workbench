import type {Configuration} from './types.ts';

/** Split a multi-unit BOM line without dangling references or duplicating physical wiring. */
export function splitConfigurationPlacement(configuration:Configuration,placementId:string,newId:()=>string):Configuration {
 const cfg:Configuration=JSON.parse(JSON.stringify(configuration));
 const index=cfg.placements.findIndex(p=>p.id===placementId),placement=cfg.placements[index];
 if(!placement||placement.quantity<2)return cfg;
 if(!Number.isInteger(placement.quantity)||placement.quantity>32)throw Error('Enter a whole quantity from 2 to 32 before splitting.');
 const provider=cfg.placements.some(p=>p.adapterPlacementId===placementId||p.controllerPlacementId===placementId||p.sataDataConnections?.some(c=>c.controllerPlacementId===placementId||c.cablePlacementId===placementId)||p.sffConnections?.some(c=>c.providerPlacementId===placementId||c.cablePlacementId===placementId)||p.sataPowerConnections?.some(c=>c.powerProviderPlacementId===placementId))||cfg.storage.groups?.some(g=>g.controllerPlacementId===placementId);
 if(provider)throw Error('This line supplies other placements. Assign their adapter, controller or power connections to individual provider lines before splitting.');
 if(placement.bayTargetIds?.length||placement.sataDataConnections?.length||placement.sataPowerConnections?.length||placement.sffConnections?.length)throw Error('This line has physical bay or cable assignments. Clear those assignments before splitting, then record the wiring for each individual unit.');
 if(cfg.portMappings?.some(m=>m.placementId===placementId&&(!Number.isInteger(m.instance)||m.instance<0||m.instance>=placement.quantity)))throw Error('Resolve the invalid equipment port instance before splitting.');
 const rows=Array.from({length:placement.quantity},(_,i)=>({...placement,id:i?newId():placement.id,quantity:1,slotId:'',targetId:''}));
 cfg.placements.splice(index,1,...rows);
 for(const mapping of cfg.portMappings||[])if(mapping.placementId===placementId){mapping.placementId=rows[mapping.instance]!.id;mapping.instance=0;}
 return cfg;
}
