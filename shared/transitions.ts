import {z} from 'zod';
import type {Component,Configuration,Database,InventoryPC,Placement,Raid} from './types.ts';
import {checkConfiguration,resolveRequirementVersion} from './compatibility.ts';
import {installedConfiguration,pcAllocations,stockCounts} from './inventory.ts';
import {componentCapabilities} from './component-capabilities.ts';
import {installationLocationIds,locationPath} from './installations.ts';
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const uniqueIds=z.array(id).max(500).refine(ids=>new Set(ids).size===ids.length,'Select unique IDs.');
const rolloutSchema=z.object({pilotPCIds:uniqueIds.default([]),waveSize:z.number().int().min(1).max(500).default(10),method:z.enum(['Hardware change only (no data migration)','Backup and restore','Clone with partition review','Reimage and restore data']).default('Backup and restore'),maintenanceWindow:z.string().max(2000).default(''),rollbackNotes:z.string().max(10000).default('')}).strict();
const segmentPolicy=z.object({replacementId:id.optional(),targetSegmentId:z.string().max(200).optional(),usedGb:z.number().finite().min(0).max(100000000).optional(),evidence:z.string().max(2000).default('')}).strict();
export const transitionScenarioSchema=z.object({
 version:z.literal(1),mode:z.enum(['ssd','configuration']).default('ssd'),destinationIds:z.record(z.string().max(100000),id).default({}),name:z.string().max(200),sourceIds:uniqueIds,locationId:z.union([id,z.literal('')]),onlyHDD:z.boolean(),pcIds:uniqueIds,
 growthPercent:z.number().finite().min(0).max(500),freePercent:z.number().finite().min(0).max(90),sparePercent:z.number().finite().min(0).max(100),
 rollout:rolloutSchema.default({pilotPCIds:[],waveSize:10,method:'Backup and restore',maintenanceWindow:'',rollbackNotes:''}),
 policies:z.record(z.string().max(100000),z.record(z.string().max(200),segmentPolicy)),
}).strict().refine(s=>s.rollout.pilotPCIds.every(id=>s.pcIds.includes(id)),'Pilot PCs must be in the selected fleet.');
export type TransitionScenario=z.infer<typeof transitionScenarioSchema>;
export const newTransitionScenario=():TransitionScenario=>({version:1,mode:'configuration',destinationIds:{},name:'Fleet configuration transition',sourceIds:[],locationId:'',onlyHDD:false,pcIds:[],growthPercent:20,freePercent:20,sparePercent:0,rollout:{pilotPCIds:[],waveSize:10,method:'Backup and restore',maintenanceWindow:'',rollbackNotes:''},policies:{}});
export interface Segment {id:string;name:string;role:Placement['role'];raid:Raid;placements:Placement[];originalGb:number|null;minimumGb:number}
export interface Baseline {pc:InventoryPC;configuration:Configuration|null;provisional:boolean;issues:string[];minimumBoot:number;minimumData:number}
export interface TransitionCohort {id:string;name:string;members:Baseline[];segments:Segment[]}
/** Workspace records are JSON data; serialization also accepts nested Vue proxies. */
const clone=<T,>(value:T):T=>JSON.parse(JSON.stringify(value));
const disk=(component?:Component)=>!!component&&component.category==='Drive'&&!componentCapabilities(component).optical;
export const ssdCandidates=(db:Database)=>db.components.filter(c=>disk(c)&&c.specs.storageMedium==='SSD'&&(c.specs.capacityGb||0)>0);
export function transitionBaseline(pc:InventoryPC,db:Database):Baseline {
 const installed=pcAllocations(pc.id,db).filter(r=>r.allocation.state==='installed');
 const provisional=!installed.length;
 const configuration=provisional?db.configurations.find(c=>c.id===pc.configurationId)||null:installedConfiguration(pc,db);
 const issues:string[]=[];
 if(!configuration)issues.push('No linked configuration or installed hardware to plan from.');
 if(!provisional&&!pc.buildSettings)issues.push('Installed storage settings are not recorded. Capture RAID and boot settings before planning.');
 const own=configuration&&resolveRequirementVersion(configuration,db)?.constraints;
 const location=db.installationLocations.find(l=>l.id===pc.installationLocationId);
 const located=location&&resolveRequirementVersion(location,db)?.constraints;
 return {pc,configuration:configuration?clone(configuration):null,provisional,issues,minimumBoot:Math.max(own?.minBootGb||0,located?.minBootGb||0),minimumData:Math.max(own?.minDataGb||0,located?.minDataGb||0)};
}
export function transitionMatches(db:Database,scenario:TransitionScenario){
 const scope=scenario.locationId?installationLocationIds(scenario.locationId,db):null;
 return db.pcs.filter(pc=>!['Retired','Parts only'].includes(pc.lifecycle||'')&&(!scenario.sourceIds.length||scenario.sourceIds.includes(pc.configurationId))&&(!scope||scope.has(pc.installationLocationId||''))&&(!scenario.onlyHDD||transitionBaseline(pc,db).configuration?.placements.some(p=>db.components.find(c=>c.id===p.componentId)?.specs.storageMedium==='HDD')));
}
/** Decimal usable GB; RAID parity and mirroring consume physical capacity. Unknowns stay unknown. */
export function transitionCapacity(raid:Raid,sizes:(number|undefined)[]):number|null {
 if(!sizes.length||sizes.some(n=>n===undefined||!Number.isFinite(n)||n!<=0))return null;
 const values=sizes as number[],n=values.length,min=Math.min(...values);
 if(raid==='none')return values.reduce((a,b)=>a+b,0);
 if(raid==='mirror')return n===2?min:null;
 if(raid==='raid5')return n>=3?min*(n-1):null;
 if(raid==='raid6')return n>=4?min*(n-2):null;
 return n>=4&&n%2===0?min*n/2:null;
}
export function segmentsFor(baseline:Baseline,db:Database):Segment[]{
 const cfg=baseline.configuration;if(!cfg)return [];
 const grouped=new Map<string,Segment>();
 cfg.placements.forEach((p,index)=>{
  const c=db.components.find(c=>c.id===p.componentId);if(!disk(c))return;
  const id=p.role==='boot'?'boot':p.role==='data'?`data:${p.group==='default'?'named:default':p.group||'default'}`:`general:${index}`;
  const group=cfg.storage.groups?.find(g=>g.id===p.group);
  const raid=p.role==='boot'?(cfg.storage.bootMirror?'mirror':'none'):p.role==='data'?(group?.raid||cfg.storage.raid):'none';
  if(!grouped.has(id))grouped.set(id,{id,name:p.role==='boot'?'Boot':p.role==='data'?`Data · ${group?.name||p.group||'default array'}`:`General storage · ${c!.name}`,role:p.role,raid,placements:[],originalGb:null,minimumGb:p.role==='boot'?baseline.minimumBoot:0});
  grouped.get(id)!.placements.push(p);
 });
 for(const segment of grouped.values())segment.originalGb=transitionCapacity(segment.raid,segment.placements.flatMap(p=>Array(p.quantity).fill(db.components.find(c=>c.id===p.componentId)?.specs.capacityGb)));
 return [...grouped.values()];
}
/** Keep actual hardware variations and pinned engineering/installation requirements in separate cohorts. */
export function transitionCohorts(db:Database,scenario:TransitionScenario):TransitionCohort[]{
 const groups=new Map<string,TransitionCohort>();
 for(const pcId of scenario.pcIds){
  const pc=db.pcs.find(p=>p.id===pcId);if(!pc)continue;
  const baseline=transitionBaseline(pc,db),cfg=baseline.configuration;
  const placementIndex=new Map(cfg?.placements.map((p,i)=>[p.id,`position-${i}`])||[]);
  const normalize=(value:unknown):string=>JSON.stringify(value,(key,value)=>typeof value==='string'&&(key==='providerPlacementId'||key==='controllerPlacementId'||key==='cablePlacementId'||key==='powerProviderPlacementId'||key==='adapterPlacementId'||key==='placementId')?(placementIndex.get(value)||value):value);
  const signature=normalize({locationRequirements:resolveRequirementVersion(db.installationLocations.find(l=>l.id===pc.installationLocationId)||{},db),source:pc.configurationId,provisional:baseline.provisional,placements:cfg?.placements.map(({id:_,...p})=>p),storage:cfg?.storage,systemId:cfg?.systemId,software:cfg?.software,portMappings:cfg?.portMappings,requirements:cfg&&resolveRequirementVersion(cfg,db),minimumBoot:baseline.minimumBoot,minimumData:baseline.minimumData});
  if(!groups.has(signature))groups.set(signature,{id:signature,name:db.configurations.find(c=>c.id===pc.configurationId)?.name||'Unlinked installed hardware',members:[],segments:segmentsFor(baseline,db)});
  groups.get(signature)!.members.push(baseline);
 }
 return [...groups.values()];
}
export function requiredSegmentGb(segment:Segment,policy:z.infer<typeof segmentPolicy>|undefined,scenario:TransitionScenario):number|null {
 if(!Number.isFinite(scenario.growthPercent)||!Number.isFinite(scenario.freePercent)||scenario.freePercent>=100)return null;
 const measured=policy?.usedGb;
 const required=measured===undefined?segment.originalGb:Math.ceil(measured*(1+scenario.growthPercent/100)/(1-scenario.freePercent/100));
 return required===null?null:Math.max(required,segment.minimumGb);
}
export function replaceSegment(cfg:Configuration,segment:Segment,replacementId:string):Configuration {
 const selected=new Set(segment.placements.map(p=>p.id));
 return {...clone(cfg),placements:cfg.placements.map(p=>selected.has(p.id)?{...clone(p),componentId:replacementId}:clone(p))};
}
function targetFindings(target:Configuration,member:Baseline,db:Database){
 const findings=[...checkConfiguration(target,db).findings];
 const source=member.configuration;
 if(source?.requirementSetId){
  const captured={...target,requirementSetId:source.requirementSetId,requirementRevision:source.requirementRevision,requirementSnapshot:source.requirementSnapshot};
  findings.push(...checkConfiguration(captured,db).findings.map(f=>({...f,title:`Captured PC requirements: ${f.title}`})));
 }
 const location=db.installationLocations.find(l=>l.id===member.pc.installationLocationId);
 if(location?.requirementSetId){
  const located={...target,requirementSetId:location.requirementSetId,requirementRevision:location.requirementRevision,requirementSnapshot:location.requirementSnapshot};
  findings.push(...checkConfiguration(located,db).findings.map(f=>({...f,title:`Installation: ${f.title}`})));
 }
 return findings;
}
export function transitionOptions(cohort:TransitionCohort,segment:Segment,scenario:TransitionScenario,db:Database){
 const required=requiredSegmentGb(segment,scenario.policies[cohort.id]?.[segment.id],scenario);
 return ssdCandidates(db).map(component=>{
  const usableGb=transitionCapacity(segment.raid,segment.placements.flatMap(p=>Array(p.quantity).fill(component.specs.capacityGb)));
  const errors=new Set<string>();
  if(required===null)errors.add('Current capacity is unknown; enter measured usage.');
  if(usableGb===null)errors.add('Invalid redundancy layout.');
  if(required!==null&&usableGb!==null&&usableGb<required)errors.add(`Needs ${required} GB usable; offers ${usableGb} GB.`);
  for(const member of cohort.members.slice(0,1)){
   if(!member.configuration)continue;
   const ownSegment=segmentsFor(member,db).find(s=>s.id===segment.id)!;
   const target=replaceSegment(member.configuration,ownSegment,component.id);
   for(const finding of targetFindings(target,member,db).filter(f=>f.severity==='error'))errors.add(`${finding.title}: ${finding.detail}`);
  }
  const free=db.inventory.filter(s=>s.componentId===component.id).reduce((n,s)=>n+stockCounts(s).available,0);
  const retained=cohort.members.reduce((n,b)=>{const positions=new Set(segmentsFor(b,db).find(s=>s.id===segment.id)?.placements.map(p=>p.id));return n+pcAllocations(b.pc.id,db).filter(r=>positions.has(r.allocation.id)&&r.allocation.state==='installed'&&r.stock.condition==='Serviceable'&&r.stock.componentId===component.id).reduce((sum,r)=>sum+r.allocation.quantity,0);},0);
  return {id:component.id,name:component.name,interface:component.specs.driveInterface,size:component.specs.driveSize,capacityGb:component.specs.capacityGb!,usableGb,free,retained,errors:[...errors],eligible:!errors.size};
 }).sort((a,b)=>Number(b.retained>0)-Number(a.retained>0)||a.capacityGb-b.capacityGb||b.free-a.free||a.name.localeCompare(b.name));
}
function proposalId(id:string){let hash=14695981039346656037n;for(const char of id){hash=BigInt.asUintN(64,(hash^BigInt(char.charCodeAt(0)))*1099511628211n);}return `transition-${id.slice(0,45)}-${hash.toString(16)}`;}
export interface ProcurementRow {id:string;name:string;interface:string;size:string;category:string;capacityGb:number|null;target:number;retained:number;reserved:number;spares:number;free:number;order:number}
export interface PCTransition {id:string;name:string;source:string;destination:string;location:string;provisional:boolean;status:'Blocked'|'Review';issues:string[];warnings:string[];beforeBoot:number|null;beforeData:number|null;afterBoot:number|null;afterData:number|null;removed:number;changes:{name:string;target:number;retained:number;added:number;removed:number}[];target:Configuration|null}
export function planTransition(db:Database,input:TransitionScenario){
 const scenario=transitionScenarioSchema.parse(input),cohorts=transitionCohorts(db,scenario),pcs:PCTransition[]=[],demand=new Map<string,ProcurementRow>();
 for(const cohort of cohorts)for(const member of cohort.members){
  const issues=[...member.issues],warnings:string[]=[],cfg=member.configuration;let target=scenario.mode==='configuration'?clone(db.configurations.find(c=>c.id===scenario.destinationIds[cohort.id])||null):cfg?clone(cfg):null;
  if(scenario.mode==='configuration'&&!target)issues.push('Choose an existing destination configuration for this group.');
  const targetSegments=target?segmentsFor({...member,configuration:target},db):[];
  const capacityDemand=new Map<string,number>();
  if(['Retired','Parts only'].includes(member.pc.lifecycle||''))issues.push('Inactive PC: remove it from this plan.');
  const segments=segmentsFor(member,db);
  if(!segments.length&&scenario.mode==='ssd')issues.push('No disk storage is recorded.');
  if(member.provisional)warnings.push('Uses the linked configuration as a planning assumption; installed hardware has not been recorded.');
  if(pcAllocations(member.pc.id,db).some(r=>r.allocation.state==='installed'&&r.stock.condition!=='Serviceable'))issues.push('Installed stock needs repair or retirement review.');
  for(const segment of segments){
   const policy=scenario.policies[cohort.id]?.[segment.id],required=requiredSegmentGb(segment,policy,scenario);
   if(policy?.usedGb!==undefined&&!policy.evidence.trim())issues.push(`${segment.name}: provide usage evidence/date for the capacity assumption.`);
   if(policy?.usedGb!==undefined&&segment.originalGb!==null&&policy.usedGb>segment.originalGb)issues.push(`${segment.name}: measured usage exceeds recorded usable capacity; verify the baseline.`);
   if(segment.originalGb===null)warnings.push(`${segment.name}: current usable capacity is unknown or its redundancy layout is invalid.`);
   if(scenario.mode==='configuration'){
    const mapped=targetSegments.find(s=>s.id===(policy?.targetSegmentId||segment.id));
    if(!mapped||mapped.role!==segment.role)issues.push(`${segment.name}: map to a destination storage segment of the same role.`);
    else if(required===null)issues.push(`${segment.name}: current capacity is unknown; enter measured usage.`);
    else capacityDemand.set(mapped.id,(capacityDemand.get(mapped.id)||0)+required);
    continue;
   }
   const replacement=db.components.find(c=>c.id===policy?.replacementId);
   if(!replacement||!ssdCandidates(db).some(c=>c.id===replacement.id)){issues.push(`${segment.name}: choose a catalog SSD with a known capacity.`);continue;}
   if(!replacement.verified)warnings.push(`${replacement.name}: catalog specifications are unverified.`);
   const capacity=transitionCapacity(segment.raid,segment.placements.flatMap(p=>Array(p.quantity).fill(replacement.specs.capacityGb)));
   if(required===null||capacity===null||capacity<required)issues.push(`${segment.name}: SSD layout does not meet the required usable capacity.`);
   if(target)target=replaceSegment(target,segment,replacement.id);
  }
  if(scenario.mode==='configuration'&&target){
   for(const [id,required] of capacityDemand){const segment=targetSegments.find(s=>s.id===id)!;if(segment.originalGb===null||segment.originalGb<required)issues.push(`${segment.name}: destination needs ${required} GB usable for mapped source storage.`);}
   for(const segment of targetSegments.filter(s=>s.originalGb===null))warnings.push(`${segment.name}: destination usable capacity is unknown or its redundancy layout is invalid.`);
   if(target.status!=='Approved')warnings.push('Destination configuration is not approved; obtain engineering approval before execution.');
   if(target.systemId!==cfg?.systemId)warnings.push('Destination changes the equipment system; review software and connection mappings.');
   for(const p of target.placements){const component=db.components.find(c=>c.id===p.componentId);if(component&&!component.verified)warnings.push(`${component.name}: catalog specifications are unverified.`);}
  }
  const before=cfg&&checkConfiguration(cfg,db),after=target&&checkConfiguration(target,db);
  if(after){
   for(const finding of targetFindings(target!,member,db))(finding.severity==='error'?issues: finding.severity==='warning'?warnings:[]).push(`${finding.title}: ${finding.detail}`);
   if(after.bootGb<member.minimumBoot)issues.push(`Pinned boot requirement needs ${member.minimumBoot} GB.`);
   if(after.usableDataGb<member.minimumData)issues.push(`Pinned data requirement needs ${member.minimumData} GB.`);
  }
  const assignedLocation=db.installationLocations.find(l=>l.id===member.pc.installationLocationId);
  if(assignedLocation?.targetConfigurationId)warnings.push('The installation target configuration is unchanged. Review its replacement target as part of the handoff.');
  let removed=0;const changes:PCTransition['changes']=[];
  if(target&&!issues.length){
   const owned=pcAllocations(member.pc.id,db).filter(r=>r.allocation.state==='installed'&&r.stock.condition==='Serviceable').map(r=>({...r,left:r.allocation.quantity}));
   const reservations=pcAllocations(member.pc.id,db).filter(r=>r.allocation.state==='reserved'&&r.stock.condition==='Serviceable').map(r=>({...r,left:r.allocation.quantity}));
   const totals=new Map<string,{target:number;retained:number;added:number;removed:number}>();
   for(const p of target.placements){
    const component=db.components.find(c=>c.id===p.componentId);if(!component)continue;
    if(scenario.mode==='ssd'&&!disk(component))continue;
    let needed=p.quantity,retained=0,reserved=0;
    const candidates=owned.filter(r=>r.stock.componentId===p.componentId&&(scenario.mode==='configuration'||r.allocation.id===p.id)).sort((a,b)=>Number(b.allocation.id===p.id)-Number(a.allocation.id===p.id));
    for(const unit of candidates){const used=Math.min(needed,unit.left);unit.left-=used;needed-=used;retained+=used;}
    for(const held of reservations.filter(r=>r.stock.componentId===p.componentId&&(scenario.mode==='configuration'||r.allocation.role===p.role&&(r.allocation.group||'')===(p.group||'')))){const used=Math.min(needed,held.left);held.left-=used;needed-=used;reserved+=used;}
    if(!demand.has(component.id))demand.set(component.id,{id:component.id,name:component.name,category:component.category,interface:component.specs.driveInterface||'—',size:component.specs.driveSize||'—',capacityGb:component.specs.capacityGb??null,target:0,retained:0,reserved:0,spares:0,free:db.inventory.filter(s=>s.componentId===component.id).reduce((n,s)=>n+stockCounts(s).available,0),order:0});
    const row=demand.get(component.id)!;row.target+=p.quantity;row.retained+=retained;row.reserved+=reserved;
    const total=totals.get(component.id)||{target:0,retained:0,added:0,removed:0};total.target+=p.quantity;total.retained+=retained;total.added+=p.quantity-retained;totals.set(component.id,total);
   }
   for(const unit of owned){if(scenario.mode==='ssd'&&!disk(db.components.find(c=>c.id===unit.stock.componentId)))continue;if(!unit.left)continue;removed+=unit.left;const total=totals.get(unit.stock.componentId)||{target:0,retained:0,added:0,removed:0};total.removed+=unit.left;totals.set(unit.stock.componentId,total);}
   for(const [id,total] of totals)changes.push({name:db.components.find(c=>c.id===id)?.name||id,...total});
   if(scenario.mode==='configuration')warnings.push('Retained parts may need relocation and rewiring. Review every destination placement, bay, adapter, controller, cable and connection mapping before installation.');
   if(reservations.some(r=>r.left>0))warnings.push('Some existing reservations are unused by this target; review reassignment or release. They remain excluded from free stock.');
  }
  pcs.push({id:member.pc.id,name:member.pc.name,source:cohort.name,destination:scenario.mode==='configuration'?target?.name||'Not selected':'SSD replacement',location:locationPath(member.pc.installationLocationId||'',db)||member.pc.location||'Unassigned',provisional:member.provisional,status:issues.length?'Blocked':'Review',issues:[...new Set(issues)],warnings:[...new Set(warnings)],beforeBoot:segments.some(s=>s.role==='boot'&&s.originalGb===null)?null:before?.bootGb||0,beforeData:segments.some(s=>s.role==='data'&&s.originalGb===null)?null:before?.usableDataGb||0,afterBoot:issues.length||(target?segmentsFor({...member,configuration:target},db):[]).some(s=>s.role==='boot'&&s.originalGb===null)?null:after?.bootGb||0,afterData:issues.length||(target?segmentsFor({...member,configuration:target},db):[]).some(s=>s.role==='data'&&s.originalGb===null)?null:after?.usableDataGb||0,removed,changes,target:target&&!issues.length?{...target,id:proposalId(member.pc.id),name:`${member.pc.name} · transition proposal`,status:'Draft',revision:undefined,approvalHistory:undefined,approvalSnapshot:undefined}:null});
 }
 for(const id of scenario.pcIds.filter(id=>!db.pcs.some(p=>p.id===id)))pcs.push({id,name:id,source:'Missing',destination:'',location:'',provisional:true,status:'Blocked',issues:['Selected PC no longer exists.'],warnings:[],beforeBoot:0,beforeData:0,afterBoot:0,afterData:0,removed:0,changes:[],target:null});
 for(const row of demand.values()){row.spares=Math.ceil((row.target-row.retained)*scenario.sparePercent/100);row.order=Math.max(0,row.target-row.retained-row.reserved+row.spares-row.free);}
 const pilots=new Set(scenario.rollout.pilotPCIds);
 const eligible=pcs.filter(p=>p.status!=='Blocked');
 const waves:{id:string;phase:string;count:number;pcs:string;provisional:number}[]=[];
 const pilot=eligible.filter(p=>pilots.has(p.id));
 if(pilot.length)waves.push({id:'pilot',phase:'Pilot',count:pilot.length,pcs:pilot.map(p=>p.name).join(', '),provisional:pilot.filter(p=>p.provisional).length});
 const remainder=eligible.filter(p=>!pilots.has(p.id));
 for(let i=0;i<remainder.length;i+=scenario.rollout.waveSize){const members=remainder.slice(i,i+scenario.rollout.waveSize);waves.push({id:`wave-${i}`,phase:`Wave ${Math.floor(i/scenario.rollout.waveSize)+1}`,count:members.length,pcs:members.map(p=>p.name).join(', '),provisional:members.filter(p=>p.provisional).length});}
 return {pcs,waves,procurement:[...demand.values()],blocked:pcs.filter(p=>p.status==='Blocked').length,provisional:pcs.filter(p=>p.provisional).length,included:pcs.filter(p=>p.status!=='Blocked').length};
}
