import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../server/seed';
import { prepareInstallationRecord, captureRequirementBinding } from '../server/installation-requirements';
import { savePCRecord } from '../server/pc-lifecycle';
const version={revision:1,at:'2026-10-08T10:00:00Z',name:'Microscope controller',description:'Stable acquisition requirements',connections:[],constraints:{minMemoryGb:64}};
test('configuration and location capture selected requirement revisions without changing them on later publication',()=>{
 const db=structuredClone(seed);db.requirementsSets.push({id:'microscopy-requirements',name:'Microscopy',description:'',versions:[version]});
 const config=prepareInstallationRecord('configurations',{...db.configurations[0],requirementSetId:'microscopy-requirements',requirementRevision:1},db) as typeof db.configurations[number];
 const location=prepareInstallationRecord('installationLocations',{id:'bench1',name:'Bench 1',kind:'Bench',parentId:'',requirementSetId:'microscopy-requirements',requirementRevision:1,targetConfigurationId:config.id,notes:''},db) as typeof db.installationLocations[number];
 db.requirementsSets[0].versions.push({...version,revision:2,constraints:{minMemoryGb:128}});
 assert.equal(config.requirementSnapshot?.constraints?.minMemoryGb,64);assert.equal(location.requirementSnapshot?.constraints?.minMemoryGb,64);
 assert.throws(()=>captureRequirementBinding({requirementSetId:'microscopy-requirements',requirementRevision:99},db),/published/);
});
test('requirements publication is append-only and unbinding removes a stale snapshot',()=>{
 const db=structuredClone(seed);const set={id:'requirements',name:'Controller',description:'',versions:[version]};db.requirementsSets.push(set);
 assert.throws(()=>prepareInstallationRecord('requirementsSets',{...set,versions:[{...version,name:'Changed published revision'}]},db),/cannot be changed/);
 assert.equal((prepareInstallationRecord('requirementsSets',{...set,versions:[version,{...version,revision:2}]},db) as typeof set).versions.length,2);
 const cleared=captureRequirementBinding({requirementSetId:'',requirementRevision:1,requirementSnapshot:version},db);assert.equal(cleared.requirementSnapshot,undefined);assert.equal(cleared.requirementRevision,0);
});
test('moving a built PC to an installation location is recorded in its timeline',()=>{
 const db=structuredClone(seed);db.installationLocations.push({id:'bench1',name:'Bench 1',kind:'Bench',parentId:'',requirementSetId:'',requirementRevision:0,targetConfigurationId:'',notes:''});
 const original=db.pcs[0];const changed=savePCRecord({...original,installationLocationId:'bench1'},db);assert.match(changed.timeline!.at(-1)!.summary,/Installation location: Unassigned → Bench 1/);
});
