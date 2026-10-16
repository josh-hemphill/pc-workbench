import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {processIsRunning,windowsProcessIsRunning} from '../server/process-owner.ts';
import {lockWorkspace} from '../server/persistence.ts';

const denied=()=>{throw Object.assign(Error('Access denied'),{code:'EPERM'});};
test('process checks distinguish a running owner from a missing process',()=>{
 assert.equal(processIsRunning(process.pid),true);
 assert.equal(processIsRunning(123,{signal:()=>{throw Object.assign(Error('gone'),{code:'ESRCH'});}}),false);
 for(const pid of [0,-1,NaN,1.5,Number.MAX_SAFE_INTEGER])assert.throws(()=>processIsRunning(pid),/Invalid/);
});
test('Windows access errors fall back to a read-only PID lookup',()=>{
 for(const code of ['EPERM','EACCES','EINVAL'])for(const alive of [true,false]){
  let queried=0;
  assert.equal(processIsRunning(123,{platform:'win32',signal:()=>{throw Object.assign(Error('probe failed'),{code});},windowsQuery:pid=>{assert.equal(pid,123);queried++;return alive;}}),alive);
  assert.equal(queried,1);
 }
 assert.throws(()=>processIsRunning(123,{platform:'linux',signal:denied,windowsQuery:()=>false}),/Access denied/);
 assert.throws(()=>processIsRunning(123,{platform:'win32',signal:denied,windowsQuery:()=>{throw Error('lookup unavailable');}}),/lookup unavailable/);
});
test('Windows lookup enumerates a live PID and a missing PID without termination rights',{skip:process.platform!=='win32'},()=>{
 assert.equal(windowsProcessIsRunning(process.pid),true);
 assert.equal(windowsProcessIsRunning(0x7fffffff),false);
});
test('stale workspace recovery uses the Windows fallback but preserves active or uncertain locks',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-owner-'));
 const filename=path.join(directory,'.server-lock.json'),original=JSON.stringify({pid:123,token:'prior-owner'});
 let release:(()=>void)|undefined;
 const probe=(alive:boolean)=>()=>processIsRunning(123,{platform:'win32',signal:denied,windowsQuery:()=>alive});
 try{
  fs.writeFileSync(filename,original);
  assert.throws(()=>lockWorkspace(directory,probe(true)),/already open/);assert.equal(fs.readFileSync(filename,'utf8'),original);
  assert.throws(()=>lockWorkspace(directory,()=>{throw Object.assign(Error('permission denied'),{code:'EPERM'});}),error=>{
   assert.ok(error instanceof Error);assert.match(error.message,/PID 123.*EPERM/);assert.ok(error.message.includes(filename));assert.ok(error.cause);return true;
  });assert.equal(fs.readFileSync(filename,'utf8'),original);
  const replacement=JSON.stringify({pid:process.pid,token:'replacement-owner'});
  assert.throws(()=>lockWorkspace(directory,()=>{fs.writeFileSync(filename,replacement);return false;}),/lock changed/);
  assert.equal(fs.readFileSync(filename,'utf8'),replacement);fs.writeFileSync(filename,original);
  release=lockWorkspace(directory,probe(false));assert.equal(JSON.parse(fs.readFileSync(filename,'utf8')).pid,process.pid);
  release();assert.equal(fs.existsSync(filename),false);
 }finally{release?.();fs.rmSync(directory,{recursive:true,force:true});}
});
