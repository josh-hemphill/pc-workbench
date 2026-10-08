import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database, InventoryPC } from '../shared/types';
import { checkInstalledPC, installedConfiguration, pcAllocations } from '../shared/inventory';
import { schemas } from './schema';
import {locationPath,installationSnapshot} from '../shared/installations';
import {captureRequirementBinding} from './installation-requirements';
import { applyStockOperation } from './inventory';

function timeline(pc: InventoryPC, kind: string, summary: string, actor = '') {
  (pc.timeline ||= []).push({ id: randomUUID(), at: new Date().toISOString(), kind, summary:summary.slice(0,10000), actor });
}

export function savePCRecord(input: unknown, db: Database): InventoryPC {
  const next = schemas.pcs.parse(input), previous = db.pcs.find(p => p.id === next.id);
  if(next.buildSettings)next.buildSettings=captureRequirementBinding(next.buildSettings,db);
  for (const key of ['timeline', 'commissioning', 'snapshot', 'snapshots'] as const) {
    if (JSON.stringify(next[key] ?? (key === 'timeline' || key === 'snapshots' ? [] : null)) !== JSON.stringify(previous?.[key] ?? (key === 'timeline' || key === 'snapshots' ? [] : null))) throw Error('PC commissioning and history are managed by lifecycle actions. Reload before saving.');
  }
  if(previous?.lifecycle==='Parts only'&&!['Parts only','Building','Retired'].includes(next.lifecycle||''))throw Error('Return a Parts-only PC to Building before commissioning or putting it into service.');
  if(next.lifecycle==='In service'&&previous?.timeline){
    let lastParts=-1,lastCommission=-1;
    previous.timeline.forEach((entry,index)=>{if(entry.kind==='parts-only'||entry.kind==='parts-only-rebuild')lastParts=index;if(entry.kind==='commission')lastCommission=index;});
    if(lastParts>lastCommission)throw Error('Commission this PC again after returning it from Parts only to Building before marking it in service.');
  }
  if (next.lifecycle === 'Commissioned' && previous?.lifecycle !== 'Commissioned') throw Error('Use Commission PC to capture a validated hardware and software snapshot.');
  if ((next.lifecycle === 'In service') && !next.commissioning) throw Error('Commission this PC before marking it in service.');
  if (next.lifecycle === 'Retired' && pcAllocations(next.id, db).length) throw Error('Remove installed components and release reservations before retiring a PC.');
  const changed = (['name', 'serial', 'location', 'installationLocationId', 'configurationId', 'notes', 'buildSettings', 'lifecycle', 'software'] as const).filter(k => JSON.stringify(next[k]) !== JSON.stringify(previous?.[k]));
  if (!previous) timeline(next, 'register', `Registered ${next.name}.`);
  else if (changed.length) timeline(next, 'update', changed.map(k => k==='installationLocationId'?`Installation location: ${locationPath(previous.installationLocationId||'',db)||'Unassigned'} → ${locationPath(next.installationLocationId||'',db)||'Unassigned'}`:`${k}: ${JSON.stringify(previous[k])} → ${JSON.stringify(next[k])}`).join('; ').slice(0, 10000));
  if(next.lifecycle==='Parts only'&&previous?.lifecycle!=='Parts only')timeline(next,'parts-only','Marked Parts only. Installed parts and reservations remain assigned until explicitly removed or released.');
  if(previous?.lifecycle==='Parts only'&&next.lifecycle==='Building')timeline(next,'parts-only-rebuild','Returned from Parts only to Building. Validate installed parts and commission again before returning to service.');
  return schemas.pcs.parse(next);
}

const commissionSchema = z.object({ by: z.string().trim().min(1).max(200), checks: z.array(z.string().trim().min(1).max(500)).min(1).max(100), notes: z.string().max(10000).default('') }).strict();

export function commissionPCRecord(original: InventoryPC, input: unknown, db: Database): InventoryPC {
  const confirmation = commissionSchema.parse(input);
  if(original.lifecycle==='Parts only')throw Error('A Parts-only PC cannot be commissioned. Return it to Building first.');
  if (original.lifecycle === 'Retired') throw Error('A retired PC cannot be commissioned. Return it to Building first.');
  if (!original.buildSettings) throw Error('Record the equipment and storage settings before commissioning.');
  if (!pcAllocations(original.id, db).some(r => r.allocation.state === 'installed')) throw Error('Record installed hardware before commissioning.');
  const report = checkInstalledPC(original, db);
  if (report.status === 'Conflicts') throw Error('Resolve installed compatibility conflicts before commissioning.');
  const pc = structuredClone(original), configuration = installedConfiguration(pc, db), at = new Date().toISOString();
  const ids = new Set(configuration.placements.map(p => p.componentId));
  const installedStock = pcAllocations(pc.id,db).filter(r=>r.allocation.state==='installed').map(({stock,allocation:a})=>({stockId:stock.id,componentId:stock.componentId,serial:stock.serial,assetTag:stock.assetTag,allocationId:a.id,quantity:a.quantity,role:a.role,mount:a.mount,slotId:a.slotId,group:a.group,targetId:a.targetId}));
  const snapshot = { at, configuration, installedStock, installation:installationSnapshot(pc,db), components: structuredClone(db.components.filter(c => ids.has(c.id))), system: structuredClone(db.systems.find(s => s.id === configuration.systemId) || null) };
  pc.snapshot = snapshot; (pc.snapshots ||= []).push(snapshot);
  pc.commissioning = { at, ...confirmation }; pc.lifecycle = 'Commissioned';
  timeline(pc, 'commission', `Commissioned revision ${pc.snapshots.length}; checks: ${confirmation.checks.join(', ')}. ${confirmation.notes}`, confirmation.by);
  return schemas.pcs.parse(pc);
}

export function decommissionPC(original: InventoryPC, input: unknown, db: Database): Database {
  const request = z.object({ disposition:z.enum(['Serviceable','Quarantined','Repair','Retired']),location:z.string().trim().min(1).max(10000),notes:z.string().trim().min(1).max(10000),actor:z.string().max(200).default('') }).strict().parse(input);
  const next = structuredClone(db);
  for (const {stock,allocation} of pcAllocations(original.id, db)) {
    const current = next.inventory.find(s=>s.id===stock.id)!;
    const result = applyStockOperation(current, {action:allocation.state==='installed'?'remove':'release',allocationId:allocation.id,quantity:allocation.quantity,notes:request.notes,actor:request.actor,...(allocation.state==='installed'?{disposition:request.disposition,destinationLocation:request.location}:{})},next);
    next.inventory[next.inventory.findIndex(s=>s.id===stock.id)] = result.stock;
    if (result.additionalStock) next.inventory.push(result.additionalStock);
  }
  const pc = structuredClone(original); pc.lifecycle='Retired';
  timeline(pc,'decommission',`Released reservations and removed installed hardware to ${request.location}, ${request.disposition}. ${request.notes}`,request.actor);
  next.pcs[next.pcs.findIndex(p=>p.id===pc.id)]=schemas.pcs.parse(pc);
  return next;
}
