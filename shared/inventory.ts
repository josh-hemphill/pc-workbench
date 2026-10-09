import type { Configuration, Database, InventoryPC, StockAllocation, StockRecord } from './types';
import { checkConfiguration } from './compatibility';
import { mapStorageBindings, storageBindingsMatch } from './storage-bindings';
import { checkLocationPC, installationSnapshot } from './installations';

export function stockCounts(stock: StockRecord) {
  const reserved = stock.allocations.filter(a => a.state === 'reserved').reduce((n, a) => n + a.quantity, 0);
  const installed = stock.allocations.filter(a => a.state === 'installed').reduce((n, a) => n + a.quantity, 0);
  const unallocated = stock.quantity - reserved - installed;
  return { reserved, installed, unallocated, available: stock.condition === 'Serviceable' ? unallocated : 0 };
}

export function pcAllocations(pcId: string, db: Database) {
  return db.inventory.flatMap(stock => stock.allocations.filter(a => a.pcId === pcId).map(allocation => ({ stock, allocation })));
}

function providerIndex(installed:ReturnType<typeof pcAllocations>) {
  const exact=new Map(installed.map(row=>[row.allocation.id,row]));
  const planned=new Map<string,typeof installed>();
  for(const row of installed)if(row.allocation.plannedPlacementId){const id=row.allocation.plannedPlacementId,group=planned.get(id);if(group)group.push(row);else planned.set(id,[row]);}
  const resolve=(id='')=>{if(!id||exact.has(id))return id;const candidates=planned.get(id);return candidates?.length===1?candidates[0].allocation.id:id;};
  return {exact,planned,resolve};
}

/** Actual components come exclusively from installation records, never the mutable template. */
export function installedConfiguration(pc: InventoryPC, db: Database): Configuration {
  const installed = pcAllocations(pc.id, db).filter(r => r.allocation.state === 'installed');
  const {exact,planned,resolve:actualId}=providerIndex(installed);
  const actualPort=(mapping:NonNullable<Configuration['portMappings']>[number])=>{
    if(exact.has(mapping.placementId))return {...mapping};
    let instance=mapping.instance;
    for(const {allocation} of planned.get(mapping.placementId)||[]) {
      if(instance<allocation.quantity)return {...mapping,placementId:allocation.id,instance};
      instance-=allocation.quantity;
    }
    return {...mapping};
  };
  return {
    id: pc.id, name: pc.name, description: 'Recorded installed hardware', systemId: pc.buildSettings?.systemId || '',
    status: 'Draft', updatedAt: new Date(0).toISOString(),
    placements: installed.map(({ stock, allocation: a }) => ({
      id: a.id, componentId: stock.componentId, quantity: a.quantity, slotId: a.slotId,
      ...mapStorageBindings(a,actualId), role: a.role, mount: a.mount, group: a.group || '', targetId: a.targetId || '', adapterPlacementId: actualId(a.adapterPlacementId), controllerPlacementId: actualId(a.controllerPlacementId),
    })),
    requirementSetId:pc.buildSettings?.requirementSetId,requirementRevision:pc.buildSettings?.requirementRevision,requirementSnapshot:pc.buildSettings?.requirementSnapshot,
    storage: pc.buildSettings?.storage ? { ...pc.buildSettings.storage, ...(pc.buildSettings.storage.groups ? {groups:pc.buildSettings.storage.groups.map(g=>({...g,controllerPlacementId:actualId(g.controllerPlacementId)}))}: {}) } : { raid: 'none', bootMirror: false }, notes: pc.buildSettings?.notes || '', software: pc.software || pc.buildSettings?.software, portMappings: pc.buildSettings?.portMappings?.map(actualPort),
  };
}

