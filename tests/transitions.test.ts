import {test} from 'node:test';
import assert from 'node:assert/strict';
import {seed} from '../server/seed.ts';
import {checkConfiguration} from '../shared/compatibility.ts';
import {schemas} from '../server/schema.ts';
import {encodeCSV,decodeCSV} from '../server/store.ts';
import type {Database,StockRecord} from '../shared/types.ts';
import {newTransitionScenario,transitionCapacity,transitionCohorts,transitionBaseline,transitionMatches,requiredSegmentGb,transitionOptions,planTransition,transitionScenarioSchema} from '../shared/transitions.ts';
function fixture():Database {
 const db=structuredClone(seed);db.components.forEach(c=>c.verified=true);
 db.pcs=[0,1].map(i=>({...structuredClone(db.pcs[0]),id:`pc-${i}`,name:`Migration PC ${i}`,configurationId:i?'older-second':'imaging'}));
 db.configurations.push({...structuredClone(db.configurations[0]),id:'older-second',name:'Second older configuration'});
 db.inventory=[];
 for(const pc of db.pcs)for(const p of db.configurations[0].placements){
  db.inventory.push({id:`stock-${pc.id}-${p.id}`,componentId:p.componentId,tracking:'bulk',serial:'',assetTag:'',quantity:p.quantity,location:'Stock home',condition:'Serviceable',notes:'',history:[],allocations:[{id:`actual-${pc.id}-${p.id}`,pcId:pc.id,quantity:p.quantity,state:'installed',plannedPlacementId:p.id,slotId:p.slotId,role:p.role,mount:p.mount,group:p.group,notes:'',createdAt:'2026-10-10T00:00:00Z',updatedAt:'2026-10-10T00:00:00Z'}]});
 }
 return db;
}
function scenarioFor(db:Database){
 const scenario=newTransitionScenario();scenario.mode='ssd';scenario.pcIds=db.pcs.slice(0,2).map(p=>p.id);
 for(const cohort of transitionCohorts(db,scenario))for(const segment of cohort.segments){
  const entries=scenario.policies[cohort.id]??={};entries[segment.id]={replacementId:segment.role==='boot'?'nvme':'ssd',evidence:'Measured fleet filesystem usage, 2026-10-10',...(segment.role==='data'?{usedGb:1000}:{})};
 }
 return scenario;
}
const stock=(id:string,quantity:number,condition:StockRecord['condition']='Serviceable'):StockRecord=>({id,componentId:'ssd',tracking:'bulk',serial:'',assetTag:'',quantity,location:'Warehouse',condition,notes:'',allocations:[],history:[]});
test('transition capacities account for parity mirrors mixed sizes invalid layouts and unknown capacity',()=>{
 assert.equal(transitionCapacity('mirror',[8000,4000]),4000);assert.equal(transitionCapacity('raid5',[4000,4000,8000]),8000);assert.equal(transitionCapacity('raid6',[4000,4000,4000,4000]),8000);assert.equal(transitionCapacity('raid10',[2000,2000,2000,2000]),4000);assert.equal(transitionCapacity('none',[1000,2000]),3000);
 for(const sizes of [[undefined,8000],[0,1000],[NaN,1000]])assert.equal(transitionCapacity('mirror',sizes),null);
 assert.equal(transitionCapacity('mirror',[1000,1000,1000]),null);assert.equal(transitionCapacity('raid10',[1000,1000,1000]),null);
});
test('capacity reduction requires measured usage with growth and free space and preserves boot minimum',()=>{
 const db=fixture(),scenario=scenarioFor(db),cohort=transitionCohorts(db,scenario)[0],data=cohort.segments.find(s=>s.role==='data')!,boot=cohort.segments.find(s=>s.role==='boot')!;
 assert.equal(requiredSegmentGb(data,undefined,scenario),8000);assert.equal(requiredSegmentGb(data,{usedGb:1000,evidence:'Measurement'},scenario),1500);
 assert.equal(requiredSegmentGb({...boot,minimumGb:1200},{usedGb:100,evidence:'Measurement'},scenario),1200);
 scenario.policies[cohort.id][data.id].evidence='';const report=planTransition(db,scenario);assert(report.pcs[0].issues.some(i=>i.includes('usage evidence')));assert.equal(report.included,1);
 scenario.policies[cohort.id][data.id].usedGb=9000;assert(planTransition(db,scenario).pcs[0].issues.some(i=>i.includes('exceeds recorded')));
});
test('procurement pools stock once across source configurations and respects installed reserved and unusable stock',()=>{
 const db=fixture();db.pcs.push({...structuredClone(db.pcs[0]),id:'outside-plan',name:'Another PC'});
 const free=stock('shared-pool',3);free.allocations=[{id:'held-selected',pcId:'pc-0',quantity:1,state:'reserved',plannedPlacementId:'',slotId:'',role:'data',mount:'front-hot-swap',notes:'',createdAt:'2026-10-10T00:00:00Z',updatedAt:'2026-10-10T00:00:00Z'},{id:'held-other',pcId:'outside-plan',quantity:1,state:'reserved',plannedPlacementId:'',slotId:'',role:'data',mount:'front-hot-swap',notes:'',createdAt:'2026-10-10T00:00:00Z',updatedAt:'2026-10-10T00:00:00Z'}];db.inventory.push(free,stock('quarantined',100,'Quarantined'));
 const scenario=scenarioFor(db),before=JSON.stringify(db),report=planTransition(db,scenario);assert.equal(report.blocked,0,JSON.stringify(report.pcs.map(p=>p.issues)));
 const data=report.procurement.find(r=>r.id==='ssd')!;assert.equal(data.target,4);assert.equal(data.retained,0);assert.equal(data.reserved,1);assert.equal(data.free,1);assert.equal(data.order,2);
 const boot=report.procurement.find(r=>r.id==='nvme')!;assert.equal(boot.target,4);assert.equal(boot.retained,4);assert.equal(boot.order,0);assert.equal(report.pcs.reduce((n,p)=>n+p.removed,0),4);assert.equal(JSON.stringify(db),before);
 scenario.sparePercent=10;assert.equal(planTransition(db,scenario).procurement.find(r=>r.id==='ssd')!.order,3);
});
test('SSD choices and final combinations retain compatibility checks including M.2 limits',()=>{
 const db=fixture(),scenario=scenarioFor(db),cohort=transitionCohorts(db,scenario)[0],segment=cohort.segments.find(s=>s.role==='data')!;
 const options=transitionOptions(cohort,segment,scenario,db);assert(options.find(o=>o.id==='ssd')!.eligible);assert(!options.find(o=>o.id==='nvme')!.eligible);
 scenario.policies[cohort.id][segment.id].replacementId='nvme';const report=planTransition(db,scenario);assert.equal(report.pcs[0].status,'Blocked');assert.equal(report.pcs[0].target,null);assert(report.pcs[0].issues.some(i=>/M\.2|bay|capacity exceeded/i.test(i)));
});
test('installed baselines override outdated template hardware and unknown media never gets inferred',()=>{
 const db=fixture(),pc=db.pcs[0];db.configurations[0].placements=db.configurations[0].placements.map(p=>p.componentId==='hdd'?{...p,componentId:'ssd'}:p);
 assert(transitionBaseline(pc,db).configuration!.placements.some(p=>p.componentId==='hdd'));
 const scenario=newTransitionScenario();scenario.onlyHDD=true;assert.equal(transitionMatches(db,scenario).length,2);
 delete db.components.find(c=>c.id==='hdd')!.specs.storageMedium;assert.equal(transitionMatches(db,scenario).length,0);
});
test('hardware variations form separate cohorts and installation pinned requirements block unsafe SSD transitions',()=>{
 const db=fixture();db.pcs[1].configurationId='imaging';
 const s=newTransitionScenario();s.pcIds=db.pcs.map(p=>p.id);assert.equal(transitionCohorts(db,s).length,1);
 db.inventory.find(s=>s.id==='stock-pc-1-line-8')!.componentId='ssd';assert.equal(transitionCohorts(db,s).length,2);
 const version={revision:1,at:'2026-10-10T00:00:00Z',name:'Scientific archive',description:'',connections:[],constraints:{minDataGb:6000,requiredComponents:[{componentId:'hdd',quantity:2}]}};
 db.requirementsSets=[{id:'archive-needs',name:'Archive requirements',description:'',versions:[version]}];db.installationLocations=[{id:'station',name:'Archive station',kind:'Station',parentId:'',requirementSetId:'archive-needs',requirementRevision:1,requirementSnapshot:version,targetConfigurationId:'',notes:''}];db.pcs[0].installationLocationId='station';
 const report=planTransition(db,scenarioFor(db));assert.equal(report.pcs[0].status,'Blocked');assert(report.pcs[0].issues.some(i=>i.includes('6000')));assert(report.pcs[0].issues.some(i=>i.includes('Installation:')));
});
test('missing installed settings inactive and deleted PCs remain explicit blockers',()=>{
 const db=fixture();db.pcs[0].buildSettings=null;db.pcs[1].lifecycle='Parts only';const scenario=scenarioFor(db);scenario.pcIds.push('deleted-pc');const report=planTransition(db,scenario);
 assert.equal(report.blocked,3);assert.equal(report.procurement.length,0);assert(report.pcs[0].issues.some(i=>i.includes('storage settings')));assert(report.pcs[1].issues.some(i=>i.includes('Inactive')));assert(report.pcs[2].issues.some(i=>i.includes('no longer exists')));
});
test('configuration-only planning is provisional and cannot assume ownership of template SSDs',()=>{
 const db=fixture();db.inventory=[];const scenario=scenarioFor(db),report=planTransition(db,scenario);assert.equal(report.blocked,0);assert.equal(report.provisional,2);assert.equal(report.procurement.find(r=>r.id==='nvme')!.retained,0);assert.equal(report.procurement.find(r=>r.id==='nvme')!.order,4);
});
test('unknown baseline capacities remain unknown until a measured usage assumption is provided',()=>{
 const db=fixture();delete db.components.find(c=>c.id==='hdd')!.specs.capacityGb;const scenario=scenarioFor(db),report=planTransition(db,scenario);assert.equal(report.pcs[0].beforeData,null);assert.equal(report.pcs[0].afterData,2000);assert.equal(report.blocked,0);
 const cohort=transitionCohorts(db,scenario)[0],data=cohort.segments.find(s=>s.role==='data')!;delete scenario.policies[cohort.id][data.id].usedGb;assert.equal(planTransition(db,scenario).pcs[0].status,'Blocked');
});
test('media classification and versioned plans round-trip while invalid assumptions are rejected',()=>{
 const db=fixture();assert.deepEqual(decodeCSV('components',encodeCSV('components',db.components)),db.components);assert(schemas.components.safeParse(db.components.find(c=>c.id==='ssd')).success);
 const scenario=scenarioFor(db);assert.deepEqual(transitionScenarioSchema.parse(JSON.parse(JSON.stringify(scenario))),scenario);
 for(const draft of [{...scenario,freePercent:100},{...scenario,growthPercent:-1},{...scenario,pcIds:['pc-0','pc-0']},{...scenario,version:2},{...scenario,unexpected:true}])assert(!transitionScenarioSchema.safeParse(draft).success);
});

