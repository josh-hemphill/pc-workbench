// Prepare a verified sidecar bundle input. This does not compile a Tauri host.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../../',import.meta.url));
const triples={win32:{x64:'x86_64-pc-windows-msvc',arm64:'aarch64-pc-windows-msvc'},darwin:{x64:'x86_64-apple-darwin',arm64:'aarch64-apple-darwin'},linux:{x64:'x86_64-unknown-linux-gnu',arm64:'aarch64-unknown-linux-gnu'}};
const triple=triples[process.platform]?.[process.arch];if(!triple)throw Error('Unsupported Tauri desktop target.');
const ext=process.platform==='win32'?'.exe':'';
const source=path.join(root,'bin',`pc-workbench-node-${process.platform}-${process.arch}${ext}`);
const manifest=JSON.parse(await fs.readFile(source+'.json','utf8')),bytes=await fs.readFile(source);
if(manifest.nativeWindow||manifest.platform!==process.platform||manifest.arch!==process.arch||manifest.sha256!==createHash('sha256').update(bytes).digest('hex'))throw Error('Sidecar manifest does not match this backend artifact.');
const stage=path.join(root,'.standalone/tauri');await fs.mkdir(path.join(stage,'binaries'),{recursive:true});
const target=path.join(stage,'binaries',`pc-workbench-backend-${triple}${ext}`);await fs.writeFile(target,bytes,{mode:0o755});await fs.chmod(target,0o755);
const fragment={bundle:{externalBin:['binaries/pc-workbench-backend']}};
await fs.writeFile(path.join(stage,'bundle.fragment.json'),JSON.stringify(fragment,null,2)+'\n');
console.log(JSON.stringify({target,targetTriple:triple,nativeHostBuilt:false,backendProtocol:'--desktop; JSON ready on stdout; shutdown on stdin; EOF also stops backend'},null,2));
