import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database, StockAllocation, StockEvent, StockRecord } from '../shared/types';
import { stockCounts } from '../shared/inventory';
import { schemas, stockActionSchema } from './schema';

function event(stock: StockRecord, action: StockEvent['action'], quantity: number, db: Database, allocation?: StockAllocation, notes = '', linkage: Pick<StockEvent, 'sourceAllocationId' | 'targetStockId'> = {}) {
  const reservation=allocation?`Owner: ${allocation.owner||'unassigned'}; work order: ${allocation.workOrder||'none'}; needed by: ${allocation.dueAt||'none'}; expiry: ${allocation.expiresAt||'none'}. `:'';
  stock.history.push({
    id: randomUUID(), at: new Date().toISOString(), action, quantity,
    pcId: allocation?.pcId || '', pcName: db.pcs.find(p => p.id === allocation?.pcId)?.name || '',
    allocationId: allocation?.id || '', notes: (reservation+notes).slice(0, 10000), ...linkage,
  });
}

export function saveStockRecord(input: unknown, db: Database): StockRecord {
  const next = schemas.inventory.parse(input);
  const existing = db.inventory.find(s => s.id === next.id);
  if (existing) {
    if (next.componentId !== existing.componentId || next.tracking !== existing.tracking) throw Error('A stock record’s component type and tracking mode cannot change. Retire an incorrect record and receive a new one.');
    if (next.quantity !== existing.quantity) throw Error('Use Adjust count to change a bulk lot quantity with a reason.');
    if (JSON.stringify(next.allocations) !== JSON.stringify(existing.allocations) || JSON.stringify(next.history) !== JSON.stringify(existing.history)) throw Error('Stock changed since this editor was opened. Reload it before saving. Allocations and history are managed by inventory actions.');
    const changes = (['serial', 'assetTag', 'location', 'condition', 'notes', 'supplier', 'purchaseOrder', 'reorderLevel', 'repairReference', 'supplierReturnReference'] as const).filter(k => next[k] !== existing[k]).map(k => `${k}: ${existing[k]} → ${next[k]}`);
    if (changes.length) event(next, 'edit', 0, db, undefined, changes.join('; ').slice(0, 10000));
  } else {
    if (next.allocations.length || next.history.length) throw Error('Receive new stock without allocations or history; use CSV import to restore existing inventory.');
    event(next, 'receive', next.quantity, db, undefined, next.notes);
  }
  return next;
}

