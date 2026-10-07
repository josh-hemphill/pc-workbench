import type { Configuration, Database, Finding, Report, Resource, Component, Placement, StorageGroup } from './types';

/** Deterministic planning checks. Manufacturer-specific lane sharing and firmware are manual checks. */
export function checkConfiguration(config: Configuration, db: Database): Report {
  const findings: Finding[] = [], resources: Resource[] = [], slotAssignments: Record<string,string> = {};
  const add = (severity: Finding['severity'],title:string,detail:string) => findings.push({severity,title,detail});
  const rows: {p:Placement;c:Component}[] = [];
  for(const p of config.placements) { if(!Number.isInteger(p.quantity)||p.quantity<1||p.quantity>32){add('error','Invalid component quantity','Enter a whole number from 1 to 32 for each component.');continue;}const c = db.components.find(c=>c.id===p.componentId); if(c) rows.push({p,c}); else add('error','Missing component',`Catalog entry ${p.componentId} no longer exists.`); }
  for(const row of rows)if(row.c.category==='Drive'&&row.p.mount==='auto'&&row.p.targetId) {
    const provider=row.p.adapterPlacementId?rows.find(r=>r.p.id===row.p.adapterPlacementId):rows.find(r=>r.c.category===(row.c.specs.driveSize==='M.2'?'Motherboard':'Chassis'));
    const target=provider?.c.specs.driveTargets?.find(t=>t.id===row.p.targetId);
    if(target)row.p={...row.p,mount:target.mount};
  }
  const of = (category: string) => rows.filter(r=>r.c.category===category);
  const single = (category: string) => { const matches=of(category); const count=matches.reduce((n,r)=>n+r.p.quantity,0); if(count!==1) add('error',`${category} selection`, `Select exactly one ${category.toLowerCase()}; ${count} selected.`); return matches[0]?.c; };
  const board=single('Motherboard'), chassis=single('Chassis'), cpu=single('CPU'), psu=single('PSU');
  if(!of('Memory').length) add('error','Memory missing','Add at least one memory module.');
  if(!of('Cooler').length) add('warning','CPU cooling unconfirmed','Add a cooler or confirm the CPU includes adequate cooling.');
  for(const {c} of rows) if(!c.verified) add('warning','Specifications need verification',`${c.name}: confirm manufacturer specifications before approval.`);
  function resource(name:string,used:number,available:number|undefined,unit?:string) {
    if(available===undefined) { if(used>0) add('warning',`${name} capacity unknown`,`Requirements: ${used}${unit||''}. Enter available capacity in the catalog.`); return; }
    resources.push({name,used,available,unit});
    if(used>available) add('error',`${name} capacity exceeded`,`${used}${unit||''} required; ${available}${unit||''} available.`);
  }
  if(board&&cpu) { if(!board.specs.socket||!cpu.specs.socket) add('warning','CPU socket unknown','Enter socket specifications for the CPU and motherboard.'); else if(board.specs.socket!==cpu.specs.socket) add('error','CPU socket mismatch',`${cpu.specs.socket} CPU cannot use a ${board.specs.socket} motherboard.`); else add('pass','CPU socket matches',`${cpu.specs.socket} socket. Confirm CPU support and minimum BIOS with the motherboard vendor.`); }
  if(board&&chassis) { if(!board.specs.formFactor||!chassis.specs.supportedForms) add('warning','Motherboard fit unconfirmed','Enter board form factor and chassis supported forms.'); else if(!chassis.specs.supportedForms.includes(board.specs.formFactor)) add('error','Motherboard does not fit',`${board.specs.formFactor} is not supported by ${chassis.name}.`); else add('pass','Motherboard fits chassis',`${board.specs.formFactor} is supported.`); }
  for(const {c} of of('Memory')) { if(c.specs.capacityGb===undefined)add('warning','Memory capacity unknown',`Enter module capacity for ${c.name}.`);if(!c.specs.memoryType||!board?.specs.memoryType) add('warning','Memory type unknown',`Confirm ${c.name} matches the motherboard.`); else if(c.specs.memoryType!==board.specs.memoryType) add('error','Memory type mismatch',`${c.name} uses ${c.specs.memoryType}; board requires ${board.specs.memoryType}.`); }
  resource('DIMM slots',of('Memory').reduce((n,r)=>n+r.p.quantity,0),board?.specs.dimmSlots);
  resource('Memory',of('Memory').reduce((n,r)=>n+(r.c.specs.capacityGb||0)*r.p.quantity,0),board?.specs.maxMemoryGb,' GB');
  for(const {c} of of('Cooler')) { if(c.specs.supportsSockets&&cpu?.specs.socket&&!c.specs.supportsSockets.includes(cpu.specs.socket)) add('error','Cooler socket mismatch',`${c.name} does not support ${cpu.specs.socket}.`); if(c.specs.heightMm===undefined||chassis?.specs.maxCoolerHeightMm===undefined) add('warning','Cooler clearance unknown',`Verify ${c.name} height against chassis clearance.`); else if(c.specs.heightMm>chassis.specs.maxCoolerHeightMm) add('error','Cooler too tall',`${c.specs.heightMm} mm exceeds ${chassis.specs.maxCoolerHeightMm} mm clearance.`); }
  const cards=rows.filter(r=>['GPU','Scientific card','Network card','Storage adapter'].includes(r.c.category));
  const slots=board?.specs.slots||[];
  const instances=cards.flatMap(r=>Array.from({length:r.p.quantity},(_,i)=>({...r,key:`${r.p.id}:${i}`})));
  for(const {c} of cards) { const s=c.specs; if(s.lengthMm===undefined||s.heightMm===undefined||s.slotBus===undefined||s.requiredLanes===undefined||s.slotWidth===undefined||s.bracketWidth===undefined) add('warning','Card specifications incomplete',`Confirm bus, lanes, physical connector, bracket width and dimensions for ${c.name}.`); if(chassis?.specs.maxCardLengthMm===undefined||chassis.specs.maxCardHeightMm===undefined) add('warning','Chassis card clearance unknown',`Enter card length and height clearance for ${chassis?.name||'the chassis'}.`); if(s.lengthMm!==undefined&&chassis?.specs.maxCardLengthMm!==undefined&&s.lengthMm>chassis.specs.maxCardLengthMm) add('error','Card exceeds length clearance',`${c.name}: ${s.lengthMm} mm exceeds ${chassis.specs.maxCardLengthMm} mm.`); if(s.heightMm!==undefined&&chassis?.specs.maxCardHeightMm!==undefined&&s.heightMm>chassis.specs.maxCardHeightMm) add('error','Card exceeds height clearance',`${c.name}: ${s.heightMm} mm exceeds ${chassis.specs.maxCardHeightMm} mm.`); }
  const candidates=(r:typeof instances[number])=> slots.filter(s=>(!r.p.slotId||r.p.slotId===s.id)&&s.bus===r.c.specs.slotBus&&(!r.c.specs.bifurcationMode||!s.bifurcationModes||s.bifurcationModes.includes(r.c.specs.bifurcationMode))&&(s.bus==='PCI' ? ((!s.pciVoltage||!r.c.specs.pciVoltage||s.pciVoltage==='universal'||r.c.specs.pciVoltage==='universal'||s.pciVoltage===r.c.specs.pciVoltage)&&(!s.pciBits||!r.c.specs.pciBits||s.pciBits>=r.c.specs.pciBits)) : (s.physical>=(r.c.specs.slotWidth||1)&&s.lanes>=(r.c.specs.requiredLanes||1)&&s.generation>=(r.c.specs.minGeneration||1)))&&(chassis?.specs.rearSlots===undefined||s.position+(r.c.specs.bracketWidth||1)-1<=chassis.specs.rearSlots));
  const ordered=[...instances].sort((a,b)=>candidates(a).length-candidates(b).length);
  // Backtracking prevents a small auto-assigned card from stealing the only suitable x16 slot.
  let attempts=0;
  function assign(i:number,occupied:Set<number>):boolean { if(++attempts>20000)return false;if(i===ordered.length) {
      for(const rule of board?.specs.laneRules || []) {
        const active=instances.filter(r=>rule.slots.includes(slotAssignments[r.key]));
        if(rule.exclusive&&active.length>1)return false;
        if(rule.maxLanes!==undefined&&active.reduce((n,r)=>n+(r.c.specs.requiredLanes||1),0)>rule.maxLanes)return false;
      }
      const activeRules=(board?.specs.laneRules||[]).filter(rule=>instances.some(r=>rule.slots.includes(slotAssignments[r.key])));
      const m2Used=rows.filter(r=>r.c.category==='Drive'&&r.c.specs.driveSize==='M.2'&&r.p.mount!=='rear-sled').reduce((n,r)=>n+r.p.quantity,0);
      const sataUsed=rows.filter(r=>r.c.category==='Drive'&&r.c.specs.driveInterface==='SATA'&&!rows.some(controller=>controller.p.id===r.p.controllerPlacementId&&controller.c.category==='Storage adapter')).reduce((n,r)=>n+r.p.quantity,0);
      if(activeRules.length&&board?.specs.m2Slots!==undefined&&m2Used>Math.max(0,board.specs.m2Slots-activeRules.reduce((n,r)=>n+(r.disableM2Slots||0),0)))return false;
      if(activeRules.length&&board?.specs.sataPorts!==undefined&&sataUsed>Math.max(0,board.specs.sataPorts-activeRules.reduce((n,r)=>n+(r.disableSataPorts||0),0)))return false;
      return true;
    } const r=ordered[i]; for(const s of candidates(r)){ const positions=Array.from({length:r.c.specs.bracketWidth||1},(_,j)=>s.position+j); if(positions.some(p=>occupied.has(p)))continue; slotAssignments[r.key]=s.id; if(assign(i+1,new Set([...occupied,...positions])))return true; delete slotAssignments[r.key]; } return false; }
  if(instances.length>32) add('error','Too many expansion cards','A single PC supports at most 32 card instances in this planner.');
  else if(!assign(0,new Set())) { for(const r of instances) if(!candidates(r).length) add('error','No compatible expansion slot',`${r.c.name}: needs ${r.c.specs.slotBus||'an unspecified bus'} x${r.c.specs.slotWidth||'?'} with ${r.c.specs.requiredLanes||'?'} lanes${r.p.slotId?` in ${r.p.slotId}`:''}.`); add('error','Expansion slots cannot be allocated',attempts>20000?'Allocation search limit reached. Reserve specific slots to reduce the search space.':'Cards compete for slots or adjacent rear brackets. Move/remove cards or select a different motherboard.'); }
  else if(instances.length) add('pass','Expansion cards allocated',`${instances.length} cards fit the declared slots and rear bracket positions.`);
  for(const r of instances) {
    const slot=slots.find(s=>s.id===slotAssignments[r.key]);
    if(r.c.specs.slotBus==='PCI'&&(!r.c.specs.pciVoltage||!slot?.pciVoltage||!r.c.specs.pciBits||!slot?.pciBits)) add('warning','PCI electrical compatibility unknown',`${r.c.name}: enter card and slot voltage/keying and 32/64-bit requirements.`);
    if(r.c.specs.requiresBifurcation||r.c.specs.bifurcationMode) {
      if(!r.c.specs.bifurcationMode) add('warning','Bifurcation mode unknown',`${r.c.name}: enter the required lane split, such as x4/x4/x4/x4, and slot-specific supported modes.`);
      else if(!slot?.bifurcationModes)add('warning','Slot bifurcation support unknown',`${r.c.name}: verify ${slot?.id||'assigned slot'} supports ${r.c.specs.bifurcationMode}.`);
      else if(!slot.bifurcationModes.includes(r.c.specs.bifurcationMode))add('error','Slot bifurcation mismatch',`${r.c.name}: ${slot.id} does not support ${r.c.specs.bifurcationMode}.`);
    }
  }
  for(const {c} of rows) {
    if(c.specs.supportedOS) {
      if(!config.software?.os)add('warning','Operating system unrecorded',`${c.name}: choose an OS to check supported operating systems.`);
      else if(!c.specs.supportedOS.some(os=>os.toLowerCase()===config.software!.os!.toLowerCase()))add('error','Operating system unsupported',`${c.name} does not list ${config.software.os} as supported.`);
    }
    for(const [requirement,actual,label] of [[c.specs.requiredDriver,config.software?.drivers?.[c.id],'Driver'],[c.specs.requiredFirmware,config.software?.firmware?.[c.id],'Firmware']] as const) {
      if(requirement&&!actual)add('warning',`${label} unrecorded`,`${c.name}: record ${requirement} before commissioning.`);
      else if(requirement&&actual&&requirement.toLowerCase()!==actual.toLowerCase())add('error',`${label} requirement mismatch`,`${c.name}: requires ${requirement}; recorded ${actual}.`);
    }
  }
  resource('Rear brackets',cards.reduce((n,r)=>n+(r.c.specs.bracketWidth||1)*r.p.quantity,0),chassis?.specs.rearSlots);
  if(cards.length) add('warning','Lane sharing and firmware review','Check motherboard lane-sharing tables, M.2/SATA disabling rules, scientific card drivers, OS support and required firmware. Declared lanes are assumed simultaneously available.');
  const system=db.systems.find(s=>s.id===config.systemId);
  if(!system) add('warning','No equipment system linked','Link equipment to check USB and Ethernet requirements.');
  else for(const port of ['usbA','usbC','ethernet'] as const) { const used=system.connections.reduce((n,c)=>n+Math.max(c[port],(c.requirements||[]).filter(r=>r.kind===({usbA:'USB-A',usbC:'USB-C',ethernet:'Ethernet'} as const)[port]).reduce((q,r)=>q+r.quantity,0)),0); const kind=({usbA:'USB-A',usbC:'USB-C',ethernet:'Ethernet'} as const)[port]; const suppliers=rows.filter(r=>r.c.category!=='Chassis'); const known=board?.specs[port]!==undefined||board?.specs.ports!==undefined; const available=suppliers.reduce((n,r)=>n+Math.max(r.c.specs[port]||0,r.c.specs.ports?.filter(p=>p.kind===kind).length||0)*r.p.quantity,0); resource(({usbA:'USB-A ports',usbC:'USB-C ports',ethernet:'Ethernet ports'})[port],used,known?available:undefined); }
  const occupiedPorts=new Set<string>();
  for(const mapping of config.portMappings || []) {
    const connection=system?.connections.find(c=>c.id===mapping.connectionId), requirement=connection?.requirements?.find(r=>r.id===mapping.requirementId);
    const row=rows.find(r=>r.p.id===mapping.placementId), port=row?.c.specs.ports?.find(p=>p.id===mapping.portId);
    if(!requirement||!row||!port||mapping.instance<0||mapping.instance>=row.p.quantity||!Number.isInteger(mapping.instance)) { add('error','Invalid equipment port mapping','A connection, requirement, component instance or port no longer exists.');continue; }
    const key=`${mapping.placementId}:${mapping.instance}:${mapping.portId}`;
    if(occupiedPorts.has(key))add('error','Equipment port double booked',`${connection!.name}: port ${mapping.portId} is assigned more than once.`);
    occupiedPorts.add(key);
    if(port.kind!==requirement.kind)add('error','Equipment connector mismatch',`${connection!.name}: ${requirement.kind} requires a matching port; mapped ${port.kind}.`);
    for(const [needed,actual,label] of [[requirement.minSpeedMbps,port.speedMbps,'speed (Mbps)'],[requirement.minPowerW,port.powerW,'power (W)']] as const)if(needed!==undefined){if(actual===undefined)add('warning','Equipment port capability unknown',`${connection!.name}: verify ${label} on ${port.id}.`);else if(actual<needed)add('error','Equipment port capability insufficient',`${connection!.name}: ${port.id} provides ${actual} ${label}, needs ${needed}.`);}
    if(requirement.protocol){if(!port.protocol)add('warning','Equipment protocol unknown',`${connection!.name}: verify ${requirement.protocol} on ${port.id}.`);else if(port.protocol.toLowerCase()!==requirement.protocol.toLowerCase())add('error','Equipment protocol mismatch',`${connection!.name}: requires ${requirement.protocol}, mapped ${port.protocol}.`);}
    if(requirement.isolated){if(port.isolated===undefined)add('warning','Equipment isolation unknown',`${connection!.name}: verify isolation on ${port.id}.`);else if(!port.isolated)add('error','Equipment isolation missing',`${connection!.name}: ${port.id} is not isolated.`);}
  }
  for(const connection of system?.connections || [])for(const requirement of connection.requirements || []) {
    const mapped=(config.portMappings||[]).filter(m=>m.connectionId===connection.id&&m.requirementId===requirement.id).length;
    if(mapped<requirement.quantity)add('warning','Equipment ports not mapped',`${connection.name}: map ${requirement.quantity-mapped} additional ${requirement.kind} ports for ${requirement.id}.`);
    if(mapped>requirement.quantity)add('error','Equipment mapping count exceeded',`${connection.name}: ${mapped} ports mapped for ${requirement.quantity} required.`);
  }
  if(system) add('warning','Connection performance review','Port counts do not establish USB bandwidth, power, connector protocol, Ethernet speed, real-time latency or isolation. Confirm each instrument specification.');
  const drives=of('Drive'); let internal25=0,internal35=0,front=0,sata=0,m2=0,rear=0;
  const sleds=of('Storage adapter');
  for(const {p,c} of drives) {
    const s=c.specs;
    if(!s.driveInterface||!s.driveSize||s.capacityGb===undefined) add('warning','Drive specifications incomplete',`Enter interface, size and capacity for ${c.name}.`);
    if(p.mount==='rear-sled') { rear+=p.quantity; if(s.driveInterface!=='NVMe'||s.driveSize!=='M.2') add('error','Rear sled drive mismatch',`${c.name}: this planner's rear sleds accept M.2 NVMe drives.`); }
    else if(s.driveSize==='M.2') { m2+=p.quantity; if(p.mount==='front-hot-swap') add('error','M.2 front bay unsupported','Front bays are modeled for SATA 2.5/3.5 inch drives. U.2/U.3 needs a separately verified adapter/backplane.'); if(s.m2Length!==undefined&&board?.specs.m2Lengths&&!board.specs.m2Lengths.includes(s.m2Length)) add('error','M.2 length unsupported',`${c.name}: ${s.m2Length} mm is not supported.`); if(s.driveInterface!=='NVMe') add('warning','M.2 protocol review','Board M.2 slots are modeled as NVMe. Verify support for SATA M.2 manually.'); }
    else if(p.mount==='front-hot-swap') { front+=p.quantity; if(s.driveInterface!=='SATA') add('error','Front bay interface mismatch','Declared front hot-swap bays support SATA drives only.'); }
    else { if(s.driveSize==='2.5')internal25+=p.quantity; else if(s.driveSize==='3.5')internal35+=p.quantity; }
    if(s.driveInterface==='SATA')sata+=p.quantity;
  }
  const occupiedTargets=new Set<string>();
  for(const {p,c} of drives) {
    const provider=p.adapterPlacementId?rows.find(r=>r.p.id===p.adapterPlacementId):rows.find(r=>r.c.category===(p.mount==='front-hot-swap'||c.specs.driveSize!=='M.2'?'Chassis':'Motherboard'));
    if(p.adapterPlacementId&&!provider)add('error','Drive adapter missing',`${c.name}: selected target provider no longer exists.`);
    if(provider&&provider.p.quantity!==1&&(p.targetId||p.adapterPlacementId))add('error','Ambiguous drive adapter instance',`${c.name}: split ${provider.c.name} into individual placements before binding drives.`);
    if(p.targetId) {
      const target=provider?.c.specs.driveTargets?.find(t=>t.id===p.targetId);
      if(!target)add('error','Drive target missing',`${c.name}: target ${p.targetId} is absent on the selected provider.`);
      else {
        const key=`${provider!.p.id}:${target.id}`;
        if(p.quantity!==1||occupiedTargets.has(key))add('error','Drive target double booked',`${target.id} accepts one individually recorded drive.`);
        occupiedTargets.add(key);
        if(p.mount!=='auto'&&target.mount!==p.mount)add('error','Drive mount mismatch',`${c.name}: ${target.id} is ${target.mount}, not ${p.mount}.`);
        if(!target.driveSizes||!target.interfaces||!c.specs.driveSize||!c.specs.driveInterface)add('warning','Drive target fit unconfirmed',`${c.name}: record supported target sizes/interfaces and drive specifications for ${target.id}.`);
        if(c.specs.driveSize==='M.2'&&(!target.m2Lengths||c.specs.m2Length===undefined))add('warning','Drive target length unknown',`${c.name}: verify target ${target.id} accepts the actual M.2 drive length.`);
        if(p.role==='boot'&&target.bootable===undefined)add('warning','Drive target boot support unknown',`${c.name}: verify boot support at ${target.id}.`);
        if(target.driveSizes&&c.specs.driveSize&&!target.driveSizes.includes(c.specs.driveSize))add('error','Drive target size mismatch',`${c.name}: ${target.id} does not accept ${c.specs.driveSize}.`);
        if(target.interfaces&&c.specs.driveInterface&&!target.interfaces.includes(c.specs.driveInterface))add('error','Drive target interface mismatch',`${c.name}: ${target.id} does not accept ${c.specs.driveInterface}.`);
        if(target.m2Lengths&&c.specs.m2Length!==undefined&&!target.m2Lengths.includes(c.specs.m2Length))add('error','Drive target length mismatch',`${c.name}: ${target.id} does not accept ${c.specs.m2Length} mm.`);
        if(p.role==='boot'&&target.bootable===false)add('error','Drive target cannot boot',`${c.name}: ${target.id} is not bootable.`);
        if(p.mount==='front-hot-swap'&&target.hotSwap!==true)add(target.hotSwap===false?'error':'warning','Drive target hot-swap unconfirmed',`${target.id}: verify live removal support.`);
      }
    }else if(p.mount==='rear-sled'||p.mount==='front-hot-swap')add('warning','Individual drive target unrecorded',`${c.name}: bind each drive to a specific sled or bay for servicing.`);
    if(p.adapterPlacementId&&provider?.c.category==='Storage adapter') {
      if(p.mount!=='rear-sled')add('warning','Drive adapter routing review',`${c.name}: selected adapter is recorded but confirm controller routing and mount.`);
      if(p.role==='boot'&&provider.c.specs.bootable===false)add('error','Storage adapter cannot boot',`${provider.c.name} does not support boot drives.`);
    }
    if(p.controllerPlacementId) {
      const controller=rows.find(r=>r.p.id===p.controllerPlacementId);
      if(!controller||!['Motherboard','Storage adapter'].includes(controller.c.category))add('error','Drive controller missing',`${c.name}: bind an installed motherboard or storage controller.`);
      else if(p.role==='boot'&&controller.c.specs.bootable===false)add('error','Storage controller cannot boot',`${controller.c.name} does not support boot drives.`);
      else if(p.mount==='front-hot-swap'&&controller.c.specs.hotPlug===false)add('error','Storage controller hot-plug unsupported',`${controller.c.name} cannot support the declared front hot-swap drive.`);
    }
  }
  let disabledM2=0,disabledSata=0;
  for(const rule of board?.specs.laneRules||[])if(instances.some(r=>rule.slots.includes(slotAssignments[r.key]))) {disabledM2+=rule.disableM2Slots||0;disabledSata+=rule.disableSataPorts||0;}
  const declaredTargets=(category:string,mount:Placement['mount'])=>rows.filter(r=>r.c.category===category).reduce((n,r)=>n+(r.c.specs.driveTargets||[]).filter(t=>t.mount===mount).length*r.p.quantity,0);
  const controllerSata=new Map<string,number>(), adapterDrives=new Map<string,number>();
  for(const {p,c} of drives) {
    if(p.adapterPlacementId)adapterDrives.set(p.adapterPlacementId,(adapterDrives.get(p.adapterPlacementId)||0)+p.quantity);
    const controller=rows.find(r=>r.p.id===p.controllerPlacementId);
    if(c.specs.driveInterface==='SATA'&&controller?.c.category==='Storage adapter') {sata-=p.quantity;controllerSata.set(controller.p.id,(controllerSata.get(controller.p.id)||0)+p.quantity);}
  }
  for(const [controllerId,used] of controllerSata) {const controller=rows.find(r=>r.p.id===controllerId)!;resource(`SATA controller ${controller.c.name}`,used,controller.c.specs.sataPorts);}
  for(const [adapterId,used] of adapterDrives) {const adapter=rows.find(r=>r.p.id===adapterId);if(adapter?.c.category==='Storage adapter')resource(`Adapter ${adapter.c.name} drive positions`,used,adapter.c.specs.sledDrives??adapter.c.specs.driveTargets?.length);}
  resource('Internal 2.5-inch bays',internal25,chassis?.specs.bays25); resource('Internal 3.5-inch bays',internal35,chassis?.specs.bays35); resource('Front hot-swap bays',front,chassis?.specs.hotSwapBays??(chassis?.specs.driveTargets?declaredTargets('Chassis','front-hot-swap'):undefined)); resource('SATA ports',sata,board?.specs.sataPorts===undefined?undefined:Math.max(0,board.specs.sataPorts-disabledSata)); resource('SATA power plugs',drives.filter(r=>r.c.specs.driveInterface==='SATA').reduce((n,r)=>n+r.p.quantity,0),psu?.specs.sataPower); resource('Onboard M.2 slots',m2,board?.specs.m2Slots===undefined?undefined:Math.max(0,board.specs.m2Slots-disabledM2)); resource('Rear sled positions',rear,sleds.reduce((n,r)=>n+(r.c.specs.sledDrives??r.c.specs.driveTargets?.filter(t=>t.mount==='rear-sled').length??0)*r.p.quantity,0));
  for(const {p,c} of sleds) { const assigned=slots.find(s=>s.id===slotAssignments[`${p.id}:0`]); if(c.specs.requiresBifurcation&&!assigned?.bifurcationModes&&!board?.specs.bifurcation) add(board?.specs.bifurcation===false?'error':'warning','PCIe bifurcation required',`${c.name} requires motherboard firmware support for lane splitting.`); if(rear>0&&!c.specs.sledHotSwap) add('warning','Rear sled is not declared hot-swappable',`${c.name}: shut down before servicing unless the vendor explicitly supports live removal.`); }
  if(front>0)add('warning','Hot-swap backplane review','Verify backplane drive size, controller hot-plug support and power connections. Front bays are counted separately from internal bays.');
  const unknownPower=rows.filter(r=>!['Chassis','PSU'].includes(r.c.category)&&r.c.specs.powerW===undefined);
  if(unknownPower.length)add('warning','Power estimate incomplete',`Missing draw for ${unknownPower.map(r=>r.c.name).join(', ')}.`);
  const draw=rows.reduce((n,r)=>n+(r.c.specs.powerW||0)*r.p.quantity,0); resource('Power with 25% headroom',Math.ceil(draw*1.25),psu?.specs.capacityW,' W');
  add('warning','Power connectors and cooling review','Confirm GPU/CPU power plugs, PSU form factor, cooler thermal rating and chassis airflow. Wattage alone does not establish compatibility.');
  const boot=drives.filter(r=>r.p.role==='boot'), data=drives.filter(r=>r.p.role==='data');
  const capacities=(rs:typeof drives)=>rs.flatMap(r=>Array(r.p.quantity).fill(r.c.specs.capacityGb||0) as number[]);
  const boots=capacities(boot), datas=capacities(data);
  if(!boots.length)add('warning','Boot drive missing','Assign at least one drive the boot role.');
  if(config.storage.bootMirror&&boots.length!==2)add('error','Boot mirror needs two drives',`${boots.length} boot drives selected; a mirrored boot pair needs exactly two.`);
  const groups: StorageGroup[] = config.storage.groups || [];
  const storageGroups: NonNullable<Report['storageGroups']> = [];
  function capacityGroup(id:string,name:string,raid:StorageGroup['raid'],members:typeof drives) {
    const sizes=capacities(members),n=sizes.length,smallest=n?Math.min(...sizes):0;
    let usableGb=sizes.reduce((a,b)=>a+b,0);
    if(raid!=='none') {
      const valid=raid==='mirror'?n===2:raid==='raid5'?n>=3:raid==='raid6'?n>=4:n>=4&&n%2===0;
      if(!valid)add('error','Invalid data redundancy layout',`${name}: ${raid} requires ${raid==='mirror'?'exactly 2':raid==='raid5'?'at least 3':raid==='raid6'?'at least 4':'an even number of at least 4'} data drives; ${n} selected.`);
      usableGb=valid?smallest*(raid==='mirror'?1:raid==='raid5'?n-1:raid==='raid6'?n-2:n/2):0;
      if(new Set(sizes).size>1)add('warning','Mixed drive capacities',`${name}: usable capacity uses the smallest member.`);
      add('warning','RAID implementation review',`${name}: verify software/hardware RAID, recovery and backups.`);
    }
    storageGroups.push({id,name,raid,driveCount:n,usableGb});return usableGb;
  }
  let usableDataGb=0;
  if(groups.length) {
    for(const group of groups) {
      const members=data.filter(r=>r.p.group===group.id);
      usableDataGb+=capacityGroup(group.id,group.name,group.raid,members);
      if(group.controllerPlacementId&&!rows.some(r=>r.p.id===group.controllerPlacementId&&['Motherboard','Storage adapter'].includes(r.c.category)))add('error','Storage group controller missing',`${group.name}: select a motherboard or storage adapter.`);
    }
    const ungrouped=data.filter(r=>!r.p.group);
    if(ungrouped.length)usableDataGb+=capacityGroup('default','Default data array',config.storage.raid,ungrouped);
    if(data.some(r=>r.p.group&&!groups.some(g=>g.id===r.p.group)))add('error','Data drive group missing','A data drive names a storage group that no longer exists.');
  }else usableDataGb=capacityGroup('default','Data',config.storage.raid,data);
  if(!config.storage.bootMirror&&boots.length>1)add('warning','Multiple unmirrored boot drives','Confirm intended boot selection or enable a boot mirror.');
  const bootGb=config.storage.bootMirror?(boots.length===2?Math.min(...boots):0):boots.reduce((a,b)=>a+b,0);
  return {findings,resources,status:findings.some(f=>f.severity==='error')?'Conflicts':findings.some(f=>f.severity==='warning')?'Needs review':'Compatible',usableDataGb,bootGb,slotAssignments,storageGroups};
}
