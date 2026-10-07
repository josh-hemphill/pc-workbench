import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database, StockAllocation, StockEvent, StockRecord } from '../shared/types';
import { stockCounts } from '../shared/inventory';
import { schemas, stockActionSchema } from './schema';

function event(stock: StockRecord, action: StockEvent['action'], quantity: number, db: Database, allocation?: StockAllocation, notes = '') {
  stock.history.push({
    id: randomUUID(), at: new Date().toISOString(), action, quantity,
    pcId: allocation?.pcId || '', pcName: db.pcs.find(p => p.id === allocation?.pcId)?.name || '',
    allocationId: allocation?.id || '', notes: notes.slice(0, 10000),
  });
}

export function saveStockRecord(input: unknown, db: Database): StockRecord {
  const next = schemas.inventory.parse(input);
  const existing = db.inventory.find(s => s.id === next.id);
  if (existing) {
    if (next.componentId !== existing.componentId || next.tracking !== existing.tracking) throw Error('A stock record’s component type and tracking mode cannot change. Retire an incorrect record and receive a new one.');
    if (next.quantity !== existing.quantity) throw Error('Use Adjust count to change a bulk lot quantity with a reason.');
    if (JSON.stringify(next.allocations) !== JSON.stringify(existing.allocations) || JSON.stringify(next.history) !== JSON.stringify(existing.history)) throw Error('Stock changed since this editor was opened. Reload it before saving. Allocations and history are managed by inventory actions.');
    const changes = (['serial', 'assetTag', 'location', 'condition', 'notes'] as const).filter(k => next[k] !== existing[k]).map(k => `${k}: ${existing[k]} → ${next[k]}`);
    if (changes.length) event(next, 'edit', 0, db, undefined, changes.join('; ').slice(0, 10000));
  } else {
    if (next.allocations.length || next.history.length) throw Error('Receive new stock without allocations or history; use CSV import to restore existing inventory.');
    event(next, 'receive', next.quantity, db, undefined, next.notes);
  }
  return next;
}

export function applyStockAction(original: StockRecord, input: unknown, db: Database): StockRecord {
  const action = stockActionSchema.parse(input);
  const stock = structuredClone(original);
  const now = new Date().toISOString();
  if (action.action === 'reserve' || action.action === 'install') {
    if (stock.condition !== 'Serviceable') throw Error('Only serviceable stock can be reserved or installed.');
    if (action.quantity > stockCounts(stock).available) throw Error('Insufficient available stock. Other reservations and installations already consume these units.');
    const pc = db.pcs.find(p => p.id === action.pcId);
    if (!pc) throw Error('PC not found. Register the machine before allocating components.');
    const template = db.configurations.find(c => c.id === pc.configurationId);
    const planned = template?.placements.find(p => p.id === action.plannedPlacementId);
    if (action.plannedPlacementId && (!planned || planned.componentId !== stock.componentId)) throw Error('Selected planned placement does not match this stock and PC configuration.');
    const allocation: StockAllocation = {
      id: randomUUID(), pcId: pc.id, quantity: action.quantity, state: action.action === 'reserve' ? 'reserved' : 'installed',
      plannedPlacementId: action.plannedPlacementId, role: action.role || planned?.role || 'general',
      mount: action.mount || planned?.mount || 'auto', slotId: action.slotId ?? planned?.slotId ?? '',
      notes: action.notes, createdAt: now, updatedAt: now,
    };
    stock.allocations.push(allocation);
    event(stock, action.action, action.quantity, db, allocation, `${allocation.role}; ${allocation.mount}; slot ${allocation.slotId || 'auto'}. ${action.notes}`);
  } else {
    if (!('allocationId' in action)) throw Error('Allocation ID is required.');
    const allocationId = action.allocationId;
    const allocation = stock.allocations.find(a => a.id === allocationId);
    if (!allocation) throw Error('Allocation not found; it may already have been released or removed.');
    if (action.action === 'configure') {
      const previous = `${allocation.role}, ${allocation.mount}, ${allocation.slotId || 'auto'}`;
      allocation.role = action.role; allocation.mount = action.mount; allocation.slotId = action.slotId;
      allocation.notes = action.notes; allocation.updatedAt = now;
      event(stock, 'configure', 0, db, allocation, `${previous} → ${allocation.role}, ${allocation.mount}, ${allocation.slotId || 'auto'}. ${action.notes}`);
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
        event(stock, 'install', action.quantity, db, installed, `${installed.role}; ${installed.mount}; slot ${installed.slotId || 'auto'}. ${action.notes}`);
      } else {
        if (action.action === 'release' && allocation.state !== 'reserved') throw Error('Only reservations can be released. Use Remove for installed components.');
        if (action.action === 'remove' && allocation.state !== 'installed') throw Error('Only installed components can be removed. Use Release for reservations.');
        event(stock, action.action, action.quantity, db, allocation, `${allocation.role}; ${allocation.mount}; returned to ${stock.location || 'unrecorded stock location'}. ${action.notes}`);
        allocation.quantity -= action.quantity; allocation.updatedAt = now;
        if (!allocation.quantity) stock.allocations = stock.allocations.filter(a => a.id !== allocation.id);
      }
    }
  }
  return schemas.inventory.parse(stock);
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
  condition: z.enum(['Serviceable','Quarantined','Retired']), notes: z.string().trim().min(1, 'A transfer reason is required.').max(10000),
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
    condition: transfer.condition, notes: transfer.notes, allocations: [], history: [],
  };
  source.quantity -= transfer.quantity;
  event(source, 'transfer-out', -transfer.quantity, db, undefined, `To ${target.assetTag || target.id} (${target.id}), ${target.location}, ${target.condition}. ${transfer.notes}`);
  event(target, 'transfer-in', transfer.quantity, db, undefined, `From ${source.assetTag || source.id} (${source.id}), ${source.location}, ${source.condition}. ${transfer.notes}`);
  return { source, target };
}
