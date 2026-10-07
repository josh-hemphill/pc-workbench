import type { Configuration, Database, Finding, Report, Resource, Component, Placement } from './types';

/** Deterministic planning checks. Manufacturer-specific lane sharing and firmware are manual checks. */
export function checkConfiguration(config: Configuration, db: Database): Report {
  const findings: Finding[] = [], resources: Resource[] = [], slotAssignments: Record<string,string> = {};
  const add = (severity: Finding['severity'],title:string,detail:string) => findings.push({severity,title,detail});
  const rows: {p:Placement;c:Component}[] = [];
  for(const p of config.placements) { if(!Number.isInteger(p.quantity)||p.quantity<1||p.quantity>32){add('error','Invalid component quantity','Enter a whole number from 1 to 32 for each component.');continue;}const c = db.components.find(c=>c.id===p.componentId); if(c) rows.push({p,c}); else add('error','Missing component',`Catalog entry ${p.componentId} no longer exists.`); }
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
  const candidates=(r:typeof instances[number])=> slots.filter(s=>(!r.p.slotId||r.p.slotId===s.id)&&s.bus===r.c.specs.slotBus&&(s.bus==='PCI'||(s.physical>=(r.c.specs.slotWidth||1)&&s.lanes>=(r.c.specs.requiredLanes||1)&&s.generation>=(r.c.specs.minGeneration||1)))&&(chassis?.specs.rearSlots===undefined||s.position+(r.c.specs.bracketWidth||1)-1<=chassis.specs.rearSlots));
  const ordered=[...instances].sort((a,b)=>candidates(a).length-candidates(b).length);
  // Backtracking prevents a small auto-assigned card from stealing the only suitable x16 slot.
  let attempts=0;
  function assign(i:number,occupied:Set<number>):boolean { if(++attempts>20000)return false;if(i===ordered.length)return true; const r=ordered[i]; for(const s of candidates(r)){ const positions=Array.from({length:r.c.specs.bracketWidth||1},(_,j)=>s.position+j); if(positions.some(p=>occupied.has(p)))continue; slotAssignments[r.key]=s.id; if(assign(i+1,new Set([...occupied,...positions])))return true; delete slotAssignments[r.key]; } return false; }
  if(instances.length>32) add('error','Too many expansion cards','A single PC supports at most 32 card instances in this planner.');
  else if(!assign(0,new Set())) { for(const r of instances) if(!candidates(r).length) add('error','No compatible expansion slot',`${r.c.name}: needs ${r.c.specs.slotBus||'an unspecified bus'} x${r.c.specs.slotWidth||'?'} with ${r.c.specs.requiredLanes||'?'} lanes${r.p.slotId?` in ${r.p.slotId}`:''}.`); add('error','Expansion slots cannot be allocated',attempts>20000?'Allocation search limit reached. Reserve specific slots to reduce the search space.':'Cards compete for slots or adjacent rear brackets. Move/remove cards or select a different motherboard.'); }
  else if(instances.length) add('pass','Expansion cards allocated',`${instances.length} cards fit the declared slots and rear bracket positions.`);
  resource('Rear brackets',cards.reduce((n,r)=>n+(r.c.specs.bracketWidth||1)*r.p.quantity,0),chassis?.specs.rearSlots);
  if(cards.length) add('warning','Lane sharing and firmware review','Check motherboard lane-sharing tables, M.2/SATA disabling rules, scientific card drivers, OS support and required firmware. Declared lanes are assumed simultaneously available.');
  const system=db.systems.find(s=>s.id===config.systemId);
  if(!system) add('warning','No equipment system linked','Link equipment to check USB and Ethernet requirements.');
  else for(const port of ['usbA','usbC','ethernet'] as const) { const used=system.connections.reduce((n,c)=>n+c[port],0); const known=board?.specs[port]!==undefined; const available=rows.filter(r=>r.c.category!=='Chassis').reduce((n,r)=>n+(r.c.specs[port]||0)*r.p.quantity,0); resource(({usbA:'USB-A ports',usbC:'USB-C ports',ethernet:'Ethernet ports'})[port],used,known?available:undefined); }
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
  resource('Internal 2.5-inch bays',internal25,chassis?.specs.bays25); resource('Internal 3.5-inch bays',internal35,chassis?.specs.bays35); resource('Front hot-swap bays',front,chassis?.specs.hotSwapBays); resource('SATA ports',sata,board?.specs.sataPorts); resource('SATA power plugs',sata,psu?.specs.sataPower); resource('Onboard M.2 slots',m2,board?.specs.m2Slots); resource('Rear sled positions',rear,sleds.reduce((n,r)=>n+(r.c.specs.sledDrives||0)*r.p.quantity,0));
  for(const {c} of sleds) { if(c.specs.requiresBifurcation&&!board?.specs.bifurcation) add(board?.specs.bifurcation===false?'error':'warning','PCIe bifurcation required',`${c.name} requires motherboard firmware support for lane splitting.`); if(rear>0&&!c.specs.sledHotSwap) add('warning','Rear sled is not declared hot-swappable',`${c.name}: shut down before servicing unless the vendor explicitly supports live removal.`); }
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
  let usableDataGb=datas.reduce((a,b)=>a+b,0);
  const raid=config.storage.raid, n=datas.length, smallest=n?Math.min(...datas):0;
  if(raid!=='none') { const valid=raid==='mirror'?n===2:raid==='raid5'?n>=3:raid==='raid6'?n>=4:n>=4&&n%2===0; if(!valid)add('error','Invalid data redundancy layout',`${raid} requires ${raid==='mirror'?'exactly 2':raid==='raid5'?'at least 3':raid==='raid6'?'at least 4':'an even number of at least 4'} data drives; ${n} selected.`); usableDataGb=valid?smallest*(raid==='mirror'?1:raid==='raid5'?n-1:raid==='raid6'?n-2:n/2):0; if(new Set(datas).size>1)add('warning','Mixed drive capacities','Redundant usable capacity is calculated using the smallest drive.'); add('warning','RAID implementation review','Select and verify software/hardware RAID support, boot recovery and backups. Redundancy does not replace a backup.'); }
  if(!config.storage.bootMirror&&boots.length>1)add('warning','Multiple unmirrored boot drives','Confirm intended boot selection or enable a boot mirror.');
  const bootGb=config.storage.bootMirror?(boots.length===2?Math.min(...boots):0):boots.reduce((a,b)=>a+b,0);
  return {findings,resources,status:findings.some(f=>f.severity==='error')?'Conflicts':findings.some(f=>f.severity==='warning')?'Needs review':'Compatible',usableDataGb,bootGb,slotAssignments};
}
