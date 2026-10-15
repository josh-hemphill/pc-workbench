import {build,createServer} from 'vite';
import vue from '@vitejs/plugin-vue';
import {fileURLToPath} from 'node:url';
import {resolveRuntimeConfig} from '../../server/runtime-config.ts';
export const root=fileURLToPath(new URL('../../',import.meta.url));
export async function frontend(mode:string){
 const config={root,configFile:false as const,clearScreen:false,plugins:[vue()],server:{host:'127.0.0.1',port:5173,strictPort:true,proxy:{'/api':`http://127.0.0.1:${resolveRuntimeConfig({sourceRoot:root}).port}`}}};
 if(mode==='build'){await build(config);return;}
 if(mode!=='dev')throw Error('Expected build or dev.');
 const server=await createServer(config);await server.listen();server.printUrls();return server;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])await frontend(process.argv[2]||'build');
