import type {Database,InventoryPC,InstallationLocation,StockRecord,Configuration} from '../../shared/types.ts';
import {seed} from '../../server/seed.ts';
import {newTransitionScenario,transitionCohorts,transitionMatches} from '../../shared/transitions.ts';
export const syntheticDate='2026-10-21T12:00:00.000Z';
export interface WorkflowFixture {id:string;description:string;db:Database;expected:{active:number;blocked:number};steps:string[]}
export function syntheticCatalog():Database {
 const db=structuredClone(seed);db.pcs=[];db.inventory=[];db.installationLocations=[];db.systems=[];
 db.components=db.components.filter(c=>['case-tower','board-atx','cpu','ram','nvme','hdd','ssd','psu','cooler'].includes(c.id));
 for(const c of db.components){c.manufacturer='Synthetic Test Hardware';c.source='Synthetic workflow fixture — not manufacturer evidence';c.verified=true;}
 db.components.find(c=>c.id==='case-tower')!.specs.bays525=1;
 db.components.find(c=>c.id==='case-tower')!.specs.bayTargets=[{id:'FRONT',size:'5.25'}];
 const source=structuredClone(seed.configurations[0]);Object.assign(source,{id:'source-hdd',name:'SYNTHETIC · HDD workstation',systemId:'',status:'Draft',updatedAt:syntheticDate,notes:'Synthetic current hardware assumption',description:'Two 8 TB HDDs in a data mirror; one 1 TB NVMe boot drive.'});
 source.placements=source.placements.filter(p=>!['gpu','daq','nic'].includes(p.componentId));source.placements.find(p=>p.role==='boot')!.quantity=1;source.storage.bootMirror=false;
 const mixed=structuredClone(source);mixed.id='source-mixed';mixed.name='SYNTHETIC · mixed drive workstation';mixed.storage.raid='none';mixed.placements.find(p=>p.componentId==='hdd')!.quantity=1;mixed.placements.push({...structuredClone(mixed.placements.find(p=>p.componentId==='hdd')!),id:'existing-ssd',componentId:'ssd',quantity:1});
 db.components.push({id:'cage',name:'SYNTHETIC · dual SSD bay cage',category:'Storage adapter',manufacturer:'Synthetic Test Hardware',source:'Synthetic workflow fixture',verified:true,specs:{storageAdapterKind:'bay-cage',baySize:'5.25',bayUnits:1,sataPowerPlugs:1,driveTargets:[{id:'A',mount:'front-hot-swap',driveSizes:['2.5'],interfaces:['SATA']},{id:'B',mount:'front-hot-swap',driveSizes:['2.5'],interfaces:['SATA']}]}});
 db.components.push({...structuredClone(db.components.find(c=>c.id==='ssd')!),id:'ssd-large',name:'SYNTHETIC · 8 TB SATA SSD',specs:{...db.components.find(c=>c.id==='ssd')!.specs,capacityGb:8000}});
 const destination=structuredClone(source);destination.id='destination-ssd';destination.name='SYNTHETIC · SSD and bay conversion';destination.notes='Synthetic destination; engineering approval still required.';
 destination.placements=destination.placements.filter(p=>p.componentId!=='hdd');destination.placements.find(p=>p.componentId==='ram')!.quantity=3;
 destination.placements.push({id:'new-cage',componentId:'cage',quantity:1,slotId:'',role:'general',mount:'auto',group:'',targetId:'FRONT'});
 for(const id of ['A','B'])destination.placements.push({id:`new-ssd-${id}`,componentId:'ssd',quantity:1,slotId:'',role:'data',mount:'front-hot-swap',group:'',adapterPlacementId:'new-cage',targetId:id});
 const large=structuredClone(destination);large.id='destination-large';large.name='SYNTHETIC · high-capacity SSD conversion';large.placements.forEach(p=>{if(p.componentId==='ssd')p.componentId='ssd-large';});
 const observed=structuredClone(source);observed.id='source-extra-memory';observed.name='SYNTHETIC · observed three-DIMM variation';observed.placements.find(p=>p.componentId==='ram')!.quantity=3;
 db.configurations=[source,mixed,destination,large,observed];
 const version={revision:1,at:syntheticDate,name:'Synthetic archive minimum',description:'Known installation must preserve 6 TB usable data.',connections:[],constraints:{minDataGb:6000}};
 db.requirementsSets=[{id:'archive-minimum',name:'SYNTHETIC · archive requirements',description:'Synthetic test minimum',versions:[version]}];return db;
}
function location(id:string,parentId:string,kind:InstallationLocation['kind']='Bench'):InstallationLocation{return {id,name:kind==='Bench'?`Bench ${id.split('-').at(-1)}`:`SYNTHETIC ${id}`,kind,parentId,requirementSetId:'',requirementRevision:0,targetConfigurationId:kind==='Bench'?'destination-ssd':'',notes:'Synthetic location; device presence must be explicitly recorded.'};}
export function addLocations(db:Database,count:number){
 db.installationLocations=[location('site-a','','Site'),location('site-b','','Site')];const split=Math.ceil(count/2);
 for(let i=1;i<=count;i++){const bench=location(`bench-${i}`,i<=split?'site-a':'site-b');bench.name=`Bench ${i<=split?i:i-split}`;db.installationLocations.push(bench);}
}
export function syntheticPC(db:Database,n:number,sourceId=n%2?'source-hdd':'source-mixed'):InventoryPC {
 return {id:`synthetic-pc-${n}`,name:`SYNTHETIC-PC-${String(n).padStart(3,'0')}`,serial:'',location:'',installationLocationId:`bench-${n}`,configurationId:'',notes:'Fictional device, safe for isolated workflow testing.',buildSettings:null,lifecycle:'Planning',hardwareSurvey:{status:'uninspected',configurationId:sourceId,evidence:'Synthetic site owner report, 2026-10-21; current hardware inferred from adjacent station.'}};
}
export function syntheticStock(id:string,componentId:string,quantity:number,condition:StockRecord['condition']='Serviceable'):StockRecord{return {id,componentId,quantity,tracking:'bulk',serial:'',assetTag:id,location:'SYNTHETIC warehouse',condition,notes:'Synthetic inventory',allocations:[],history:[]};}
export function recordInstalled(db:Database,pc:InventoryPC,cfg:Configuration,componentIds?:string[]){
 pc.buildSettings={systemId:'',storage:structuredClone(cfg.storage),notes:'Synthetic recorded settings'};
 for(const p of cfg.placements.filter(p=>!componentIds||componentIds.includes(p.componentId))){
  const stock=syntheticStock(`installed-${pc.id}-${p.id}`,p.componentId,p.quantity);
  stock.allocations=[{...structuredClone(p),id:`actual-${pc.id}-${p.id}`,pcId:pc.id,state:'installed',plannedPlacementId:p.id,notes:'Synthetic observed hardware',createdAt:syntheticDate,updatedAt:syntheticDate}];
  // Placement's componentId belongs on the stock record, not on its allocation.
  delete (stock.allocations[0] as unknown as Record<string,unknown>).componentId;db.inventory.push(stock);
 }
}
export function workflowFixtures():WorkflowFixture[]{
 const cases:WorkflowFixture[]=[];
 function make(id:string,description:string,count:number,steps:string[],prepare:(db:Database)=>void,blocked=0,active=count){const db=syntheticCatalog();addLocations(db,count);prepare(db);cases.push({id,description,db,expected:{active,blocked},steps});}
 make('01-locations-only','Imported hierarchy; known devices have not yet been registered.',4,['Import locations; grouping locations stay empty.','Select only benches with confirmed devices and register awaiting inspection.','Document a current configuration assumption; review a transition.'],()=>{},0,0);
 make('02-legacy-plans','Older PC CSVs have linked plans but no survey or installed records.',4,['Import legacy PCs without hardwareSurvey.','Review provisional planning; possible assumed reuse stays zero.','Bulk-record a documented current assumption to make conditional reuse available.'],db=>{for(let n=1;n<=4;n++){const pc=syntheticPC(db,n);pc.configurationId=pc.hardwareSurvey!.configurationId;delete pc.hardwareSurvey;db.pcs.push(pc);}});
 make('03-assumed-fleet','Six inaccessible PCs with documented HDD and mixed-drive assumptions.',6,['Filter by both source configurations and by site.','Review SSD + bay + memory conversion and both procurement estimates.','Save and reopen the plan; confirm no stock or PC assignment changes.'],db=>{for(let n=1;n<=6;n++)db.pcs.push(syntheticPC(db,n));});
 make('04-partial-conflict','Two partial surveys agree with assumptions; one records extra RAM.',3,['Review: the extra-RAM PC blocks, and its demand is excluded.','Edit its survey directly, choose the observed three-DIMM configuration and explicitly reuse matching group inputs.','Enumerate remaining parts, complete the survey and commission through normal actions.'],db=>{for(let n=1;n<=3;n++){const pc=syntheticPC(db,n,'source-hdd');pc.hardwareSurvey!.status='partial';db.pcs.push(pc);recordInstalled(db,pc,db.configurations[0],n===3?['ram']:['cpu']);}db.inventory.find(s=>s.allocations[0]?.pcId==='synthetic-pc-3')!.quantity=3;db.inventory.find(s=>s.allocations[0]?.pcId==='synthetic-pc-3')!.allocations[0].quantity=3;},1);
 make('05-stock-pressure','Two recorded PCs, outside-scope reservations, unusable stock and inactive PCs.',5,['Select the first two PCs; inspect full procurement.','Expect 2 SSDs, 1 cage and 2 RAM modules to order.','Explicitly selecting Parts only / Retired PCs blocks them; their stock is not free.'],db=>{for(let n=1;n<=5;n++){const pc=syntheticPC(db,n,'source-hdd');pc.configurationId='source-hdd';pc.hardwareSurvey!.status=n<=2?'complete':'uninspected';if(n===4)pc.lifecycle='Parts only';if(n===5)pc.lifecycle='Retired';db.pcs.push(pc);if(n<=2)recordInstalled(db,pc,db.configurations[0]);}
 const pool=syntheticStock('ssd-pool','ssd',3);pool.allocations=[1,3].map(n=>({id:`reservation-${n}`,pcId:`synthetic-pc-${n}`,quantity:1,state:'reserved',plannedPlacementId:'',slotId:'',role:'data',mount:'front-hot-swap',group:'',notes:'Synthetic reservation',createdAt:syntheticDate,updatedAt:syntheticDate}));db.inventory.push(pool,syntheticStock('cage-pool','cage',1),syntheticStock('quarantined-ssds','ssd',50,'Quarantined'),syntheticStock('repair-memory','ram',50,'Repair'));},0,3);
 make('06-unknown-capacity','Unknown source drive capacity, one missing measurement, and a pinned 6 TB minimum.',3,['Review: pinned capacity and missing usage evidence block two PCs.','Add measured usage to the unknown cohort.','Choose the high-capacity destination; all three become plannable.'],db=>{delete db.components.find(c=>c.id==='hdd')!.specs.capacityGb;const unknown=structuredClone(db.configurations[0]);unknown.id='source-unmeasured';unknown.name='SYNTHETIC · capacity survey pending';db.configurations.push(unknown);for(let n=1;n<=3;n++)db.pcs.push(syntheticPC(db,n,n===2?unknown.id:'source-hdd'));const loc=db.installationLocations.find(l=>l.id==='bench-1')!;loc.requirementSetId='archive-minimum';loc.requirementRevision=1;loc.requirementSnapshot=structuredClone(db.requirementsSets[0].versions[0]);},2);
 make('07-survey-gaps','Known device presence with missing assumptions, evidence, or supposedly complete hardware.',4,['Confirm all four remain explicit blockers despite location targets.','Bulk-set uninspected, the current HDD assumption, and evidence.','Review again: all four are provisional and plannable.'],db=>{for(let n=1;n<=4;n++){const pc=syntheticPC(db,n,'source-hdd');if(n===1)pc.hardwareSurvey!.configurationId='';if(n===2)pc.hardwareSurvey!.evidence='';if(n===3)pc.hardwareSurvey!.status='complete';if(n===4){delete pc.hardwareSurvey;pc.configurationId='';}db.pcs.push(pc);}},4);
 make('08-fleet-scale','125 devices across two sites; 120 active and five inactive.',125,['Use source and hierarchy filters; duplicate bench labels must resolve by ID.','Select matching PCs across multiple pages; hidden selections remain explicit.','Review all 120 active PCs; save/reload a plan without changing inventory.'],db=>{for(let n=1;n<=125;n++){const pc=syntheticPC(db,n);if(n>120)pc.lifecycle=n%2?'Retired':'Parts only';db.pcs.push(pc);}},0,120);
 return cases;
}
/** Prepopulated inputs remain editable and are always reviewed against the live workspace. */
export function fixtureScenario(fixture:WorkflowFixture){
 const scenario=newTransitionScenario();scenario.name=`SYNTHETIC · ${fixture.id}`;scenario.pcIds=transitionMatches(fixture.db,scenario).map(pc=>pc.id);
 if(fixture.id==='05-stock-pressure')scenario.pcIds=fixture.db.pcs.slice(0,2).map(pc=>pc.id);
 for(const cohort of transitionCohorts(fixture.db,scenario)){
  scenario.destinationIds[cohort.id]='destination-ssd';
  for(const segment of cohort.segments)if(segment.role==='data')scenario.policies[cohort.id]={[segment.id]:{usedGb:1000,evidence:'Synthetic filesystem usage: maximum 1000 GB per PC, 2026-10-21'}};
  if(fixture.id==='06-unknown-capacity'&&cohort.members[0].pc.id==='synthetic-pc-2')scenario.policies[cohort.id]={};
 }
 return scenario;
}
