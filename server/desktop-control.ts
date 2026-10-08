import type { Readable } from 'node:stream';

/** A bounded line protocol for the parent desktop process; no HTTP control surface. */
export function attachDesktopControl(input:Readable,shutdown:()=>void,maxLineBytes=4096):()=>void {
  if(!Number.isInteger(maxLineBytes)||maxLineBytes<1||maxLineBytes>65536)throw Error('Desktop command limit must be between 1 and 65536 bytes.');
  const line=Buffer.alloc(maxLineBytes);let length=0,overflow=false,stopped=false;
  const dispose=()=>{if(stopped)return;stopped=true;input.off('data',data);input.off('end',finish);input.off('close',finish);input.off('error',finish);input.pause();};
  const finish=()=>{if(stopped)return;dispose();shutdown();};
  const data=(chunk:Buffer|string)=>{
    const bytes=typeof chunk==='string'?Buffer.from(chunk):chunk;
    for(const byte of bytes) {
      if(stopped)break;
      if(byte===10) {
        if(!overflow){try{const command:unknown=JSON.parse(line.subarray(0,length).toString('utf8'));if(command&&typeof command==='object'&&!Array.isArray(command)&&(command as {type?:unknown}).type==='shutdown')finish();}catch{/* Malformed or unrelated commands do not change server state. */}}
        length=0;overflow=false;
      }else if(!overflow){if(length===maxLineBytes){overflow=true;length=0;}else line[length++]=byte;}
    }
  };
  input.on('data',data);input.once('end',finish);input.once('close',finish);input.once('error',finish);
  if(input.readableEnded||input.destroyed)finish();
  return dispose;
}
