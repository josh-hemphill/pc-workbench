import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/index.ts';
import { resolveRuntimeConfig } from '../server/runtime-config.ts';
import { defaultUserSettings } from '../shared/settings.ts';

test('appearance is per-user across origins and workspaces, with revision conflicts and isolated workspace backups', async () => {
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'bench-appearance-'));
  const runtime=resolveRuntimeConfig({home:path.join(base,'user-a'),env:{},sourceRoot:base});
  const otherUser=resolveRuntimeConfig({home:path.join(base,'user-b'),env:{},sourceRoot:base});
  let server:Server|undefined;
  const open=async(directory:string,config=runtime)=>{
    server=createApp(directory,{runtimeConfig:config}).listen(0,'127.0.0.1');
    await new Promise<void>((resolve,reject)=>{server!.once('listening',resolve);server!.once('error',reject);});
    return `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  };
  const close=async()=>{server!.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>resolve()));server=undefined;};
  try {
    let origin=await open(path.join(base,'workspace-a'));
    const before=await (await fetch(`${origin}/api/state`)).json();
    const preferences=await fetch(`${origin}/api/preferences`);
    assert.deepEqual(await preferences.json(),{theme:'system'});
    const save=await fetch(`${origin}/api/preferences`,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':preferences.headers.get('etag')!},body:JSON.stringify({theme:'dark'})});
    assert.equal(save.status,200);assert.deepEqual(await save.json(),{theme:'dark'});
    const stale=await fetch(`${origin}/api/preferences`,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':'missing'},body:JSON.stringify({theme:'light'})});
    assert.equal(stale.status,409);await stale.text();
    assert.equal((await (await fetch(`${origin}/api/state`)).json()).revision,before.revision);
    assert.equal(fs.existsSync(path.join(base,'workspace-a','user-settings.json')),false);
    for(const body of [{theme:'invalid'},{theme:'light',unexpected:true},null,[]]){
      const invalid=await fetch(`${origin}/api/preferences`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      assert.equal(invalid.status,400);await invalid.text();
    }
    const missing=await fetch(`${origin}/api/preferences`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({theme:'light'})});
    assert.equal(missing.status,428);await missing.text();
    const foreign=await fetch(`${origin}/api/settings/user`,{method:'PUT',headers:{'Content-Type':'application/json',Origin:'https://foreign.example'},body:JSON.stringify(defaultUserSettings)});
    assert.equal(foreign.status,403);await foreign.text();
    assert.equal(Object.hasOwn(await (await fetch(`${origin}/api/backup`)).json(),'appearance'),false);
    await close();origin=await open(path.join(base,'workspace-b'));
    assert.deepEqual(await (await fetch(`${origin}/api/preferences`)).json(),{theme:'dark'});
    await close();origin=await open(path.join(base,'workspace-a'),otherUser);
    assert.deepEqual(await (await fetch(`${origin}/api/preferences`)).json(),{theme:'system'});
    await close();origin=await open(path.join(base,'workspace-a'));
    assert.deepEqual(await (await fetch(`${origin}/api/preferences`)).json(),{theme:'dark'});
    const db=new DatabaseSync(path.join(base,'workspace-a','workbench.sqlite'));
    assert.equal(db.prepare("SELECT value FROM workspace_meta WHERE key='theme'").get(),undefined);db.close();
  }finally{if(server)await close();fs.rmSync(base,{recursive:true,force:true});}
});

test('legacy appearance is offered explicitly and never overrides existing user settings', async () => {
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'bench-legacy-'));
  const directory=path.join(base,'workspace'),runtime=resolveRuntimeConfig({home:path.join(base,'user'),env:{},sourceRoot:base});
  let server:Server|undefined;
  try {
    const app=createApp(directory,{runtimeConfig:runtime});app.locals.closeStore();
    const db=new DatabaseSync(path.join(directory,'workbench.sqlite'));
    db.prepare('INSERT OR REPLACE INTO workspace_meta(key,value) VALUES(?,?)').run('theme','dark');db.close();
    server=createApp(directory,{runtimeConfig:runtime}).listen(0,'127.0.0.1');
    await new Promise<void>((resolve,reject)=>{server!.once('listening',resolve);server!.once('error',reject);});
    const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
    const first=await (await fetch(`${origin}/api/settings/user`)).json();
    assert.equal(first.value.appearance.theme,'system');assert.equal(first.legacyTheme,'dark');
    const imported=await fetch(`${origin}/api/settings/user/import-legacy`,{method:'POST',headers:{'If-Match':first.revision}});
    assert.equal(imported.status,200);assert.equal((await imported.json()).value.appearance.theme,'dark');
    const saved=await (await fetch(`${origin}/api/settings/user`)).json();assert.equal(saved.legacyTheme,null);
    const again=await fetch(`${origin}/api/settings/user/import-legacy`,{method:'POST',headers:{'If-Match':saved.revision}});
    assert.equal(again.status,409);await again.text();
    const db2=new DatabaseSync(path.join(directory,'workbench.sqlite'));
    assert.equal(db2.prepare("SELECT value FROM workspace_meta WHERE key='theme'").get()?.value,'dark');db2.close();
  }finally{if(server){server.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>resolve()));}fs.rmSync(base,{recursive:true,force:true});}
});
