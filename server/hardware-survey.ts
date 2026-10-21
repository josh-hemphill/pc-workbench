import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Database} from '../shared/types.ts';
import {isPCInstallationKind} from '../shared/types.ts';
import {hardwareSurveySchema} from '../shared/hardware-survey.ts';
import {savePCRecord} from './pc-lifecycle.ts';
export const registerUnsurveyedSchema=z.object({
 locationIds:z.array(z.string()).min(1).max(500).refine(ids=>new Set(ids).size===ids.length,'Select unique locations.'),
 survey:hardwareSurveySchema.refine(s=>s.status==='uninspected','New PCs must await inspection.'),
}).strict();
/** Explicitly selected, empty PC locations only; registration never fabricates component stock. */
export function registerUnsurveyedPCs(input:unknown,db:Database){
 const {locationIds,survey}=registerUnsurveyedSchema.parse(input);
 if(!survey.evidence.trim())throw Error('Record how the device presence and hardware assumption are known.');
 if(survey.configurationId&&!db.configurations.some(c=>c.id===survey.configurationId))throw Error('Assumed configuration not found.');
 return locationIds.map(id=>{
  const location=db.installationLocations.find(l=>l.id===id);
  if(!location||!isPCInstallationKind(location.kind))throw Error('Choose Station, Bench or System locations.');
  if(db.pcs.some(pc=>pc.installationLocationId===id&&pc.lifecycle!=='Retired'))throw Error(`${location.name} already has a PC. Open its record instead.`);
  return savePCRecord({id:randomUUID(),name:`${location.name} PC`.slice(0,200),serial:'',location:'',installationLocationId:id,configurationId:'',notes:'',buildSettings:null,lifecycle:'Planning',hardwareSurvey:survey},db);
 });
}
