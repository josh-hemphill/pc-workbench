import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../server/seed';
import { checkConfiguration } from '../shared/compatibility';
import { schemas } from '../server/schema';
const setup=()=>{const db=structuredClone(seed);return {db,config:db.configurations[0],board:db.components.find(c=>c.id==='board-atx')!};};
const errors=(r:ReturnType<typeof checkConfiguration>,title:string)=>r.findings.some(f=>f.severity==='error'&&f.title===title);
test('named storage arrays calculate independent capacity and reject unassigned drives',()=>{
 const {db,config}=setup();config.storage.groups=[{id:'acquisition',name:'Acquisition',raid:'mirror'},{id:'scratch',name:'Scratch',raid:'none'}];config.placements.find(p=>p.componentId==='hdd')!.group='acquisition';config.placements.push({id:'scratch-drive',componentId:'ssd',quantity:1,role:'data',mount:'internal',slotId:'',group:'scratch'});
 let r=checkConfiguration(config,db);assert.equal(r.usableDataGb,10000);assert.equal(r.storageGroups?.length,2);
 config.placements.find(p=>p.id==='scratch-drive')!.group='missing';r=checkConfiguration(config,db);assert.ok(errors(r,'Data drive group missing'));assert.equal(r.usableDataGb,8000);
});
test('individual front targets reject double occupancy, wrong size and unbootable targets',()=>{
 const {db,config}=setup();const chassis=db.components.find(c=>c.id==='chassis') || db.components.find(c=>c.category==='Chassis')!;
 chassis.specs.driveTargets=[{id:'bay1',mount:'front-hot-swap',driveSizes:['2.5'],interfaces:['SATA'],bootable:false,hotSwap:true}];const drive=config.placements.find(p=>p.componentId==='hdd')!;drive.targetId='bay1';drive.role='boot';
 const r=checkConfiguration(config,db);assert.ok(errors(r,'Drive target double booked'));assert.ok(errors(r,'Drive target size mismatch'));assert.ok(errors(r,'Drive target cannot boot'));
});
test('slot lane exclusivity forces alternative allocation and rejects fully pinned conflict',()=>{
 const {db,config,board}=setup();const gpu=config.placements.find(p=>p.componentId==='gpu')!,daq=config.placements.find(p=>p.componentId==='daq')!;
 board.specs.laneRules=[{id:'exclusive',slots:['PCIE_1','PCIE_2'],exclusive:true}];gpu.slotId='PCIE_1';daq.slotId='PCIE_2';assert.ok(errors(checkConfiguration(config,db),'Expansion slots cannot be allocated'));
});
test('structured port mapping checks bandwidth, protocol, isolation and double booking',()=>{
 const {db,config,board}=setup();const boardLine=config.placements.find(p=>p.componentId===board.id)!;board.specs.ports=[{id:'lan1',kind:'Ethernet',protocol:'Ethernet',speedMbps:100,isolated:false}];const conn=db.systems.find(s=>s.id===config.systemId)!.connections[0];conn.requirements=[{id:'capture',kind:'Ethernet',quantity:2,protocol:'EtherCAT',minSpeedMbps:1000,isolated:true}];config.portMappings=[{connectionId:conn.id,requirementId:'capture',placementId:boardLine.id,instance:0,portId:'lan1'},{connectionId:conn.id,requirementId:'capture',placementId:boardLine.id,instance:0,portId:'lan1'}];
 const r=checkConfiguration(config,db);for(const title of ['Equipment port double booked','Equipment port capability insufficient','Equipment protocol mismatch','Equipment isolation missing'])assert.ok(errors(r,title));
});
test('PCI voltage keying and 64 bit slot requirements are checked separately from PCIe',()=>{
 const {db,config,board}=setup();config.placements=config.placements.filter(p=>!['gpu','daq','nic'].includes(p.componentId));const card=db.components.find(c=>c.id==='daq')!;card.specs.slotBus='PCI';card.specs.pciVoltage='5V';card.specs.pciBits=64;board.specs.slots=[{id:'PCI1',bus:'PCI',physical:1,lanes:1,generation:1,position:1,pciVoltage:'3.3V',pciBits:32}];config.placements.push({id:'legacy',componentId:card.id,quantity:1,slotId:'PCI1',role:'general',mount:'auto',group:''});assert.ok(errors(checkConfiguration(config,db),'No compatible expansion slot'));
 board.specs.slots[0].pciVoltage='universal';board.specs.slots[0].pciBits=64;assert.ok(!errors(checkConfiguration(config,db),'No compatible expansion slot'));
});
test('scientific card software requirements distinguish unknown versions and known mismatches',()=>{
 const {db,config}=setup();const card=db.components.find(c=>c.id==='daq')!;card.specs.supportedOS=['Linux'];card.specs.requiredDriver='DAQ 3';card.specs.requiredFirmware='2.1';config.software={os:'Windows',drivers:{daq:'DAQ 2'}};let r=checkConfiguration(config,db);assert.ok(errors(r,'Operating system unsupported'));assert.ok(errors(r,'Driver requirement mismatch'));assert.ok(r.findings.some(f=>f.title==='Firmware unrecorded'&&f.severity==='warning'));
 config.software={os:'Linux',drivers:{daq:'DAQ 3'},firmware:{daq:'2.1'}};r=checkConfiguration(config,db);assert.ok(!r.findings.some(f=>['Operating system unsupported','Driver requirement mismatch','Firmware unrecorded'].includes(f.title)));
});
test('new schema fields remain optional for legacy records and preserve new engineering data',()=>{
 const {db,config}=setup();assert.ok(schemas.configurations.safeParse(config).success);assert.ok(schemas.pcs.safeParse(db.pcs[0]).success);config.storage.groups=[{id:'data',name:'Data',raid:'mirror'}];config.software={os:'Linux',drivers:{daq:'3'}};assert.deepEqual(schemas.configurations.parse(config).storage.groups,config.storage.groups);
});
test('slot-specific bifurcation supports a sled without a global board flag',()=>{
 const db=structuredClone(seed),config=db.configurations[2],board=db.components.find(c=>c.id==='board-atx')!,sled=db.components.find(c=>c.category==='Storage adapter')!;sled.specs.bifurcationMode='x4/x4';board.specs.bifurcation=false;for(const slot of board.specs.slots!)slot.bifurcationModes=['x4/x4'];
 let r=checkConfiguration(config,db);assert.ok(!errors(r,'PCIe bifurcation required'));assert.ok(!errors(r,'Slot bifurcation mismatch'));
 for(const slot of board.specs.slots!)slot.bifurcationModes=[];r=checkConfiguration(config,db);assert.ok(errors(r,'No compatible expansion slot'));
});
test('shared resources disabled by occupied slots reject an impossible drive/card combination',()=>{
 const {db,config,board}=setup();board.specs.laneRules=[{id:'shared-sata',slots:['PCIE_1','PCIE_2','PCIE_3'],disableSataPorts:6}];assert.ok(errors(checkConfiguration(config,db),'Expansion slots cannot be allocated'));
});
test('unknown individual drive target capabilities produce review warnings',()=>{
 const {db,config}=setup(),chassis=db.components.find(c=>c.category==='Chassis')!;chassis.specs.driveTargets=[{id:'bay',mount:'front-hot-swap'}];const drive=config.placements.find(p=>p.componentId==='hdd')!;drive.quantity=1;drive.targetId='bay';drive.role='boot';const report=checkConfiguration(config,db);assert.ok(report.findings.some(f=>f.severity==='warning'&&f.title==='Drive target fit unconfirmed'));assert.ok(report.findings.some(f=>f.severity==='warning'&&f.title==='Drive target boot support unknown'));
});
test('default array coexists with named arrays and missing group IDs reject',()=>{
 const {db,config}=setup();config.storage.groups=[{id:'scratch',name:'Scratch',raid:'none'}];config.placements.push({id:'scratch-extra',componentId:'ssd',quantity:1,slotId:'',role:'data',mount:'internal',group:'scratch'});let r=checkConfiguration(config,db);assert.equal(r.usableDataGb,10000);assert.ok(!errors(r,'Data drive group missing'));assert.equal(r.storageGroups?.length,2);config.placements.find(p=>p.id==='scratch-extra')!.group='deleted';r=checkConfiguration(config,db);assert.ok(errors(r,'Data drive group missing'));
});
test('equipment identifiers must be unique to avoid ambiguous port mappings',()=>{
 const {db,config}=setup();const system=db.systems.find(s=>s.id===config.systemId)!;system.connections.push(structuredClone(system.connections[0]));assert.ok(!schemas.systems.safeParse(system).success);system.connections.pop();system.connections[0].requirements=[{id:'duplicate',kind:'USB-A',quantity:1},{id:'duplicate',kind:'USB-C',quantity:1}];assert.ok(!schemas.systems.safeParse(system).success);
});
test('automatic mount uses bound rear target without consuming onboard M2',()=>{
 const db=structuredClone(seed),config=db.configurations[2],board=db.components.find(c=>c.id==='board-atx')!,sledLine=config.placements.find(p=>db.components.find(c=>c.id===p.componentId)?.category==='Storage adapter')!,sled=db.components.find(c=>c.id===sledLine.componentId)!;board.specs.m2Slots=0;sled.specs.driveTargets=[{id:'rear1',mount:'rear-sled',driveSizes:['M.2'],interfaces:['NVMe'],m2Lengths:[80]}];const nvme=config.placements.find(p=>p.componentId==='nvme')!;nvme.quantity=1;nvme.mount='auto';nvme.adapterPlacementId=sledLine.id;nvme.targetId='rear1';const r=checkConfiguration(config,db);assert.ok(!errors(r,'Onboard M.2 slots capacity exceeded'));assert.equal(r.resources.find(r=>r.name==='Rear sled positions')?.used,1);assert.equal(nvme.mount,'auto');
});
test('topology rules cannot silently reference nonexistent slots',()=>{
 const {board}=setup();board.specs.laneRules=[{id:'missing',slots:['NOT_PRESENT']}];assert.ok(!schemas.components.safeParse(board).success);
});
test('partial explicit port catalog preserves aggregate counts without double counting',()=>{
 const {db,config,board}=setup();board.specs.ports=[{id:'LAN1',kind:'Ethernet'}];const r=checkConfiguration(config,db);assert.equal(r.resources.find(r=>r.name==='USB-A ports')?.available,board.specs.usbA);assert.ok(!errors(r,'USB-A ports capacity exceeded'));assert.equal(r.resources.find(r=>r.name==='Ethernet ports')?.available,(board.specs.ethernet||0)+(db.components.find(c=>c.id==='nic')!.specs.ethernet||0));
});
