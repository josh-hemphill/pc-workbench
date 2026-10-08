import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectionPortTotals,connectionSummary} from '../shared/ports';
import type {Connection} from '../shared/types';

test('equipment summaries preserve legacy demand without double counting and show distinct custom interfaces',()=>{
  const connections:Connection[]=[
    {id:'stage',name:'Stage',usbA:3,usbC:0,ethernet:0,notes:'',requirements:[{id:'usb',kind:'USB-A',quantity:2},{id:'serial',kind:'Serial',quantity:1},{id:'can',kind:'Custom',customType:' CAN ',quantity:1}]},
    {id:'camera',name:'Camera',usbA:0,usbC:0,ethernet:0,notes:'',requirements:[{id:'usb',kind:'USB-A',quantity:4},{id:'can',kind:'Custom',customType:'can',quantity:2},{id:'trigger',kind:'Custom',customType:'Trigger I/O',quantity:1}]},
  ];
  const totals=connectionPortTotals(connections);
  assert.equal(totals.find(row=>row.label==='USB-A')?.quantity,7);
  assert.equal(totals.find(row=>row.label==='Serial')?.quantity,1);
  assert.equal(totals.find(row=>row.label==='CAN')?.quantity,3);
  assert.equal(totals.find(row=>row.label==='Trigger I/O')?.quantity,1);
  assert.equal(connectionSummary(connections[0]),'3 USB-A · 1 Serial · 1 CAN');
});