export function applyStockOperation(original: StockRecord, input: unknown, db: Database): { stock: StockRecord; additionalStock?: StockRecord } {
  const action = stockActionSchema.parse(input);
  const stock = structuredClone(original);
  let additionalStock: StockRecord | undefined;
  const now = new Date().toISOString();
  if (action.action === 'reserve' || action.action === 'install') {
    if (stock.condition !== 'Serviceable') throw Error('Only serviceable stock can be reserved or installed.');
    if (action.quantity > stockCounts(stock).available) throw Error('Insufficient available stock. Other reservations and installations already consume these units.');
    const pc = db.pcs.find(p => p.id === action.pcId);
    if (!pc) throw Error('PC not found. Register the machine before allocating components.');
    if (pc.lifecycle === 'Retired') throw Error('Retired PCs cannot receive allocations.');
    const template = db.configurations.find(c => c.id === pc.configurationId);
    const planned = template?.placements.find(p => p.id === action.plannedPlacementId);
    if (action.plannedPlacementId && (!planned || planned.componentId !== stock.componentId)) throw Error('Selected planned placement does not match this stock and PC configuration.');
    const allocation: StockAllocation = {
      id: randomUUID(), pcId: pc.id, quantity: action.quantity, state: action.action === 'reserve' ? 'reserved' : 'installed',
      plannedPlacementId: action.plannedPlacementId, role: action.role || planned?.role || 'general',
      mount: action.mount || planned?.mount || 'auto', slotId: action.slotId ?? planned?.slotId ?? '',
      notes: action.notes, createdAt: now, updatedAt: now,
      owner: action.owner || '', workOrder: action.workOrder || '', dueAt: action.dueAt || '', expiresAt: action.expiresAt || '',
      group: action.group || planned?.group || '', targetId: action.targetId || planned?.targetId || '', adapterPlacementId: action.adapterPlacementId || planned?.adapterPlacementId || '', controllerPlacementId: action.controllerPlacementId || planned?.controllerPlacementId || '',
    };
    stock.allocations.push(allocation);
    event(stock, action.action, action.quantity, db, allocation, `${allocation.role}; ${allocation.mount}; slot ${allocation.slotId || 'auto'}. ${action.notes}`);
  } else {
    if (!('allocationId' in action)) throw Error('Allocation ID is required.');
    const allocationId = action.allocationId;
    const allocation = stock.allocations.find(a => a.id === allocationId);
    if (!allocation) throw Error('Allocation not found; it may already have been released or removed.');
    if (action.action === 'configure') {
      const description=(a:StockAllocation)=>`${a.role}, ${a.mount}, ${a.slotId || 'auto'}, group ${a.group||'default'}, target ${a.targetId||'auto'}, provider ${a.adapterPlacementId||'auto'}, controller ${a.controllerPlacementId||'auto'}, owner ${a.owner||'unassigned'}, work order ${a.workOrder||'none'}, due ${a.dueAt||'none'}, expiry ${a.expiresAt||'none'}`;
      const previous = description(allocation);
      allocation.role = action.role; allocation.mount = action.mount; allocation.slotId = action.slotId;
      allocation.notes = action.notes; allocation.updatedAt = now;
      for (const key of ['group','targetId','adapterPlacementId','controllerPlacementId'] as const) if (action[key] !== undefined) allocation[key]=action[key];
      const raw = input as Record<string, unknown>;
      for (const key of ['owner','workOrder','dueAt','expiresAt'] as const) if (key in raw) allocation[key]=action[key];
      event(stock, 'configure', 0, db, allocation, `${previous} → ${description(allocation)}. ${action.notes}`);
    } else {
      if (action.quantity > allocation.quantity) throw Error('Quantity exceeds this allocation.');
      if (action.action === 'install-reserved') {
        if (allocation.state !== 'reserved') throw Error('Only a reservation can be installed.');
        if (stock.condition !== 'Serviceable') throw Error('Quarantined or retired stock cannot be installed.');
        let installed = allocation;
        if (action.quantity < allocation.quantity) {
          allocation.quantity -= action.quantity; allocation.updatedAt = now;
          installed = { ...allocation, id: randomUUID(), quantity: action.quantity, createdAt: now };
          stock.allocations.push(installed);
        }
        installed.state = 'installed'; installed.updatedAt = now;
        if (action.notes) installed.notes = action.notes;
        event(stock, 'install', action.quantity, db, installed, `${installed.role}; ${installed.mount}; slot ${installed.slotId || 'auto'}. ${action.notes}`, { sourceAllocationId: allocation.id });
      } else {
        if (action.action === 'release' && allocation.state !== 'reserved') throw Error('Only reservations can be released. Use Remove for installed components.');
        if (action.action === 'remove' && allocation.state !== 'installed') throw Error('Only installed components can be removed. Use Release for reservations.');
        const destinationLocation = action.action === 'remove' ? action.destinationLocation ?? stock.location : stock.location;
        const disposition = action.action === 'remove' ? action.disposition ?? stock.condition : stock.condition;
        event(stock, action.action, action.quantity, db, allocation, `${allocation.role}; ${allocation.mount}; returned to ${destinationLocation || 'unrecorded stock location'}, ${disposition}. ${action.notes}`);
        allocation.quantity -= action.quantity; allocation.updatedAt = now;
        if (!allocation.quantity) stock.allocations = stock.allocations.filter(a => a.id !== allocation.id);
        if (action.action === 'remove' && (destinationLocation !== stock.location || disposition !== stock.condition)) {
          if (stock.tracking === 'serialized') {
            stock.location = destinationLocation; stock.condition = disposition;
          } else {
            stock.quantity -= action.quantity;
            additionalStock = { ...stock, id: randomUUID(), assetTag: '', quantity: action.quantity, location: destinationLocation, condition: disposition, notes: action.notes, allocations: [], history: [] };
            stock.history.at(-1)!.targetStockId = additionalStock.id;
            event(stock, 'transfer-out', -action.quantity, db, undefined, `Removal disposition to ${additionalStock.id}. ${action.notes}`, { targetStockId: additionalStock.id, sourceAllocationId: allocation.id });
            event(additionalStock, 'transfer-in', action.quantity, db, allocation, `Removed from ${stock.assetTag || stock.id} (${stock.id}). ${action.notes}`, { sourceAllocationId: allocation.id });
            additionalStock.history.at(-1)!.sourceStockId = stock.id;
          }
        }
      }
    }
  }
  const actor=(input as {actor?:string}).actor;
  if(actor){for(const added of stock.history.slice(original.history.length))added.actor=actor;if(additionalStock)for(const added of additionalStock.history)added.actor=actor;}
  return { stock: schemas.inventory.parse(stock), ...(additionalStock ? { additionalStock: schemas.inventory.parse(additionalStock) } : {}) };
}

