import {once} from 'node:events';
import type {AppOptions} from '../../../server/app';
import {startNodeServer} from '../../../server/node-serve';
import {resolveRuntimeConfig} from '../../../server/runtime-config';
import {assertSettingsSeparation} from '../../../server/settings';
import {openWebview} from './webviewjs';
import {prepareAddon} from './addon';
import {openNeutralino} from './neutralino';

export async function startDesktop(options:Pick<AppOptions,'assets'|'sourceRoot'>={}){
 const config=resolveRuntimeConfig({standalone:!!options.assets,sourceRoot:options.sourceRoot});
 assertSettingsSeparation(config);
 const headless=process.argv.includes('--headless-probe');
 const server=startNodeServer({...options,desktopOriginOnly:true},headless);
 let native:{close:()=>Promise<void>}|undefined,stopping:Promise<void>|undefined;
 const stopped=once(server,'close');
 const stop=()=>stopping??=(async()=>{
  if(server.listening){server.close();server.closeIdleConnections();}
  const timer=setTimeout(()=>server.closeAllConnections(),5000);
  try{await stopped;}finally{clearTimeout(timer);}
 })();
 const onClose=()=>{void native?.close().catch(error=>{console.error(error);process.exitCode=1;});};
 server.once('close',onClose);
 try{
  await once(server,'listening');
  const address=server.address();if(!address||typeof address==='string')throw Error('Invalid desktop address.');
  const origin=`http://127.0.0.1:${address.port}`;
  if(headless){const addon=prepareAddon(config.cacheDir);console.log(JSON.stringify({type:'desktop-probe',nativeWindow:false,addon,cacheDir:config.cacheDir}));return;}
  const shell=process.argv.includes('--neutralino')?'neutralino':'webviewjs';
  native=shell==='neutralino'?await openNeutralino(origin,config,stop):await openWebview(origin,config,stop);
  // A signal or backend shutdown can happen while the native host initializes.
  if(!server.listening)await native.close();
  console.log(JSON.stringify({type:'window-ready',shell,origin}));
 }catch(error){
  server.off('close',onClose);
  await stop().catch(()=>{});
  throw error;
 }
}
if(process.argv[1]?.endsWith('/desktop/main.ts')||process.argv[1]?.endsWith('\\desktop\\main.ts')){
 void startDesktop().catch(error=>{console.error('Desktop startup failed:',error);process.exitCode=1;});
}
