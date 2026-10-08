import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';

const {parseBackendMessage,isAppNavigation,externalHTTPS,stopBackend}=createRequire(import.meta.url)('../desktop/protocol.cjs');

test('desktop readiness accepts private loopback application URLs and rejects deceptive or invalid messages',()=>{
 assert.deepEqual(parseBackendMessage('{"type":"ready","url":"http://127.0.0.1:43123/"}'),{type:'ready',url:'http://127.0.0.1:43123/'});
 for(const url of ['https://127.0.0.1:43123/','http://localhost:43123/','http://127.0.0.1.example.com:43123/','http://127.0.0.1@evil.example/','http://user@127.0.0.1:43123/','http://127.0.0.1:43123/api/state','http://127.0.0.1:43123/?next=evil','http://127.0.0.1:43123/#evil','file:///tmp/index.html']){
  assert.throws(()=>parseBackendMessage(JSON.stringify({type:'ready',url})),Error,url);
 }
 for(const line of ['null','[]','{}','{"type":"ready","url":42}','{"type":"error","message":" "}','{"type":"shutdown"}','{']) assert.throws(()=>parseBackendMessage(line));
 assert.throws(()=>parseBackendMessage(' '.repeat(65537)),/maximum size/);
 assert.deepEqual(parseBackendMessage(JSON.stringify({type:'error',message:'Workspace locked'})),{type:'error',message:'Workspace locked'});
 assert.equal(parseBackendMessage(JSON.stringify({type:'error',message:'x'.repeat(9000)})).message.length,8192);
});

test('desktop navigation is restricted to the exact backend origin and external links to credential-free HTTPS',()=>{
 const origin='http://127.0.0.1:43123';
 for(const url of [origin+'/',origin+'/api/state',origin+'/?tab=inventory#stock']) assert.equal(isAppNavigation(url,origin),true);
 for(const url of ['http://127.0.0.1:43124/','http://localhost:43123/','https://127.0.0.1:43123/','http://user@127.0.0.1:43123/','http://127.0.0.1:43123.evil.example/','file:///tmp/index.html','javascript:alert(1)','not a URL']) assert.equal(isAppNavigation(url,origin),false,url);
 assert.equal(externalHTTPS('https://example.org/help?q=1#section'),'https://example.org/help?q=1#section');
 for(const url of ['http://example.org/','https://user:secret@example.org/','file:///tmp/index.html','mailto:person@example.org','javascript:alert(1)','not a URL']) assert.equal(externalHTTPS(url),null,url);
});

function fakeChild(){
 const child=new EventEmitter() as EventEmitter&{exitCode:number|null;signalCode:string|null;stdin:EventEmitter&{write:(data:string)=>void;end:()=>void};kill:(signal:string)=>boolean};
 const writes:string[]=[],kills:string[]=[];let ended=0;
 child.exitCode=null;child.signalCode=null;child.stdin=Object.assign(new EventEmitter(),{write:(data:string)=>{writes.push(data);},end:()=>{ended++;}});child.kill=signal=>{kills.push(signal);return true;};
 const timers=new Map<number,()=>void>();let timerId=0;
 return {child,writes,kills,get ended(){return ended;},timers,setTimer:(callback:()=>void)=>{const id=++timerId;timers.set(id,callback);return id;},clearTimer:(id:number)=>timers.delete(id),fire:()=>{const entry=timers.entries().next().value as [number,()=>void]|undefined;assert.ok(entry);timers.delete(entry[0]);entry[1]();}};
}

test('desktop shutdown requests private stdin shutdown and waits for process exit before completing',()=>{
 const f=fakeChild();let stopped=0;
 stopBackend(f.child,{onStopped:()=>{stopped++;},setTimer:f.setTimer,clearTimer:f.clearTimer});
 assert.deepEqual(f.writes,['{"type":"shutdown"}\n']);assert.equal(f.ended,1);assert.equal(stopped,0);assert.equal(f.timers.size,1);
 f.child.exitCode=0;f.child.emit('exit',0,null);
 assert.equal(stopped,1);assert.equal(f.timers.size,0);assert.deepEqual(f.kills,[]);
 f.child.emit('exit',0,null);assert.equal(stopped,1);
});

test('desktop shutdown escalates a stalled backend and completes once its termination is observed',()=>{
 const f=fakeChild();let stopped=0,result:unknown;
 stopBackend(f.child,{onStopped:(value:unknown)=>{stopped++;result=value;},setTimer:f.setTimer,clearTimer:f.clearTimer});
 f.fire();assert.deepEqual(f.kills,['SIGKILL']);assert.equal(stopped,0);
 f.child.signalCode='SIGKILL';f.child.emit('exit',null,'SIGKILL');assert.equal(stopped,1);assert.equal(f.timers.size,0);
 assert.deepEqual(result,{confirmed:true,forced:true});
});

test('desktop shutdown absorbs asynchronous stdin errors and distinguishes unconfirmed termination',()=>{
 const f=fakeChild();let result:unknown;
 f.child.kill=()=>{throw Error('Cannot terminate process');};
 stopBackend(f.child,{onStopped:(value:unknown)=>{result=value;},setTimer:f.setTimer,clearTimer:f.clearTimer});
 assert.doesNotThrow(()=>f.child.stdin.emit('error',Object.assign(Error('Broken pipe'),{code:'EPIPE'})));
 assert.equal(result,undefined);f.fire();assert.equal(result,undefined);f.fire();
 assert.deepEqual(result,{confirmed:false,forced:true});
 f.child.emit('exit',1,null);assert.deepEqual(result,{confirmed:false,forced:true});
});

test('desktop shutdown immediately completes for an already-exited or absent backend',()=>{
 const f=fakeChild();f.child.exitCode=1;let stopped=0;
 stopBackend(f.child,{onStopped:()=>{stopped++;},setTimer:f.setTimer,clearTimer:f.clearTimer});
 stopBackend(null,{onStopped:()=>{stopped++;},setTimer:f.setTimer,clearTimer:f.clearTimer});
 assert.equal(stopped,2);assert.deepEqual(f.writes,[]);assert.equal(f.timers.size,0);
});
