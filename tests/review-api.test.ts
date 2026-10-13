import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server/index';
import {encodeCSV} from '../server/store';
import type {Database} from '../shared/types';

async function workspace(run:(request:(route:string,method?:string,body?:unknown,revision?:string)=>Promise<Response>,state:()=>Promise<Database&{revision:string}>)=>Promise<void>){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bench-review-')),server=createApp(dir).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const request=(route:string,method='GET',body?:unknown,revision?:string)=>fetch(base+route,{method,headers:{'Content-Type':'application/json',...(revision?{'If-Match':revision}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const state=async()=>await (await request('/api/state')).json();
 try{await run(request,state);}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));fs.rmSync(dir,{recursive:true,force:true});}
}
test('all inventory commands reject missing or stale revisions before changing counts allocations or history',async()=>workspace(async(request,state)=>{
 const initial=await state();const record={id:'review-lot',componentId:'ram',tracking:'bulk',serial:'',assetTag:'',quantity:5,location:'Shelf',condition:'Serviceable',notes:'',allocations:[],history:[]};
 assert.equal((await request('/api/inventory/review-lot','PUT',record,initial.revision)).status,200);const current=await state();
 for(const [route,body] of [['action',{action:'reserve',pcId:'pc-01',quantity:1}],['adjust',{quantity:7,notes:'Receipt'}],['transfer',{quantity:1,location:'Shelf 2',condition:'Serviceable',notes:'Move'}],['serialize',{units:[{serial:'S1'}],notes:'Label'}],['batch',{records:[{...record,id:'new-lot'}]}]] as const){
  const url=route==='batch'?'/api/inventory/batch':`/api/inventory/review-lot/${route}`;
  assert.equal((await request(url,'POST',body)).status,428,route);assert.equal((await request(url,'POST',body,initial.revision)).status,409,route);
 }
 assert.equal((await state()).revision,current.revision);
 assert.equal((await request('/api/inventory/review-lot/action','POST',{action:'reserve',pcId:'pc-01',quantity:2},current.revision)).status,200);
 const held=await state();assert.equal(held.inventory[0].allocations[0].quantity,2);
 assert.equal((await request('/api/inventory/review-lot/adjust','POST',{quantity:3,notes:'Stale count'},current.revision)).status,409);assert.equal((await state()).revision,held.revision);
}));
test('CSV merges preserve existing stock audits and PC lifecycle history, reject count edits atomically, and allow new historical records',async()=>workspace(async(request,state)=>{
 let current=await state();const stock={id:'review-lot',componentId:'ram',tracking:'bulk',serial:'',assetTag:'',quantity:5,location:'Shelf',condition:'Serviceable',notes:'',allocations:[],history:[]};
 await request('/api/inventory/review-lot','PUT',stock,current.revision);current=await state();const received=current.inventory[0];
 for(const bad of [{...received,history:[]},{...received,quantity:8}]){
  const response=await request('/api/inventory/import','POST',{csv:encodeCSV('inventory',[{...received,id:'new-record'},bad])},current.revision);assert.equal(response.status,400);assert.equal((await state()).revision,current.revision);
 }
 const response=await request('/api/inventory/import','POST',{csv:encodeCSV('inventory',[{...received,location:'Shelf B'}])},current.revision);assert.equal(response.status,200);current=await state();assert.equal(current.inventory[0].history[0].id,received.history[0].id);assert.equal(current.inventory[0].history.at(-1)!.action,'edit');
 await request('/api/pcs/pc-01','PUT',{...current.pcs[0],notes:'Accepted asset note'},current.revision);current=await state();const pc=current.pcs[0];assert(pc.timeline?.length);
 assert.equal((await request('/api/pcs/import','POST',{csv:encodeCSV('pcs',[{...pc,timeline:[]}])},current.revision)).status,400);assert.equal((await state()).revision,current.revision);
 assert.equal((await request('/api/pcs/import','POST',{csv:encodeCSV('pcs',[{...pc,name:'Updated label'}])},current.revision)).status,200);current=await state();assert.equal(current.pcs[0].timeline!.length,pc.timeline!.length+1);
 const transferred={...received,id:'historical-transfer',history:received.history.map(e=>({...e,id:'transferred-event'}))};assert.equal((await request('/api/inventory/import','POST',{csv:encodeCSV('inventory',[transferred])},current.revision)).status,200);
}));
test('CSV configuration merges advance revisions and preserve prior approvals instead of accepting replacement history',async()=>workspace(async(request,state)=>{
 let current=await state();const config={...current.configurations[0],status:'Approved'};assert.equal((await request(`/api/configurations/${config.id}`,'PUT',config,current.revision)).status,200);
 current=await state();const approved=current.configurations[0];assert.equal(approved.approvalHistory!.length,1);
 assert.equal((await request('/api/configurations/import','POST',{csv:encodeCSV('configurations',[{...approved,name:'CSV revised',revision:0,approvalHistory:[]}])},current.revision)).status,200);
 current=await state();assert.equal(current.configurations[0].revision,approved.revision!+1);assert.equal(current.configurations[0].approvalHistory!.length,2);assert.equal(current.configurations[0].approvalHistory![0].configuration.name,approved.name);
}));
