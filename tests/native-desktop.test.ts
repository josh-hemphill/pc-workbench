import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {sameOrigin,localOrigin,requestClose,closeCoordinator,type CloseView} from '../tools/node/desktop/policy.ts';
import {extractAddon} from '../tools/node/desktop/addon.ts';
import {neutralinoConfiguration,approvedNeutralinoClose,neutralinoCloseScript} from '../tools/node/desktop/neutralino.ts';
import {createApp} from '../server/app.ts';
import {once} from 'node:events';
import {get} from 'node:http';
const origin='http://127.0.0.1:1234';
function view(allowed:unknown,form:'single'|'double'|'error-first'|'error'='single'):CloseView {
 return {url:()=>origin,evaluateScriptWithCallback:(script,callback)=>{
  const id=JSON.parse(script.match(/id:("[^"]+")/)![1]);
  const result=JSON.stringify({id,origin,allowed});
  callback(...(form==='error'?['failure',result]:form==='error-first'?[null,result]:[form==='double'?JSON.stringify(result):result]));
 }};
}
test('desktop navigation matches exact loopback origin, including port and credentials',()=>{
 assert.equal(localOrigin(origin),origin);
 for(const url of ['https://127.0.0.1:1234','http://localhost:1234','http://127.0.0.1:9999','http://127.0.0.1:1234@foreign.example','javascript:alert(1)','file:///tmp/index.html','http://user@127.0.0.1:1234'])assert.equal(sameOrigin(url,origin),false,url);
 assert.equal(sameOrigin(origin+'/configurations?id=1#details',origin),true);
 assert.throws(()=>localOrigin(origin+'/elsewhere'));
});
test('close decisions handle native error-first and encoded WebView2 callback forms',async()=>{
 for(const form of ['single','double','error-first'] as const)assert.equal(await requestClose(view(true,form),origin),true);
 assert.equal(await requestClose(view(true,'error'),origin),false);
 for(const allowed of [false,'true',1,null])assert.equal(await requestClose(view(allowed),origin),false);
});
test('close fails closed for missing callbacks, script errors, stale origin and malformed results',async()=>{
 assert.equal(await requestClose({url:()=>origin,evaluateScriptWithCallback:()=>{}},origin,5),false);
 assert.equal(await requestClose({url:()=>origin,evaluateScriptWithCallback:()=>{throw Error('script failed');}},origin),false);
 assert.equal(await requestClose({url:()=>origin,evaluateScriptWithCallback:(_s,cb)=>cb('true')},origin),false);
 const changed=view(true);const original=changed.evaluateScriptWithCallback;changed.evaluateScriptWithCallback=(s,cb)=>{changed.url=()=>origin.replace('1234','9999');original(s,cb);};
 assert.equal(await requestClose(changed,origin),false);
});
test('repeated native close requests share one prompt and cancel retains the backend',async()=>{
 let reply!:(allowed:boolean)=>void,prompts=0,stops=0;
 const close=closeCoordinator(()=>{prompts++;return new Promise(resolve=>reply=resolve);},async()=>{stops++;},()=>assert.fail());
 const first=close();assert.equal(close(),first);reply(false);await first;assert.equal(stops,0);
 const second=close();reply(true);await second;await close();assert.equal(prompts,2);assert.equal(stops,1);
});
test('native cache extraction is durable, integrity checked and separate from application cwd',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'workbench native cache '));
 try{
  const file=extractAddon(Buffer.from('native fixture'),directory);assert.ok(file.startsWith(directory+path.sep));assert.equal(extractAddon(Buffer.from('native fixture'),directory),file);
  fs.writeFileSync(file,'tampered');assert.throws(()=>extractAddon(Buffer.from('native fixture'),directory),/integrity/);
  fs.rmSync(file);fs.mkdirSync(file);assert.throws(()=>extractAddon(Buffer.from('native fixture'),directory));
  if(process.platform!=='win32'){fs.rmdirSync(file);fs.symlinkSync(path.join(directory,'missing'),file);assert.throws(()=>extractAddon(Buffer.from('native fixture'),directory));}
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('Neutralino host has narrow capabilities and closes only for its session approval',()=>{
 const config=neutralinoConfiguration(origin,'/user/cache');assert.equal(config.modes.window.exitProcessOnClose,false);assert.equal(config.modes.window.newWindowPolicy,'custom');assert.equal(config.tokenSecurity,'one-time');assert.deepEqual(config.nativeAllowList,['app.exit','extensions.dispatch']);
 assert.equal(approvedNeutralinoClose({event:'close-approved',data:{nonce:'session'}},'session'),true);
 for(const value of [null,{event:'close-approved',data:{nonce:'other'}},{event:'exec',data:{nonce:'session'}}])assert.equal(approvedNeutralinoClose(value,'session'),false);
 assert.ok(neutralinoCloseScript(origin,'session').includes('__pcWorkbenchCanClose'));
});
test('desktop API rejects foreign loopback ports as well as remote origins and hosts',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-native-origin-'));
 const app=createApp(directory,{desktopOriginOnly:true});const server=app.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');const url=`http://127.0.0.1:${address.port}`;
 try{
  assert.equal((await fetch(url+'/api/state',{headers:{origin:url}})).status,200);
  for(const origin of ['http://127.0.0.1:1','https://foreign.example'])assert.equal((await fetch(url+'/api/state',{headers:{origin}})).status,403);
  const status=await new Promise<number|undefined>((resolve,reject)=>get(url+'/api/state',{headers:{host:'localhost:'+address.port}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject));assert.equal(status,403);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));fs.rmSync(directory,{recursive:true,force:true});}
});
test('Neutralino real child protocol ignores stale approvals and stops backend before native exit',async()=>{
 const {openNeutralino}=await import('../tools/node/desktop/neutralino.ts');
 const {resolveRuntimeConfig}=await import('../server/runtime-config.ts');
 const {spawn}=await import('node:child_process');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'workbench neutralino protocol '));
 const previous=process.env.BENCH_NEUTRALINO_BIN;process.env.BENCH_NEUTRALINO_BIN=process.execPath;
 const marker=path.join(directory,'stopped'),result=path.join(directory,'result');
 const runtime=resolveRuntimeConfig({home:directory,env:{BENCH_CACHE_DIR:path.join(directory,'cache')},standalone:true});
 let host:{close:()=>Promise<void>}|undefined,stops=0;
 try{
  host=await openNeutralino(origin,runtime,async()=>{stops++;fs.writeFileSync(marker,'stopped');},(_command,args,options)=>spawn(process.execPath,[path.resolve('tests/fixtures/neutralino-host.mjs'),...(args??[])],{...options,env:{...options?.env,BENCH_NEUTRALINO_STOPPED:marker,BENCH_NEUTRALINO_RESULT:result}}));
  const deadline=Date.now()+5000;while(!fs.existsSync(result)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(fs.readFileSync(result,'utf8'),'shutdown-before-native-exit');await host.close();assert.equal(stops,1);
  assert.deepEqual(fs.readdirSync(path.join(runtime.cacheDir,'neutralino-host')),[]);
 }finally{await host?.close();if(previous===undefined)delete process.env.BENCH_NEUTRALINO_BIN;else process.env.BENCH_NEUTRALINO_BIN=previous;fs.rmSync(directory,{recursive:true,force:true});}
});
