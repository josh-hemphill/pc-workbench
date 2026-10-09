import type {Component,Specs} from './types';
export type StorageAdapterKind='controller'|'pcie-sled'|'bay-cage'|'mount-adapter';
export const storageAdapterKinds=[{title:'SATA / storage controller',value:'controller'},{title:'PCIe NVMe sled',value:'pcie-sled'},{title:'Bay-mounted drive cage / backplane',value:'bay-cage'},{title:'Passive mounting adapter',value:'mount-adapter'}];
export function storageAdapterKind(component:Component):StorageAdapterKind|undefined {
 if(component.category!=='Storage adapter')return undefined;
 const specs=component.specs as Specs&{storageAdapterKind?:StorageAdapterKind};
 if(specs.storageAdapterKind)return specs.storageAdapterKind;
 if(specs.baySize||!specs.slotBus&&specs.driveTargets?.some(target=>target.mount==='front-hot-swap'))return 'bay-cage';
 if(specs.sledDrives!==undefined||specs.requiresBifurcation!==undefined||specs.driveTargets?.some(target=>target.mount==='rear-sled'))return 'pcie-sled';
 return 'controller';
}
export function componentCapabilities(component:Component) {
 const category=component.category,specs=component.specs as Specs&{driveKind?:'disk'|'optical'},adapter=storageAdapterKind(component);
 const optical=category==='Drive'&&(specs.driveKind?specs.driveKind==='optical':String(specs.driveSize)==='5.25');
 const slotCard=['GPU','Scientific card','Network card'].includes(category)||category==='Storage adapter'&&(adapter==='controller'||adapter==='pcie-sled');
 const software=['Motherboard','CPU','GPU','Scientific card','Network card','Drive'].includes(category)||category==='Storage adapter'&&adapter==='controller'||category==='Bay accessory'&&!!(specs.ports?.length||specs.requiredDriver||specs.requiredFirmware);
 return {adapter,optical,slotCard,pci:slotCard&&specs.slotBus==='PCI',pcie:slotCard&&specs.slotBus!=='PCI',software,
 ports:['Motherboard','GPU','Scientific card','Network card','Bay accessory'].includes(category)||category==='Storage adapter'&&adapter==='controller',
 driveTargets:category==='Chassis'||category==='Motherboard'||category==='Storage adapter',laneRules:category==='Motherboard',
 bayConsumer:category==='Bay accessory'||category==='Storage adapter'&&(adapter==='bay-cage'||adapter==='mount-adapter')||optical,
 bayProvider:category==='Chassis'||category==='Storage adapter'&&adapter==='mount-adapter',
 sataController:category==='Motherboard'||category==='Storage adapter'&&adapter==='controller',
 m2:category==='Drive'&&specs.driveSize==='M.2'&&!optical,nvmeSled:adapter==='pcie-sled',controller:category==='Motherboard'||adapter==='controller',
 };
}
/** Report retained records that this category-specific form deliberately leaves in JSON. */
export function retainedAdvancedFields(component:Component):string[] {
 const c=componentCapabilities(component),spec=component.specs,hidden:string[]=[];
 const hide=(allowed:boolean,keys:(keyof Specs)[])=>{if(!allowed)for(const key of keys)if(spec[key]!==undefined)hidden.push(key);};
 hide(component.category==='Chassis',['supportedForms','rearSlots','maxCardLengthMm','maxCardHeightMm','maxCoolerHeightMm','bays25','bays35','bays525','hotSwapBays']);
 hide(['CPU','Motherboard'].includes(component.category),['socket']);hide(['Memory','Motherboard'].includes(component.category),['memoryType']);hide(component.category==='Motherboard',['slots','dimmSlots','maxMemoryGb','m2Slots','m2Lengths','bifurcation']);
 hide(c.sataController,['sataPorts']);hide(component.category==='PSU',['sataPower','capacityW']);hide(component.category==='Cooler',['supportsSockets']);hide(component.category==='Drive',['driveInterface','driveSize']);hide(component.category==='Memory'||component.category==='Drive'&&!c.optical,['capacityGb']);
 hide(c.slotCard,['slotBus','slotWidth','requiredLanes','minGeneration','bracketWidth']);hide(c.slotCard&&!c.pci,['slotWidth','requiredLanes','minGeneration']);hide(c.pci,['pciVoltage','pciBits']);hide(c.nvmeSled,['sledDrives','requiresBifurcation','sledHotSwap','bifurcationMode']);
 hide(c.software,['supportedOS','requiredDriver','requiredFirmware']);hide(c.ports,['ports']);hide(c.driveTargets,['driveTargets']);hide(c.laneRules,['laneRules']);hide(c.controller,['bootable','hotPlug']);hide(c.bayConsumer,['baySize','bayUnits']);hide(c.bayProvider,['bayTargets']);hide(c.m2,['m2Length']);
 return hidden;
}
