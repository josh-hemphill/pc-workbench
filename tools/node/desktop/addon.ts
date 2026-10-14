import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {getAsset,isSea} from 'node:sea';
export const addonKey='pc-workbench-webviewjs-addon';
export function extractAddon(bytes:Buffer,cacheDir:string):string {
 const digest=createHash('sha256').update(bytes).digest('hex');
 const directory=path.join(cacheDir,'native',`webviewjs-0.4.7-${process.platform}-${process.arch}-${digest}`);
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 if(!fs.lstatSync(directory).isDirectory()||fs.lstatSync(directory).isSymbolicLink())throw Error('Native cache must be a real directory.');
 const filename=path.join(directory,'webview.node');
 function verify(){const stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink()||createHash('sha256').update(fs.readFileSync(filename)).digest('hex')!==digest)throw Error('Native addon cache integrity check failed. Remove the native cache and retry.');}
 let present=false;try{fs.lstatSync(filename);present=true;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 if(present){verify();return filename;}
 const temporary=path.join(directory,randomUUID()+'.tmp');
 try{fs.writeFileSync(temporary,bytes,{flag:'wx',mode:0o600});fs.renameSync(temporary,filename);}finally{fs.rmSync(temporary,{force:true});}
 verify();return filename;
}
export function prepareAddon(cacheDir:string):string|undefined {
 if(!isSea())return undefined;
 const filename=extractAddon(Buffer.from(getAsset(addonKey)),cacheDir);
 process.env.NAPI_RS_NATIVE_LIBRARY_PATH=filename;
 return filename;
}
