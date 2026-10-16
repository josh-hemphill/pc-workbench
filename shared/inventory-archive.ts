import type {Component,StockRecord} from './types.ts';
export interface ArchivedInventory {id:string;at:string;stock:StockRecord;component:Component}
export function inventoryDeletionReason(stock:StockRecord):string {
 if(stock.allocations.length)return 'Release reservations and remove installed items before deleting this record.';
 if(stock.quantity!==0&&stock.condition!=='Retired')return 'Adjust an empty bulk lot to zero, or retire this record before deleting it. Removed PC parts return to stock; they are not automatically disposed of.';
 return '';
}