test('rollout waves put chosen pilots first and leave blocked PCs out of wave and stock totals',()=>{
 const db=fixture(),scenario=scenarioFor(db);scenario.rollout.pilotPCIds=['pc-1'];scenario.rollout.waveSize=1;
 const report=planTransition(db,scenario);assert.deepEqual(report.waves.map(w=>[w.phase,w.count,w.pcs]),[['Pilot',1,'Migration PC 1'],['Wave 1',1,'Migration PC 0']]);
 db.pcs[0].lifecycle='Retired';const blocked=planTransition(db,scenario);assert.equal(blocked.waves.length,1);assert.equal(blocked.waves[0].phase,'Pilot');assert.equal(blocked.procurement.find(r=>r.id==='ssd')!.target,2);
 assert(!transitionScenarioSchema.safeParse({...scenario,rollout:{...scenario.rollout,pilotPCIds:['not-selected']}}).success);
});
test('planning handles reactive frontend records without changing their data',async()=>{
 const {reactive}=await import('vue');const db=reactive(fixture()),scenario=reactive(scenarioFor(db)),before=JSON.stringify(db);
 const report=planTransition(db,scenario);assert.equal(report.blocked,0);assert.equal(report.pcs.length,2);assert.equal(JSON.stringify(db),before);
});
test('source configuration and hierarchy filters select the fleet without changing explicit plan IDs',()=>{
 const db=fixture();db.installationLocations=[{id:'site',name:'Site',kind:'Site',parentId:'',requirementSetId:'',requirementRevision:0,targetConfigurationId:'',notes:''},{id:'bench',name:'Bench',kind:'Bench',parentId:'site',requirementSetId:'',requirementRevision:0,targetConfigurationId:'',notes:''}];db.pcs[0].installationLocationId='bench';
 const scenario=scenarioFor(db);scenario.locationId='site';scenario.sourceIds=['imaging','older-second'];assert.deepEqual(transitionMatches(db,scenario).map(p=>p.id),['pc-0']);assert.deepEqual(scenario.pcIds,['pc-0','pc-1']);scenario.sourceIds=['older-second'];assert.equal(transitionMatches(db,scenario).length,0);
});
function destinationScenario(db:Database){
 const scenario=scenarioFor(db);scenario.mode='configuration';
 const destination=structuredClone(db.configurations[0]);destination.id='destination';destination.name='SSD and bay upgrade';
 destination.placements=destination.placements.map(p=>({...p,id:`dest-${p.id}`,componentId:p.componentId==='hdd'?'ssd':p.componentId,quantity:p.componentId==='ram'?3:p.quantity}));
 const chassis=db.components.find(c=>c.id==='case-tower')!;chassis.specs.bays525=1;chassis.specs.bayTargets=[{id:'FRONT',size:'5.25'}];
 db.components.push({id:'cage',name:'Dual SSD front cage',category:'Storage adapter',manufacturer:'Example',source:'',verified:true,specs:{storageAdapterKind:'bay-cage',baySize:'5.25',bayUnits:1,sataPowerPlugs:1,driveTargets:[{id:'A',mount:'front-hot-swap',driveSizes:['2.5'],interfaces:['SATA']},{id:'B',mount:'front-hot-swap',driveSizes:['2.5'],interfaces:['SATA']}]}});
 destination.placements=destination.placements.filter(p=>p.componentId!=='ssd');
 destination.placements.push({id:'cage-position',componentId:'cage',quantity:1,slotId:'',role:'general',mount:'auto',group:'',targetId:'FRONT'});
 for(const targetId of ['A','B'])destination.placements.push({id:`ssd-${targetId}`,componentId:'ssd',quantity:1,slotId:'',role:'data',mount:'front-hot-swap',group:'',adapterPlacementId:'cage-position',targetId});
 db.configurations.push(destination);
 for(const cohort of transitionCohorts(db,scenario)){scenario.destinationIds[cohort.id]=destination.id;for(const segment of cohort.segments)scenario.policies[cohort.id][segment.id]={evidence:'Measured fleet usage 2026-10-10',...(segment.role==='data'?{usedGb:1000}:{})};}
 return scenario;
}
test('destination transitions include cages memory and all hardware while reusing installed models across new placement IDs',()=>{
 const db=fixture(),scenario=destinationScenario(db),before=JSON.stringify(db),report=planTransition(db,scenario);
 assert.equal(report.blocked,0,JSON.stringify(report.pcs.map(p=>p.issues)));
 assert.equal(report.procurement.find(r=>r.id==='cage')!.order,2);
 assert.equal(report.procurement.find(r=>r.id==='ram')!.target,6);assert.equal(report.procurement.find(r=>r.id==='ram')!.retained,4);assert.equal(report.procurement.find(r=>r.id==='ram')!.order,2);
 assert.equal(report.procurement.find(r=>r.id==='cpu')!.retained,2);assert.equal(report.procurement.find(r=>r.id==='nvme')!.retained,4);
 assert.equal(report.pcs[0].changes.find(c=>c.name.includes('HDD'))!.removed,2);assert.equal(report.pcs[0].changes.find(c=>c.name==='Dual SSD front cage')!.added,1);
 assert(report.pcs[0].warnings.some(w=>w.includes('rewiring')));assert.equal(JSON.stringify(db),before);
});
test('destination transitions block missing targets incompatible bay cages and insufficient mapped capacities',()=>{
 const db=fixture(),scenario=destinationScenario(db),cohort=transitionCohorts(db,scenario)[0];delete scenario.destinationIds[cohort.id];assert.equal(planTransition(db,scenario).pcs[0].status,'Blocked');scenario.destinationIds[cohort.id]='destination';
 db.components.find(c=>c.id==='cage')!.specs.driveTargets![0].driveSizes=['3.5'];assert(planTransition(db,scenario).pcs[0].issues.some(i=>/size|fit|target/i.test(i)));
 db.components.find(c=>c.id==='cage')!.specs.driveTargets![0].driveSizes=['2.5'];delete scenario.policies[cohort.id]['data:default'].usedGb;assert(planTransition(db,scenario).pcs[0].issues.some(i=>i.includes('8000 GB')));
});
test('destination storage regrouping requires explicit source mapping and retains captured PC constraints',()=>{
 const db=fixture(),scenario=destinationScenario(db),destination=db.configurations.find(c=>c.id==='destination')!;
 destination.placements.filter(p=>p.role==='data').forEach(p=>p.group='new-array');
 const cohort=transitionCohorts(db,scenario)[0];assert(planTransition(db,scenario).pcs[0].issues.some(i=>i.includes('map to a destination')));
 for(const c of transitionCohorts(db,scenario))scenario.policies[c.id]['data:default'].targetSegmentId='data:new-array';assert.equal(planTransition(db,scenario).blocked,0);
 const version={revision:1,at:'2026-10-10T00:00:00Z',name:'Keep acquisition hardware',description:'',connections:[],constraints:{requiredComponents:[{componentId:'daq',quantity:1}]}};
 db.requirementsSets=[{id:'capture',name:version.name,description:'',versions:[version]}];db.pcs[0].buildSettings={...db.pcs[0].buildSettings!,requirementSetId:'capture',requirementRevision:1,requirementSnapshot:version};
 destination.placements=destination.placements.filter(p=>p.componentId!=='daq');
 const updated=transitionCohorts(db,scenario)[0];scenario.destinationIds[updated.id]='destination';scenario.policies[updated.id]={'data:default':{usedGb:1000,evidence:'Measurement',targetSegmentId:'data:new-array'}};
 assert(planTransition(db,scenario).pcs[0].issues.some(i=>i.includes('Captured PC requirements:')));
});
test('older SSD plan files retain their original mode and new plans default to whole configurations',()=>{
 const db=fixture(),scenario=scenarioFor(db);const legacy=JSON.parse(JSON.stringify(scenario));delete legacy.mode;delete legacy.destinationIds;assert.equal(transitionScenarioSchema.parse(legacy).mode,'ssd');assert.equal(newTransitionScenario().mode,'configuration');
});
test('bay replacement records old cages separately and consumes installed and reserved quantities only once across target lines',()=>{
 const db=fixture();
 db.components.push({id:'old-cage',name:'Old front bay assembly',category:'Bay accessory',manufacturer:'Example',source:'',verified:true,specs:{baySize:'5.25',bayUnits:1}});
 for(const pc of db.pcs){const record=structuredClone(db.inventory.find(s=>s.allocations[0].pcId===pc.id)!);record.id=`old-bays-${pc.id}`;record.componentId='old-cage';record.quantity=1;record.allocations=[{...record.allocations[0],id:`old-bay-${pc.id}`,quantity:1,plannedPlacementId:'',role:'general'}];db.inventory.push(record);}
 const scenario=destinationScenario(db),destination=db.configurations.find(c=>c.id==='destination')!,memory=destination.placements.find(p=>p.componentId==='ram')!;
 memory.quantity=1;destination.placements.push({...memory,id:'extra-memory-position',quantity:2});
 const held=stock('cage-pool',3);held.componentId='cage';held.allocations=[{...db.inventory[0].allocations[0],id:'cage-held-selected',state:'reserved',quantity:1},{...db.inventory[0].allocations[0],id:'cage-held-outside',pcId:'unselected',state:'reserved',quantity:1}];db.inventory.push(held);
 const report=planTransition(db,scenario);assert.equal(report.blocked,0,JSON.stringify(report.pcs.map(p=>p.issues)));
 const cage=report.procurement.find(r=>r.id==='cage')!;assert.equal(cage.target,2);assert.equal(cage.reserved,1);assert.equal(cage.free,1);assert.equal(cage.order,0);
 const ram=report.procurement.find(r=>r.id==='ram')!;assert.equal(ram.retained,4);assert.equal(ram.order,2);
 assert.equal(report.pcs[0].changes.find(c=>c.name==='Old front bay assembly')!.removed,1);assert.equal(report.pcs[0].removed,3);
 assert(!report.procurement.some(r=>r.id==='old-cage'));
});
test('new destination arrays with missing specifications remain unknown in the result and produce review notes',()=>{
 const db=fixture(),scenario=destinationScenario(db),destination=db.configurations.find(c=>c.id==='destination')!;
 db.components.push({...structuredClone(db.components.find(c=>c.id==='ssd')!),id:'unknown-drive',name:'Additional drive, capacity unconfirmed',specs:{driveSize:'2.5',driveInterface:'SATA',powerW:5,storageMedium:'SSD'}});
 destination.storage.groups=[{id:'additional',name:'Additional data',raid:'none'}];
 destination.placements.push({id:'additional-drive',componentId:'unknown-drive',quantity:1,slotId:'',role:'data',mount:'internal',group:'additional'});
 const report=planTransition(db,scenario);assert.equal(report.blocked,0,JSON.stringify(report.pcs.map(p=>p.issues)));assert.equal(report.pcs[0].afterData,null);assert(report.pcs[0].warnings.some(w=>w.includes('destination usable capacity is unknown')));
 scenario.rollout.method='Hardware change only (no data migration)';assert.equal(transitionScenarioSchema.parse(scenario).rollout.method,scenario.rollout.method);
});
test('named array ID default remains separate from ungrouped data storage',()=>{
 const db=fixture();db.pcs[0].buildSettings!.storage.groups=[{id:'default',name:'Named default array',raid:'none'}];
 const stock=db.inventory.find(s=>s.componentId==='hdd'&&s.allocations[0].pcId===db.pcs[0].id)!;
 stock.allocations.push({...structuredClone(stock.allocations[0]),id:'named-default-drive',quantity:1,group:'default'});stock.quantity+=1;
 const scenario=newTransitionScenario();scenario.pcIds=[db.pcs[0].id];const segments=transitionCohorts(db,scenario)[0].segments.filter(s=>s.role==='data');
 assert.equal(segments.length,2);assert.equal(segments.find(s=>s.id==='data:default')!.raid,'mirror');assert.equal(segments.find(s=>s.id==='data:named:default')!.raid,'none');assert.equal(segments[0].originalGb,8000);assert.equal(segments[1].originalGb,8000);const report=checkConfiguration(transitionBaseline(db.pcs[0],db).configuration!,db);assert.deepEqual(report.storageGroups!.map(g=>g.id),['default','default:ungrouped']);assert.equal(report.usableDataGb,16000);
});

