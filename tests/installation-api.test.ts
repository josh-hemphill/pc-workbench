import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {AddressInfo} from 'node:net';
import {createApp} from '../server/index';
import {encodeCSV,decodeCSV} from '../server/store';

test('installation API captures canonical requirement revisions, protects publication and persists assignments',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bench-installation-api-'));
 const app=createApp(dir),server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 const request=async(url:string,method='GET',body?:unknown)=>{const state=await fetch(base+'/api/state');return fetch(base+url,{method,headers:{'Content-Type':'application/json','If-Match':state.headers.get('X-Workspace-Revision')!},body:body===undefined?undefined:JSON.stringify(body)});};
 try{
  const version={revision:1,at:'2026-10-08T00:00:00Z',name:'Controller',description:'',connections:[],constraints:{minMemoryGb:32}};
  const requirements={id:'requirements',name:'Requirements',description:'',versions:[version]};
  assert.equal((await request('/api/requirementsSets/requirements','PUT',requirements)).status,200);
  const original=await (await request('/api/state')).json();
  const config={...original.configurations[0],requirementSetId:'requirements',requirementRevision:1};
  const savedConfig=await request(`/api/configurations/${config.id}`,'PUT',config);assert.equal(savedConfig.status,200);assert.deepEqual((await savedConfig.json()).requirementSnapshot,version);
  const location={id:'bench',name:'Bench',kind:'Bench',parentId:'',requirementSetId:'requirements',requirementRevision:1,targetConfigurationId:config.id,notes:''};
  const savedLocation=await request('/api/installationLocations/bench','PUT',location);assert.equal(savedLocation.status,200);assert.deepEqual((await savedLocation.json()).requirementSnapshot,version);
  const imported={...location,requirementSnapshot:{...version,constraints:{minMemoryGb:999}}};
  assert.equal((await request('/api/installationLocations/import','POST',{csv:encodeCSV('installationLocations',[imported])})).status,200);
  assert.equal((await (await request('/api/state')).json()).installationLocations[0].requirementSnapshot.constraints.minMemoryGb,32);
  assert.equal((await request('/api/requirementsSets/import','POST',{csv:encodeCSV('requirementsSets',[{...requirements,versions:[{...version,name:'Rewritten publication'}]}])})).status,400);
  assert.equal((await request('/api/pcs/pc-01','PUT',{...original.pcs[0],installationLocationId:'bench'})).status,200);
  const csv=await (await request('/api/export/installationLocations')).text();assert.equal(decodeCSV('installationLocations',csv).length,1);
  const state=await (await request('/api/state')).json();assert.equal(state.pcs[0].installationLocationId,'bench');assert.match(state.pcs[0].timeline.at(-1).summary,/Installation location: Unassigned → Bench/);
  const sqlite=path.join(dir,'workbench.sqlite');assert.equal(fs.existsSync(sqlite),true);assert.equal(fs.existsSync(path.join(dir,'pcs.csv')),false);
 }finally{// All request assertions are complete; Deno may keep discarded fetch bodies connected.
 server.closeAllConnections();
 await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));fs.rmSync(dir,{recursive:true,force:true});}
});
