import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { createApp } from '../server/index';

test('appearance persists across server origins without changing record revisions or accepting invalid preferences', async () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bench-appearance-'));
  let server:Server|undefined;
  const open=async()=>{
    server=createApp(directory).listen(0,'127.0.0.1');
    await new Promise<void>(resolve=>server!.once('listening',resolve));
    return `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  };
  const close=async()=>{server!.closeAllConnections();await new Promise<void>(resolve=>server!.close(()=>resolve()));server=undefined;};
  try {
    let origin=await open();
    assert.deepEqual(await (await fetch(`${origin}/api/preferences`)).json(),{theme:'system'});
    const before=await (await fetch(`${origin}/api/state`)).json();
    const save=await fetch(`${origin}/api/preferences`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({theme:'dark'})});
    assert.equal(save.status,200);assert.deepEqual(await save.json(),{theme:'dark'});
    assert.equal((await (await fetch(`${origin}/api/state`)).json()).revision,before.revision);
    await close();origin=await open();
    assert.deepEqual(await (await fetch(`${origin}/api/preferences`)).json(),{theme:'dark'});
    for(const body of [{theme:'invalid'},{theme:'light',unexpected:true},null,[]]){
      const invalid=await fetch(`${origin}/api/preferences`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      assert.equal(invalid.status,400);await invalid.text();
    }
    const foreign=await fetch(`${origin}/api/preferences`,{method:'PUT',headers:{'Content-Type':'application/json',Origin:'https://foreign.example'},body:JSON.stringify({theme:'light'})});
    assert.equal(foreign.status,403);await foreign.text();
    assert.deepEqual(await (await fetch(`${origin}/api/preferences`)).json(),{theme:'dark'});
    assert.equal(Object.hasOwn(await (await fetch(`${origin}/api/backup`)).json(),'theme'),false);
  } finally {if(server)await close();fs.rmSync(directory,{recursive:true,force:true});}
});
