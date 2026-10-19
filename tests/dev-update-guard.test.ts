import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installDevUpdateGuard} from '../src/dev-update-guard.ts';
const tick=()=>new Promise<void>(resolve=>setTimeout(resolve,15));
function fixture(){const listeners=new Map<string,()=>Promise<void>>();let dirty=false,notices=0;const stop=installDevUpdateGuard({on:(event,callback)=>{listeners.set(event,callback);},off:event=>{listeners.delete(event);}},()=>dirty,()=>notices++,1);return {listeners,stop,setDirty:(value:boolean)=>{dirty=value;},notices:()=>notices};}
test('automatic development updates and reconnect reloads wait for edits to be resolved',async()=>{
 const f=fixture();f.setDirty(true);let released=0;
 try{const pending=['vite:beforeUpdate','vite:beforeFullReload','vite:ws:disconnect'].map(event=>f.listeners.get(event)!().then(()=>released++));await tick();assert.equal(released,0);assert.equal(f.notices(),1);f.setDirty(false);await Promise.all(pending);assert.equal(released,3);f.setDirty(true);let next=false;const again=f.listeners.get('vite:beforeFullReload')!().then(()=>next=true);await tick();assert.equal(next,false);assert.equal(f.notices(),2);f.setDirty(false);await again;}finally{f.stop();}
});
test('clean updates proceed immediately and disposal removes listeners and timers',async()=>{
 const f=fixture();await f.listeners.get('vite:beforeUpdate')!();assert.equal(f.notices(),0);f.setDirty(true);const waiting=f.listeners.get('vite:ws:disconnect')!();f.stop();await waiting;assert.equal(f.listeners.size,0);f.stop();
});