/** Legacy single-record callers must opt into the atomic operation for lot splits. */
export function applyStockAction(original: StockRecord, input: unknown, db: Database): StockRecord {
  const result = applyStockOperation(original, input, db);
  if (result.additionalStock) throw Error('This removal creates a disposition lot; commit applyStockOperation atomically.');
  return result.stock;
}

export function adjustStockCount(original: StockRecord, input: unknown, db: Database): StockRecord {
  const { quantity, notes } = countAdjustmentSchema.parse(input);
  if (original.tracking !== 'bulk') throw Error('Serialized units always have quantity 1. Change their condition to retire or quarantine them.');
  if (original.condition === 'Retired') throw Error('Retired lots cannot be adjusted. Receive a new lot.');
  const stock = structuredClone(original), delta = quantity - stock.quantity;
  if (quantity < stockCounts(stock).installed + stockCounts(stock).reserved) throw Error('Total quantity cannot be lower than the installed and reserved units.');
  stock.quantity = quantity;
  event(stock, 'adjust', delta, db, undefined, notes);
  return stock;
}

export const countAdjustmentSchema = z.object({ quantity: z.number().int().min(0).max(1000000), notes: z.string().trim().min(1, 'A reason is required for count adjustments.').max(10000) }).strict();

const transferSchema = z.object({
  quantity: z.number().int().min(1).max(1000000), assetTag: z.string().max(10000), location: z.string().max(10000),
  condition: z.enum(['Serviceable','Quarantined','Repair','Retired']), notes: z.string().trim().min(1, 'A transfer reason is required.').max(10000),
}).strict();

/** Split a free bulk quantity into a new lot; both records commit in one inventory CSV write. */
export function transferBulkStock(original: StockRecord, input: unknown, db: Database) {
  const transfer = transferSchema.parse(input);
  if (original.tracking !== 'bulk') throw Error('Only bulk lots can be split. Edit the location or condition of an individual serialized unit instead.');
  if (original.condition === 'Retired') throw Error('Retired stock cannot be transferred.');
  if (transfer.quantity > stockCounts(original).unallocated) throw Error('Transfer quantity exceeds unallocated units. Release or remove allocated components first.');
  const source = structuredClone(original);
  const target: StockRecord = {
    id: randomUUID(), componentId: source.componentId, tracking: 'bulk', serial: '',
    assetTag: transfer.assetTag, quantity: transfer.quantity, location: transfer.location,
    condition: transfer.condition, notes: transfer.notes, allocations: [], history: [], supplier:source.supplier, purchaseOrder:source.purchaseOrder, reorderLevel:source.reorderLevel,repairReference:source.repairReference,supplierReturnReference:source.supplierReturnReference,
  };
  source.quantity -= transfer.quantity;
  event(source, 'transfer-out', -transfer.quantity, db, undefined, `To ${target.assetTag || target.id} (${target.id}), ${target.location}, ${target.condition}. ${transfer.notes}`,{targetStockId:target.id});
  event(target, 'transfer-in', transfer.quantity, db, undefined, `From ${source.assetTag || source.id} (${source.id}), ${source.location}, ${source.condition}. ${transfer.notes}`);
  target.history.at(-1)!.sourceStockId=source.id;
  return { source, target };
}

/** Assign unit identities to free bulk stock without changing the total inventory. */
export function convertBulkToSerialized(original: StockRecord, input: unknown, db: Database) {
  const request = z.object({ units: z.array(z.object({serial:z.string().trim().min(1).max(10000),assetTag:z.string().max(10000).default(''),location:z.string().max(10000).optional()}).strict()).min(1).max(1000), notes:z.string().trim().min(1).max(10000) }).strict().parse(input);
  if (original.tracking !== 'bulk' || original.condition === 'Retired') throw Error('Only active bulk lots can be converted to serialized units.');
  if (request.units.length > stockCounts(original).unallocated) throw Error('Serializing exceeds the unallocated bulk quantity.');
  const source = structuredClone(original);
  source.quantity -= request.units.length;
  const targets = request.units.map(unit => {
    const target: StockRecord = { ...source, id:randomUUID(),tracking:'serialized',serial:unit.serial,assetTag:unit.assetTag,quantity:1,location:unit.location ?? source.location,allocations:[],history:[],notes:request.notes };
    event(source,'transfer-out',-1,db,undefined,`Serialized unit ${unit.serial}. ${request.notes}`,{targetStockId:target.id});
    event(target,'transfer-in',1,db,undefined,`Serialized from lot ${source.id}. ${request.notes}`);
    target.history.at(-1)!.sourceStockId=source.id;
    return schemas.inventory.parse(target);
  });
  return {source:schemas.inventory.parse(source),targets};
}
