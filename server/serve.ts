import {createApp} from './app.ts';
import {resolveRuntimeConfig} from './runtime-config.ts';
import {fileURLToPath} from 'node:url';
import {setTimeout} from 'node:timers';
const root=fileURLToPath(new URL('../',import.meta.url));
const config=resolveRuntimeConfig({sourceRoot:root}),app=createApp(config.dataDir,{sourceRoot:root});
const server=app.listen(config.port,'127.0.0.1',()=>console.log(`Deno API: http://127.0.0.1:${config.port}\nData: ${config.dataDir}`));
let closing=false;
function close(){if(closing)return;closing=true;server.close(()=>Deno.exit());server.closeIdleConnections();setTimeout(()=>server.closeAllConnections(),5000).unref();}
Deno.addSignalListener('SIGINT',close);if(Deno.build.os!=='windows')Deno.addSignalListener('SIGTERM',close);
server.once('error',error=>{console.error(error);Deno.exitCode=1;});
