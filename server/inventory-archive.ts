import {z} from 'zod';
import {schemas} from './schema.ts';
import {componentSchema} from '../shared/component-schema.ts';
import {inventoryDeletionReason,type ArchivedInventory} from '../shared/inventory-archive.ts';
const archive=z.object({id:z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),at:z.iso.datetime(),stock:schemas.inventory,component:componentSchema}).strict().refine(row=>row.stock.componentId===row.component.id,'Archived stock must retain its own component snapshot').refine(row=>!inventoryDeletionReason(row.stock),'Only empty or retired unallocated stock may be archived');
export function parseInventoryArchive(input:unknown):ArchivedInventory[]{return z.array(archive).max(10000).refine(rows=>new Set(rows.map(r=>r.id)).size===rows.length,'Duplicate inventory archive IDs').parse(input);}
