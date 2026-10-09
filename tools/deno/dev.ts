// Supervise Deno-native backend/frontend processes; stopping either stops both.
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
// Only one process may populate node_modules. Concurrent auto-installers can
// contend for its locks, and their progress redraws overwrite Vite's output.
console.log('Preparing Deno dependencies (frontend and API start after installation)...');
const install=await new Deno.Command(Deno.execPath(),{cwd:root,args:['install','--config',`${root}/deno.json`,'--frozen','--node-modules-dir=auto'],stdin:'inherit',stdout:'inherit',stderr:'inherit'}).spawn().status;
if(!install.success){console.error('Dependency installation failed; run deno install --frozen to diagnose it.');Deno.exit(install.code);}
console.log('Dependencies ready. Starting API and Vite...');
const children=['server/serve.ts','tools/deno/frontend.ts'].map((script,index)=>new Deno.Command(Deno.execPath(),{cwd:root,args:['run','--config',`${root}/deno.json`,'--node-modules-dir=manual','--cached-only','-A',...(index===0?['--watch','--no-clear-screen']:[]),script,...(index===1?['dev']:[])],stdin:'inherit',stdout:'inherit',stderr:'inherit'}).spawn());
let stopping=false;
let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
function stop(){
  if(stopping)return;
  stopping=true;
  for(const child of children)try{child.kill('SIGTERM');}catch{/* already exited */}
  // Deno's watcher can survive a graceful exit of the watched application.
  // Give the API time to close SQLite before terminating any remaining watcher.
  shutdownTimer=setTimeout(()=>{
    for(const child of children)try{child.kill('SIGKILL');}catch{/* already exited */}
  },6000);
}
Deno.addSignalListener('SIGINT',stop);if(Deno.build.os!=='windows')Deno.addSignalListener('SIGTERM',stop);
try{const first=await Promise.race(children.map(child=>child.status));const signaled=stopping;stop();await Promise.all(children.map(child=>child.status));Deno.exitCode=signaled?0:first.code;}finally{stop();if(shutdownTimer!==undefined)clearTimeout(shutdownTimer);}
