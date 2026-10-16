import type {Component,Configuration,Database,Finding,Resource,CoolingDevice,CoolingHeader,Placement} from './types.ts';
export const headerPowered=(device:CoolingDevice)=>device.powerConnector==='Fan 3-pin'||device.powerConnector==='Fan 4-pin';
export function coolingInputs(component:Component,quantity=1){return (component.specs.coolingDevices||[]).flatMap(device=>{
 const needsHeader=headerPowered(device)||!device.powerConnector||device.control!==undefined&&device.control!=='Fixed speed'||device.tachometer===true;
 return needsHeader?Array.from({length:Math.min(1024,(device.count??1)*quantity)},(_,i)=>({device,deviceIndex:i+1})):[];
});}
export function coolingPowerW(component:Component):number|undefined{
 if(component.specs.powerW!==undefined)return component.specs.powerW;
 const devices=component.specs.coolingDevices;
 if(!['Fan','Cooler'].includes(component.category)||!devices?.length||devices.some(d=>d.voltageV===undefined||d.currentA===undefined))return;
 return devices.reduce((sum,d)=>sum+d.voltageV!*d.currentA!*(d.count??1),0);
}
export function checkCooling(config:Configuration,db:Database){
 const findings:Finding[]=[],resources:Resource[]=[];
 const add=(severity:Finding['severity'],title:string,detail:string)=>findings.push({severity,title,detail});
 const rows=config.placements.flatMap(p=>{const c=db.components.find(c=>c.id===p.componentId);return c?[{p,c}]:[];});
 const usage=new Map<string,{p:Placement;c:Component;h:CoolingHeader;amps:number;unknown:boolean;devices:number;rpm:number;controls:Set<string>}>();
 for(const {p,c} of rows){
  if(['Fan','Cooler'].includes(c.category)&&!c.specs.coolingDevices?.length)add('warning','Cooling specifications unknown',`${c.name}: record fan/pump power, control and RPM feedback.`);
  const expected=coolingInputs(c,p.quantity),seen=new Set<string>();
  for(const d of c.specs.coolingDevices||[]){
   if(d.powerConnector==='SATA power'&&c.specs.sataPowerInputs===undefined&&c.specs.sataPowerPlugs===undefined)add('warning','Cooling external power unconfirmed',`${c.name} / ${d.id}: record the assembly's SATA power inputs and connect them to PSU plugs; PWM/RPM wiring does not supply motor power.`);
   if(d.powerConnector==='SATA power'&&(c.specs.sataPowerInputs?.length===0||c.specs.sataPowerInputs===undefined&&c.specs.sataPowerPlugs===0))add('error','Cooling external power missing',`${c.name} / ${d.id}: SATA-powered motors need at least one physical power input.`);
   if(d.powerConnector==='Peripheral 4-pin'||d.powerConnector==='Proprietary')add('warning','Cooling external power review',`${c.name} / ${d.id}: verify PSU connector, pinout, voltage and wiring independently of control.`);
   if(d.powerConnector&&!headerPowered(d)&&d.control==='DC voltage')add('error','Cooling control mismatch',`${c.name} / ${d.id}: a motherboard DC voltage setting cannot regulate a motor powered separately. Record a verified controller or a supported control method.`);
  }
  for(const connection of p.coolingConnections||[]){
   const input=expected.find(e=>e.device.id===connection.deviceId&&e.deviceIndex===connection.deviceIndex),key=connection.deviceId+':'+connection.deviceIndex;
   if(!input){add('error','Cooling input missing',`${c.name}: ${key} is not a header input in this placement.`);continue;}
   if(seen.has(key)){add('error','Cooling input connected twice',`${c.name}: ${key} has more than one header assignment.`);continue;}seen.add(key);
   const provider=rows.find(r=>r.p.id===connection.headerPlacementId),h=provider?.c.specs.coolingHeaders?.find(h=>h.id===connection.headerId);
   if(!provider||!h){add('error','Cooling header missing',`${c.name}: selected header ${connection.headerId} no longer exists in the build.`);continue;}
   if(provider.p.quantity!==1){add('error','Cooling provider ambiguous',`${provider.c.name}: split header providers into individual placements before wiring.`);continue;}
   if(provider.p.id===p.id){add('error','Cooling self connection',`${c.name}: a motor cannot supply its own header.`);continue;}
   const d=input.device,label=`${c.name} / ${key} → ${provider.c.name} / ${h.id}`,plug=d.controlConnector??(headerPowered(d)?d.powerConnector:undefined);
   if(!d.powerConnector||!plug||!h.connector)add('warning','Cooling connector unknown',label);
   else if(plug==='Proprietary'||h.connector==='Proprietary')add('warning','Cooling pinout review',`${label}: proprietary connectors require manufacturer verification.`);
   else if(d.control==='PWM'&&(plug!=='Fan 4-pin'||h.connector!=='Fan 4-pin'))add('error','Cooling PWM connector mismatch',`${label}: PWM requires the fourth control pin at both ends.`);
   if(d.control===undefined||h.controlModes===undefined)add('warning','Cooling control unknown',label);
   else if(d.control!=='Fixed speed'&&!h.controlModes.includes(d.control))add('error','Cooling control mismatch',`${label}: header does not support ${d.control}.`);
   if(headerPowered(d)){
    if(d.voltageV===undefined||h.voltageV===undefined)add('warning','Cooling voltage unknown',label);
    else if(d.voltageV!==h.voltageV)add('error','Cooling voltage mismatch',`${label}: ${d.voltageV} V motor on ${h.voltageV} V header.`);
   }
   if(d.tachometer===true&&h.tachometer!==true)add('warning','Cooling RPM feedback unconfirmed',label);
   const id=provider.p.id+':'+h.id;
   const used=usage.get(id)??{p:provider.p,c:provider.c,h,amps:0,unknown:false,devices:0,rpm:0,controls:new Set<string>()};
   used.devices++;if(d.control&&d.control!=='Fixed speed')used.controls.add(d.control);if(d.tachometer)used.rpm++;
   if(headerPowered(d)){used.amps+=d.currentA??0;used.unknown ||= d.currentA===undefined;}else if(!d.powerConnector)used.unknown=true;
   usage.set(id,used);
  }
  const missing=expected.filter(e=>!seen.has(e.device.id+':'+e.deviceIndex));
  if(missing.length)add('warning','Cooling wiring incomplete',`${c.name}: ${missing.length} fan/pump power or control inputs need header assignments.`);
 }
 const groups=new Map<string,{amps:number;unknown:boolean;limit:number|undefined;label:string}>();
 for(const used of usage.values()){
  const label=`${used.c.name} / ${used.h.id}`,limit=used.h.maxCurrentA;
  if(limit!==undefined)resources.push({name:`Cooling header current: ${label}`,used:used.amps,available:limit,unit:' A'});
  if(used.controls.size>1)add('error','Cooling shared control conflict',`${label}: motors require different control modes on one shared header.`);
  if(used.devices>(used.h.maxDevices??1))add('error','Cooling header device limit exceeded',`${label}: ${used.devices} devices; documented limit ${used.h.maxDevices??1}. Record a verified splitter/hub limit.`);
  if(used.devices>1)add('warning','Cooling shared header review',`${label}: verify the splitter/hub and its wiring. A shared header does not provide independent control for each motor.`);
  if(used.rpm>1)add('warning','Cooling shared RPM channel',`${label}: a splitter normally returns one RPM signal; verify which motor is monitored.`);
  if(used.unknown||limit===undefined)add('warning','Cooling current unconfirmed',`${label}: document maximum/startup motor current and header current limit; known subtotal ${used.amps} A.`);
  if(limit!==undefined&&used.amps>limit+1e-9)add('error','Cooling header current exceeded',`${label}: ${used.amps} A exceeds ${limit} A.`);
  if(used.h.limitGroup){
   const group=used.c.specs.coolingHeaderGroups?.find(g=>g.id===used.h.limitGroup);
   if(!group){add('warning','Cooling shared current limit unknown',`${label}: group ${used.h.limitGroup} is not documented.`);continue;}
   const id=used.p.id+':'+group.id,entry=groups.get(id)??{amps:0,unknown:false,limit:group.maxCurrentA,label:used.c.name+' / '+group.id};
   entry.amps+=used.amps;entry.unknown ||= used.unknown;groups.set(id,entry);
  }
 }
 for(const group of groups.values()){
  if(group.limit!==undefined){resources.push({name:`Cooling shared current: ${group.label}`,used:group.amps,available:group.limit,unit:' A'});if(group.amps>group.limit+1e-9)add('error','Cooling shared current exceeded',`${group.label}: ${group.amps} A exceeds ${group.limit} A.`);}
  if(group.unknown||group.limit===undefined)add('warning','Cooling shared current unconfirmed',`${group.label}: complete motor and shared-limit ratings before approval.`);
 }
 return {findings,resources};
}
