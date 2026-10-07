import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {AddressInfo} from 'node:net';
import {createApp} from '../server/index';
import {encodeCSV} from '../server/store';
test('API requires revisions, protects imported stock identity, and previews safe restores',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bench-revision-'));const server=createApp(dir).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 const request=(url:string,method='GET',body?:unknown,revision?:string)=>fetch(base+url,{method,headers:{'Content-Type':'application/json',...(revision?{'If-Match':revision}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 try{
  const stateResponse=await request('/api/state'),initial=await stateResponse.json(),revision=initial.revision;assert.equal(stateResponse.headers.get('X-Workspace-Revision'),revision);
  assert.equal((await request('/api/pcs/pc-01','PUT',initial.pcs[0])).status,428);
  const changed=await request('/api/pcs/pc-01','PUT',{...initial.pcs[0],location:'New location'},revision);assert.equal(changed.status,200);const latest=changed.headers.get('X-Workspace-Revision')!;assert.notEqual(latest,revision);
  assert.equal((await request('/api/pcs/pc-01','PUT',initial.pcs[0],revision)).status,409);
  const backup={...initial};delete backup.revision;delete backup.recoveryRequired;const preview=await request('/api/restore/preview','POST',{backup});assert.equal(preview.status,200);assert.equal((await preview.json()).counts.pcs,initial.pcs.length);
  const restore=await request('/api/restore','POST',{backup},latest);assert.equal(restore.status,200);const result=await restore.json();assert.ok(fs.existsSync(result.backupFile));assert.equal((await (await request('/api/state')).json()).pcs[0].location,initial.pcs[0].location);
  let approvedRevision=(await (await request('/api/state')).json()).revision;const configuration={...initial.configurations[0],status:'Approved'};const approval=await request(`/api/configurations/${configuration.id}`,'PUT',configuration,approvedRevision);assert.equal(approval.status,200);const firstApproval=await approval.json();assert.equal(firstApproval.approvalHistory.length,1);assert.ok(firstApproval.approvalSnapshot.components.length);approvedRevision=approval.headers.get('X-Workspace-Revision')!;const secondApproval=await request(`/api/configurations/${configuration.id}`,'PUT',{...firstApproval,name:'Reviewed revision'},approvedRevision);assert.equal(secondApproval.status,200);const revised=await secondApproval.json();assert.equal(revised.approvalHistory.length,2);assert.equal(revised.approvalHistory[0].configuration.name,configuration.name);assert.equal(revised.revision,firstApproval.revision+1);
  const stock={id:'import-unit',componentId:'ram',tracking:'serialized',serial:'ABC',assetTag:'',quantity:1,location:'Shelf',condition:'Serviceable',notes:'',allocations:[],history:[]};let current=(await (await request('/api/state')).json()).revision;assert.equal((await request('/api/inventory/import-unit','PUT',stock,current)).status,200);current=(await (await request('/api/state')).json()).revision;assert.equal((await request('/api/inventory/import','POST',{csv:encodeCSV('inventory',[{...stock,componentId:'cpu'}])},current)).status,400);
 const liveStore=(server.listeners('request')[0] as unknown as {locals:{store:import('../server/store').Store}}).locals.store;const original=structuredClone(liveStore.db),next=structuredClone(liveStore.db);next.pcs[0].location='Failed restore';const persist=liveStore.persist.bind(liveStore);let failed=false;liveStore.persist=(collection,rows)=>{if(collection==='configurations'){failed=true;throw Error('Injected restore failure');}if(failed)throw Error('Injected rollback failure');persist(collection,rows);};assert.throws(()=>liveStore.restore(next),/rollback could not finish/);assert.equal((await request('/api/inventory/import-unit/action','POST',{action:'reserve',pcId:'pc-01',quantity:1})).status,503);assert.equal((await request('/api/pcs/pc-01','PUT',original.pcs[0])).status,503);assert.equal((await (await request('/api/state')).json()).recoveryRequired,true);
 }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));fs.rmSync(dir,{recursive:true,force:true});}
});
