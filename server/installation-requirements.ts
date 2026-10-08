import type { Database, RequirementVersion } from '../shared/types';
import { schemas, type Collection } from './schema';

type Binding = {requirementSetId?:string;requirementRevision?:number;requirementSnapshot?:RequirementVersion};
/** Resolve a published immutable revision. Labels can change without changing the requirements. */
export function captureRequirementBinding<T extends Binding>(record:T,db:Database):T {
 const next=structuredClone(record);
 if(!next.requirementSetId){delete next.requirementSnapshot;if('requirementSetId' in next||next.requirementRevision!==undefined)next.requirementRevision=0;return next;}
 const set=db.requirementsSets.find(s=>s.id===next.requirementSetId);
 const version=set?.versions.find(v=>v.revision===next.requirementRevision);
 if(!version)throw Error('Choose an existing published installation requirements revision.');
 next.requirementSnapshot=structuredClone(version);
 return next;
}

export function prepareInstallationRecord(collection:Collection,input:unknown,db:Database):unknown {
 if(collection==='requirementsSets'){
  const next=schemas.requirementsSets.parse(input),previous=db.requirementsSets.find(s=>s.id===next.id);
  if(next.versions.some((v,i)=>i>0&&v.revision<=next.versions[i-1].revision))throw Error('Requirements revisions must be in increasing order.');
  if(previous&&(next.versions.length<previous.versions.length||previous.versions.some((v,i)=>JSON.stringify(v)!==JSON.stringify(next.versions[i]))))throw Error('Published requirements revisions cannot be changed. Publish a new revision instead.');
  return next;
 }
 if(collection==='installationLocations')return captureRequirementBinding(schemas.installationLocations.parse(input),db);
 if(collection==='configurations')return captureRequirementBinding(schemas.configurations.parse(input),db);
 return input;
}
