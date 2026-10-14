import {randomUUID} from 'node:crypto';

export function localOrigin(value:string):string {
 const url=new URL(value);
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Expected a loopback application origin.');
 return url.origin;
}
export function sameOrigin(value:string,origin:string):boolean {
 try {const url=new URL(value);return url.origin===localOrigin(origin)&&!url.username&&!url.password;}catch{return false;}
}
// No generic renderer binding: only evaluate the app's close decision.
export interface CloseView {url():string|null;evaluateScriptWithCallback(script:string,callback:(...args:unknown[])=>void):void}
export function requestClose(view:CloseView,origin:string,timeoutMs=30000):Promise<boolean> {
 if(!sameOrigin(view.url()??'',origin))return Promise.resolve(false);
 const id=randomUUID();
 return new Promise(resolve=>{
  let settled=false;
  const finish=(value:boolean)=>{if(settled)return;settled=true;clearTimeout(timer);resolve(value);};
  const timer=setTimeout(()=>finish(false),timeoutMs);
  const script=`JSON.stringify({id:${JSON.stringify(id)},origin:location.origin,allowed:location.origin===${JSON.stringify(origin)}&&typeof globalThis.__pcWorkbenchCanClose==='function'&&globalThis.__pcWorkbenchCanClose()===true})`;
  try{view.evaluateScriptWithCallback(script,(...args)=>{
   // Current native source uses an error-first N-API callback; online docs
   // describe one argument. Accept only these two representations.
   if(args.length===2&&args[0]!=null){finish(false);return;}
   let result:unknown=args.length===2?args[1]:args.length===1?args[0]:null;
   try{
    for(let depth=0;depth<2&&typeof result==='string';depth++)result=JSON.parse(result);
    const decision=result as {id?:unknown;origin?:unknown;allowed?:unknown}|null;
    finish(decision?.id===id&&decision.origin===origin&&decision.allowed===true&&sameOrigin(view.url()??'',origin));
   }catch{finish(false);}
  });}catch{finish(false);}
 });
}
export function closeCoordinator(confirm:()=>Promise<boolean>,shutdown:()=>Promise<void>,report:(error:unknown)=>void){
 let pending:Promise<void>|undefined,closed=false;
 return ()=>{
  if(closed)return Promise.resolve();
  return pending??=(async()=>{try{if(await confirm()){await shutdown();closed=true;}}catch(error){report(error);}finally{pending=undefined;}})();
 };
}
