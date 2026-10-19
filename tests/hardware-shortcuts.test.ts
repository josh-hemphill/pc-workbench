import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {CoolingHeader,Slot,Component} from '../shared/types.ts';
import {addFanLayout,slotPresets,slotSummary} from '../shared/hardware-shortcuts.ts';
import {componentSchema} from '../shared/component-schema.ts';
test('fan layout appends CPU and system headers with unique IDs and unknown electrical ratings',()=>{
 const headers:CoolingHeader[]=[{id:'SYS_FAN_1',name:'CHA_FAN1',connector:'Fan 3-pin',maxCurrentA:2}];
 const original=structuredClone(headers[0]);const added=addFanLayout(headers,3,'Fan 4-pin',true);
 assert.equal(headers.length,5);assert.deepEqual(headers[0],original);assert.equal(added[0].name,'CPU_FAN');assert.deepEqual(added.map(h=>h.id),['CPU_FAN_1','SYS_FAN_2','SYS_FAN_3','SYS_FAN_4']);
 assert(added.every(h=>h.connector==='Fan 4-pin'&&h.controlModes===undefined&&h.maxCurrentA===undefined&&h.voltageV===undefined));
 addFanLayout(headers,1,'Fan 3-pin',true);assert.equal(headers.length,6);assert.equal(headers.filter(h=>h.name==='CPU_FAN').length,1);
});
test('fan layout can omit CPU and rejects invalid batches before mutation',()=>{
 const headers:CoolingHeader[]=[];addFanLayout(headers,2,'Fan 3-pin',false);assert(headers.every(h=>h.id.startsWith('SYS_FAN')));
 for(const count of [-1,1.5,64,NaN])assert.throws(()=>addFanLayout(headers,count,'Fan 4-pin',true));assert.equal(headers.length,2);
 const full:CoolingHeader[]=Array.from({length:64},(_,i)=>({id:`HEADER_${i}`}));const original=structuredClone(full);assert.throws(()=>addFanLayout(full,0,'Fan 4-pin',true));assert.deepEqual(full,original);
});
test('slot summaries separate physical width, electrical lanes, generation and documented source',()=>{
 const slot:Slot={id:'PCIE_1',bus:'PCIe',...slotPresets.wide4,generation:4,position:1,laneSource:'Chipset'};
 assert.match(slotSummary(slot),/x16 connector \/ x4 wired · Gen 4 · Chipset/);assert.equal(slotPresets.x1.lanes,1);delete slot.laneSource;assert.match(slotSummary(slot),/Source unknown/);
 const board:Component={id:'board',name:'Board',category:'Motherboard',manufacturer:'',source:'',verified:false,specs:{slots:[{...slot,laneSource:'CPU'}]}};
 assert.equal(componentSchema.parse(board).specs.slots![0].laneSource,'CPU');assert(!componentSchema.safeParse({...board,specs:{slots:[{...slot,laneSource:'inferred'}]}}).success);
 assert.match(slotSummary({...slot,bus:'PCI'}),/^PCI · position 1$/);
});
