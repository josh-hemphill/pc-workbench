/** Keep startup feedback independent of Vue and its dependency graph. */
import {isModuleLoadFailure,nextStartupRetry,startupRetryKey} from './startup-recovery.ts';
const startupScreen=document.querySelector<HTMLElement>('[data-startup-screen]');
function showScreen(title:string,message:string,recovery=false,canReload=false){
 if(!startupScreen?.isConnected)return;
 startupScreen.setAttribute('role',recovery?'alert':'status');startupScreen.replaceChildren();
 const heading=document.createElement('h1');heading.textContent=title;
 const detail=document.createElement('p');detail.textContent=message;
 startupScreen.append(heading,detail);
 if(recovery||canReload){
  const retry=document.createElement('button');retry.type='button';retry.textContent='Reload workbench';
  // Reload preserves the hash route and fetches a fresh module graph.
  retry.addEventListener('click',()=>{clearRetry();location.reload();});startupScreen.append(retry);
 }
}
function clearRetry(){try{sessionStorage.removeItem(startupRetryKey);}catch{/* Storage can be disabled. */}}
function recoverModuleLoad(error:unknown){
 if(!isModuleLoadFailure(error)||!startupScreen?.isConnected)return false;
 try{
  const retry=nextStartupRetry(sessionStorage.getItem(startupRetryKey));if(!retry)return false;
  // Persist before reloading: if storage is unavailable, do not risk an endless loop.
  sessionStorage.setItem(startupRetryKey,JSON.stringify(retry));
  showScreen('Opening your workbench…','Waiting for the application connection. Your current page will open automatically.');
  console.warn('Retrying workbench module loading:',error);
  window.setTimeout(()=>{if(startupScreen.isConnected)location.reload();},750*2**(retry.attempts-1));
  return true;
 }catch{return false;}
}
const waitingMessage=import.meta.env.DEV?'The development server is still preparing the application. This page will open automatically when it is ready.':'The application is still loading. This page will open automatically when it is ready.';
const timer=window.setTimeout(()=>showScreen('Workbench is still opening',waitingMessage,false,true),15000);
try{
 await import('./main.ts');
 clearRetry();
}catch(error){
 if(!recoverModuleLoad(error)){
  clearRetry();console.error('Workbench startup failed:',error);
  showScreen('Workbench could not start',error instanceof Error?error.message:String(error),true);
 }
}finally{window.clearTimeout(timer);}

export {};
