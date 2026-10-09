import {test} from 'node:test';
import assert from 'node:assert/strict';
import {categories} from '../shared/types';
import type {Component, Category, Specs} from '../shared/types';
import {componentCapabilities,storageAdapterKind,retainedAdvancedFields} from '../shared/component-capabilities';
const part=(category:Category,specs:Specs={}):Component=>({id:'test',name:'Test component',category,manufacturer:'',source:'',verified:false,specs});
test('all twelve categories expose relevant provider, software and motherboard sections',()=>{
 const expected:Record<Category,{ports:boolean;software:boolean;targets:boolean;slot:boolean}>={
 Chassis:{ports:false,software:false,targets:true,slot:false},Motherboard:{ports:true,software:true,targets:true,slot:false},CPU:{ports:false,software:true,targets:false,slot:false},Memory:{ports:false,software:false,targets:false,slot:false},GPU:{ports:true,software:true,targets:false,slot:true},'Scientific card':{ports:true,software:true,targets:false,slot:true},'Network card':{ports:true,software:true,targets:false,slot:true},'Storage adapter':{ports:true,software:true,targets:true,slot:true},'Bay accessory':{ports:true,software:false,targets:false,slot:false},Drive:{ports:false,software:true,targets:false,slot:false},PSU:{ports:false,software:false,targets:false,slot:false},Cooler:{ports:false,software:false,targets:false,slot:false}};
 assert.equal(categories.length,12);for(const category of categories){const c=componentCapabilities(part(category)),e=expected[category];assert.equal(c.ports,e.ports,`${category} ports`);assert.equal(c.software,e.software,`${category} software`);assert.equal(c.driveTargets,e.targets,`${category} targets`);assert.equal(c.slotCard,e.slot,`${category} slot`);assert.equal(c.laneRules,category==='Motherboard');}
});
test('legacy and explicit adapter roles distinguish passive cages, mounting adapters, controllers and PCIe sleds',()=>{
 assert.equal(storageAdapterKind(part('Storage adapter',{baySize:'5.25'})),'bay-cage');assert.equal(storageAdapterKind(part('Storage adapter',{sledDrives:2})),'pcie-sled');assert.equal(storageAdapterKind(part('Storage adapter',{slotBus:'PCIe',sataPorts:4})),'controller');
 for(const storageAdapterKind of ['controller','pcie-sled','bay-cage','mount-adapter'] as const){const c=componentCapabilities(part('Storage adapter',{storageAdapterKind,baySize:'5.25',slotBus:'PCIe'}));assert.equal(c.adapter,storageAdapterKind);assert.equal(c.slotCard,['controller','pcie-sled'].includes(storageAdapterKind));assert.equal(c.sataController,storageAdapterKind==='controller');assert.equal(c.nvmeSled,storageAdapterKind==='pcie-sled');assert.equal(c.bayConsumer,['bay-cage','mount-adapter'].includes(storageAdapterKind));}
});
test('conventional PCI presents voltage and connector bits while PCIe presents electrical lanes',()=>{
 const pci=componentCapabilities(part('Scientific card',{slotBus:'PCI'})),pcie=componentCapabilities(part('Scientific card',{slotBus:'PCIe'}));assert.equal(pci.pci,true);assert.equal(pci.pcie,false);assert.equal(pcie.pci,false);assert.equal(pcie.pcie,true);
 assert.equal(componentCapabilities(part('Memory',{slotBus:'PCI'})).pci,false);
});
test('optical drives consume mounting bays but have no RAID capacity and M.2 disks expose length',()=>{
 const optical=componentCapabilities(part('Drive',{driveKind:'optical',driveSize:'5.25',capacityGb:10}));assert.equal(optical.optical,true);assert.equal(optical.bayConsumer,true);assert.equal(optical.m2,false);assert.ok(retainedAdvancedFields(part('Drive',{driveKind:'optical',capacityGb:10})).includes('capacityGb'));
 assert.equal(componentCapabilities(part('Drive',{driveKind:'disk',driveSize:'5.25'})).optical,false);
 assert.equal(componentCapabilities(part('Drive',{driveInterface:'SATA',driveSize:'2.5'})).m2,false);assert.equal(componentCapabilities(part('Drive',{driveInterface:'SATA',driveSize:'M.2'})).m2,true);assert.equal(componentCapabilities(part('Drive',{driveInterface:'NVMe',driveSize:'M.2'})).m2,true);
});
test('category and role changes retain incompatible historical metadata for deliberate JSON review',()=>{
 const component=part('Memory',{slotBus:'PCI',laneRules:[],driveTargets:[],pciVoltage:'5V',baySize:'5.25',supportedOS:['Windows'],capacityGb:16});const before=structuredClone(component);const retained=retainedAdvancedFields(component);assert.ok(retained.includes('slotBus'));assert.ok(retained.includes('laneRules'));assert.ok(retained.includes('driveTargets'));assert.ok(retained.includes('supportedOS'));assert.ok(!retained.includes('capacityGb'));assert.deepEqual(component,before);
 const cage=part('Storage adapter',{storageAdapterKind:'bay-cage',sledDrives:2,slotBus:'PCIe'});assert.ok(retainedAdvancedFields(cage).includes('slotBus'));assert.ok(retainedAdvancedFields(cage).includes('sledDrives'));
});
