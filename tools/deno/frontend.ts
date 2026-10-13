// Vite and its Vue plugin execute inside Deno; no Node child process is launched.
import { build, createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { resolveRuntimeConfig } from '../../server/runtime-config.ts';
export const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));
const mode = Deno.args[0] ?? 'build';
const apiPort=mode==='dev'?resolveRuntimeConfig({sourceRoot}).port:3001;
const config = { root:sourceRoot, configFile:false as const, clearScreen:false, plugins:[vue()], server:{host:'127.0.0.1',port:5173,proxy:{'/api':`http://127.0.0.1:${apiPort}`}} };
if(mode==='build')await build(config);
else if(mode==='dev'){
 const server=await createServer(config);await server.listen();server.printUrls();
 const close=()=>{void server.close().finally(()=>Deno.exit());};
 Deno.addSignalListener('SIGINT',close);if(Deno.build.os!=='windows')Deno.addSignalListener('SIGTERM',close);
}else throw Error('Expected frontend mode: build or dev.');
