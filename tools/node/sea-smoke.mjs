import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const executable=path.join(root,'bin',`pc-workbench-node-${process.platform}-${process.arch}${process.platform==='win32'?'.exe':''}`);
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'pc-workbench-node-sea-'));
let child;
async function run(portOverride){
 const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=portOverride??probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const config=path.join(temporary,'app.json');await fs.writeFile(config,JSON.stringify({version:1,dataDir:path.join(temporary,'data'),port}));
 const childEnv={...process.env,PATH:'',BENCH_CONFIG_FILE:config,BENCH_USER_SETTINGS_FILE:path.join(temporary,'user.json'),BENCH_CACHE_DIR:path.join(temporary,'cache')};delete childEnv.PORT;delete childEnv.BENCH_DATA_DIR;delete childEnv.NODE_OPTIONS;
 child=spawn(executable,['--desktop'],{cwd:temporary,env:childEnv,stdio:['pipe','pipe','pipe']});let output='',errors='';child.stderr.on('data',chunk=>errors+=chunk);
 return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('SEA readiness timeout: '+errors)),15000);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);reject(Error('SEA startup exited '+code+': '+errors));});child.stdout.on('data',chunk=>{output+=chunk;for(const line of output.split('\n')){try{const message=JSON.parse(line);if(message.type==='ready'){clearTimeout(timer);resolve(message.origin);}}catch{}}});});
}
async function stop(eof=false){const exited=once(child,'exit');if(eof)child.stdin.end();else child.stdin.write('shutdown\n');const timer=setTimeout(()=>child.kill(),10000);try{const [code]=await exited;assert.equal(code,0);assert.equal(await fs.access(path.join(temporary,'data','.server-lock.json')).then(()=>true,()=>false),false);}finally{clearTimeout(timer);child=undefined;}}
try{
 let origin=await run();let response=await fetch(origin+'/');assert.equal(response.status,200);const html=await response.text();const asset=html.match(/(?:src|href)="(\/assets\/[^\"]+)"/)[1];response=await fetch(origin+asset);assert.equal(response.status,200);assert.ok((await response.arrayBuffer()).byteLength>100);
 response=await fetch(origin+'/api/state',{headers:{Origin:'https://foreign.example'}});assert.equal(response.status,403);
 const state=await (await fetch(origin+'/api/state')).json(),record=state.components.find(c=>c.id==='cpu');record.name='CPU saved by isolated Node SEA';
 response=await fetch(origin+'/api/components/cpu',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':state.revision},body:JSON.stringify(record)});assert.equal(response.status,200,await response.text());
 const csv=await (await fetch(origin+'/api/export/components')).text();assert.ok(csv.includes(record.name));const backup=await (await fetch(origin+'/api/backup')).json();assert.ok(backup.components.some(c=>c.name===record.name));await stop();
 origin=await run();const restored=await (await fetch(origin+'/api/state')).json();assert.equal(restored.components.find(c=>c.id==='cpu').name,record.name);await stop(true);
 const occupied=createServer();occupied.listen(0,'127.0.0.1');await once(occupied,'listening');try{await assert.rejects(run(occupied.address().port),/SEA startup exited 1[\s\S]*EADDRINUSE/);assert.equal(child.exitCode,1);child=undefined;assert.equal(await fs.access(path.join(temporary,'data','.server-lock.json')).then(()=>true,()=>false),false);}finally{await new Promise(resolve=>occupied.close(resolve));}
 console.log('SEA passed: empty PATH/cwd, embedded frontend assets, API edits, CSV/backup, SQLite restart, shutdown command, parent EOF, port-conflict failure and released workspace lock.');
}finally{if(child&&child.exitCode===null&&child.signalCode===null){child.kill();await once(child,'exit').catch(()=>{});}await fs.rm(temporary,{recursive:true,force:true});}
