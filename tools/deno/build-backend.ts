import { build, stop } from 'npm:esbuild@0.28.2';
import { Buffer } from 'node:buffer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const bundlePath = path.join(root, 'desktop/server-bundle.mjs');
const mimeTypes: Record<string,string> = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2'};

/** Bundle only the shared app and its actual dependencies; no Node executable. */
export async function buildBackend() {
 const assets: Record<string,{base64:string;mime:string}> = {};
 async function collect(directory:string,prefix='') {
  for await(const entry of Deno.readDir(directory)) {
   const filename=path.join(directory,entry.name),name=`${prefix}/${entry.name}`;
   if(entry.isDirectory)await collect(filename,name);
   else if(entry.isFile)assets[name]={base64:Buffer.from(await Deno.readFile(filename)).toString('base64'),mime:mimeTypes[path.extname(name)]||'application/octet-stream'};
   else throw Error(`Frontend assets must be regular files: ${filename}`);
  }
 }
 await collect(path.join(root,'dist'));
 if(!assets['/index.html'])throw Error('Frontend build missing: run deno task build.');
 try {
  await build({stdin:{contents:`export {createApp} from './server/app.ts';\nexport {resolveRuntimeConfig} from './server/runtime-config.ts';\nimport {Buffer} from 'node:buffer';\nconst encoded=${JSON.stringify(assets)};\nexport const assets=Object.fromEntries(Object.entries(encoded).map(([name,value])=>[name,{data:Buffer.from(value.base64,'base64'),mime:value.mime}]));`,resolveDir:root,sourcefile:'deno-server-entry.ts',loader:'ts'},outfile:bundlePath,bundle:true,platform:'node',format:'esm',target:'es2022',minifyWhitespace:true,legalComments:'none',banner:{js:"import {createRequire as __denoCreateRequire} from 'node:module'; const require=__denoCreateRequire(import.meta.url);"},logLevel:'warning'});
 } finally {stop();}
 console.log(`Deno backend bundle: ${bundlePath}`);
}
if(import.meta.main)await buildBackend();
