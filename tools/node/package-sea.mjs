import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {inject} from 'postject';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
if(Number(process.versions.node.split('.')[0])!==24)throw Error('Use Node 24 for this SEA prototype.');
const stage=await fs.mkdtemp(path.join(root,'.standalone/sea-'));
const output=path.join(root,'bin',`pc-workbench-node-${process.platform}-${process.arch}${process.platform==='win32'?'.exe':''}`);
function run(command,args){const result=spawnSync(command,args,{stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)throw Error(`${command} failed (${result.status}).`);}
try{
 await fs.mkdir(path.dirname(output),{recursive:true});
 const configFile=path.join(stage,'sea.json'),blob=path.join(stage,'sea.blob');
 await fs.writeFile(configFile,JSON.stringify({main:path.join(root,'.standalone/server.cjs'),output:blob,disableExperimentalSEAWarning:true,useSnapshot:false,useCodeCache:false}));
 run(process.execPath,['--experimental-sea-config',configFile]);
 await fs.copyFile(process.execPath,output);await fs.chmod(output,0o755);
 if(process.platform==='darwin')run('codesign',['--remove-signature',output]);
 await inject(output,'NODE_SEA_BLOB',await fs.readFile(blob),{sentinelFuse:'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',...(process.platform==='darwin'?{machoSegmentName:'NODE_SEA'}:{})});
 if(process.platform==='darwin')run('codesign',['--sign','-',output]);
 const bytes=await fs.readFile(output),manifest={prototype:true,nodeVersion:process.version,platform:process.platform,arch:process.arch,bytes:bytes.length,nodeRuntimeBytes:(await fs.stat(process.execPath)).size,sha256:createHash('sha256').update(bytes).digest('hex'),nativeWindow:false,embeddedNodeRuntime:true,externalNodeRequired:false,externalFrontendRequired:false};
 await fs.writeFile(output+'.json',JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({output,...manifest},null,2));
}finally{await fs.rm(stage,{recursive:true,force:true});}