export function checkInstalledPC(pc: InventoryPC, db: Database) {
  const report = checkConfiguration(installedConfiguration(pc, db), db);
  const allocations=pcAllocations(pc.id,db),providers=providerIndex(allocations.filter(row=>row.allocation.state==='installed'));
  if (!pc.buildSettings) report.findings.push({ severity: 'warning', title: 'Installed settings not recorded', detail: 'Capture or enter equipment and storage settings for this PC. Template settings are not inherited.' });
  for (const { stock, allocation } of allocations) {
    if (allocation.state === 'installed' && stock.condition !== 'Serviceable') {
      report.findings.push({ severity: 'error', title: 'Installed stock is not serviceable', detail: `${stock.serial || stock.assetTag || stock.id} is ${stock.condition.toLowerCase()}. Inspect and remove or repair this component.` });
    }
    if(allocation.state==='installed')for(const binding of new Set([allocation.adapterPlacementId,allocation.controllerPlacementId,...(allocation.sataDataConnections||[]).map(connection=>connection.controllerPlacementId),...(allocation.sataPowerConnections||[]).map(connection=>connection.powerProviderPlacementId)]))if(binding&&!providers.exact.has(binding)&&(providers.planned.get(binding)?.length||0)>1)report.findings.push({severity:'error',title:'Ambiguous installed provider binding',detail:'Several installed units match the planned adapter/controller. Record the exact allocation ID in Placement before commissioning.'});
  }
  if (commissioningDrift(pc,db)) report.findings.push({severity:'warning',title:'Changed since commissioning',detail:'Installed identities, hardware specifications, equipment settings or software differ from the latest accepted snapshot. Validate the changes and commission a new revision.'});
  if(pc.installationLocationId) {
    const location=db.installationLocations?.find(location=>location.id===pc.installationLocationId);
    if(!location)report.findings.push({severity:'error',title:'Installation location missing',detail:'The assigned physical installation location no longer exists.'});
    else {const locationReport=checkLocationPC(pc,location,db);for(const finding of locationReport.findings)if(!report.findings.some(previous=>previous.title===finding.title&&previous.detail===finding.detail&&previous.severity===finding.severity))report.findings.push(finding);if(location.requirementSetId)for(const resource of locationReport.resources.filter(resource=>resource.name.startsWith('Required ')||/\bports(?: \(|$)/.test(resource.name)))report.resources.push({...resource,name:`Installation ${resource.name}`});}
  }
  report.status = report.findings.some(f => f.severity === 'error') ? 'Conflicts' : report.findings.some(f => f.severity === 'warning') ? 'Needs review' : 'Compatible';
  return report;
}

export function commissioningDrift(pc:InventoryPC,db:Database) {
  if (!pc.snapshot) return false;
  const canonical=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
  const actual=installedConfiguration(pc,db);
  if(canonical(installationSnapshot(pc,db)||null)!==canonical(pc.snapshot.installation||null))return true;
  if (canonical(actual)!==canonical(pc.snapshot.configuration)) return true;
  if (pc.snapshot.components.some(previous=>canonical(previous)!==canonical(db.components.find(c=>c.id===previous.id)))) return true;
  if (!actual.requirementSetId && canonical(pc.snapshot.system)!==canonical(db.systems.find(s=>s.id===actual.systemId)||null)) return true;
  if (pc.snapshot.installedStock) {
    const identities=pcAllocations(pc.id,db).filter(r=>r.allocation.state==='installed').map(({stock,allocation:a})=>({stockId:stock.id,componentId:stock.componentId,serial:stock.serial,assetTag:stock.assetTag,allocationId:a.id,quantity:a.quantity,...mapStorageBindings(a),role:a.role,mount:a.mount,slotId:a.slotId,group:a.group,targetId:a.targetId}));
    if(canonical(identities)!==canonical(pc.snapshot.installedStock))return true;
  }
  return false;
}

/** Group demand by type so separate BOM lines never double-count the same free pool. */
export function stockReadiness(configuration: Configuration, db: Database, pcId = '') {
  const demand = new Map<string, number>();
  for (const p of configuration.placements) demand.set(p.componentId, (demand.get(p.componentId) || 0) + (Number.isInteger(p.quantity) && p.quantity > 0 ? p.quantity : 0));
  return [...demand].map(([componentId, required]) => {
    let available = 0, installed = 0, reserved = 0, blocked = 0;
    for (const stock of db.inventory.filter(s => s.componentId === componentId)) {
      available += stockCounts(stock).available;
      for (const a of stock.allocations.filter(a => a.pcId === pcId)) {
        if (stock.condition !== 'Serviceable') blocked += a.quantity;
        else if (a.state === 'installed') installed += a.quantity;
        else reserved += a.quantity;
      }
    }
    const remaining = Math.max(0, required - installed - reserved);
    return { componentId, required, installed, reserved, blocked, remaining, available, shortage: Math.max(0, remaining - available) };
  });
}

export function planDifferences(pc: InventoryPC, db: Database) {
  const template = db.configurations.find(c => c.id === pc.configurationId);
  if (!template) return ['No planned configuration linked.'];
  const installed = pcAllocations(pc.id, db).filter(r => r.allocation.state === 'installed');
  const assignments = installed.map(() => new Map<number, number>());
  const {resolve:providerId}=providerIndex(installed);
  const bayAnchors=new Set(template.placements.filter(p=>{
    if(!p.bayTargetIds?.length||!p.targetId)return false;
    const provider=template.placements.find(row=>p.adapterPlacementId?row.id===p.adapterPlacementId:db.components.find(c=>c.id===row.componentId)?.category==='Chassis');
    return db.components.find(c=>c.id===provider?.componentId)?.specs.bayTargets?.some(bay=>bay.id===p.targetId);
  }).map(p=>p.id));
  const matches = (pi: number, ai: number) => {
    const p = template.placements[pi], { stock, allocation: a } = installed[ai];
    const plannedBays=p.bayTargetIds?.length?new Set(p.bayTargetIds):undefined;
    if(plannedBays&&(!a.bayTargetIds?.length||a.bayTargetIds.some(id=>!plannedBays.has(id))))return false;
    // Each explicitly located unit can cover its subset of an aggregate BOM span.
    // Check the complete union below after matching component quantities.
    return storageBindingsMatch({...p,bayTargetIds:undefined},a,providerId) && stock.componentId === p.componentId && a.role === p.role && (p.mount === 'auto' || a.mount === p.mount) && (!p.slotId || a.slotId === p.slotId) && (a.group||'')===(p.group||'') && (!p.targetId || bayAnchors.has(p.id) || a.targetId === p.targetId) && (!p.adapterPlacementId || providerId(a.adapterPlacementId)===providerId(p.adapterPlacementId)) && (!p.controllerPlacementId || providerId(a.controllerPlacementId)===providerId(p.controllerPlacementId));
  };
  // Reassign flexible matches when a later constrained placement needs the same unit.
  // This finds maximum matching instead of falsely reporting drift based on BOM order.
  function matchOne(pi: number, visited: Set<number>, visitedPlans = new Set<number>()): boolean {
    if (visitedPlans.has(pi)) return false;
    visitedPlans.add(pi);
    for (let ai = 0; ai < installed.length; ai++) {
      if (visited.has(ai) || !matches(pi, ai)) continue;
      visited.add(ai);
      const used = [...assignments[ai].values()].reduce((n, q) => n + q, 0);
      if (used < installed[ai].allocation.quantity) {
        assignments[ai].set(pi, (assignments[ai].get(pi) || 0) + 1); return true;
      }
      for (const [other, qty] of assignments[ai]) if (qty > 0 && matchOne(other, visited, visitedPlans)) {
        assignments[ai].set(other, qty - 1); assignments[ai].set(pi, (assignments[ai].get(pi) || 0) + 1); return true;
      }
    }
    return false;
  }
  const differences: string[] = [];
  for (const [pi, p] of template.placements.entries()) {
    let needed = p.quantity;
    while (needed > 0 && matchOne(pi, new Set())) needed--;
    if (needed > 0) differences.push(`${needed} × ${db.components.find(c => c.id === p.componentId)?.name || p.componentId} missing or placed differently (${p.role}, ${p.mount}${p.slotId ? `, ${p.slotId}` : ''}).`);
  }
  // Later constrained plans can move earlier matches; inspect the final assignment.
  for(const [pi,p] of template.placements.entries()){
    if(p.bayTargetIds?.length&&assignments.reduce((n,assigned)=>n+(assigned.get(pi)||0),0)===p.quantity){
      const occupied=new Set(installed.flatMap((row,ai)=>(assignments[ai].get(pi)||0)>0?row.allocation.bayTargetIds||[]:[]));
      const missing=p.bayTargetIds.filter(id=>!occupied.has(id));
      if(missing.length)differences.push(`Recorded bay occupancy differs from the template for ${db.components.find(c=>c.id===p.componentId)?.name||p.componentId}: missing ${missing.join(', ')}.`);
    }
  }
  for (const [ai, row] of installed.entries()) {
    const left = row.allocation.quantity - [...assignments[ai].values()].reduce((n, q) => n + q, 0);
    if (left > 0) differences.push(`${left} × ${db.components.find(c => c.id === row.stock.componentId)?.name || row.stock.componentId} installed outside the planned placement.`);
  }
  const normalize=(value:unknown):unknown=>{if(value===undefined||value==='')return undefined;if(Array.isArray(value)){const list=value.map(normalize);return list.length?list:undefined;}if(value&&typeof value==='object'){const entries=Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,val])=>[key,normalize(val)] as const).filter(([,val])=>val!==undefined);return entries.length?Object.fromEntries(entries):undefined;}return value;};
  const current=installedConfiguration(pc,db),planned=installedConfiguration({...pc,software:template.software,buildSettings:{systemId:template.systemId,storage:template.storage,notes:'',software:template.software,portMappings:template.portMappings,requirementSetId:template.requirementSetId,requirementRevision:template.requirementRevision,requirementSnapshot:template.requirementSnapshot}},db);
  const settings=(cfg:Configuration)=>normalize({systemId:cfg.systemId,storage:cfg.storage,software:cfg.software,portMappings:cfg.portMappings,requirementSetId:cfg.requirementSetId,requirementRevision:cfg.requirementRevision});
  if (!pc.buildSettings || JSON.stringify(settings(current))!==JSON.stringify(settings(planned))) differences.push('Recorded equipment or redundancy settings differ from the template (including storage groups, software or port mappings).');
  return differences;
}

