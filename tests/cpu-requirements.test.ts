import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {seed} from '../server/seed.ts';
import {componentSchema} from '../shared/component-schema.ts';
import {requirementVersionSchema} from '../server/schema.ts';
import {checkConfiguration} from '../shared/compatibility.ts';
import {checkInstalledPC} from '../shared/inventory.ts';
import {extractProductDetails} from '../shared/product-enrichment.ts';
import {Store,encodeCSV,decodeCSV} from '../server/store.ts';
import type {RequirementVersion,StockRecord} from '../shared/types.ts';

function setup(){
 const db=structuredClone(seed),config=db.configurations[0],cpu=db.components.find(c=>c.id==='cpu')!;
 const version:RequirementVersion={revision:1,at:'2026-10-16T12:00:00Z',name:'Acquisition software',description:'Parallel processing baseline',connections:[],constraints:{minCpuCores:8,minCpuThreads:12}};
 db.requirementsSets=[{id:'parallel',name:'Parallel processing',description:'',versions:[version]}];
 config.requirementSetId='parallel';config.requirementRevision=1;
 return {db,config,cpu,version};
}
const cpuFindings=(report:ReturnType<typeof checkConfiguration>)=>report.findings.filter(f=>/physical CPU cores|logical CPU threads/.test(f.detail));

test('CPU specifications are optional positive integers and requirement minima are nonnegative integers',()=>{
 const {cpu,version}=setup();assert.equal(componentSchema.safeParse(cpu).success,true);
 for(const key of ['coreCount','threadCount'] as const){
  for(const value of [0,-1,1.5,10001,Infinity])assert.equal(componentSchema.safeParse({...cpu,specs:{...cpu.specs,[key]:value}}).success,false);
  assert.equal(componentSchema.safeParse({...cpu,specs:{...cpu.specs,[key]:24}}).success,true);
 }
 for(const key of ['minCpuCores','minCpuThreads'] as const){
  for(const value of [-1,1.5,10001])assert.equal(requirementVersionSchema.safeParse({...version,constraints:{[key]:value}}).success,false);
  assert.equal(requirementVersionSchema.safeParse({...version,constraints:{[key]:0}}).success,true);
 }
});

test('physical cores and logical threads satisfy separate minima without assuming SMT ratios',()=>{
 const {db,config,cpu}=setup();cpu.specs.coreCount=8;cpu.specs.threadCount=12;
 let report=checkConfiguration(config,db);assert.deepEqual(cpuFindings(report),[]);
 assert.equal(report.resources.find(r=>r.name==='Required physical CPU cores')?.available,8);
 cpu.specs.coreCount=6;report=checkConfiguration(config,db);
 assert.equal(cpuFindings(report).length,1);assert.equal(cpuFindings(report)[0].severity,'error');assert.match(cpuFindings(report)[0].detail,/physical CPU cores/);
 cpu.specs.coreCount=8;cpu.specs.threadCount=8;report=checkConfiguration(config,db);
 assert.equal(cpuFindings(report).length,1);assert.equal(cpuFindings(report)[0].severity,'error');assert.match(cpuFindings(report)[0].detail,/logical CPU threads/);
});

test('unknown CPU counts require review independently; absent minima add no findings',()=>{
 const {db,config,cpu,version}=setup();cpu.specs.coreCount=8;
 let findings=cpuFindings(checkConfiguration(config,db));assert.equal(findings.length,1);assert.equal(findings[0].severity,'warning');assert.match(findings[0].detail,/logical CPU threads/);
 delete cpu.specs.coreCount;findings=cpuFindings(checkConfiguration(config,db));assert.equal(findings.length,2);assert.ok(findings.every(f=>f.severity==='warning'));
 version.constraints={};assert.deepEqual(cpuFindings(checkConfiguration(config,db)),[]);
 version.constraints={minCpuCores:0,minCpuThreads:0};assert.deepEqual(cpuFindings(checkConfiguration(config,db)),[]);
});

