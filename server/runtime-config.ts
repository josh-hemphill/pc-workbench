import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface RuntimeConfigOptions {
  standalone?: boolean;
  sourceRoot?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
}
export interface RuntimeConfig { configFile: string; dataDir: string; port: number }

/** Resolve user settings without creating directories or changing process state. */
export function resolveRuntimeConfig(options:RuntimeConfigOptions={}):RuntimeConfig {
  const env=options.env??process.env,platform=options.platform??process.platform;
  const paths=platform==='win32'?path.win32:path.posix;
  const home=options.home??os.homedir();
  const nonempty=(value:unknown,label:string):string=>{
    if(typeof value!=='string'||!value.trim()||value.includes('\0'))throw new Error(`${label} must be a nonempty path string without null characters.`);
    return value.trim();
  };
  const expand=(value:string)=>{
    if(value==='~')return home;
    if(value.startsWith('~/')||value.startsWith('~\\'))return paths.join(home,value.slice(2));
    if(value.startsWith('~'))throw new Error(`Cannot expand ${value}: use ~/ for the current user's home directory.`);
    return value;
  };
  const directory=(name:string,fallback:string)=>{
    if(env[name]===undefined)return fallback;
    const value=expand(nonempty(env[name],name));
    if(!paths.isAbsolute(value))throw new Error(`${name} must be an absolute directory path.`);
    return value;
  };
  const app='pc-workbench';
  let configDir:string,dataDefault:string;
  if(platform==='win32') {
    configDir=paths.join(directory('APPDATA',paths.join(home,'AppData','Roaming')),app);
    dataDefault=paths.join(directory('LOCALAPPDATA',paths.join(home,'AppData','Local')),app,'data');
  }else if(platform==='darwin') {
    configDir=paths.join(home,'Library','Application Support',app);
    dataDefault=paths.join(configDir,'data');
  }else {
    configDir=paths.join(directory('XDG_CONFIG_HOME',paths.join(home,'.config')),app);
    dataDefault=paths.join(directory('XDG_DATA_HOME',paths.join(home,'.local','share')),app);
  }
  const explicitConfig=env.BENCH_CONFIG_FILE!==undefined;
  const configFile=explicitConfig?paths.resolve(expand(nonempty(env.BENCH_CONFIG_FILE,'BENCH_CONFIG_FILE'))):paths.join(configDir,'config.json');
  let fileSettings:{dataDir:string;port?:number}|undefined;
  try {
    const raw=fs.readFileSync(configFile,'utf8');
    let parsed:unknown;
    try{parsed=JSON.parse(raw.replace(/^\uFEFF/,''));}catch(error){throw new Error(`Invalid JSON: ${(error as Error).message}`);}
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('Settings must be a JSON object with dataDir and optional port.');
    const settings=parsed as Record<string,unknown>;
    const unknown=Object.keys(settings).filter(key=>key!=='dataDir'&&key!=='port');
    if(unknown.length)throw new Error(`Unknown setting${unknown.length===1?'':'s'}: ${unknown.join(', ')}. Supported settings are dataDir and port.`);
    const dataDir=nonempty(settings.dataDir,'dataDir');
    if(settings.port!==undefined&&(typeof settings.port!=='number'||!Number.isInteger(settings.port)||settings.port<1||settings.port>65535))throw new Error('port must be an integer from 1 to 65535.');
    fileSettings={dataDir,...(settings.port!==undefined?{port:settings.port as number}:{})};
  }catch(error) {
    let absent=false;
    if((error as NodeJS.ErrnoException).code==='ENOENT'&&!explicitConfig) {
      // A broken symlink is a configured file that cannot be read, not an absent configuration.
      try{fs.lstatSync(configFile);}catch(statError){absent=(statError as NodeJS.ErrnoException).code==='ENOENT';}
    }
    if(absent)fileSettings=undefined;
    else throw new Error(`Cannot load PC Workbench settings at ${configFile}: ${(error as Error).message} Fix this file${explicitConfig?' or BENCH_CONFIG_FILE':''}; startup stopped to avoid using an unintended data directory.`,{cause:error});
  }
  let dataDir:string;
  if(env.BENCH_DATA_DIR!==undefined)dataDir=paths.resolve(expand(nonempty(env.BENCH_DATA_DIR,'BENCH_DATA_DIR')));
  else if(fileSettings)dataDir=paths.resolve(paths.dirname(configFile),expand(fileSettings.dataDir));
  else dataDir=options.standalone?dataDefault:paths.resolve(options.sourceRoot??process.cwd(),'data');
  let port=fileSettings?.port??3001;
  if(env.PORT!==undefined) {
    const value=env.PORT.trim();
    if(!/^\d+$/.test(value)||!Number.isInteger(Number(value))||Number(value)<1||Number(value)>65535)throw new Error('PORT must be an integer from 1 to 65535.');
    port=Number(value);
  }
  return {configFile,dataDir,port};
}
