import path from 'node:path';
import {root,bundlePath} from './build-backend.ts';

const target=Deno.args[0]||'win-x64';
const triples:Record<string,string>={'win-x64':'x86_64-pc-windows-msvc','linux-x64':'x86_64-unknown-linux-gnu'};
if(!triples[target])throw Error('Usage: deno task package [win-x64|linux-x64]');
if(Deno.version.deno!=='2.9.7')throw Error('This desktop runtime requires Deno 2.9.7.');
const name=`pc-workbench-${target}`,buildDirectory=path.join(root,'.standalone','desktop',target),output=path.join(buildDirectory,name);
await Deno.stat(bundlePath).catch(()=>{throw Error('Backend bundle missing: run deno task build.');});
const stage=await Deno.makeTempDir({prefix:'pc-workbench-desktop-stage-'});
await Deno.mkdir(buildDirectory,{recursive:true});
try{
 await Deno.remove(output,{recursive:true}).catch(error=>{if(!(error instanceof Deno.errors.NotFound))throw error;});
 for(const filename of ['deno.json','main.ts','backend.ts','proxy-server.ts','server-bundle.mjs','server-bundle.d.mts'])await Deno.copyFile(path.join(root,'desktop',filename),path.join(stage,filename));
 const result=await new Deno.Command(Deno.execPath(),{cwd:stage,args:['desktop','--backend','webview','--target',triples[target],'--output',output,'--no-code-cache','--allow-read','--allow-write','--allow-env','--allow-sys','--allow-net=127.0.0.1,pcpartpicker.com','--no-prompt','main.ts'],stdout:'inherit',stderr:'inherit'}).spawn().status;
 if(!result.success)throw Error(`Deno desktop build failed (${result.code}).`);
}finally{await Deno.remove(stage,{recursive:true});}
await Deno.copyFile(path.join(root,'docs','DENO.md'),path.join(output,'README.md'));
const hash=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))).map(value=>value.toString(16).padStart(2,'0')).join('');
const files:{path:string;bytes:number;sha256:string}[]=[];
async function inspect(directory:string,prefix=''){
 for await(const entry of Deno.readDir(directory)){
  const filename=path.join(directory,entry.name),relative=prefix+entry.name;
  if(entry.isDirectory)await inspect(filename,`${relative}/`);
  else if(entry.isFile){const bytes=await Deno.readFile(filename);files.push({path:relative,bytes:bytes.length,sha256:await hash(bytes)});}
  else throw Error(`Unexpected packaging entry: ${filename}`);
 }
}
await inspect(output);
if(files.some(file=>/pc-workbench-server|node\.exe|node_modules/.test(file.path)))throw Error('Unexpected sidecar or npm directory in runtime package.');
const manifest={experimentalDesktop:true,requires:target==='win-x64'?['Microsoft Edge WebView2 Runtime','Microsoft Visual C++ 2015–2022 Redistributable (x64)']:['GTK3','WebKitGTK 4.1'],target,denoVersion:Deno.version.deno,backend:'webview',applicationBackend:'in-process Deno node:sqlite + Express',nodeSidecar:false,builtAt:new Date().toISOString(),files};
await Deno.writeTextFile(path.join(output,'build.json'),JSON.stringify(manifest,null,2));
const bin=path.join(root,'bin');await Deno.mkdir(bin,{recursive:true});const zipPath=path.join(bin,`${name}.zip`);
await Deno.remove(zipPath).catch(error=>{if(!(error instanceof Deno.errors.NotFound))throw error;});
const command=Deno.build.os==='windows'
 ?new Deno.Command('powershell.exe',{args:['-NoProfile','-NonInteractive','-Command','Compress-Archive -LiteralPath $env:BENCH_DENO_PACKAGE_DIR -DestinationPath $env:BENCH_DENO_PACKAGE_ZIP -Force'],env:{BENCH_DENO_PACKAGE_DIR:output,BENCH_DENO_PACKAGE_ZIP:zipPath},stdout:'inherit',stderr:'inherit'})
 :new Deno.Command('zip',{cwd:buildDirectory,args:['-q','-r',zipPath,name],stdout:'inherit',stderr:'inherit'});
const zipped=await command.spawn().status;if(!zipped.success)throw Error('ZIP packaging failed; install zip on Unix build hosts.');
const sha256=await hash(await Deno.readFile(zipPath));
await Deno.writeTextFile(`${zipPath}.sha256`,`${sha256}  ${path.basename(zipPath)}\n`);await Deno.writeTextFile(`${zipPath}.build.json`,JSON.stringify({...manifest,sha256},null,2));
console.log(`Deno desktop package: ${zipPath}\nSHA-256: ${sha256}`);
