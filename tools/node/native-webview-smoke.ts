// Linux/X11 native integration check; run inside a dedicated virtual display.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../../server/app';
import {resolveRuntimeConfig} from '../../server/runtime-config';
import {Backend} from './desktop/backend';
import {openWebview} from './desktop/webviewjs';
import {requestClose} from './desktop/policy';
if(process.platform!=='linux'||!process.env.DISPLAY)throw Error('This check requires Linux, WebKitGTK, X11 tools and DISPLAY.');
const root=fileURLToPath(new URL('../../',import.meta.url));
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-native-smoke-'));
const config=resolveRuntimeConfig({standalone:true,home:directory,env:{BENCH_DATA_DIR:path.join(directory,'workspace'),BENCH_CACHE_DIR:path.join(directory,'cache')}});
const assets:Record<string,{data:Buffer;mime:string}>={};function collect(dir:string,prefix=''){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const name=prefix+'/'+e.name,file=path.join(dir,e.name);if(e.isDirectory())collect(file,name);else assets[name]={data:fs.readFileSync(file),mime:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'} as Record<string,string>)[path.extname(file)]||'application/octet-stream'};}}collect(path.join(root,'dist'));
const app=createApp(config.dataDir,{runtimeConfig:config,assets,desktopOriginOnly:true});
const backend=new Backend(()=>({listen:(p,h,cb)=>(()=>{const server=app.listen(p,h,cb);server.on('request',(req,res)=>res.on('finish',()=>console.log('NATIVE_HTTP',req.url,res.statusCode)));return server;})(),locals:{closeStore:()=>app.locals.closeStore()}}));
let host:Awaited<ReturnType<typeof openWebview>>|undefined;
try{
 const origin=await backend.ready;host=await openWebview(origin,config,()=>backend.stop());
 host.view.on('page-load-started',e=>console.log('PAGE_START',e));host.view.on('page-load-finished',e=>console.log('PAGE_FINISH',e));console.log('NATIVE_WINDOW_CREATED',host.view.url());
 function evaluate(script:string):Promise<unknown>{return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Native JS result timed out')),10000);host!.view.evaluateScriptWithCallback(script,(...args:unknown[])=>{clearTimeout(timer);if(args.length===2&&args[0])reject(args[0]);else{let value=args.length===2?args[1]:args[0];try{for(let i=0;i<2&&typeof value==='string';i++)value=JSON.parse(value);resolve(value);}catch{resolve(value);}}});});}
 await new Promise(r=>setTimeout(r,1500));const until=Date.now()+20000;let loaded=false;
 while(Date.now()<until){if(await evaluate("JSON.stringify(typeof globalThis.__pcWorkbenchCanClose==='function'&&[...document.querySelectorAll('h1')].some(e=>e.textContent==='Configurations')&&!document.body.innerText.includes('Opening your workbench'))")){loaded=true;break;}await new Promise(r=>setTimeout(r,100));}
 if(!loaded)throw Error('Native frontend did not load');
 await new Promise(r=>setTimeout(r,400));const {execFileSync}=await import('node:child_process');if(process.env.BENCH_NATIVE_SCREENSHOT)execFileSync('import',['-window','root',process.env.BENCH_NATIVE_SCREENSHOT]);
 console.log('NATIVE_UI_LOADED',await evaluate("JSON.stringify({title:document.title,headings:[...document.querySelectorAll('h1')].map(e=>e.textContent),origin:location.origin})"));
 assert.equal(await requestClose(host.view,origin),true);console.log('Native clean close decision passed.');
 await evaluate("document.querySelectorAll('button').forEach(b=>{if(b.textContent?.includes('Component catalog'))b.click()});JSON.stringify(true)");
 await new Promise(r=>setTimeout(r,200));
 await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent?.includes('Add component'))?.click();JSON.stringify(true)");await new Promise(r=>setTimeout(r,200));
  await evaluate("const label=[...document.querySelectorAll('label')].find(e=>e.textContent?.includes('Component name'));const input=document.getElementById(label.htmlFor);input.value='Native unsaved component';input.dispatchEvent(new Event('input',{bubbles:true}));window.confirm=()=>false;JSON.stringify(true)");await new Promise(r=>setTimeout(r,100));
 execFileSync('python3',[path.join(root,'tests/fixtures/request-native-close.py')]);await new Promise(r=>setTimeout(r,400));
 assert.equal((await fetch(origin+'/api/state')).status,200);assert.equal(await evaluate("JSON.stringify([...document.querySelectorAll('input')].some(e=>e.value==='Native unsaved component'))"),true);console.log('Native OS close cancellation retained the edited form and backend.');
 host.view.loadUrl('https://example.com');await new Promise(r=>setTimeout(r,200));assert.equal(await evaluate('JSON.stringify(location.origin=== '+JSON.stringify(origin)+')'),true);console.log('Native foreign navigation blocked.');
 await evaluate("window.confirm=()=>true;JSON.stringify(true)");execFileSync('python3',[path.join(root,'tests/fixtures/request-native-close.py')]);await backend.status;
 assert.equal(fs.existsSync(path.join(config.dataDir,'.server-lock.json')),false);console.log('Native accepted close released the SQLite workspace lock.');
}finally{await host?.close();await backend.stop();fs.rmSync(directory,{recursive:true,force:true});}
