import type {Configuration,Database} from '../shared/types.ts';

/** Both individual and bulk saves retain the same revision and approval history. */
export function saveConfigurationRecord(input:Configuration,db:Database):Configuration {
 const existing=db.configurations.find(config=>config.id===input.id);
 const revision=(existing?.revision||0)+1;
 const approvalSnapshot=input.status==='Approved'?{
  at:new Date().toISOString(),
  components:structuredClone(db.components.filter(component=>input.placements.some(p=>p.componentId===component.id))),
  system:structuredClone(db.systems.find(system=>system.id===input.systemId)||null),
 }:existing?.approvalSnapshot;
 const approvalHistory=[...(existing?.approvalHistory||[])];
 if(input.status==='Approved'&&approvalSnapshot){
  const {approvalHistory:_,approvalSnapshot:__,revision:___,...configuration}=input;
  approvalHistory.push({revision,at:approvalSnapshot.at,configuration,components:approvalSnapshot.components,system:approvalSnapshot.system});
 }
 return {...input,revision,approvalSnapshot,approvalHistory};
}
