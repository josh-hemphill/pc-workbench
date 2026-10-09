import type { BaySize, BayTarget, Component, Configuration, Database, Finding, Resource } from './types';
import { componentCapabilities } from './component-capabilities';

/** Mounting spaces and logical drive positions are separate. Only physical spaces contribute bay consumption. */
export function checkBayTopology(config: Configuration, db: Database): { findings: Finding[]; resources: Resource[] } {
  const findings: Finding[] = [], resources: Resource[] = [];
  const rows = config.placements.flatMap(p => { const c = db.components.find(c => c.id === p.componentId); return c ? [{ p, c }] : []; });
  type Row = typeof rows[number];
  const chassis = rows.find(row => row.c.category === 'Chassis');
  const add = (severity: Finding['severity'], title: string, detail: string) => findings.push({ severity, title, detail });
  const use = new Map<string, Map<BaySize, number>>();
  const occupied = new Map<string, string>();
  let front = 0;
  function resource(name: string, used: number, available?: number) {
    if (available === undefined) { if (used) add('warning', `${name} capacity unknown`, `${used} positions required. Enter available capacity in the catalog.`); return; }
    resources.push({ name, used, available });
    if (used > available) add('error', `${name} capacity exceeded`, `${used} positions required; ${available} available.`);
  }
  function capacity(c: Component, size: BaySize) {
    const scalar = size === '2.5' ? c.specs.bays25 : size === '3.5' ? c.specs.bays35 : c.specs.bays525;
    if (c.specs.bayTargets === undefined) return scalar;
    const listed = c.specs.bayTargets.filter(bay => bay.size === size).length;
    if (scalar !== undefined && scalar < listed) add('warning', 'Bay capacity declarations disagree', `${c.name}: ${listed} named ${size}-inch spaces exceed the aggregate count ${scalar}. Verify the catalog; named spaces are retained.`);
    return Math.max(scalar ?? 0, listed);
  }
  function adjacency(row: Row, targets: BayTarget[], units: number) {
    if (units <= 1) return;
    if (targets.some(target => !target.group?.trim() || target.position === undefined)) {
      add('warning', 'Multi-bay adjacency unconfirmed', `${row.c.name}: record a bank/group and ordered position on every occupied bay to verify adjacency.`); return;
    }
    const groups = new Map<string, number[]>();
    for (const target of targets) { const group = target.group!.trim(); groups.set(group, [...groups.get(group) || [], target.position!]); }
    for (const [group, positions] of groups) {
      positions.sort((a, b) => a - b);
      if (positions.length % units || positions.some((position, index) => index % units !== 0 && position !== positions[index - 1]! + 1)) {
        add('error', 'Mounting bays are not adjacent', `${row.c.name}: each unit needs ${units} contiguous spaces in one bay bank; the selected spaces in ${group} do not form complete adjacent spans.`);
      }
    }
  }
  function consume(row: Row, provider: Row | undefined, size: BaySize, units: number, ids: string[], complete: boolean) {
    if (!provider || provider.p.id === row.p.id) {
      add('error', 'Bay provider missing', `${row.c.name}: bind another installed chassis or physical mounting adapter.`); return;
    }
    const ancestry = new Set([row.p.id]); let ancestor: Row | undefined = provider;
    while (ancestor) {
      if (ancestry.has(ancestor.p.id)) { add('error', 'Bay provider cycle', `${row.c.name}: mounting providers cannot contain one another.`); break; }
      ancestry.add(ancestor.p.id);
      ancestor = ancestor.p.adapterPlacementId ? rows.find(candidate => candidate.p.id === ancestor!.p.adapterPlacementId) : undefined;
    }
    if (!componentCapabilities(provider.c).bayProvider) { add('error', 'Bay provider missing', `${row.c.name}: ${provider.c.name} is not a physical bay provider.`); return; }
    if (provider.p.quantity !== 1 && (ids.length || row.p.adapterPlacementId)) add('error', 'Ambiguous bay provider instance', `${row.c.name}: split ${provider.c.name} into individual placements before selecting its physical bays.`);
    const required = units * row.p.quantity;
    const counts = use.get(provider.p.id) || new Map<BaySize, number>();
    counts.set(size, (counts.get(size) || 0) + required); use.set(provider.p.id, counts);
    if (complete && ids.length !== required) add('error', 'Occupied bay count mismatch', `${row.c.name}: ${row.p.quantity} unit(s) need ${required} physical spaces; ${ids.length} are selected.`);
    if (!ids.length) { add('warning', 'Individual bay target unrecorded', `${row.c.name}: select named physical bays for fit and occupancy checks.`); if (units > 1) add('warning', 'Multi-bay adjacency unconfirmed', `${row.c.name}: select all ${required} occupied bays and record their bank and positions to verify adjacency.`); return; }
    const targets: BayTarget[] = [];
    for (const id of ids) {
      const target = provider.c.specs.bayTargets?.find(bay => bay.id === id);
      if (!target) { add('error', 'Bay target missing', `${row.c.name}: ${id} is not a physical bay on ${provider.c.name}.`); continue; }
      targets.push(target);
      const key = JSON.stringify([provider.p.id, id]);
      if (occupied.has(key) || !complete && row.p.quantity !== 1) add('error', 'Bay target double booked', `${provider.c.name} / ${id}: ${row.c.name} shares a physical space with ${occupied.get(key) || 'another unit of the same placement'}.`);
      occupied.set(key, row.c.name);
      if (target.size !== size) add('error', 'Bay size mismatch', `${row.c.name} requires ${size}-inch bays; ${id} is ${target.size}-inch.`);
      if (target.maxDepthMm !== undefined && row.c.specs.lengthMm !== undefined && row.c.specs.lengthMm > target.maxDepthMm) add('error', 'Bay depth exceeded', `${row.c.name}: ${row.c.specs.lengthMm} mm depth exceeds ${id}'s ${target.maxDepthMm} mm clearance.`);
      else if (target.maxDepthMm === undefined || row.c.specs.lengthMm === undefined) add('warning', 'Bay depth unconfirmed', `${row.c.name} / ${id}: verify component depth and available mounting clearance.`);
    }
    if (units > 1 && !complete) add('warning', 'Multi-bay occupancy review', `${row.c.name}: ${required} bays are budgeted but only the legacy anchor ${ids[0]} is bound. Select every occupied bay to verify overlap and adjacency.`);
    if (complete && targets.length === required) adjacency(row, targets, units);
  }
  for (const row of rows) {
    const { p, c } = row;
    const isDrive = c.category === 'Drive';
    const explicitBays = p.bayTargetIds?.length ? p.bayTargetIds : undefined;
    let provider = p.adapterPlacementId ? rows.find(candidate => candidate.p.id === p.adapterPlacementId) : chassis;
    if (isDrive) {
      if (c.specs.driveSize === 'M.2' || p.mount === 'rear-sled') continue;
      const target = provider?.c.specs.driveTargets?.find(target => target.id === p.targetId);
      const targetFits = target && (p.mount === 'auto' || target.mount === p.mount) && target.driveSizes?.includes(c.specs.driveSize || '') && target.interfaces?.includes(c.specs.driveInterface || '');
      // Drives inside a cage consume its logical positions; the cage itself consumes the chassis spaces.
      if (provider && ['bay-cage', 'mount-adapter'].includes(componentCapabilities(provider.c).adapter || '') && targetFits && !target.bayId && explicitBays === undefined) continue;
      const mount = p.mount === 'auto' && target ? target.mount : p.mount;
      if (mount === 'front-hot-swap' && (!provider || provider.c.category === 'Chassis' || !targetFits)) front += p.quantity;
      const alias = target?.bayId || (provider?.c.specs.bayTargets?.some(bay => bay.id === p.targetId) ? p.targetId : undefined);
      if (alias && explicitBays !== undefined && (explicitBays!.length !== 1 || explicitBays![0] !== alias)) add('error', 'Drive target physical bay mismatch', `${c.name}: logical target ${target?.id || p.targetId} occupies physical bay ${alias}; its selected mounting spaces must match that alias.`);
      if (mount === 'front-hot-swap' && !alias && explicitBays === undefined) continue;
      if (provider && !componentCapabilities(provider.c).bayProvider) provider = chassis; // Invalid adapters must not waive chassis demand.
      const size = c.specs.baySize || c.specs.driveSize;
      if (!['2.5', '3.5', '5.25'].includes(size || '')) { add('warning', 'Bay installation specifications incomplete', `${c.name}: record the physical drive size.`); continue; }
      consume(row, provider, size as BaySize, c.specs.bayUnits ?? 1, explicitBays ?? (alias ? [alias] : []), explicitBays !== undefined || !!alias);
      continue;
    }
    if (!componentCapabilities(c).bayConsumer) continue;
    if (!c.specs.baySize) { add('warning', 'Bay installation specifications incomplete', `${c.name}: record required bay size and bay units before verifying physical fit.`); continue; }
    if (c.specs.bayUnits === undefined) add('warning', 'Bay consumption unconfirmed', `${c.name}: one bay per unit is assumed; verify and record the occupied bay count.`);
    consume(row, provider, c.specs.baySize, c.specs.bayUnits ?? 1, explicitBays ?? (p.targetId ? [p.targetId] : []), explicitBays !== undefined);
  }
  for (const provider of rows.filter(row => componentCapabilities(row.c).bayProvider)) {
    const counts = use.get(provider.p.id);
    for (const size of ['2.5', '3.5', '5.25'] as const) {
      const name = provider === chassis ? size === '2.5' ? 'Internal 2.5-inch bays' : size === '3.5' ? 'Internal 3.5-inch bays' : '5.25-inch bays' : `Bay provider ${provider.c.name} (${provider.p.id}) ${size}-inch bays`;
      const available = capacity(provider.c, size);
      resource(name, counts?.get(size) || 0, available === undefined ? undefined : available * provider.p.quantity);
    }
  }
  const frontCapacity = chassis?.c.specs.hotSwapBays ?? (chassis?.c.specs.driveTargets === undefined ? undefined : chassis.c.specs.driveTargets.filter(target => target.mount === 'front-hot-swap').length);
  resource('Front hot-swap bays', front, frontCapacity);
  return { findings, resources };
}
