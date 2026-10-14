import fs from 'node:fs';
import type {RuntimeConfig} from '../../../server/runtime-config';
import {closeCoordinator,requestClose,sameOrigin} from './policy';
import {prepareAddon} from './addon';
export async function openWebview(origin:string,config:RuntimeConfig,stop:()=>Promise<void>){
 prepareAddon(config.cacheDir);
 // Bundled JS wrapper, native addon loaded only after cache setup above.
 const {Application}=await import('@webviewjs/webview');
 const app=new Application();
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  await Promise.race([app.whenReady(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Native window startup timed out.')),15000);})]);
  clearTimeout(timer);
  fs.mkdirSync(config.cacheDir,{recursive:true,mode:0o700});
  const profile=app.createWebContext({dataDirectory:config.cacheDir});
  const win=app.createBrowserWindow({title:'PC Workbench — WebviewJS exploration',width:1440,height:960,logical:true});
  const view=win.createWebview({url:origin,webContext:profile,enableDevtools:false,navigationHandler:url=>sameOrigin(url,origin),newWindowHandler:()=>false});
  let ending:Promise<void>|undefined;
  const finish=()=>ending??=(async()=>{await stop();app.exit();})();
  const request=closeCoordinator(()=>requestClose(view,origin),finish,error=>console.error('Close canceled:',error));
  win.on('close',event=>{event.preventDefault();void request();});
  app.on('application-close-requested',()=>{void finish().catch(error=>{console.error(error);process.exitCode=1;});});
  return {close:finish,app,win,view};
 }catch(error){clearTimeout(timer);app.exit();throw error;}
}
