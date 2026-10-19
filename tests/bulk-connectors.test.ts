import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectorKinds,ensureConnectors} from '../shared/bulk-connectors.ts';
import type {Component} from '../shared/types.ts';
const component=(category:Component['category'],specs:Component['specs']={}):Component=>({id:'test-part',name:'Test part',category,manufacturer:'',source:'',verified:true,specs});
test('bulk connector additions preserve wired IDs, disabled ports and original records',()=>{
 const before=component('Motherboard',{sataDataPorts:[{id:'SATA_DATA_2',disabled:true},{id:'BIOS_PORT'}],sataPorts:2}),copy=structuredClone(before);
 const after=ensureConnectors(before,{kind:'sataDataPorts',minimum:4});
 assert.deepEqual(after.specs.sataDataPorts,[...before.specs.sataDataPorts!,{id:'SATA_DATA_1'},{id:'SATA_DATA_3'}]);
 assert.equal(after.specs.sataPorts,4);assert.equal(after.verified,false);assert.deepEqual(before,copy);
 assert.strictEqual(ensureConnectors(before,{kind:'sataDataPorts',minimum:1}),before);
});
test('naming count-only connectors retains larger counts and PSU harness metadata',()=>{
 const psu=component('PSU',{sataPower:6});const named=ensureConnectors(psu,{kind:'sataPowerConnectors',minimum:2});
 assert.equal(named.specs.sataPowerConnectors!.length,6);assert.equal(named.specs.sataPower,6);
 const existing=component('PSU',{sataPowerConnectors:[{id:'custom-plug',harness:'Cable A'}]});
 assert.deepEqual(ensureConnectors(existing,{kind:'sataPowerConnectors',minimum:2}).specs.sataPowerConnectors,[{id:'custom-plug',harness:'Cable A'},{id:'SATA_POWER_1'}]);
});
test('bay accessories and cages support separate consumed power and data inputs',()=>{
 for(const c of [component('Bay accessory'),component('Storage adapter',{storageAdapterKind:'bay-cage'})]){
  assert(connectorKinds(c).includes('sataDataInputs'));assert(connectorKinds(c).includes('sataPowerInputs'));
  const data=ensureConnectors(c,{kind:'sataDataInputs',minimum:2}),power=ensureConnectors(data,{kind:'sataPowerInputs',minimum:1});
  assert.deepEqual(power.specs.sataDataInputs,[{id:'SATA_DATA_IN_1'},{id:'SATA_DATA_IN_2'}]);assert.equal(power.specs.sataPowerPlugs,1);
 }
 const controller=component('Storage adapter',{storageAdapterKind:'controller'});assert(connectorKinds(controller).includes('sataDataPorts'));
 assert.throws(()=>ensureConnectors(component('Chassis'),{kind:'sataDataPorts',minimum:1}),/not applicable/);
});
test('connector bounds reject fractions and oversized inventories without writes',()=>{
 const c=component('Motherboard');for(const minimum of [0,-1,1.5,1001,NaN])assert.throws(()=>ensureConnectors(c,{kind:'sataDataPorts',minimum}));
 assert.throws(()=>ensureConnectors(component('PSU',{sataPower:1001}),{kind:'sataPowerConnectors',minimum:1}),/limit/);
 assert.deepEqual(c.specs,{});
});
