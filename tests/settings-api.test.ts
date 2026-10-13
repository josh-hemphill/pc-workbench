import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { createApp } from '../server/index';
import { resolveRuntimeConfig } from '../server/runtime-config';

test('settings API validates before save, preserves active workspace, and keeps user preferences across backup restore', async () => {
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'bench-settings-api-'));
  const runtime=resolveRuntimeConfig({home:path.join(base,'user'),env:{},sourceRoot:base});
  let server:Server|undefined;
  try {
    server=createApp(runtime.dataDir,{runtimeConfig:runtime}).listen(0,'127.0.0.1');
    await new Promise<void>((resolve,reject)=>{server!.once('listening',resolve);server!.once('error',reject);});
    const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
    const request=async(route:string,method='GET',body?:unknown,revision?:string)=>{
      const response=await fetch(`${url}${route}`,{method,headers:{'Content-Type':'application/json',...(revision?{'If-Match':revision}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
      return {status:response.status,body:await response.json()};
    };
    const state=(await request('/api/state')).body,backup=(await request('/api/backup')).body;
    const app=(await request('/api/settings/app')).body;
    const destination=path.join(base,'portable'),next={version:1,dataDir:destination,port:4100};
    assert.equal((await request('/api/settings/app','PUT',next)).status,428);
    assert.equal((await request('/api/settings/app/preview','POST',{...next,dataDir:base})).status,400);
    const preview=await request('/api/settings/app/preview','POST',next);assert.equal(preview.status,200);assert.equal(preview.body.exists,false);
    assert.equal(fs.existsSync(destination),false);
    const saved=await request('/api/settings/app','PUT',next,app.revision);
    assert.equal(saved.status,200);assert.equal(saved.body.restartRequired,true);assert.equal(saved.body.effective.dataDir,runtime.dataDir);
    assert.equal(fs.existsSync(destination),false);
    assert.equal((await request('/api/settings/app','PUT',next,app.revision)).status,409);
    assert.equal((await request('/api/state')).body.revision,state.revision);
    const user=(await request('/api/settings/user')).body;
    const custom={...user.value,appearance:{theme:'dark',palette:'slate',customColors:{slate:{light:{primary:'#563d7c'},dark:{primary:'#c8a4eb'}}}}};
    assert.equal((await request('/api/settings/user','PUT',custom,user.revision)).status,200);
    assert.equal((await request('/api/restore','POST',{backup},state.revision)).status,200);
    assert.deepEqual((await request('/api/settings/user')).body.value,custom);
    assert.deepEqual((await request('/api/backup')).body,backup);
  }finally{if(server){server.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>resolve()));}fs.rmSync(base,{recursive:true,force:true});}
});

test('different workspace servers sharing one user reject stale settings changes', async () => {
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'bench-settings-race-'));
  const runtime=resolveRuntimeConfig({home:path.join(base,'user'),env:{},sourceRoot:base});
  const servers:Server[]=[];
  try {
    const urls=[];
    for(const name of ['first','second']) {
      const server=createApp(path.join(base,name),{runtimeConfig:runtime}).listen(0,'127.0.0.1');servers.push(server);
      await new Promise<void>((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
      urls.push(`http://127.0.0.1:${(server.address() as {port:number}).port}`);
    }
    const first=await (await fetch(`${urls[0]}/api/settings/user`)).json(),second=await (await fetch(`${urls[1]}/api/settings/user`)).json();
    const write=async(url:string,theme:string)=>{
      const result=await fetch(`${url}/api/settings/user`,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':second.revision},body:JSON.stringify({...first.value,appearance:{...first.value.appearance,theme}})});
      await result.text();return result.status;
    };
    assert.equal(await write(urls[0],'dark'),200);assert.equal(await write(urls[1],'light'),409);
    assert.equal((await (await fetch(`${urls[1]}/api/settings/user`)).json()).value.appearance.theme,'dark');
  }finally{for(const server of servers){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}fs.rmSync(base,{recursive:true,force:true});}
});
