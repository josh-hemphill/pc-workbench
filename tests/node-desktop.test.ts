import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Backend,proxyRequest,proxyTarget} from '../desktop/backend';
import {createApp} from '../server/app';
test('Node desktop backend preserves SQLite, loopback proxy streaming and cleanup without a renderer bridge',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'node-desktop-'));
 const factory=()=>{const app=createApp(directory);return {listen:(port:number,host:string,callback:(error?:Error)=>void)=>app.listen(port,host,callback),locals:{closeStore:()=>app.locals.closeStore()}};};
 const backend=new Backend(factory);
 try{
  const origin=await backend.ready;assert.match(origin,/^http:\/\/127\.0\.0\.1:\d+$/);const state=await(await fetch(origin+'/api/state')).json();assert.ok(state.components.length);
  const result=await proxyRequest(new Request('http://127.0.0.1:9876/api/components/cpu',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':state.revision},body:JSON.stringify({...state.components.find((c:{id:string})=>c.id==='cpu'),name:'Node streamed desktop edit'})}),origin);assert.equal(result.status,200,await result.text());
  const foreign=await proxyRequest(new Request('http://127.0.0.1:9876/api/state',{headers:{origin:'https://foreign.example'}}),origin);assert.equal(foreign.status,403);assert.equal(proxyTarget('http://127.0.0.1:9876//example.com','http://127.0.0.1:3001'),'http://127.0.0.1:3001//example.com');
  await backend.stop();await backend.stop();assert.equal((await backend.status).success,true);assert.equal(fs.existsSync(path.join(directory,'.server-lock.json')),false);
  const restarted=new Backend(factory);try{const state=await(await fetch((await restarted.ready)+'/api/state')).json();assert.equal(state.components.find((c:{id:string})=>c.id==='cpu').name,'Node streamed desktop edit');}finally{await restarted.stop();}
 }finally{await backend.stop();fs.rmSync(directory,{recursive:true,force:true});}
});
