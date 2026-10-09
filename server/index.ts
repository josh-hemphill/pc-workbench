import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolveRuntimeConfig} from './runtime-config';
import {createApp as createRuntimeApp,type AppOptions} from './app';
export type {AppOptions} from './app';
const root=import.meta.url?path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'):path.dirname(process.execPath);
export function createApp(dataDir?:string,options:AppOptions={}) {
 return createRuntimeApp(dataDir??resolveRuntimeConfig({sourceRoot:root,standalone:false}).dataDir,{...options,sourceRoot:root});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const runtime=resolveRuntimeConfig({sourceRoot:root});
 const server=createApp(runtime.dataDir).listen(runtime.port,'127.0.0.1',()=>console.log(`Bench API / production app: http://127.0.0.1:${runtime.port}\nData directory: ${runtime.dataDir}`));
 for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>server.close());
}
