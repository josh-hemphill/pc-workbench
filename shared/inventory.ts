import type { Configuration, Database, InventoryPC, StockAllocation, StockRecord } from './types';
import { checkConfiguration } from './compatibility';

export function stockCounts(stock: StockRecord) {
  const reserved = stock.allocations.filter(a => a.state === 'reserved').reduce((n, a) => n + a.quantity, 0);
  const installed = stock.allocations.filter(a => a.state === 'installed').reduce((n, a) => n + a.quantity, 0);
  const unallocated = stock.quantity - reserved - installed;
  return { reserved, installed, unallocated, available: stock.condition === 'Serviceable' ? unallocated : 0 };
}

export function pcAllocations(pcId: string, db: Database) {
  return db.inventory.flatMap(stock => stock.allocations.filter(a => a.pcId === pcId).map(allocation => ({ stock, allocation })));
}

/** Actual components come exclusively from installation records, never the mutable template. */
export function installedConfiguration(pc: InventoryPC, db: Database): Configuration {
  return {
    id: pc.id, name: pc.name, description: 'Recorded installed hardware', systemId: pc.buildSettings?.systemId || '',
    status: 'Draft', updatedAt: new Date(0).toISOString(),
    placements: pcAllocations(pc.id, db).filter(r => r.allocation.state === 'installed').map(({ stock, allocation: a }) => ({
      id: a.id, componentId: stock.componentId, quantity: a.quantity, slotId: a.slotId,
      role: a.role, mount: a.mount, group: '',
    })),
    storage: pc.buildSettings?.storage || { raid: 'none', bootMirror: false }, notes: pc.buildSettings?.notes || '',
  };
}

export function checkInstalledPC(pc: InventoryPC, db: Database) {
  const report = checkConfiguration(installedConfiguration(pc, db), db);
  if (!pc.buildSettings) report.findings.push({ severity: 'warning', title: 'Installed settings not recorded', detail: 'Capture or enter equipment and storage settings for this PC. Template settings are not inherited.' });
  for (const { stock, allocation } of pcAllocations(pc.id, db)) {
    if (allocation.state === 'installed' && stock.condition !== 'Serviceable') {
      report.findings.push({ severity: 'error', title: 'Installed stock is not serviceable', detail: `${stock.serial || stock.assetTag || stock.id} is ${stock.condition.toLowerCase()}. Inspect and remove or repair this component.` });
    }
  }
  report.status = report.findings.some(f => f.severity === 'error') ? 'Conflicts' : report.findings.some(f => f.severity === 'warning') ? 'Needs review' : 'Compatible';
  return report;
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
  const matches = (pi: number, ai: number) => {
    const p = template.placements[pi], { stock, allocation: a } = installed[ai];
    return stock.componentId === p.componentId && a.role === p.role && (p.mount === 'auto' || a.mount === p.mount) && (!p.slotId || a.slotId === p.slotId);
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
  for (const [ai, row] of installed.entries()) {
    const left = row.allocation.quantity - [...assignments[ai].values()].reduce((n, q) => n + q, 0);
    if (left > 0) differences.push(`${left} × ${db.components.find(c => c.id === row.stock.componentId)?.name || row.stock.componentId} installed outside the planned placement.`);
  }
  if (!pc.buildSettings || pc.buildSettings.systemId !== template.systemId || pc.buildSettings.storage.raid !== template.storage.raid || pc.buildSettings.storage.bootMirror !== template.storage.bootMirror) differences.push('Recorded equipment or redundancy settings differ from the template.');
  return differences;
}
