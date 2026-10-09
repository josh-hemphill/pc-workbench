import {isPCInstallationKind} from './types';
import type {Database,InventoryPC} from './types';
import {locationPath,installationPCs,installationLocationIds} from './installations';
import {resolveRequirementVersion} from './compatibility';
import {checkInstalledPC,pcAllocations,planDifferences} from './inventory';
export function pcOperationalContext(pc:InventoryPC,db:Database){
 const location=db.installationLocations.find(l=>l.id===pc.installationLocationId),build=pc.buildSettings?resolveRequirementVersion(pc.buildSettings,db):undefined,requirement=location?resolveRequirementVersion(location,db):undefined;
 const system=db.systems.find(s=>s.id===pc.buildSettings?.systemId);
 const buildSet=db.requirementsSets.find(s=>s.id===pc.buildSettings?.requirementSetId),locationSet=db.requirementsSets.find(s=>s.id===location?.requirementSetId);
 const labels=[system?.name,buildSet?.name,locationSet?.name,build?`Build: ${build.name} · revision ${build.revision}`:undefined,requirement?`Installation: ${requirement.name} · revision ${requirement.revision}`:undefined].filter(Boolean) as string[];
 return {labels,equipment:[...(system?.connections||[]),...(build?.connections||[]),...(requirement?.connections||[])].map(c=>c.name)};
}
export function locationOperationRows(pcs:InventoryPC[],db:Database){return pcs.map(pc=>{const report=checkInstalledPC(pc,db),allocations=pcAllocations(pc.id,db),differences=planDifferences(pc,db);return {pc,report,differences,context:pcOperationalContext(pc,db),faultyParts:allocations.filter(a=>a.allocation.state==='installed'&&['Repair','Quarantined'].includes(a.stock.condition)),operationalStatus:pc.lifecycle==='Retired'?'Retired / archived':report.status,installed:allocations.filter(a=>a.allocation.state==='installed').reduce((n,a)=>n+a.allocation.quantity,0),reserved:allocations.filter(a=>a.allocation.state==='reserved').reduce((n,a)=>n+a.allocation.quantity,0),attention:pc.lifecycle!=='Retired'&&(['Maintenance','Parts only'].includes(pc.lifecycle||'')||report.status!=='Compatible'||differences.length>0)};});}
export function distributionVacancies(db:Database,locationId='',descendants=true){const ids=locationId?installationLocationIds(locationId,db,descendants):null;return db.installationLocations.filter(l=>isPCInstallationKind(l.kind)&&(!ids||ids.has(l.id))&&!installationPCs(l.id,db,false).some(p=>!['Retired','Parts only'].includes(p.lifecycle||'')));}
export function operationSearchText(pc:InventoryPC,db:Database){const c=pcOperationalContext(pc,db);return [pc.name,pc.serial,pc.location,locationPath(pc.installationLocationId||'',db),...c.labels,...c.equipment].join(' ').toLowerCase();}
