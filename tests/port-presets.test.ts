import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyPortPreset,portPresets,portPresetValue} from '../shared/port-presets.ts';
import type {Port} from '../shared/types.ts';
import {componentSchema} from '../shared/component-schema.ts';
test('Ethernet shortcuts convert gigabit rates to Mbps without changing connector or documented protocol',()=>{
 const port:Port={id:'LAN_1',kind:'Ethernet',connector:'SFP+',protocol:'IEEE 802.3',powerW:0};
 applyPortPreset(port,'ethernet-2500');assert.equal(port.speedMbps,2500);assert.equal(port.protocol,'IEEE 802.3');assert.equal(port.connector,'SFP+');assert.equal(port.id,'LAN_1');assert.equal(port.powerW,0);assert.equal(portPresetValue(port),'ethernet-2500');
});
test('USB shortcuts distinguish versions with equal speed and preserve electrical declarations and stable IDs',()=>{
 const port:Port={id:'USB_C_1',kind:'USB-C',connector:'USB-C',powerW:15,pinout:'Vendor wiring',isolated:true};
 applyPortPreset(port,'usb-480');assert.equal(port.speedMbps,480);assert.equal(port.protocol,'USB 2.0');
 applyPortPreset(port,'usb-20000');assert.equal(portPresetValue(port),'usb-20000');assert.equal(port.protocol,'USB 3.2 Gen 2x2');
 applyPortPreset(port,'usb4-20000');assert.equal(portPresetValue(port),'usb4-20000');assert.equal(port.protocol,'USB4');
 assert.equal(port.id,'USB_C_1');assert.equal(port.powerW,15);assert.equal(port.pinout,'Vendor wiring');assert.equal(port.isolated,true);
 port.speedMbps=1234;assert.equal(portPresetValue(port),'');const before=structuredClone(port);applyPortPreset(port,'');assert.deepEqual(port,before);
});
test('USB-A excludes USB-C-only standards and unknown or inapplicable presets never change ports',()=>{
 const port:Port={id:'USB_A_1',kind:'USB-A'};applyPortPreset(port,'usb4-40000');assert.equal(port.speedMbps,undefined);
 applyPortPreset(port,'usb-5000');assert.equal(port.speedMbps,5000);assert.equal(port.protocol,'USB 3.1 Gen 1');
 const before=structuredClone(port);applyPortPreset(port,'ethernet-1000');assert.deepEqual(port,before);
 assert.deepEqual(portPresets('Serial'),[]);
});
test('every selectable port preset produces schema-valid catalog data',()=>{
 for(const kind of ['Ethernet','USB-A','USB-C'] as const)for(const preset of portPresets(kind)){
  const port:Port={id:'PORT_1',kind};applyPortPreset(port,preset.value);
  assert.equal(componentSchema.safeParse({id:'board',name:'Board',category:'Motherboard',manufacturer:'',source:'',verified:false,specs:{ports:[port]}}).success,true,preset.title);
 }
});
