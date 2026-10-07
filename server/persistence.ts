import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export class CommittedWriteError extends Error {
 constructor(public filename:string,cause:unknown){super(`File was replaced but directory durability could not be confirmed: ${filename}`,{cause});}
}

/** Flush contents before replacing a file; readers never see a partial CSV. */
export function durableWrite(filename: string, contents: string) {
 let committed=false;
 const temporary = `${filename}.${randomUUID()}.tmp`;
 try {
  const fd = fs.openSync(temporary, 'wx');
  try { fs.writeFileSync(fd, contents); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, filename);
  committed=true;
  // Windows does not support opening/fsyncing directories; the file itself is flushed.
  if(process.platform==='win32')return;
  const directory = fs.openSync(path.dirname(filename), 'r');
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
 } catch(error){if(committed)throw new CommittedWriteError(filename,error);throw error;} finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

/** A live server owns a workspace. Stale crash locks are recovered on startup. */
export function lockWorkspace(dir: string) {
 fs.mkdirSync(dir, {recursive:true});
 const filename = path.join(dir, '.server-lock.json');
 const token = randomUUID();
 for (let attempt = 0; attempt < 2; attempt++) {
  try {
   const fd = fs.openSync(filename, 'wx');
   try { fs.writeFileSync(fd, JSON.stringify({pid:process.pid, token})); } finally { fs.closeSync(fd); }
   let released = false;
   const release = () => {
    if (released) return;
    released = true;
    try { if (JSON.parse(fs.readFileSync(filename,'utf8')).token === token) fs.unlinkSync(filename); } catch { /* Already removed during cleanup. */ }
    process.removeListener('exit', release);
   };
   process.once('exit', release);
   return release;
  } catch (error) {
   if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
   let owner: {pid?:number};
   try { owner = JSON.parse(fs.readFileSync(filename,'utf8')); } catch { throw Error('Workspace lock is unreadable. Check that no server is running before removing .server-lock.json.'); }
   if (!Number.isInteger(owner.pid) || !owner.pid || owner.pid < 1) throw Error('Invalid workspace lock; check that no server is running before removing it.');
   try { process.kill(owner.pid, 0); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ESRCH') { fs.unlinkSync(filename); continue; }
    throw Error('Cannot verify workspace lock owner.');
   }
   throw Error(`Workspace is already open by server process ${owner.pid}. Stop that server before opening this data directory.`);
  }
 }
 throw Error('Could not acquire workspace lock.');
}