test('documented hardware assumptions are separate from planned targets and survive a partial survey',()=>{
 const db=fixture(),pc=db.pcs[0];pc.configurationId='older-second';pc.hardwareSurvey={status:'partial',configurationId:'imaging',evidence:'Site owner, 2026-10-20; same build as adjacent station'};
 db.inventory=db.inventory.filter(s=>s.allocations[0].pcId===pc.id&&s.componentId==='cpu');
 const before=JSON.stringify(db),baseline=transitionBaseline(pc,db);assert.equal(baseline.provisional,true);assert.equal(baseline.configuration?.id,'imaging');assert(baseline.configuration!.placements.some(p=>p.componentId==='hdd'));assert.deepEqual(baseline.issues,[]);
 const scenario=newTransitionScenario();scenario.pcIds=[pc.id];scenario.sourceIds=['imaging'];assert.deepEqual(transitionMatches(db,scenario).map(p=>p.id),[pc.id]);
 scenario.mode='configuration';const cohort=transitionCohorts(db,scenario)[0];scenario.destinationIds[cohort.id]='imaging';const report=planTransition(db,scenario);assert.equal(report.blocked,0,JSON.stringify(report.pcs[0].issues));
 const cpu=report.procurement.find(p=>p.id==='cpu')!;assert.equal(cpu.retained,1);assert.equal(cpu.assumedRetained,0);assert.equal(cpu.orderIfConfirmed,0);
 const memory=report.procurement.find(p=>p.id==='ram')!;assert.equal(memory.retained,0);assert.equal(memory.assumedRetained,2);assert.equal(memory.order,2);assert.equal(memory.orderIfConfirmed,0);
 assert(report.pcs[0].warnings.some(w=>w.includes('Site owner')));assert.equal(JSON.stringify(db),before);
});
test('unknown undocumented contradicted and empty completed surveys block instead of silently using partial hardware',()=>{
 const db=fixture(),pc=db.pcs[0];pc.hardwareSurvey={status:'partial',configurationId:'',evidence:'Awaiting access'};
 assert.equal(transitionBaseline(pc,db).configuration,null);assert(transitionBaseline(pc,db).issues.length);
 pc.hardwareSurvey.configurationId='imaging';pc.hardwareSurvey.evidence=' ';assert(transitionBaseline(pc,db).issues.some(i=>i.includes('source/date')));
 pc.hardwareSurvey.evidence='Survey 2026-10-20';db.inventory.find(s=>s.componentId==='cpu')!.allocations[0].quantity=2;assert(transitionBaseline(pc,db).issues.some(i=>i.includes('exceeds the assumed')));
 pc.hardwareSurvey.status='complete';db.inventory=[];const baseline=transitionBaseline(pc,db);assert.equal(baseline.provisional,false);assert.equal(baseline.configuration?.placements.length,0);assert(baseline.issues.some(i=>i.includes('no installed hardware')));
});
test('assumed reuse uses each missing unit once and never turns removals into free stock',()=>{
 const db=fixture(),pc=db.pcs[0];pc.hardwareSurvey={status:'uninspected',configurationId:'imaging',evidence:'Legacy device list, 2026-10-20'};db.inventory=[];
 const scenario=destinationScenario(db);scenario.pcIds=[pc.id];const cohort=transitionCohorts(db,scenario)[0];scenario.destinationIds[cohort.id]='destination';scenario.policies[cohort.id]={'data:default':{usedGb:1000,evidence:'Fleet usage 2026-10-20'}};
 const destination=db.configurations.find(c=>c.id==='destination')!,ram=destination.placements.find(p=>p.componentId==='ram')!;ram.quantity=1;destination.placements.push({...ram,id:'more-ram',quantity:2});scenario.sparePercent=10;
 const report=planTransition(db,scenario);assert.equal(report.blocked,0,JSON.stringify(report.pcs[0].issues));assert.equal(report.pcs[0].removed,0);
 const memory=report.procurement.find(p=>p.id==='ram')!;assert.equal(memory.target,3);assert.equal(memory.assumedRetained,2);assert.equal(memory.order,4);assert.equal(memory.orderIfConfirmed,2);
 const drives=report.procurement.find(p=>p.id==='ssd')!;assert.equal(drives.assumedRetained,0);assert.equal(drives.orderIfConfirmed,drives.order);assert.equal(drives.free,0);
});
test('partial survey assumptions cannot weaken separately recorded PC requirements',()=>{
 const db=fixture(),pc=db.pcs[0],version={revision:1,at:'2026-10-20T00:00:00Z',name:'Known requirements',description:'',connections:[],constraints:{minDataGb:12000,requiredComponents:[{componentId:'hdd',quantity:2}]}};
 db.requirementsSets.push({id:'known-needs',name:'Known requirements',description:'',versions:[version]});pc.hardwareSurvey={status:'partial',configurationId:'imaging',evidence:'Access pending 2026-10-20'};pc.buildSettings={...pc.buildSettings!,requirementSetId:'known-needs',requirementRevision:1,requirementSnapshot:version};
 assert.equal(transitionBaseline(pc,db).minimumData,12000);const scenario=scenarioFor(db),report=planTransition(db,scenario);assert.equal(report.pcs[0].status,'Blocked');assert(report.pcs[0].issues.some(i=>i.includes('Recorded PC requirements:')));
});
test('conditional reuse pools shared free stock and selected reservations once across assumed PCs',()=>{
 const db=fixture();db.inventory=[];for(const pc of db.pcs)pc.hardwareSurvey={status:'uninspected',configurationId:pc.configurationId,evidence:'Legacy records, 2026-10-20'};
 const scenario=newTransitionScenario();scenario.pcIds=db.pcs.map(p=>p.id);const destination=structuredClone(db.configurations[0]);destination.id='more-memory';destination.placements.find(p=>p.componentId==='ram')!.quantity=3;db.configurations.push(destination);
 for(const cohort of transitionCohorts(db,scenario))scenario.destinationIds[cohort.id]=destination.id;
 const pool=stock('memory-pool',2);pool.componentId='ram';pool.allocations=[{id:'held-memory',pcId:db.pcs[0].id,quantity:1,state:'reserved',plannedPlacementId:'',slotId:'',role:'general',mount:'auto',notes:'',createdAt:'2026-10-20T00:00:00Z',updatedAt:'2026-10-20T00:00:00Z'}];db.inventory.push(pool);
 const report=planTransition(db,scenario);assert.equal(report.blocked,0,JSON.stringify(report.pcs.map(p=>p.issues)));const row=report.procurement.find(p=>p.id==='ram')!;
 assert.equal(row.target,6);assert.equal(row.assumedRetained,4);assert.equal(row.retained,0);assert.equal(row.reserved,1);assert.equal(row.free,1);assert.equal(row.order,4);assert.equal(row.orderIfConfirmed,0);assert.equal(pool.allocations.length,1);
});

test('placeholder destinations cannot produce procurement and unknown baselines remain provisional',()=>{
 const db=fixture(),ssd=db.components.find(c=>c.id==='ssd')!;ssd.identityKind='placeholder';ssd.verified=false;
 const scenario=scenarioFor(db),blocked=planTransition(db,scenario);assert.equal(blocked.blocked,2);assert.equal(blocked.procurement.length,0);
 // Known common constraints may describe a placeholder baseline, but resolving to a known SSD never credits its identity as reusable stock.
 delete ssd.identityKind;ssd.verified=true;const hdd=db.components.find(c=>c.id==='hdd')!;hdd.identityKind='placeholder';hdd.verified=false;
 const report=planTransition(db,scenarioFor(db));assert.equal(report.blocked,0);assert.equal(report.provisional,2);assert(report.pcs.every(pc=>pc.warnings.some(w=>w.includes('placeholder identities'))));assert.equal(report.procurement.find(r=>r.id==='ssd')!.retained,0);
});
