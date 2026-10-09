import type {Component,Configuration,Database,Finding,Placement,Resource} from './types';
import {componentCapabilities,storageAdapterKind} from './component-capabilities';

/** SATA channels and PSU end plugs are physical resources, independent of drive bays. */
export function checkStorageConnections(config:Configuration,db:Database,slotAssignments:Record<string,string>) {
 const findings:Finding[]=[],resources:Resource[]=[];
 const add=(severity:Finding['severity'],title:string,detail:string)=>findings.push({severity,title,detail});
 const resource=(name:string,used:number,available:number|undefined)=>{
  if(available===undefined){if(used)add('warning',`${name} capacity unknown`,`${used} required; enter manufacturer capacity and routing documentation.`);return;}
  resources.push({name,used,available});
  if(used>available)add('error',`${name} capacity exceeded`,`${used} required; ${available} available.`);
 };
 const components=new Map(db.components.map(c=>[c.id,c]));
 const rows=config.placements.flatMap(p=>{const c=components.get(p.componentId);return c?[{p,c}]:[];});
 type Row=typeof rows[number];
 const byId=new Map(rows.map(r=>[r.p.id,r]));
 const board=rows.find(r=>r.c.category==='Motherboard'),psu=rows.find(r=>r.c.category==='PSU');
 type Pool={row:Row;used:number;available:number|undefined;endpoints:Map<string,{disabled:boolean;booked:number}>|undefined;unnamedDisabled:number};
 const dataPools=new Map<string,Pool>(),powerPools=new Map<string,Pool>();
 const activeSlots=new Set(Object.values(slotAssignments));
 for(const row of rows) {
  const {p,c}=row,s=c.specs;
  if(componentCapabilities(c).sataController) {
   const named=s.sataDataPorts;
   const disabled=new Set<string>();let unnamedDisabled=0;
   for(const rule of s.laneRules||[])if(rule.slots.some(slot=>activeSlots.has(slot))) {
    for(const id of rule.disableSataPortIds||[])disabled.add(id);
    unnamedDisabled+=Math.max(0,(rule.disableSataPorts||0)-new Set(rule.disableSataPortIds||[]).size);
   }
   if(named!==undefined&&s.sataPorts!==undefined&&named.length!==s.sataPorts)add('warning','SATA data catalog differs from count',`${c.name}: the complete named catalog (${named.length}) overrides legacy SATA port count (${s.sataPorts}).`);
   const endpoints=named===undefined?undefined:new Map(named.map(port=>[port.id,{disabled:!!port.disabled||disabled.has(port.id),booked:0}]));
   if(endpoints&&endpoints.size!==named!.length)add('error','Duplicate SATA port IDs',`${c.name}: every SATA data endpoint needs a unique ID.`);
   for(const id of disabled)if(endpoints&&!endpoints.has(id))add('error','Lane rule SATA port missing',`${c.name}: active lane rule disables undeclared port ${id}.`);
   if(disabled.size&&!endpoints)add('warning','Lane rule SATA port catalog unknown',`${c.name}: named disabled ports cannot be checked without a complete SATA port catalog.`);
   const available=endpoints?Math.max(0,[...endpoints.values()].filter(port=>!port.disabled).length-unnamedDisabled)*p.quantity:s.sataPorts===undefined?undefined:Math.max(0,s.sataPorts-disabled.size-unnamedDisabled)*p.quantity;
   dataPools.set(p.id,{row,used:0,available,endpoints,unnamedDisabled});
  } else if(s.sataDataPorts!==undefined||s.sataPorts!==undefined)add('warning','SATA controller role unconfirmed',`${c.name}: a passive adapter or other component cannot supply active SATA data channels.`);
  if(c.category==='PSU') {
   const named=s.sataPowerConnectors;
   if(named!==undefined&&s.sataPower!==undefined&&named.length!==s.sataPower)add('warning','SATA power catalog differs from count',`${c.name}: the complete end-plug catalog (${named.length}) overrides legacy SATA power count (${s.sataPower}). Harness names do not add plugs.`);
   const endpoints=named===undefined?undefined:new Map(named.map(plug=>[plug.id,{disabled:false,booked:0}]));
   if(endpoints&&endpoints.size!==named!.length)add('error','Duplicate SATA power connector IDs',`${c.name}: each physical end plug needs a unique ID.`);
   powerPools.set(p.id,{row,used:0,available:named===undefined?(s.sataPower===undefined?undefined:s.sataPower*p.quantity):named.length*p.quantity,endpoints,unnamedDisabled:0});
  }else if(s.sataPowerConnectors!==undefined)add('error','SATA power provider invalid',`${c.name}: SATA PSU end plugs must belong to a power supply.`);
 }
 type DataRoute=NonNullable<Placement['sataDataConnections']>[number];
 type PowerRoute=NonNullable<Placement['sataPowerConnections']>[number];
 type Sink={row:Row;id:string;quantity:number;route?:DataRoute|PowerRoute;legacySource?:string;boot?:boolean;hotPlug?:boolean;downstreamControllers?:Set<string>};
 const dataSinks=new Map<string,Sink>(),powerSinks=new Map<string,Sink>();
 const key=(row:Row,id:string)=>JSON.stringify([row.p.id,id]);
 const dataInputUses=new Map<string,number>();
 const cages=rows.filter(row=>row.c.category==='Storage adapter'&&storageAdapterKind(row.c)==='bay-cage');
 const cageIds=new Set(cages.map(row=>row.p.id));
 function compatibleCage(drive:Row):{row:Row;target:NonNullable<Component['specs']['driveTargets']>[number]}|undefined {
  const provider=byId.get(drive.p.adapterPlacementId||'');
  if(!provider||!cageIds.has(provider.p.id)||provider.p.id===drive.p.id)return;
  const target=provider.c.specs.driveTargets?.find(t=>t.id===drive.p.targetId);
  if(!target||target.mount==='rear-sled'||(drive.p.mount!=='auto'&&target.mount!==drive.p.mount)||!target.interfaces?.includes('SATA')||!drive.c.specs.driveSize||!target.driveSizes?.includes(drive.c.specs.driveSize))return;
  if(provider.p.quantity!==1)add('error','Ambiguous SATA cage instance',`${drive.c.name}: split ${provider.c.name} into individual placements before binding its inputs and targets.`);
  return {row:provider,target};
 }
 function targetInput(cage:Row,id:string|undefined,kind:'data'|'power',drive:Row):string|undefined {
  const list=kind==='data'?cage.c.specs.sataDataInputs:cage.c.specs.sataPowerInputs;
  if(id){
   if(list&&!list.some(input=>input.id===id)){add('error',`SATA cage ${kind} input missing`,`${cage.c.name} / ${drive.p.targetId}: target references undeclared ${kind} input ${id}.`);return;}
   if(!list)add('warning',`SATA cage ${kind} input catalog unknown`,`${cage.c.name}: document input ${id} before confirming the target route.`);
   return id;
  }
  if(list?.length===1)return list[0].id;
  if(list&&list.length>1)add('error',`SATA cage ${kind} route ambiguous`,`${cage.c.name} / ${drive.p.targetId}: choose the specific ${kind} input in the target catalog.`);
  return;
 }
 // Power inputs belong to the cage/accessory itself, including empty cages.
 for(const row of rows)if(row.c.category!=='Drive') {
  const named=row.c.specs.sataPowerInputs;
  if(named!==undefined&&row.c.specs.sataPowerPlugs!==undefined&&named.length!==row.c.specs.sataPowerPlugs)add('warning','SATA power input catalog differs from count',`${row.c.name}: named power inputs override legacy plug count.`);
  if(named)for(const input of named)powerSinks.set(key(row,input.id),{row,id:input.id,quantity:row.p.quantity});
  else if(row.c.specs.sataPowerPlugs!==undefined&&row.c.specs.sataPowerPlugs>0)powerSinks.set(key(row,''),{row,id:'',quantity:row.c.specs.sataPowerPlugs*row.p.quantity});
 }
 for(const row of rows.filter(r=>r.c.category==='Drive'&&r.c.specs.driveInterface==='SATA')) {
  const cage=compatibleCage(row);
  let sharedData=false,sharedPower=false;
  if(cage) {
   const dataId=targetInput(cage.row,cage.target.sataDataInputId,'data',row);
   if(dataId) {
    const sinkKey=key(cage.row,dataId);sharedData=true;
    const sink:Sink=dataSinks.get(sinkKey)||{row:cage.row,id:dataId,quantity:cage.row.p.quantity,legacySource:cage.row.p.controllerPlacementId};
    sink.boot ||= row.p.role==='boot';sink.hotPlug ||= cage.target.mount==='front-hot-swap';dataSinks.set(sinkKey,sink);
    if(row.p.controllerPlacementId)(sink.downstreamControllers??=new Set()).add(row.p.controllerPlacementId);
    const uses=(dataInputUses.get(sinkKey)||0)+row.p.quantity;dataInputUses.set(sinkKey,uses);
    if(uses>cage.row.p.quantity)add('error','SATA cage data input shared',`${cage.row.c.name} / ${dataId}: multiple drives cannot share one SATA channel; record separate inputs or verified controller hardware.`);
   }else add('warning','SATA cage data routing unconfirmed',`${row.c.name}: no verified cage input route; conservatively count a separate host channel.`);
   const powerId=targetInput(cage.row,cage.target.sataPowerInputId,'power',row);
   if(powerId&&cage.row.c.specs.sataPowerInputs===undefined&&cage.row.c.specs.sataPowerPlugs!==undefined)sharedPower=true;
   else if(powerId) {
    sharedPower=true;
    const sinkKey=key(cage.row,powerId);
    if(!powerSinks.has(sinkKey))powerSinks.set(sinkKey,{row:cage.row,id:powerId,quantity:cage.row.p.quantity});
   }else if(cage.row.c.specs.sataPowerPlugs!==undefined&&cage.row.c.specs.sataPowerInputs===undefined&&!cage.target.sataPowerInputId)sharedPower=true;
   else add('warning','Bay adapter power inputs unknown',`${cage.row.c.name}: no verified power-input route; downstream drives are conservatively budgeted individually.`);
  }else {
   const provider=byId.get(row.p.adapterPlacementId||'');
   if(provider&&cageIds.has(provider.p.id))add('warning',provider.c.specs.sataPowerInputs===undefined&&provider.c.specs.sataPowerPlugs===undefined?'Bay adapter power inputs unknown':'Bay adapter power routing unconfirmed',`${provider.c.name}: bind the drive to a compatible named SATA cage target before sharing its power inputs.`);
  }
  if(sharedData&&row.p.sataDataConnections?.length)add('error','SATA drive data route bypasses cage',`${row.c.name}: route the declared cage input instead of assigning another host channel to its downstream drive.`);
  if(sharedPower&&row.p.sataPowerConnections?.length)add('error','SATA drive power route bypasses cage',`${row.c.name}: power is supplied through its cage input; remove the duplicate direct PSU route.`);
  if(!sharedData)dataSinks.set(key(row,''),{row,id:'',quantity:row.p.quantity,legacySource:row.p.controllerPlacementId||cage?.row.p.controllerPlacementId});
  // SATA M.2 modules use slot power, not a PSU SATA end plug.
  if(!sharedPower&&row.c.specs.driveSize!=='M.2')powerSinks.set(key(row,''),{row,id:'',quantity:row.p.quantity});
  if(row.c.specs.driveSize==='M.2'&&row.p.sataPowerConnections?.length)add('error','SATA M.2 power route invalid',`${row.c.name}: M.2 power is supplied by the slot, not a SATA PSU plug.`);
 }
 function bindMappings(kind:'data'|'power') {
  const sinks=kind==='data'?dataSinks:powerSinks;
  for(const row of rows) {
   const mappings=kind==='data'?row.p.sataDataConnections:row.p.sataPowerConnections;
   if(!mappings?.length)continue;
   const implicit=row.c.category==='Drive'&&row.c.specs.driveInterface==='SATA'&&(kind==='data'||row.c.specs.driveSize!=='M.2');
   const list=kind==='data'?row.c.specs.sataDataInputs:row.c.specs.sataPowerInputs;
   if(!implicit&&kind==='data'&&!cageIds.has(row.p.id)){add('error','SATA data consumer invalid',`${row.c.name}: only SATA drives and documented cage inputs accept these data routes.`);continue;}
   if(!implicit&&kind==='power'&&list===undefined&&row.c.specs.sataPowerPlugs===undefined){add('error','SATA power consumer invalid',`${row.c.name}: document SATA power inputs before binding PSU end plugs.`);continue;}
   if(row.p.quantity!==1)add('error',`Ambiguous SATA ${kind} consumer instance`,`${row.c.name}: split the placement before mapping physical connectors.`);
   for(const mapping of mappings) {
    let id=mapping.inputId||'';
    if(implicit&&id){add('error',`SATA drive ${kind} input invalid`,`${row.c.name}: the direct drive input is implicit; do not name a cage input.`);continue;}
    if(!implicit&&list!==undefined){
     if(!id&&list.length===1)id=list[0].id;
     if(!list.some(input=>input.id===id)){add('error',`SATA ${kind} input missing`,`${row.c.name}: ${id||'unspecified input'} is not an input in the complete catalog.`);continue;}
    }else if(!implicit&&id){
     add('warning',`SATA ${kind} input catalog unknown`,`${row.c.name}: document named input ${id} before approving this mapping.`);
     if(kind==='power'&&row.c.specs.sataPowerPlugs!==undefined)id='';
    }
    const sinkKey=key(row,id);let sink=sinks.get(sinkKey);
    // An empty cage data input with a mapping reserves its physical channel.
    if(!sink&&kind==='data'&&cageIds.has(row.p.id)){sink={row,id,quantity:row.p.quantity,legacySource:row.p.controllerPlacementId};sinks.set(sinkKey,sink);}
    if(!sink&&kind==='power'&&!implicit&&list===undefined&&id){sink={row,id,quantity:row.p.quantity};sinks.set(sinkKey,sink);}
    if(!sink){add('error',`SATA ${kind} route invalid`,`${row.c.name}: this input does not require a separate ${kind} connection.`);continue;}
    if(sink.route){add('error',`SATA ${kind} input double mapped`,`${row.c.name} / ${id||'drive'}: choose one physical source per input.`);continue;}
    if(sink.quantity!==1)add('error',`Ambiguous SATA ${kind} input count`,`${row.c.name}: one physical mapping cannot describe ${sink.quantity} unnamed plugs or component instances.`);
    sink.route=mapping;
   }
  }
 }
 bindMappings('data');bindMappings('power');
 let totalPower=0;
 function consume(kind:'data'|'power',sink:Sink) {
  const pools=kind==='data'?dataPools:powerPools;
  const route=sink.route;
  const sourceId=route?(kind==='data'?(route as DataRoute).controllerPlacementId:(route as PowerRoute).powerProviderPlacementId):kind==='data'?sink.legacySource:undefined;
  if(route&&!sourceId)add('warning',`SATA ${kind} provider unrecorded`,`${sink.row.c.name}: an automatic provider is budgeted; record the actual controller or PSU before signing off the physical wiring.`);
  let pool=sourceId?pools.get(sourceId):kind==='data'?(board?dataPools.get(board.p.id):undefined):(psu?powerPools.get(psu.p.id):undefined);
  if(sourceId&&!pool){add('error',`SATA ${kind} provider invalid`,`${sink.row.c.name}: ${sourceId} is missing or is not an active ${kind==='data'?'SATA controller':'PSU'}.`);pool=kind==='data'?(board?dataPools.get(board.p.id):undefined):(psu?powerPools.get(psu.p.id):undefined);}
  if(kind==='power')totalPower+=sink.quantity;
  if(!pool){add('warning',`SATA ${kind} provider missing`,`${sink.row.c.name}: select and document the supplying ${kind==='data'?'controller':'power supply'}.`);return;}
  pool.used+=sink.quantity;
  if(kind==='data'&&sink.row.c.category==='Drive'&&route&&sink.legacySource&&sink.legacySource!==pool.row.p.id)add('error','SATA drive controller route conflicts',`${sink.row.c.name}: the named data connection and legacy controller binding select different providers.`);
  if(kind==='data'&&[...(sink.downstreamControllers||[])].some(id=>id!==pool.row.p.id))add('error','SATA cage controller route conflicts',`${sink.row.c.name} / ${sink.id}: a downstream drive controller binding contradicts this cage input's source.`);
  if(sourceId&&pool.row.p.quantity!==1)add('error',`Ambiguous SATA ${kind} provider instance`,`${pool.row.c.name}: split provider placements before choosing physical endpoints.`);
  if(kind==='data'&&(sink.boot||sink.row.p.role==='boot')&&pool.row.c.specs.bootable===false)add('error','Storage controller cannot boot',`${pool.row.c.name} cannot boot ${sink.row.c.name}.`);
  if(kind==='data'&&(sink.hotPlug||sink.row.p.mount==='front-hot-swap')&&pool.row.c.specs.hotPlug===false)add('error','Storage controller hot-plug unsupported',`${pool.row.c.name} does not support live removal.`);
  const endpointId=route?(kind==='data'?(route as DataRoute).portId:(route as PowerRoute).connectorId):undefined;
  if(!route)add('warning',`SATA ${kind} connection unrecorded`,`${sink.row.c.name}${sink.id?` / ${sink.id}`:''}: capacity is budgeted but its physical source endpoint is not recorded.`);
  if(endpointId) {
   if(!pool.endpoints)add('warning',`SATA ${kind} endpoint catalog unknown`,`${pool.row.c.name}: cannot verify endpoint ${endpointId} without its complete catalog.`);
   else {
    const endpoint=pool.endpoints.get(endpointId);
    if(!endpoint)add('error',`SATA ${kind} endpoint missing`,`${pool.row.c.name}: endpoint ${endpointId} is not declared.`);
    else {
     endpoint.booked+=sink.quantity;
     if(endpoint.booked>1)add('error',`SATA ${kind} endpoint double booked`,`${pool.row.c.name} / ${endpointId}: one physical endpoint cannot serve multiple inputs.`);
     if(endpoint.disabled)add('error','SATA data endpoint disabled',`${pool.row.c.name} / ${endpointId} is disabled by its catalog or active lane rule.`);
     if(pool.unnamedDisabled)add('warning','SATA lane-sharing route unconfirmed',`${pool.row.c.name}: active lane rules disable unnamed ports; verify ${endpointId} remains usable.`);
    }
   }
  }else if(route)add('warning',`SATA ${kind} source endpoint unrecorded`,`${pool.row.c.name}: select the individual ${kind==='data'?'SATA port':'PSU end plug'}.`);
 }
 for(const sink of dataSinks.values())consume('data',sink);
 for(const sink of powerSinks.values())consume('power',sink);
 for(const pool of dataPools.values()) {
  resource(pool.row.c.category==='Motherboard'?'SATA ports':`SATA controller ${pool.row.c.name}`,pool.used,pool.available);
  if(pool.endpoints)for(const [id,endpoint] of pool.endpoints)resources.push({name:`SATA data endpoint ${pool.row.c.name} / ${id}`,used:endpoint.booked,available:endpoint.disabled?0:pool.row.p.quantity});
 }
 const knownPower=[...powerPools.values()];
 resource('SATA power plugs',totalPower,knownPower.length&&knownPower.every(pool=>pool.available!==undefined)?knownPower.reduce((n,pool)=>n+pool.available!,0):undefined);
 for(const pool of knownPower) {
  resource(`SATA power supply ${pool.row.c.name}`,pool.used,pool.available);
  if(pool.endpoints)for(const [id,endpoint] of pool.endpoints)resources.push({name:`SATA power endpoint ${pool.row.c.name} / ${id}`,used:endpoint.booked,available:pool.row.p.quantity});
 }
 return {findings,resources};
}
