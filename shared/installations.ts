import {isPCInstallationKind} from './types';
import type { Database, InstallationLocation, InventoryPC, Report, InstallationSnapshot } from './types';
import { checkConfiguration, resolveRequirementVersion } from './compatibility';
import { installedConfiguration, planDifferences } from './inventory';

/** A readable hierarchy with cycle protection even for not-yet-validated drafts. */
export function locationPath(id: string, db: Database): string {
  const names: string[] = [], visited = new Set<string>();
  let current = db.installationLocations?.find(location => location.id === id);
  while (current && !visited.has(current.id)) {
    visited.add(current.id); names.unshift(current.name);
    current = db.installationLocations?.find(location => location.id === current!.parentId);
  }
  return names.join(' / ');
}

export function installationLocationIds(locationId: string, db: Database, includeDescendants = true): Set<string> {
  const ids = new Set([locationId]);
  if (includeDescendants) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const location of db.installationLocations || []) if (ids.has(location.parentId) && !ids.has(location.id)) { ids.add(location.id); changed = true; }
    }
  }
  return ids;
}
export function installationPCs(locationId: string, db: Database, includeDescendants = true): InventoryPC[] {
  const ids=installationLocationIds(locationId,db,includeDescendants);
  return db.pcs.filter(pc => pc.installationLocationId && ids.has(pc.installationLocationId));
}

/** Physical parts follow installed allocations, never templates or reservations. */
export function installationParts(locationId: string, db: Database, includeDescendants = true) {
  const pcs = new Map(installationPCs(locationId, db, includeDescendants).map(pc => [pc.id, pc]));
  return db.inventory.flatMap(stock => stock.allocations.filter(allocation => allocation.state === 'installed' && pcs.has(allocation.pcId)).map(allocation => {
    const pc = pcs.get(allocation.pcId)!;
    return { stock, allocation, pc, locationPath: locationPath(pc.installationLocationId!, db) };
  }));
}

/** Validate the leaf's pinned requirements; parents are rollups, not implicit requirements. */
export function checkLocationPC(pc: InventoryPC, location: InstallationLocation, db: Database): Report {
  const actual = installedConfiguration(pc, db);
  // A location requirement is independent of the PC's captured build requirement.
  const candidate = { ...actual, requirementSetId: location.requirementSetId || undefined, requirementRevision: location.requirementRevision || undefined, requirementSnapshot: location.requirementSnapshot };
  const report = checkConfiguration(candidate, db);
  const add: (severity: 'error'|'warning', title: string, detail: string) => void = (severity,title,detail) => { report.findings.push({severity,title,detail}); };
  if (!isPCInstallationKind(location.kind)) add('error','PC location must be a leaf','Assign PCs to a Station, Bench or System, beneath a Site, Area or Line.');
  if (!location.requirementSetId) add('warning','Installation requirements not assigned',`${location.name}: select a published requirements revision.`);
  else if (!resolveRequirementVersion(location, db)) add('error','Installation requirements revision missing',`${location.name}: the pinned requirements revision cannot be found.`);
  if (location.targetConfigurationId) {
    const target = db.configurations.find(configuration => configuration.id === location.targetConfigurationId);
    if (!target) add('error','Installation target configuration missing',`${location.name}: choose an existing target configuration.`);
    else {
      if (target.status !== 'Approved') add('warning','Installation target not approved',`${location.name}: ${target.name} has not been approved.`);
      const differences = planDifferences({ ...pc, configurationId: target.id }, db);
      for (const difference of differences) add('warning','Installation target differs',`${location.name}: ${difference}`);
    }
  }
  report.status = report.findings.some(finding => finding.severity === 'error') ? 'Conflicts' : report.findings.some(finding => finding.severity === 'warning') ? 'Needs review' : 'Compatible';
  return report;
}

/** Capture physical assignment and its pinned requirement context with commissioning. */
export function installationSnapshot(pc:InventoryPC,db:Database):InstallationSnapshot|undefined {
  const location=db.installationLocations?.find(location=>location.id===pc.installationLocationId);
  if(!location)return undefined;
  return {locationId:location.id,path:locationPath(location.id,db),requirementSetId:location.requirementSetId,requirementRevision:location.requirementRevision,targetConfigurationId:location.targetConfigurationId,...(location.requirementSnapshot?{requirementSnapshot:structuredClone(location.requirementSnapshot)}:{})};
}
