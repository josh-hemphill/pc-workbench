import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {AddressInfo} from 'node:net';
import {createApp} from '../server/index';
import {decodeCSV,encodeCSV} from '../server/store';
test('local API supports save/export/import/reload and rejects broken references or origins',async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bench-api-'));const server=createApp(dir).listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;const req=(url:string,method='GET',body?:unknown,headers={})=>fetch(base+url,{method,headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});try{
 const state=await (await req('/api/state')).json();assert.equal(state.configurations.length,3);
 const part={...state.components[0],id:'api-test-part',name:'API created chassis'};assert.equal((await req('/api/components/'+part.id,'PUT',part)).status,200);
 const csv=await(await req('/api/export/components')).text();const rows=decodeCSV('components',csv) as typeof part[];assert.ok(rows.some(r=>r.id===part.id));part.name='Imported updated name';assert.equal((await req('/api/components/import','POST',{csv:encodeCSV('components',[part])})).status,200);assert.equal((await(await req('/api/state')).json()).components.find((c:typeof part)=>c.id===part.id).name,part.name);
 assert.equal((await req('/api/components/cpu','DELETE')).status,400);assert.equal((await req('/api/components/'+part.id,'DELETE')).status,200);
 assert.equal((await req('/api/state','GET',undefined,{Origin:'https://untrusted.example'})).status,403);
 const config={...state.configurations[1],status:'Approved'};assert.equal((await req('/api/configurations/'+config.id,'PUT',config)).status,400);
 assert.equal((await req('/api/report/imaging')).status,200);assert.equal((await req('/api/report/unknown')).status,404);
 assert.equal((await req('/api/components/import','POST',{csv:'bad,headers\nx,y\n'})).status,400);
 assert.equal((await req('/api/state')).status,200);
 }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));fs.rmSync(dir,{recursive:true,force:true});}});
