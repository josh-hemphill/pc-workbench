import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveRuntimeConfig } from '../server/runtime-config.ts';
import { SettingsStore, SettingsConflict } from '../server/settings.ts';
import { defaultUserSettings } from '../shared/settings.ts';

function fixture(run:(base:string,store:SettingsStore)=>void){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'bench-settings-'));
  try{run(base,new SettingsStore(resolveRuntimeConfig({home:path.join(base,'user'),env:{},sourceRoot:base})));}
  finally{fs.rmSync(base,{recursive:true,force:true});}
}
test('user settings atomically save both palette modes, reject stale writers, and remain private',()=>fixture((base,store)=>{
  const first=store.user();assert.equal(first.exists,false);
  const value=structuredClone(defaultUserSettings);value.appearance.palette='slate';value.appearance.customColors={slate:{light:{primary:'#563d7c'},dark:{primary:'#c8a4eb'}}};
  const saved=store.saveUser(value,first.revision);
  assert.equal(saved.exists,true);assert.deepEqual(new SettingsStore(store.runtime).user(),saved);
  assert.throws(()=>store.saveUser(defaultUserSettings,first.revision),SettingsConflict);
  assert.deepEqual(store.user(),saved);
  if(process.platform!=='win32')assert.equal(fs.statSync(store.runtime.userSettingsFile).mode&0o777,0o600);
  assert.equal(fs.existsSync(path.join(base,'data')),false);
}));
test('unsupported versions, invalid colors, and unknown fields never overwrite user preferences',()=>fixture((_base,store)=>{
  const saved=store.saveUser(defaultUserSettings,'missing'),original=fs.readFileSync(store.runtime.userSettingsFile,'utf8');
  for(const value of [{...defaultUserSettings,version:2},{...defaultUserSettings,unexpected:true},{version:1,appearance:{theme:'dark',palette:'slate',customColors:{slate:{light:{primary:'red'}}}}}]) {
    assert.throws(()=>store.saveUser(value,saved.revision));assert.equal(fs.readFileSync(store.runtime.userSettingsFile,'utf8'),original);
  }
  fs.writeFileSync(store.runtime.userSettingsFile,'{"version":99}');
  assert.throws(()=>new SettingsStore(store.runtime),/compatible application/);
  assert.equal(fs.readFileSync(store.runtime.userSettingsFile,'utf8'),'{"version":99}');
}));
test('preview and storage saves do not create, move, or open workspaces and report restart separately',()=>fixture((base,store)=>{
  const snapshot=store.app(),destination=path.join(base,'portable','data'),value={version:1 as const,dataDir:destination,port:4100};
  const preview=store.previewApp(value);assert.equal(preview.exists,false);assert.equal(fs.existsSync(destination),false);
  const saved=store.saveApp(value,snapshot.revision);
  assert.equal(saved.effective.dataDir,store.runtime.dataDir);assert.equal(saved.nextLaunch.dataDir,destination);assert.equal(saved.restartRequired,true);
  assert.equal(fs.existsSync(destination),false);
  const restarted=resolveRuntimeConfig({home:path.join(base,'user'),env:{},sourceRoot:base});
  assert.equal(restarted.dataDir,destination);assert.equal(restarted.port,4100);
  assert.equal(new SettingsStore(restarted).app().restartRequired,false);
  assert.throws(()=>store.saveApp({...value,port:4200},snapshot.revision),SettingsConflict);
}));
test('storage validation rejects overlap, invalid destinations and symlink aliases without changing config',()=>fixture((base,store)=>{
  const current=store.app();store.saveApp(current.value,current.revision);
  const original=fs.readFileSync(store.runtime.configFile,'utf8');
  const bad=[base,path.dirname(store.runtime.userSettingsFile),store.runtime.cacheDir,'relative'];
  const file=path.join(base,'not-directory');fs.writeFileSync(file,'data');bad.push(file,path.join(file,'child'));
  for(const dataDir of bad){assert.throws(()=>store.saveApp({...current.value,dataDir},store.app().revision));assert.equal(fs.readFileSync(store.runtime.configFile,'utf8'),original);}
  if(process.platform!=='win32'){
    const alias=path.join(base,'profile-alias');fs.symlinkSync(path.dirname(store.runtime.userSettingsFile),alias);
    assert.throws(()=>store.previewApp({...current.value,dataDir:alias}),/outside the workspace/);
  }
}));
test('environment overrides remain effective while saved configuration changes independently',()=>fixture((base,store)=>{
  const runtime=resolveRuntimeConfig({home:path.join(base,'user'),env:{BENCH_DATA_DIR:path.join(base,'override'),PORT:'4300'},sourceRoot:base});
  const overridden=new SettingsStore(runtime),snapshot=overridden.app();
  const saved=overridden.saveApp({version:1,dataDir:path.join(base,'portable'),port:4100},snapshot.revision);
  assert.deepEqual(saved.effective,saved.nextLaunch);assert.equal(saved.restartRequired,false);
  assert.equal(saved.value.port,4100);assert.equal(saved.effective.port,4300);
  assert.equal(saved.overrides.dataDir,true);assert.equal(saved.overrides.port,true);
}));
test('settings save failures preserve the prior file and release their short-lived lock',()=>fixture((base,store)=>{
  const saved=store.saveUser(defaultUserSettings,'missing'),original=fs.readFileSync(store.runtime.userSettingsFile,'utf8');
  const lock=`${store.runtime.userSettingsFile}.lock`;fs.writeFileSync(lock,JSON.stringify({pid:process.pid,token:'other'}));
  assert.throws(()=>store.saveUser(defaultUserSettings,saved.revision),SettingsConflict);
  assert.equal(fs.readFileSync(store.runtime.userSettingsFile,'utf8'),original);fs.unlinkSync(lock);
  assert.throws(()=>store.saveUser(defaultUserSettings,'stale'),SettingsConflict);assert.equal(fs.existsSync(lock),false);
  const rename=fs.renameSync;
  try {
    fs.renameSync=()=>{throw Error('Simulated disk replacement failure');};
    assert.throws(()=>store.saveUser(defaultUserSettings,saved.revision),/disk replacement failure/);
  }finally{fs.renameSync=rename;}
  assert.equal(fs.readFileSync(store.runtime.userSettingsFile,'utf8'),original);assert.equal(fs.existsSync(lock),false);
  assert.equal(fs.readdirSync(path.dirname(store.runtime.userSettingsFile)).some(name=>name.endsWith('.tmp')),false);
  const write=fs.writeFileSync;
  try{
    fs.writeFileSync=()=>{throw Error('Simulated lock-header failure');};
    assert.throws(()=>store.saveUser(defaultUserSettings,saved.revision),/lock-header failure/);
  }finally{fs.writeFileSync=write;}
  assert.equal(fs.existsSync(lock),false);assert.equal(fs.readFileSync(store.runtime.userSettingsFile,'utf8'),original);
  if(process.platform!=='win32'){
    const target=path.join(base,'read-only-settings.json');fs.writeFileSync(target,original);fs.unlinkSync(store.runtime.userSettingsFile);fs.symlinkSync(target,store.runtime.userSettingsFile);
    assert.throws(()=>store.saveUser(defaultUserSettings,saved.revision),/file symlink/);assert.equal(fs.readFileSync(target,'utf8'),original);assert.equal(fs.existsSync(lock),false);
  }
}));
