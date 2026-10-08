import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {resolveRuntimeConfig} from '../server/runtime-config';

const options=(home:string)=>({home,env:{},platform:process.platform,sourceRoot:path.join(home,'source')});
const configFiles=new Map<string,string>();
function fixture(run:(home:string)=>void){const home=fs.mkdtempSync(path.join(os.tmpdir(),'bench-runtime-'));try{configFiles.set(home,resolveRuntimeConfig(options(home)).configFile);run(home);}finally{configFiles.delete(home);fs.rmSync(home,{recursive:true,force:true});}}
function settings(home:string,value:unknown){const file=configFiles.get(home)!;fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));return file;}

test('development keeps repository data while standalone defaults to per-user data without writing directories',()=>fixture(home=>{
 const base=options(home),dev=resolveRuntimeConfig(base),standalone=resolveRuntimeConfig({...base,standalone:true});
 const userData=process.platform==='win32'?path.join(home,'AppData','Local','pc-workbench','data'):process.platform==='darwin'?path.join(home,'Library','Application Support','pc-workbench','data'):path.join(home,'.local','share','pc-workbench');
 const userConfig=process.platform==='win32'?path.join(home,'AppData','Roaming','pc-workbench','config.json'):process.platform==='darwin'?path.join(home,'Library','Application Support','pc-workbench','config.json'):path.join(home,'.config','pc-workbench','config.json');
 assert.equal(dev.dataDir,path.join(home,'source','data'));assert.equal(standalone.dataDir,userData);assert.equal(dev.configFile,userConfig);assert.equal(dev.port,3001);
 assert.deepEqual(fs.readdirSync(home),[]);
}));
test('standard per-user settings resolve relative storage beside the config and optional port',()=>fixture(home=>{
 const file=settings(home,{dataDir:'../../research data',port:4100});const config=resolveRuntimeConfig(options(home));
 assert.equal(config.configFile,file);assert.equal(config.dataDir,path.resolve(path.dirname(file),'../../research data'));assert.equal(config.port,4100);
}));
test('explicit config selection and environment overrides preserve documented precedence',()=>fixture(home=>{
 settings(home,{dataDir:'standard'});const file=path.join(home,'chosen.json');fs.writeFileSync(file,JSON.stringify({dataDir:'chosen',port:4100}));
 const result=resolveRuntimeConfig({...options(home),env:{BENCH_CONFIG_FILE:file,BENCH_DATA_DIR:path.join(home,'override'),PORT:'4200'}});
 assert.equal(result.configFile,file);assert.equal(result.dataDir,path.join(home,'override'));assert.equal(result.port,4200);
}));
test('home expansion applies to config selection, configured storage and environment storage',()=>fixture(home=>{
 const file=path.join(home,'chosen.json');fs.writeFileSync(file,JSON.stringify({dataDir:'~/research'}));
 assert.equal(resolveRuntimeConfig({...options(home),env:{BENCH_CONFIG_FILE:'~/chosen.json'}}).dataDir,path.join(home,'research'));
 assert.equal(resolveRuntimeConfig({...options(home),env:{BENCH_DATA_DIR:'~/override'}}).dataDir,path.join(home,'override'));
 assert.throws(()=>resolveRuntimeConfig({...options(home),env:{BENCH_DATA_DIR:'~another/research'}}),/use ~\//);
}));
test('an explicitly missing config fails rather than quietly using a fresh default',()=>fixture(home=>{
 const missing=path.join(home,'missing.json');assert.throws(()=>resolveRuntimeConfig({...options(home),env:{BENCH_CONFIG_FILE:missing}}),error=>error instanceof Error&&error.message.includes(missing)&&error.message.includes('startup stopped'));
}));
test('invalid JSON, malformed settings and unknown keys fail even with a data-directory override',()=>fixture(home=>{
 const file=settings(home,{dataDir:'valid'});fs.writeFileSync(file,'{"dataDir":');assert.throws(()=>resolveRuntimeConfig(options(home)),/Invalid JSON/);
 for(const value of [null,[],true,{},{dataDir:''},{dataDir:'   '},{dataDir:42},{dataDir:'ok',typo:'other'}]){
  fs.writeFileSync(file,JSON.stringify(value));assert.throws(()=>resolveRuntimeConfig({...options(home),env:{BENCH_DATA_DIR:path.join(home,'override')}}),/Cannot load PC Workbench settings/);
 }
}));
test('invalid configured and environment ports cannot silently fall back',()=>fixture(home=>{
 for(const port of [0,65536,1.5,'3001',null]){settings(home,{dataDir:'valid',port});assert.throws(()=>resolveRuntimeConfig(options(home)),/port must be an integer/);}
 settings(home,{dataDir:'valid'});for(const PORT of ['','NaN','3e3','3000.5','0','65536'])assert.throws(()=>resolveRuntimeConfig({...options(home),env:{PORT}}),/PORT must be an integer/);
}));
test('Linux XDG paths select user config and local data consistently',()=>{
 const home='/home/example',env={XDG_CONFIG_HOME:'/home/example/settings',XDG_DATA_HOME:'/home/example/userdata'};const config=resolveRuntimeConfig({home,platform:'linux',env,standalone:true});
 assert.equal(config.configFile,'/home/example/settings/pc-workbench/config.json');assert.equal(config.dataDir,'/home/example/userdata/pc-workbench');
 assert.throws(()=>resolveRuntimeConfig({home,platform:'linux',env:{XDG_CONFIG_HOME:'relative'}}),/absolute directory/);
});
test('macOS defaults use Library Application Support and ignore Linux-specific environment paths',()=>{
 const config=resolveRuntimeConfig({home:'/home/example',env:{XDG_CONFIG_HOME:'/different'},platform:'darwin',standalone:true});
 assert.equal(config.configFile,'/home/example/Library/Application Support/pc-workbench/config.json');assert.equal(config.dataDir,'/home/example/Library/Application Support/pc-workbench/data');
});
test('Windows paths honor roaming config and local data overrides with home-based fallbacks',()=>{
 const fallback=resolveRuntimeConfig({home:'C:\\Users\\Example',env:{},platform:'win32',standalone:true});
 assert.equal(fallback.configFile,'C:\\Users\\Example\\AppData\\Roaming\\pc-workbench\\config.json');assert.equal(fallback.dataDir,'C:\\Users\\Example\\AppData\\Local\\pc-workbench\\data');
 const configured=resolveRuntimeConfig({home:'C:\\Users\\Example',env:{APPDATA:'D:\\Roaming',LOCALAPPDATA:'D:\\Local'},platform:'win32',standalone:true});
 assert.equal(configured.configFile,'D:\\Roaming\\pc-workbench\\config.json');assert.equal(configured.dataDir,'D:\\Local\\pc-workbench\\data');
});
test('empty or null-containing path overrides and directory config files fail with actionable errors',()=>fixture(home=>{
 for(const BENCH_DATA_DIR of ['', '   ', 'bad\0path'])assert.throws(()=>resolveRuntimeConfig({...options(home),env:{BENCH_DATA_DIR}}),/nonempty path/);
 assert.throws(()=>resolveRuntimeConfig({...options(home),env:{BENCH_CONFIG_FILE:''}}),/BENCH_CONFIG_FILE/);
 assert.throws(()=>resolveRuntimeConfig({...options(home),env:{BENCH_CONFIG_FILE:home}}),/Cannot load PC Workbench settings/);
}));
test('a broken standard config symlink is not treated as an absent user configuration',{skip:process.platform==='win32'?'Creating file symlinks on Windows requires administrator privileges or Developer Mode.':false},()=>fixture(home=>{
 const file=configFiles.get(home)!;fs.mkdirSync(path.dirname(file),{recursive:true});fs.symlinkSync(path.join(home,'lost-config.json'),file);
 assert.throws(()=>resolveRuntimeConfig(options(home)),/startup stopped/);
}));
test('UTF-8 BOM settings from Windows PowerShell preserve paths, Unicode and port',()=>fixture(home=>{
 const file=settings(home,{dataDir:'research-μ',port:4100});fs.writeFileSync(file,'\uFEFF'+fs.readFileSync(file,'utf8'),'utf8');
 const config=resolveRuntimeConfig({...options(home),env:{BENCH_CONFIG_FILE:file}});
 assert.equal(config.dataDir,path.resolve(path.dirname(file),'research-μ'));assert.equal(config.port,4100);
}));
