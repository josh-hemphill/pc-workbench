import {test} from 'node:test';
import {createServer,request as httpRequest} from 'node:http';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Backend} from '../tools/node/desktop/backend.ts';
import {createApp} from '../server/app.ts';
test('Node desktop backend preserves SQLite, API edits and cleanup without a renderer bridge',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'node-desktop-'));
 const factory=()=>{const app=createApp(directory);return {listen:(port:number,host:string,callback:(error?:Error)=>void)=>app.listen(port,host,callback),locals:{closeStore:()=>app.locals.closeStore()}};};
 const backend=new Backend(factory);
 try{
  const origin=await backend.ready;assert.match(origin,/^http:\/\/127\.0\.0\.1:\d+$/);const state=await(await fetch(origin+'/api/state')).json();assert.ok(state.components.length);
  const result=await fetch(origin+'/api/components/cpu',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':state.revision},body:JSON.stringify({...state.components.find((c:{id:string})=>c.id==='cpu'),name:'Node streamed desktop edit'})});assert.equal(result.status,200,await result.text());
  const foreign=await fetch(origin+'/api/state',{headers:{origin:'https://foreign.example'}});assert.equal(foreign.status,403);await foreign.text();
  await backend.stop();await backend.stop();assert.equal((await backend.status).success,true);assert.equal(fs.existsSync(path.join(directory,'.server-lock.json')),false);
  const restarted=new Backend(factory);try{const state=await(await fetch((await restarted.ready)+'/api/state')).json();assert.equal(state.components.find((c:{id:string})=>c.id==='cpu').name,'Node streamed desktop edit');}finally{await restarted.stop();}
 }finally{await backend.stop();fs.rmSync(directory,{recursive:true,force:true});}
});

test('backend startup failure rejects readiness and shutdown stays idempotent',async()=>{
 const backend=new Backend(()=>{throw Error('workspace locked');});
 await assert.rejects(backend.ready,/workspace locked/);
 const stopping=backend.stop();assert.equal(stopping,backend.stop());
 await stopping;assert.equal((await backend.status).success,false);
});

test('listen failure releases SQLite and permits reopening the workspace',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'node-desktop-listen-'));
 const factory=()=>{const app=createApp(directory);return {listen:(port:number,host:string,callback:(error?:Error)=>void)=>app.listen(port,host,callback),locals:{closeStore:()=>app.locals.closeStore()}};};
 const occupied=createServer();occupied.listen(0,'127.0.0.1');await once(occupied,'listening');
 let restarted:Backend|undefined;
 try{
  const address=occupied.address();assert.ok(address&&typeof address!=='string');
  const backend=new Backend(factory,{port:address.port});
  await assert.rejects(backend.ready,/address.*use|EADDRINUSE/i);
  await backend.stop();assert.equal((await backend.status).success,false);
  assert.equal(fs.existsSync(path.join(directory,'.server-lock.json')),false);
  restarted=new Backend(factory);assert.match(await restarted.ready,/^http:\/\/127\.0\.0\.1:/);
 }finally{await new Promise<void>((resolve,reject)=>occupied.close(error=>error?reject(error):resolve()));await restarted?.stop();fs.rmSync(directory,{recursive:true,force:true});}
});

test('shutdown aborts lingering clients before releasing application resources',async()=>{
 let released=false,acceptRequest!:()=>void;
 const received=new Promise<void>(resolve=>{acceptRequest=resolve;});
 const backend=new Backend(()=>{
  const server=createServer((_req,res)=>{res.writeHead(200);res.write('pending');acceptRequest();});
  return {listen:(port,host,callback)=>server.listen(port,host,callback),locals:{closeStore:()=>{released=true;}}};
 },{shutdownTimeoutMs:20});
 const request=httpRequest(await backend.ready,response=>response.resume());
 request.on('error',()=>{});request.end();
 try{await received;await backend.stop();assert.equal(released,true);assert.equal((await backend.status).success,true);}
 finally{request.destroy();await backend.stop();}
});