test('pinned CPU requirements remain stable and installed PCs check actual CPUs rather than planned CPUs',()=>{
 const {db,config,cpu,version}=setup();cpu.specs.coreCount=8;cpu.specs.threadCount=16;
 config.requirementSnapshot=structuredClone(version);db.requirementsSets[0].versions.push({...version,revision:2,constraints:{minCpuThreads:32}});
 assert.deepEqual(cpuFindings(checkConfiguration(config,db)),[]);
 const pc=db.pcs[0];pc.buildSettings={...pc.buildSettings!,requirementSetId:'parallel',requirementRevision:1,requirementSnapshot:structuredClone(version)};
 const older={...structuredClone(cpu),id:'older-cpu',name:'Older CPU',specs:{...cpu.specs,coreCount:4,threadCount:8}};db.components.push(older);
 db.inventory=config.placements.map((p,i)=>({id:`part-${i}`,componentId:p.componentId===cpu.id?older.id:p.componentId,tracking:'bulk',serial:'',assetTag:'',quantity:p.quantity,location:'Store',condition:'Serviceable',notes:'',allocations:[{id:`allocation-${i}`,pcId:pc.id,quantity:p.quantity,state:'installed',plannedPlacementId:p.id,slotId:p.slotId,role:p.role,mount:p.mount,group:p.group,createdAt:version.at,updatedAt:version.at,notes:''}],history:[]} satisfies StockRecord));
 const findings=cpuFindings(checkInstalledPC(pc,db));assert.equal(findings.length,2);assert.ok(findings.every(f=>f.severity==='error'));
});

test('product extraction proposes explicit core/thread counts independently and retains recorded counts',()=>{
 const {cpu}=setup();const html='<table><tr><th>Core Count</th><td>8</td></tr><tr><th>Thread Count</th><td>12</td></tr></table>';
 let proposal=extractProductDetails(html,cpu);assert.equal(proposal.patch.coreCount,8);assert.equal(proposal.patch.threadCount,12);
 assert.equal(extractProductDetails('<table><tr><th>Core Count</th><td>8</td></tr></table>',cpu).patch.threadCount,undefined);
 cpu.specs.coreCount=6;proposal=extractProductDetails(html,cpu);assert.equal(proposal.patch.coreCount,undefined);assert.equal(proposal.patch.threadCount,12);
 assert.equal(extractProductDetails('<table><tr><th>Thread Count</th><td>0</td></tr></table>',cpu).patch.threadCount,undefined);
});

test('CPU counts and pinned minima survive CSV and SQLite restart without migrating legacy CPUs',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-cpu-'));let store=new Store(directory);
 try{
  const {cpu,version}=setup();cpu.specs.coreCount=8;cpu.specs.threadCount=12;
  const requirements={id:'parallel',name:'Parallel processing',description:'',versions:[version]};
  assert.deepEqual(decodeCSV('components',encodeCSV('components',[cpu])),[cpu]);
  assert.deepEqual(decodeCSV('requirementsSets',encodeCSV('requirementsSets',[requirements])),[requirements]);
  store.replace('components',store.db.components.map(c=>c.id===cpu.id?cpu:c));store.replace('requirementsSets',[requirements]);
  store.replace('configurations',store.db.configurations.map((c,i)=>i===0?{...c,requirementSetId:requirements.id,requirementRevision:1,requirementSnapshot:version}:c));
  store.close();store=new Store(directory);
  assert.equal(store.db.components.find(c=>c.id===cpu.id)!.specs.threadCount,12);
  assert.deepEqual(store.db.configurations[0].requirementSnapshot?.constraints,version.constraints);
  assert.deepEqual(cpuFindings(checkConfiguration(store.db.configurations[0],store.db)),[]);
 }finally{store.close();fs.rmSync(directory,{recursive:true,force:true});}
});
