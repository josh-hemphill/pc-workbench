import {build} from 'esbuild';
import {Buffer} from 'node:buffer';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2'};
const assets:Record<string,{base64:string;mime:string}>={};
async function collect(directory:string,prefix=''){for(const entry of await fs.readdir(directory,{withFileTypes:true})){const name=prefix+'/'+entry.name,filename=path.join(directory,entry.name);if(entry.isDirectory())await collect(filename,name);else if(entry.isFile())assets[name]={base64:Buffer.from(await fs.readFile(filename)).toString('base64'),mime:mime[path.extname(name)]||'application/octet-stream'};else throw Error('Frontend assets must be regular files: '+filename);}}
await collect(path.join(root,'dist'));if(!assets['/index.html'])throw Error('Build the frontend before the backend.');
await build({stdin:{contents:`import {startNodeServer} from './server/node-serve.ts';import {Buffer} from 'node:buffer';const encoded=${JSON.stringify(assets)};const assets=Object.fromEntries(Object.entries(encoded).map(([name,value])=>[name,{data:Buffer.from(value.base64,'base64'),mime:value.mime}]));startNodeServer({assets},process.argv.includes('--desktop'));`,resolveDir:root,loader:'ts',sourcefile:'node-standalone-entry.ts'},outfile:path.join(root,'.standalone/server.cjs'),bundle:true,platform:'node',format:'cjs',target:'node24',define:{'import.meta.url':'undefined'},minifyWhitespace:true,legalComments:'eof'});
console.log('Bundled Node backend and frontend: .standalone/server.cjs');
