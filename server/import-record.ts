import type {Database} from '../shared/types.ts';
import type {Collection} from './schema.ts';
import {prepareInstallationRecord} from './installation-requirements.ts';
import {saveStockRecord} from './inventory.ts';
import {savePCRecord} from './pc-lifecycle.ts';
import {saveConfigurationRecord} from './configuration-record.ts';

/** CSV transfers may introduce history, but merges must not replace an existing audit trail. */
export function prepareImportedRecord(collection:Collection,input:{id:string},db:Database):unknown {
 const prepared=prepareInstallationRecord(collection,input,db);
 if(!db[collection].some(record=>record.id===input.id))return prepared;
 if(collection==='inventory')return saveStockRecord(prepared,db);
 if(collection==='pcs')return savePCRecord(prepared,db);
 if(collection==='configurations')return saveConfigurationRecord(prepared as Database['configurations'][number],db);
 return prepared;
}