/** Expired holds stay allocated until a person explicitly releases them. */
export function overdueReservations(db: Database, at = Date.now()) {
  return db.inventory.flatMap(stock => stock.allocations.filter(a => a.state === 'reserved' && a.expiresAt && Date.parse(a.expiresAt) <= at).map(allocation => ({ stock, allocation })));
}

/** Allocate each free pool once across the registered fleet, in registration order. */
export function fleetPicklist(db: Database) {
  const pool = new Map<string, number>();
  for (const s of db.inventory) pool.set(s.componentId, (pool.get(s.componentId) || 0) + stockCounts(s).available);
  return db.pcs.filter(pc => pc.lifecycle !== 'Retired' && pc.lifecycle !== 'Parts only').flatMap(pc => {
    const cfg = db.configurations.find(c => c.id === pc.configurationId);
    if (!cfg) return [];
    return stockReadiness(cfg, db, pc.id).map(r => {
      const available = pool.get(r.componentId) || 0, pick = Math.min(available, r.remaining);
      pool.set(r.componentId, available - pick);
      return { pcId: pc.id, pcName: pc.name, componentId: r.componentId, required: r.required, installed: r.installed, reserved: r.reserved, pick, shortage: r.remaining - pick };
    });
  });
}

export function reorderSuggestions(db: Database) {
  return db.components.map(component => {
    const stocks = db.inventory.filter(s => s.componentId === component.id && s.condition !== 'Retired');
    const available = stocks.reduce((n, s) => n + stockCounts(s).available, 0);
    const reorderLevel = Math.max(0, ...stocks.map(s => s.reorderLevel || 0));
    return { componentId: component.id, name: component.name, available, reorderLevel, order: Math.max(0, reorderLevel - available), suppliers: [...new Set(stocks.map(s => s.supplier).filter(Boolean))].join(', ') };
  }).filter(r => r.order > 0);
}
