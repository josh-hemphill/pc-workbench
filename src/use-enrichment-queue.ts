import {onBeforeUnmount,ref,watch} from 'vue';
import type {EnrichmentJob} from '../shared/catalog-quality.ts';
/** Keep catalog badges and the queue view on one snapshot, including on the Components tab. */
export function useEnrichmentQueue(enabled:()=>boolean){
 const jobs=ref<EnrichmentJob[]>([]),running=ref(false),loaded=ref(false),error=ref('');
 let timer:ReturnType<typeof setInterval>|undefined,controller:AbortController|undefined,generation=0,inFlight=false,disposed=false;
 async function refresh(){
  if(disposed||!enabled())return;
  const current=++generation;controller?.abort();controller=new AbortController();inFlight=true;
  try{
   const response=await fetch('/api/enrichment',{signal:controller.signal,cache:'no-store'});
   if(!response.ok)throw Error('Queue status is unavailable.');
   const data=await response.json();if(current!==generation)return;
   jobs.value=data.jobs;running.value=data.running;loaded.value=true;error.value='';
  }catch(e){if(current===generation)error.value=e instanceof Error?e.message:String(e);}
  finally{if(current===generation)inFlight=false;}
 }
 function stop(){clearInterval(timer);controller?.abort();generation++;inFlight=false;}
 watch(enabled,active=>{stop();loaded.value=false;error.value='';if(!active)return;void refresh();timer=setInterval(()=>{if(!inFlight)void refresh();},2500);},{immediate:true});
 onBeforeUnmount(()=>{disposed=true;stop();});
 return {jobs,running,loaded,error,refresh};
}
