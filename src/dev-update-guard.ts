type UpdateEvent='vite:beforeFullReload'|'vite:beforeUpdate'|'vite:ws:disconnect';
interface HotUpdates {on:(event:UpdateEvent,callback:()=>Promise<void>)=>void;off:(event:UpdateEvent,callback:()=>Promise<void>)=>void}
/** Vite awaits these hooks before replacing modules or reloading after reconnect. */
export function installDevUpdateGuard(hot:HotUpdates,isPending:()=>boolean,notify:()=>void,intervalMs=250){
 let pending:Promise<void>|undefined,release:(()=>void)|undefined,timer:ReturnType<typeof setInterval>|undefined,stopped=false;
 function finish(){if(timer!==undefined)clearInterval(timer);timer=undefined;const resolve=release;release=undefined;pending=undefined;resolve?.();}
 function wait(){
  if(stopped||!isPending())return Promise.resolve();
  if(!pending){
   pending=new Promise<void>(resolve=>{release=resolve;});
   timer=setInterval(()=>{if(!isPending())finish();},intervalMs);
   notify();
  }
  return pending;
 }
 const events:UpdateEvent[]=['vite:beforeFullReload','vite:beforeUpdate','vite:ws:disconnect'];
 for(const event of events)hot.on(event,wait);
 return ()=>{stopped=true;for(const event of events)hot.off(event,wait);finish();};
}
