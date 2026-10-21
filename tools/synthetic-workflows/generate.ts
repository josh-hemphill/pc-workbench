import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {encodeCSV} from '../../server/store.ts';
import {workflowFixtures,fixtureScenario,syntheticDate} from './scenarios.ts';
export const fixtureRoot=fileURLToPath(new URL('../../examples/synthetic-workflows/',import.meta.url));
export function fixtureFiles(){
 const files=new Map<string,string>(),fixtures=workflowFixtures();
 const json=(value:unknown)=>JSON.stringify(value,null,2)+'\n';
 for(const fixture of fixtures){
  const scenario=fixtureScenario(fixture),plan={id:`plan-${fixture.id}`,scenario,draft:null,workspaceRevision:'synthetic-import-review-required',draftWorkspaceRevision:'',updatedAt:syntheticDate};
  files.set(`${fixture.id}/workspace.json`,json({...fixture.db,transitionPlans:[plan]}));
  files.set(`${fixture.id}/catalog.json`,json({...fixture.db,pcs:[],inventory:[],installationLocations:[]}));
  for(const collection of ['installationLocations','pcs','inventory'] as const)files.set(`${fixture.id}/${collection}.csv`,encodeCSV(collection,fixture.db[collection]));
  files.set(`${fixture.id}/transition-plan.json`,json({version:1,scenario,workspaceRevision:'synthetic-import-review-required'}));
 }
 const first=fixtures[0].db.installationLocations.find(l=>l.kind==='Bench')!;
 files.set('rejected-imports/duplicate-locations.csv',encodeCSV('installationLocations',[first,{...first,name:'Duplicate ID, different label'}]));
 files.set('rejected-imports/missing-parent.csv',encodeCSV('installationLocations',[{...first,parentId:'nonexistent-parent'}]));
 const pcs=fixtures.find(f=>f.id==='03-assumed-fleet')!.db.pcs;
 files.set('rejected-imports/invalid-survey.csv',encodeCSV('pcs',[pcs[0],{...pcs[1],hardwareSurvey:{...pcs[1].hardwareSurvey!,status:'invented' as 'complete'}}]));
 const allocated=fixtures.find(f=>f.id==='04-partial-conflict')!.db.inventory[0];
 files.set('rejected-imports/overallocated-stock.csv',encodeCSV('inventory',[{...allocated,quantity:0}]));
 files.set('manifest.json',json({version:1,synthetic:true,generatedAt:syntheticDate,scenarios:fixtures.map(f=>({id:f.id,description:f.description,expected:f.expected,selected:fixtureScenario(f).pcIds.length,steps:f.steps})),rejectedImports:[{file:'duplicate-locations.csv',collection:'installationLocations',error:'duplicate record ID'},{file:'missing-parent.csv',collection:'installationLocations',error:'parent installation location not found'},{file:'invalid-survey.csv',collection:'pcs',error:'Invalid option'},{file:'overallocated-stock.csv',collection:'inventory',error:'Allocations exceed stock quantity'}]}));
 return files;
}
if(import.meta.main){
 const args=process.argv.slice(2);if(args.some(arg=>arg!=='--check'))throw Error('Usage: pnpm fixtures:workflows [--check]');
 const check=args.includes('--check'),changed:string[]=[];
 for(const [name,content] of fixtureFiles()){
  const target=path.join(fixtureRoot,name);
  if(check){if(!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==content)changed.push(name);}
  else {fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content);}
 }
 if(changed.length)throw Error(`Synthetic fixture files need regeneration: ${changed.join(', ')}`);
 console.log(`${check?'Verified':'Generated'} ${fixtureFiles().size} deterministic synthetic import files in ${fixtureRoot}`);
}
