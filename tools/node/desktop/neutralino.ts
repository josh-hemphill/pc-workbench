import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,type ChildProcess,type SpawnOptions} from 'node:child_process';
type NativeLauncher=(command:string,args:string[],options:SpawnOptions)=>ChildProcess;
import {neutralinoClient} from './neutralino-client.ts';
import {randomUUID} from 'node:crypto';
import type {RuntimeConfig} from '../../../server/runtime-config.ts';

export const extensionId='org.pcworkbench.host';
export function neutralinoConfiguration(origin:string,cacheDir:string){
 return {applicationId:'org.pcworkbench.exploration',version:'0.2.0',cli:{clientLibrary:'/neutralino.js'},defaultMode:'window',port:0,url:origin,enableServer:true,enableNativeAPI:true,enableExtensions:true,extensions:[{id:extensionId}],exportAuthInfo:true,tokenSecurity:'one-time',dataLocation:'app',storageLocation:'system',nativeAllowList:['app.exit','extensions.dispatch'],logging:{enabled:true,writeToLogFile:false},systemEnvs:{WEBVIEW2_USER_DATA_FOLDER:cacheDir},modes:{window:{title:'PC Workbench — Neutralino exploration',width:1440,height:960,exitProcessOnClose:false,injectClientLibrary:true,injectScript:'/close.js',newWindowPolicy:'custom',enableInspector:false}}};
}
export function neutralinoCloseScript(origin:string,nonce:string){
 return `(() => {if(location.origin!==${JSON.stringify(origin)})return;Neutralino.events.on('windowClose',()=>{if(typeof globalThis.__pcWorkbenchCanClose==='function'&&globalThis.__pcWorkbenchCanClose()===true)void Neutralino.extensions.dispatch(${JSON.stringify(extensionId)},'close-approved',{nonce:${JSON.stringify(nonce)}});});Neutralino.init();})()`;
}
export function approvedNeutralinoClose(value:unknown,nonce:string):boolean {
 return !!value&&typeof value==='object'&&(value as {event?:unknown}).event==='close-approved'&&(value as {data?:{nonce?:unknown}}).data?.nonce===nonce;
}
export async function openNeutralino(origin:string,config:RuntimeConfig,stop:()=>Promise<void>,launch:NativeLauncher=spawn){
 const executable=process.env.BENCH_NEUTRALINO_BIN;
 if(!executable||!path.isAbsolute(executable))throw Error('Set BENCH_NEUTRALINO_BIN to the absolute path of a Neutralino 6.10.0 native binary.');
 if(!(await fs.stat(executable)).isFile())throw Error('Neutralino executable must be a regular file.');
 const parent=path.join(config.cacheDir,'neutralino-host');await fs.mkdir(parent,{recursive:true,mode:0o700});
 const directory=await fs.mkdtemp(path.join(parent,'session-')),nonce=randomUUID();
 let child:ReturnType<typeof spawn>|undefined,ws:WebSocket|undefined,closing:Promise<void>|undefined;
 let ended:Promise<unknown>|undefined;
 const finish=()=>closing??=(async()=>{
  try{
   await stop();
   if(child&&child.exitCode===null&&child.signalCode===null){
    if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({id:randomUUID(),method:'app.exit',accessToken:auth?.nlToken,data:{code:0}}));
    const timer=setTimeout(()=>child?.kill(),2000);
    const force=setTimeout(()=>child?.kill('SIGKILL'),5000);
    try{await ended;}finally{clearTimeout(timer);clearTimeout(force);}
   }
  }finally{ws?.close();await fs.rm(directory,{recursive:true,force:true});}
 })();
 let auth:{nlPort:number;nlToken:string;nlConnectToken:string}|undefined;
 try{
  await fs.writeFile(path.join(directory,'neutralino.config.json'),JSON.stringify(neutralinoConfiguration(origin,config.cacheDir)),{mode:0o600});
  await fs.writeFile(path.join(directory,'close.js'),neutralinoCloseScript(origin,nonce));
  await fs.writeFile(path.join(directory,'neutralino.js'),neutralinoClient());
  child=launch(executable,[`--path=${directory}`,'--res-mode=directory'],{cwd:directory,stdio:['ignore','ignore','pipe'],env:{...process.env,WEBVIEW2_USER_DATA_FOLDER:config.cacheDir}});
  const childProcess=child;
  ended=new Promise<void>((resolve,reject)=>{childProcess.once('error',reject);childProcess.once('exit',resolve);});
  // Keep a rejection handler attached even during authentication polling.
  void ended.catch(()=>{});
  child.stderr?.on('data',chunk=>process.stderr.write(chunk));
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){
   if(child.exitCode!==null||child.signalCode!==null)throw Error('Neutralino exited before authentication. Check its native WebView dependencies.');
   try{auth=JSON.parse(await fs.readFile(path.join(directory,'.tmp/auth_info.json'),'utf8'));break;}catch(error){if(!(error instanceof SyntaxError)&&(error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   await Promise.race([new Promise(resolve=>setTimeout(resolve,50)),ended.then(()=>{throw Error('Neutralino exited during startup.');})]);
  }
  if(!auth||!Number.isInteger(auth.nlPort)||auth.nlPort<1||auth.nlPort>65535||typeof auth.nlToken!=='string'||typeof auth.nlConnectToken!=='string')throw Error('Neutralino startup authentication was missing or invalid.');
  ws=new WebSocket(`ws://127.0.0.1:${auth.nlPort}?extensionId=${extensionId}&connectToken=${encodeURIComponent(auth.nlConnectToken)}`);
  const socket=ws;
  await new Promise<void>((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Neutralino connection timed out.')),5000);
   socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
   socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('Neutralino connection failed.'));},{once:true});
  });
  socket.addEventListener('message',event=>{
   if(typeof event.data!=='string'||event.data.length>4096)return;
   try{if(approvedNeutralinoClose(JSON.parse(event.data),nonce))void finish().catch(error=>{console.error(error);process.exitCode=1;});}catch{}
  });
  socket.addEventListener('close',()=>{void finish().catch(error=>{console.error(error);process.exitCode=1;});});
  void ended.then(()=>finish(),()=>finish()).catch(error=>{console.error(error);process.exitCode=1;});
  return {close:finish};
 }catch(error){await finish().catch(()=>{});throw error;}
}
