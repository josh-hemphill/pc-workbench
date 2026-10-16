import childProcess from 'node:child_process';
import path from 'node:path';

function validatePID(pid:number){if(!Number.isSafeInteger(pid)||pid<1||pid>0x7fffffff)throw Error('Invalid lock owner process ID.');}

/** Enumerate PIDs without requesting permission to terminate another process. */
export function windowsProcessIsRunning(pid:number):boolean {
 validatePID(pid);
 const executable=path.win32.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 const script=`$ErrorActionPreference='Stop';try{if([System.Diagnostics.Process]::GetProcesses().Id -contains ${pid}){exit 0}else{exit 3}}catch{[Console]::Error.WriteLine($_.Exception.Message);exit 4}`;
 // A cold system PowerShell can take several seconds under startup/CI load.
 const result=childProcess.spawnSync(executable,['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:65536});
 if(result.error)throw result.error;
 if(result.status===0)return true;
 if(result.status===3)return false;
 throw Error(`Windows process lookup failed (${result.status??result.signal}): ${result.stderr?.trim()||'no diagnostic output'}`);
}

type ProbeOptions={platform?:NodeJS.Platform;signal?:(pid:number)=>void;windowsQuery?:(pid:number)=>boolean};
export function processIsRunning(pid:number,options:ProbeOptions={}):boolean {
 validatePID(pid);
 try{(options.signal??((owner:number)=>{process.kill(owner,0);}))(pid);return true;}
 catch(error){
  const code=(error as NodeJS.ErrnoException).code;
  if(code==='ESRCH')return false;
  if((options.platform??process.platform)==='win32'&&['EPERM','EACCES','EINVAL'].includes(code??''))return (options.windowsQuery??windowsProcessIsRunning)(pid);
  throw error;
 }
}

export function lockOwnerIsRunning(pid:number,filename:string,probe:typeof processIsRunning=processIsRunning):boolean {
 try{return probe(pid);}
 catch(cause){
  const detail=(cause as NodeJS.ErrnoException).code||(cause instanceof Error?cause.message:String(cause));
  throw Error(`Cannot verify lock owner PID ${pid} (${detail}). Lock: ${filename}. Stop other workbench instances, then retry. If the lock is left from a stopped server, verify that process has exited before removing this lock file.`,{cause});
 }
}
