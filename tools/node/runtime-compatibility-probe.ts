// Run with Node as the reference, then Cottontail 0.7.1 directly.
// Uses only temporary data; never points at a user's real workspace.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../../server/app.ts';
import {resolveRuntimeConfig} from '../../server/runtime-config.ts';
import {Store} from '../../server/store.ts';
import {Backend} from './desktop/backend.ts';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-runtime-compat-'));
const runtime=resolveRuntimeConfig({standalone:true,home:directory,env:{BENCH_DATA_DIR:path.join(directory,'workspace')}});
let backend:Backend|undefined;
function start(){const app=createApp(runtime.dataDir,{runtimeConfig:runtime,desktopOriginOnly:true});return new Backend(()=>({listen:(port,host,callback)=>app.listen(port,host,callback),locals:{closeStore:()=>app.locals.closeStore()}}));}
try{
 backend=start();let origin=await backend.ready;
 const state=await(await fetch(origin+'/api/state')).json();const record={...state.components[0],name:'Runtime compatibility durable edit'};
 const edit=await fetch(`${origin}/api/components/${record.id}`,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':state.revision},body:JSON.stringify(record)});assert.equal(edit.status,200,await edit.text());
 assert.equal((await fetch(origin+'/api/state',{headers:{Origin:'http://127.0.0.1:1'}})).status,403);
 assert.ok((await(await fetch(origin+'/api/export/components')).text()).includes(record.name));
 assert.ok((await(await fetch(origin+'/api/backup')).json()).components.some((row:{name:string})=>row.name===record.name));
 await backend.stop();assert.equal(fs.existsSync(path.join(runtime.dataDir,'.server-lock.json')),false);
 const store=new Store(runtime.dataDir);const persist=store.persist.bind(store);
 try{store.persist=(collection,rows)=>{persist(collection,rows);throw Error('injected rollback probe');};assert.throws(()=>store.replace('components',store.db.components.map(row=>row.id===record.id?{...row,name:'Must be rolled back'}:row)),/injected rollback/);}finally{store.close();}
 backend=start();origin=await backend.ready;const restored=await(await fetch(origin+'/api/state')).json();assert.equal(restored.components.find((row:{id:string})=>row.id===record.id).name,record.name);
 await backend.stop();console.log(JSON.stringify({runtime:process.versions,checks:['SQLite/WAL initialization','Express edit/revision guard','CSV/backup','foreign-port origin rejection','graceful shutdown/lock release','transaction rollback','durable restart']},null,2));
}finally{await backend?.stop();fs.rmSync(directory,{recursive:true,force:true});}
