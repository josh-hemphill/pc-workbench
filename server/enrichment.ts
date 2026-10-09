import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {categories} from '../shared/types';
import type {Store} from './store';
import {patchMissing,isMissing,fieldValue,type EnrichmentJob} from '../shared/catalog-quality';
import {extractProductDetails,pcPartPickerURL} from '../shared/product-enrichment';
const jobSchema=z.object({id:z.string(),componentId:z.string(),name:z.string(),category:z.enum(categories),url:z.string(),state:z.enum(['queued','fetching','review','failed','applied','cancelled']),createdAt:z.string(),updatedAt:z.string(),message:z.string(),proposalId:z.string().optional(),proposal:z.object({patch:z.record(z.string(),z.unknown()),evidence:z.record(z.string(),z.string())}).optional()}).strict();
export type ProductFetcher=(url:string,signal:AbortSignal)=>Promise<string>;
export async function fetchProductPage(url:string,signal:AbortSignal):Promise<string>{
 let current=pcPartPickerURL(url);
 for(let redirects=0;redirects<4;redirects++){
  const response=await fetch(current,{signal,redirect:'manual',headers:{Accept:'text/html','User-Agent':'PC-Workbench/1.0 (user-requested product enrichment)'}});
  if([301,302,303,307,308].includes(response.status)){await response.body?.cancel();current=pcPartPickerURL(new URL(response.headers.get('location')||'',current).href);continue;}
  if(!response.ok){await response.body?.cancel();throw Error(`PCPartPicker returned HTTP ${response.status}. Upload a saved product page instead; no challenge bypass is attempted.`);}
  if(!response.headers.get('content-type')?.includes('text/html')){await response.body?.cancel();throw Error('The response is not an HTML product page.');}
  const reader=response.body?.getReader();if(!reader)throw Error('Empty product page.');let size=0;const chunks:Uint8Array[]=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024)throw Error('Product page exceeds 2 MiB.');chunks.push(value);}}finally{await reader.cancel();}
  const all=new Uint8Array(size);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}return new TextDecoder().decode(all);
 }
 throw Error('Too many product redirects.');
}
export class EnrichmentQueue {
 jobs:EnrichmentJob[];running=false;private stopped=false;private closed=false;private controller?:AbortController;
 constructor(private store:Store,private fetchPage:ProductFetcher=fetchProductPage){this.jobs=z.array(jobSchema).max(500).parse(store.getEnrichmentJobs());for(const job of this.jobs)if(job.state==='fetching'){job.state='queued';job.message='Interrupted fetch; ready to retry.';}this.persist();}
 private persist(){this.store.setEnrichmentJobs(this.jobs);}
 enqueue(items:{componentId:string;url:string}[]){if(!items.length||items.length>100)throw Error('Select 1–100 components.');const pending=items.map(item=>{const c=this.store.db.components.find(c=>c.id===item.componentId);if(!c)throw Error('Component not found.');return {c,url:pcPartPickerURL(item.url)};});const added:EnrichmentJob[]=[];
  for(const {c,url} of pending){if([...this.jobs,...added].some(j=>j.componentId===c.id&&['queued','fetching','review'].includes(j.state)))continue;const at=new Date().toISOString();added.push({id:randomUUID(),componentId:c.id,name:c.name,category:c.category,url,state:'queued',createdAt:at,updatedAt:at,message:'Waiting for fetch or saved HTML.'});}
  if(this.jobs.length+added.length>500)throw Error('Queue history limit is 500 jobs. Clear completed/failed jobs first.');this.jobs.push(...added);this.persist();return added;
 }
 private job(id:string){const j=this.jobs.find(j=>j.id===id);if(!j)throw Error('Queue job not found.');return j;}
 private propose(job:EnrichmentJob,html:string){const c=this.store.db.components.find(c=>c.id===job.componentId);if(!c||c.category!==job.category||c.name!==job.name)throw Error('Component removed or identity changed; queue it again.');const p=extractProductDetails(html,c);if(!Object.keys(p.patch).length)throw Error('No supported missing fields found. Add specifications manually or try manufacturer documentation.');job.proposal={patch:p.patch,evidence:p.evidence};job.proposalId=randomUUID();job.state='review';job.message=`Source product: ${p.productName||'identity unavailable; verify the product manually'}. Confirm it matches ${c.name} before applying.`;job.updatedAt=new Date().toISOString();}
 upload(id:string,html:string){const job=this.job(id);if(!['queued','failed','review'].includes(job.state))throw Error('Only waiting, failed or review jobs accept HTML.');if(typeof html!=='string'||Buffer.byteLength(html)>2*1024*1024)throw Error('Saved HTML must be at most 2 MiB.');this.propose(job,html);this.persist();}
 retry(id:string){const job=this.job(id);if(job.state!=='failed')throw Error('Only failed jobs can be retried.');job.state='queued';delete job.proposal;job.message='Waiting to retry.';this.persist();}
 cancel(id:string){const job=this.job(id);if(job.state==='applied')throw Error('Applied jobs cannot be cancelled.');job.state='cancelled';job.updatedAt=new Date().toISOString();this.persist();}
 clear(){if(this.running)throw Error('Pause the queue before clearing history.');this.jobs=this.jobs.filter(j=>['queued','fetching','review'].includes(j.state));this.persist();}
 apply(id:string,keys:string[],proposalId:string){const job=this.job(id);if(job.state!=='review'||!job.proposal)throw Error('No proposal ready for review.');if(proposalId!==job.proposalId)throw Error('The proposal changed. Reload and review the current proposal before applying.');const c=this.store.db.components.find(c=>c.id===job.componentId);if(!c||c.category!==job.category||c.name!==job.name)throw Error('Component removed or identity changed.');if(!keys.length||new Set(keys).size!==keys.length||keys.some(k=>!Object.hasOwn(job.proposal!.patch,k)))throw Error('Select valid proposed fields.');const patch=Object.fromEntries(keys.map(k=>[k,job.proposal!.patch[k]]));const next=patchMissing(c,patch,this.store.db);const filled=keys.filter(key=>isMissing(fieldValue(c,key)));if(filled.length)next.specs.notes=[next.specs.notes,`Unverified enrichment (${new Date().toISOString()}) from ${job.url}: ${filled.map(key=>`${key} [${job.proposal!.evidence[key]}]`).join("; ")}`].filter(Boolean).join("\n");this.store.replace('components',this.store.db.components.map(x=>x.id===c.id?next:x));job.state='applied';job.message='Selected missing fields applied; existing values preserved. Verify against manufacturer documentation.';job.updatedAt=new Date().toISOString();this.persist();}
 start(){if(this.running)return;this.stopped=false;this.running=true;void this.run();}
 pause(){this.stopped=true;this.controller?.abort();}
 close(){this.closed=true;this.pause();}
 private async run(){try{while(!this.stopped){const job=this.jobs.find(j=>j.state==='queued');if(!job)break;job.state='fetching';job.updatedAt=new Date().toISOString();this.persist();this.controller=new AbortController();try{const html=await this.fetchPage(job.url,AbortSignal.any([this.controller.signal,AbortSignal.timeout(15000)]));if(this.stopped&&job.state==='fetching'){job.state='queued';}else if(job.state==='fetching')this.propose(job,html);}catch(e){if(job.state==='fetching'){job.state=this.stopped?'queued':'failed';job.message=this.stopped?'Paused; ready to retry.':String(e instanceof Error?e.message:e);}}if(this.stopped)break;this.persist();await new Promise<void>(resolve=>{const timer=setTimeout(resolve,1500);this.controller!.signal.addEventListener('abort',()=>{clearTimeout(timer);resolve();},{once:true});});}}catch(e){console.error('Enrichment queue stopped:',e instanceof Error?e.message:e);}finally{this.running=false;if(!this.closed)try{this.persist();}catch(e){console.error('Could not save enrichment queue:',e instanceof Error?e.message:e);}}}
}
