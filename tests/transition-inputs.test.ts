import {test} from 'node:test';
import assert from 'node:assert/strict';
import {workflowFixtures,fixtureScenario} from '../tools/synthetic-workflows/scenarios.ts';
import {transitionCohorts,planTransition} from '../shared/transitions.ts';
import {reusableTransitionInputs,reuseTransitionInputs} from '../shared/transition-inputs.ts';
function corrected(){
 const fixture=workflowFixtures().find(f=>f.id==='04-partial-conflict')!,db=fixture.db,scenario=fixtureScenario(fixture);
 db.pcs[2].hardwareSurvey!.configurationId='source-extra-memory';
 return {db,scenario,cohort:transitionCohorts(db,scenario).find(c=>c.members.some(m=>m.pc.id===db.pcs[2].id))!};
}
test('an explicit copy recovers destination and matching array inputs after a RAM assumption correction',()=>{
 const {db,scenario,cohort}=corrected(),before=JSON.stringify(scenario),inventory=JSON.stringify(db.inventory);
 const candidates=reusableTransitionInputs(cohort,scenario,db);assert.equal(candidates.length,1);assert.equal(candidates[0].name,'SYNTHETIC · HDD workstation');assert.equal(candidates[0].policies['data:default'].usedGb,1000);assert.equal(candidates[0].destinationId,'destination-ssd');
 assert.equal(JSON.stringify(scenario),before,'finding choices must not change the plan');assert.equal(planTransition(db,scenario).blocked,1);
 const copied=reuseTransitionInputs(cohort,candidates[0].key,scenario,db)!;assert.equal(copied.skipped,0);assert.equal(planTransition(db,scenario).blocked,0);assert.equal(JSON.stringify(db.inventory),inventory);
 assert.deepEqual(reusableTransitionInputs(cohort,scenario,db),[],'completed inputs do not keep offering recovery');
});
test('changed drives, quantities, array roles and RAID do not inherit usage measurements',()=>{
 for(const change of ['model','quantity','raid','role'] as const){
  const {db,scenario}=corrected(),cfg=db.configurations.find(c=>c.id==='source-extra-memory')!,p=cfg.placements.find(p=>p.role==='data')!;
  if(change==='model')p.componentId='ssd';if(change==='quantity')p.quantity=1;if(change==='raid')cfg.storage.raid='none';if(change==='role')p.role='general';
  const cohort=transitionCohorts(db,scenario).find(c=>c.members.some(m=>m.pc.id==='synthetic-pc-3'))!,option=reusableTransitionInputs(cohort,scenario,db)[0];
  assert(option,change);assert.equal(option.destinationId,'destination-ssd');assert.deepEqual(option.policies,{},change);assert.equal(option.skipped,1);
  reuseTransitionInputs(cohort,option.key,scenario,db);assert.equal(scenario.policies[cohort.id]?.['data:default']?.usedGb,undefined);
 }
});
test('reuse preserves entered destinations, measurements and evidence together',()=>{
 const {db,scenario,cohort}=corrected();scenario.destinationIds[cohort.id]='destination-large';scenario.policies[cohort.id]={'data:default':{usedGb:2000,evidence:'New observation'}};
 const before=JSON.stringify(scenario);assert.deepEqual(reusableTransitionInputs(cohort,scenario,db),[]);assert.equal(reuseTransitionInputs(cohort,'missing',scenario,db),null);assert.equal(JSON.stringify(scenario),before);
 const other=corrected();other.scenario.policies[other.cohort.id]={'data:default':{evidence:'New source, measurement pending'}};const candidate=reusableTransitionInputs(other.cohort,other.scenario,other.db)[0];assert.deepEqual(candidate.policies,{});reuseTransitionInputs(other.cohort,candidate.key,other.scenario,other.db);assert.equal(other.scenario.policies[other.cohort.id]['data:default'].evidence,'New source, measurement pending');
});
test('invalid imported group keys and deleted destinations do not produce misleading recovery choices',()=>{
 const {db,scenario,cohort}=corrected();scenario.destinationIds['not-json']='destination-ssd';scenario.policies['{"placements":null}']={'data:default':{usedGb:99,evidence:'Untrusted key'}};
 assert.equal(reusableTransitionInputs(cohort,scenario,db).length,1);
 scenario.policies[Object.keys(scenario.policies)[0]]['data:default'].targetSegmentId='removed-destination-array';db.configurations=db.configurations.filter(c=>c.id!=='destination-ssd');const option=reusableTransitionInputs(cohort,scenario,db)[0];assert.equal(option.destinationId,undefined);assert.equal(option.policies['data:default'].usedGb,1000);assert.equal(option.policies['data:default'].targetSegmentId,undefined);
});
test('matching inputs copied from a group are cloned and stricter requirements still block unsafe destinations',()=>{
 const {db,scenario}=corrected(),location=db.installationLocations.find(l=>l.id==='bench-3')!;location.requirementSetId='archive-minimum';location.requirementRevision=1;location.requirementSnapshot=structuredClone(db.requirementsSets[0].versions[0]);
 const cohort=transitionCohorts(db,scenario).find(c=>c.members.some(m=>m.pc.id==='synthetic-pc-3'))!,option=reusableTransitionInputs(cohort,scenario,db)[0];reuseTransitionInputs(cohort,option.key,scenario,db);
 assert.equal(planTransition(db,scenario).blocked,1);scenario.policies[cohort.id]['data:default'].usedGb=2;assert.equal(scenario.policies[option.key]['data:default'].usedGb,1000,'editing copied values must not edit the old group');
});
test('reuse does not copy mappings into a different destination or hidden destination choices into SSD mode',()=>{
 const {db,scenario,cohort}=corrected(),source=Object.keys(scenario.policies)[0];scenario.policies[source]['data:default'].targetSegmentId='old-array';scenario.destinationIds[cohort.id]='destination-large';
 const option=reusableTransitionInputs(cohort,scenario,db)[0];assert.equal(option.policies['data:default'].targetSegmentId,undefined);assert.equal(option.policies['data:default'].usedGb,1000);
 const ssd=corrected();ssd.scenario.mode='ssd';const key=Object.keys(ssd.scenario.policies)[0];ssd.scenario.policies[key]['data:default'].replacementId='ssd';ssd.scenario.policies[key]['data:default'].targetSegmentId='not-for-ssd-mode';
 const choice=reusableTransitionInputs(ssd.cohort,ssd.scenario,ssd.db)[0];assert.equal(choice.destinationId,undefined);assert.equal(choice.policies['data:default'].replacementId,'ssd');assert.equal(choice.policies['data:default'].targetSegmentId,undefined);
});
