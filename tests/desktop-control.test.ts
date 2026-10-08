import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {attachDesktopControl} from '../server/desktop-control';

 test('desktop shutdown accepts fragmented JSON and CRLF but runs once across subsequent commands and EOF',()=>{
 const input=new PassThrough();let calls=0;attachDesktopControl(input,()=>calls++);
 input.write('{"ty');input.write('pe":"shutdown"}\r\n{"type":"shutdown"}\n');input.end();
 assert.equal(calls,1);assert.equal(input.listenerCount('data'),0);assert.equal(input.isPaused(),true);
});
test('malformed, primitive and unknown commands do not shut down the server',()=>{
 const input=new PassThrough();let calls=0;const dispose=attachDesktopControl(input,()=>calls++);
 input.write('broken\nnull\n[]\n"shutdown"\n{"type":"restart"}\n{}\n');assert.equal(calls,0);dispose();input.end();assert.equal(calls,0);
});
test('overlong lines are discarded within a fixed byte budget and later valid commands still work',()=>{
 const input=new PassThrough();let calls=0;attachDesktopControl(input,()=>calls++,64);
 input.write('{"type":"shutdown","padding":"');for(let i=0;i<1000;i++)input.write('x'.repeat(1024));input.write('"}\n');assert.equal(calls,0);
 input.write('{"type":"shutdown"}\n');assert.equal(calls,1);
});
test('UTF-8 limits apply to bytes and a valid command after an oversized multi-byte line survives',()=>{
 const input=new PassThrough();let calls=0;attachDesktopControl(input,()=>calls++,32);
 input.write('{"type":"shutdown","x":"μμμμμμμμ"}\n');assert.equal(calls,0);input.write('{"type":"shutdown"}\n');assert.equal(calls,1);
});
test('parent stdin EOF closes the server even with an incomplete pending command',async()=>{
 const input=new PassThrough();let calls=0;attachDesktopControl(input,()=>calls++);input.write('{"type":');input.end();await new Promise<void>(resolve=>input.once('end',resolve));assert.equal(calls,1);
});
test('lost or failed parent pipe closes the server once',()=>{
 for(const event of ['close','error'] as const){const input=new PassThrough();let calls=0;attachDesktopControl(input,()=>calls++);if(event==='error')input.emit(event,Error('Lost parent'));else input.emit(event);assert.equal(calls,1);assert.equal(input.listenerCount('data'),0);}
});
test('already ended input and explicit disposal cannot leave listeners or trigger duplicate shutdown',()=>{
 const input=new PassThrough();input.destroy();let calls=0;const dispose=attachDesktopControl(input,()=>calls++);assert.equal(calls,1);dispose();assert.equal(calls,1);
 assert.throws(()=>attachDesktopControl(new PassThrough(),()=>{},0),/command limit/);assert.throws(()=>attachDesktopControl(new PassThrough(),()=>{},1e9),/command limit/);
});
