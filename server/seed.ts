import type { Component, Configuration, Database } from '../shared/types';
const part=(id:string,name:string,category:Component['category'],specs:Component['specs'],manufacturer='Example specification'):Component=>({id,name,category,manufacturer,specs,source:'Illustrative planning data — replace with verified manufacturer specifications',verified:false});
export const seed:Database={
 requirementsSets:[],installationLocations:[],
 components:[
  part('case-tower','Research tower · 6-bay','Chassis',{supportedForms:['ATX','Micro-ATX'],rearSlots:7,maxCardLengthMm:330,maxCardHeightMm:140,maxCoolerHeightMm:170,bays25:2,bays35:2,hotSwapBays:4,lengthMm:510,heightMm:460,widthMm:230}),
  part('case-compact','Compact instrument chassis','Chassis',{supportedForms:['Micro-ATX'],rearSlots:4,maxCardLengthMm:240,maxCardHeightMm:120,maxCoolerHeightMm:130,bays25:2,bays35:1,hotSwapBays:0,lengthMm:360,heightMm:310,widthMm:185}),
  part('board-atx','ATX workstation board · AM5','Motherboard',{socket:'AM5',formFactor:'ATX',memoryType:'DDR5',dimmSlots:4,maxMemoryGb:128,slots:[{id:'PCIE_1',bus:'PCIe',physical:16,lanes:16,generation:4,position:1},{id:'PCIE_2',bus:'PCIe',physical:16,lanes:8,generation:4,position:4},{id:'PCIE_3',bus:'PCIe',physical:4,lanes:4,generation:3,position:6}],usbA:8,usbC:2,ethernet:1,sataPorts:6,m2Slots:2,m2Lengths:[80],bifurcation:true,powerW:45}),
  part('board-compact','Micro-ATX control board · AM5','Motherboard',{socket:'AM5',formFactor:'Micro-ATX',memoryType:'DDR5',dimmSlots:2,maxMemoryGb:64,slots:[{id:'PCIE_1',bus:'PCIe',physical:16,lanes:16,generation:4,position:1},{id:'PCIE_2',bus:'PCIe',physical:4,lanes:4,generation:3,position:3}],usbA:4,usbC:1,ethernet:1,sataPorts:4,m2Slots:1,m2Lengths:[80],bifurcation:false,powerW:35}),
  part('cpu','8-core processor · AM5','CPU',{socket:'AM5',powerW:105}),
  part('ram','32 GB DDR5 module','Memory',{memoryType:'DDR5',capacityGb:32,powerW:8}),
  part('gpu','Compute GPU · PCIe x16','GPU',{slotBus:'PCIe',slotWidth:16,requiredLanes:8,minGeneration:3,bracketWidth:2,lengthMm:280,heightMm:120,powerW:200}),
  part('daq','Multifunction DAQ · PCIe x4','Scientific card',{slotBus:'PCIe',slotWidth:4,requiredLanes:4,minGeneration:2,bracketWidth:1,lengthMm:170,heightMm:110,powerW:20,notes:'Confirm acquisition software, driver and sampling requirements.'}),
  part('legacy','Legacy timing card · conventional PCI','Scientific card',{slotBus:'PCI',slotWidth:1,requiredLanes:1,minGeneration:1,bracketWidth:1,lengthMm:210,heightMm:107,powerW:15}),
  part('nic','Dual-port Ethernet adapter','Network card',{slotBus:'PCIe',slotWidth:4,requiredLanes:4,minGeneration:3,bracketWidth:1,lengthMm:140,heightMm:100,ethernet:2,powerW:12}),
  part('sled','Dual M.2 rear PCIe sled','Storage adapter',{slotBus:'PCIe',slotWidth:8,requiredLanes:8,minGeneration:3,bracketWidth:1,lengthMm:180,heightMm:110,sledDrives:2,requiresBifurcation:true,sledHotSwap:false,powerW:8}),
  part('nvme','1 TB NVMe · M.2 2280','Drive',{driveInterface:'NVMe',driveSize:'M.2',m2Length:80,capacityGb:1000,powerW:7}),
  part('ssd','2 TB SATA SSD · 2.5-inch','Drive',{driveInterface:'SATA',driveSize:'2.5',capacityGb:2000,powerW:5}),
  part('hdd','8 TB SATA HDD · 3.5-inch','Drive',{driveInterface:'SATA',driveSize:'3.5',capacityGb:8000,powerW:10}),
  part('psu','750 W modular PSU','PSU',{capacityW:750,sataPower:8,formFactor:'ATX'}),
  part('cooler','Low-profile air cooler','Cooler',{heightMm:115,supportsSockets:['AM5'],powerW:4}),
 ],
 systems:[
  {id:'microscope',name:'Microscopy & acquisition',location:'Imaging lab · bench 02',description:'Camera acquisition, stage motion and environmental control.',connections:[{id:'camera',name:'Scientific camera',usbA:1,usbC:0,ethernet:0,notes:'Dedicated USB 3 bus recommended'},{id:'stage',name:'Motorized stage',usbA:1,usbC:0,ethernet:1,notes:'Check isolated control network'},{id:'environment',name:'Environmental controller',usbA:1,usbC:0,ethernet:1,notes:''}]},
  {id:'test-rig',name:'Materials test rig',location:'Engineering lab · rig 04',description:'DAQ, load frame, thermal chamber and legacy trigger synchronization.',connections:[{id:'frame',name:'Load frame',usbA:2,usbC:0,ethernet:1,notes:''},{id:'thermal',name:'Thermal chamber',usbA:1,usbC:0,ethernet:1,notes:''},{id:'sensors',name:'USB sensor array',usbA:3,usbC:1,ethernet:0,notes:'Verify bus bandwidth and power'}]}
 ], configurations:[],pcs:[],inventory:[]
};
const placements=(entries:[string,number?,string?,string?][])=>entries.map(([componentId,quantity=1,role='general',mount='auto'],i)=>({id:`line-${i}`,componentId,quantity,slotId:'',role,mount,group:''})) as Configuration['placements'];
seed.configurations=[
 {id:'imaging',name:'Imaging workstation',description:'High-throughput acquisition with mirrored boot and data drives.',systemId:'microscope',status:'In review',updatedAt:'2026-10-07T09:30:00Z',placements:placements([['case-tower'],['board-atx'],['cpu'],['ram',2],['gpu'],['daq'],['nic'],['nvme',2,'boot'],['hdd',2,'data','front-hot-swap'],['psu'],['cooler']]),storage:{raid:'mirror',bootMirror:true},notes:'Example build. All catalog specifications require verification.'},
 {id:'controller',name:'Instrument controller',description:'Compact system for the materials test rig.',systemId:'test-rig',status:'Draft',updatedAt:'2026-10-06T15:00:00Z',placements:placements([['case-compact'],['board-compact'],['cpu'],['ram'],['legacy'],['nvme',1,'boot'],['ssd',1,'data','internal'],['psu'],['cooler']]),storage:{raid:'none',bootMirror:false},notes:'Example: exposes a conventional PCI incompatibility and missing instrument ports.'},
 {id:'archive',name:'Acquisition archive',description:'Rear NVMe sled and front serviceable data mirror.',systemId:'microscope',status:'Draft',updatedAt:'2026-10-05T11:00:00Z',placements:placements([['case-tower'],['board-atx'],['cpu'],['ram',2],['sled'],['nic'],['nvme',2,'boot','rear-sled'],['ssd',2,'data','front-hot-swap'],['psu'],['cooler']]),storage:{raid:'mirror',bootMirror:true},notes:'Example: verify bifurcation and boot support for the rear sled.'}
];
seed.pcs=[{id:'pc-01',name:'IMG-WS-01',serial:'EXAMPLE-001',location:'Imaging lab',configurationId:'imaging',notes:'Illustrative inventory record. Installed parts must be recorded separately.',buildSettings:{systemId:'microscope',storage:{raid:'mirror',bootMirror:true},notes:'Example planned boot and data mirrors'}}];
