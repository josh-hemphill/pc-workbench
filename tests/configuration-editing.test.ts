import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reactive} from 'vue';
import {seed} from '../server/seed';
import {splitConfigurationPlacement} from '../shared/configuration-editing';

test('splitting cards preserves port instance identity and the original record without mutating reactive drafts',()=>{
 const cfg=reactive(structuredClone(seed.configurations[0])),card=cfg.placements.find(p=>p.componentId==='nic')!;card.quantity=2;
 cfg.portMappings=[{placementId:card.id,instance:0,portId:'ETH',connectionId:'a',requirementId:'a'},{placementId:card.id,instance:1,portId:'ETH',connectionId:'b',requirementId:'b'}];
 const before=JSON.stringify(cfg),next=splitConfigurationPlacement(cfg,card.id,()=> 'second-card');
 assert.equal(JSON.stringify(cfg),before);assert.equal(next.placements.find(p=>p.id===card.id)!.quantity,1);
 assert.deepEqual(next.portMappings!.map(p=>[p.placementId,p.instance]),[[card.id,0],['second-card',0]]);
});
test('splitting never duplicates assigned bays or data and power wiring',()=>{
 for(const bindings of [{bayTargetIds:['FRONT']},{sataDataConnections:[{controllerPlacementId:'board',portId:'SATA1'}]},{sataPowerConnections:[{powerProviderPlacementId:'psu',connectorId:'P1'}]}]){
  const cfg=structuredClone(seed.configurations[0]),line=cfg.placements.find(p=>p.componentId==='hdd')!;Object.assign(line,bindings);const before=JSON.stringify(cfg);
  assert.throws(()=>splitConfigurationPlacement(cfg,line.id,()=> 'split'),/physical bay or cable/);assert.equal(JSON.stringify(cfg),before);
 }
});
test('splitting a referenced provider or invalid port instance is blocked',()=>{
 const cfg=structuredClone(seed.configurations[0]),line=cfg.placements.find(p=>p.componentId==='nvme')!,data=cfg.placements.find(p=>p.componentId==='hdd')!;
 data.controllerPlacementId=line.id;assert.throws(()=>splitConfigurationPlacement(cfg,line.id,()=> 'split'),/supplies other/);delete data.controllerPlacementId;
 cfg.storage.groups=[{id:'data',name:'Data',raid:'mirror',controllerPlacementId:line.id}];assert.throws(()=>splitConfigurationPlacement(cfg,line.id,()=> 'split'),/supplies other/);delete cfg.storage.groups;
 cfg.portMappings=[{placementId:line.id,instance:2,portId:'P',connectionId:'a',requirementId:'a'}];assert.throws(()=>splitConfigurationPlacement(cfg,line.id,()=> 'split'),/invalid equipment port/);
});
