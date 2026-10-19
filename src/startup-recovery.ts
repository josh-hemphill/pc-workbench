/** Only module transport failures are recoverable by refreshing the module graph. */
export function isModuleLoadFailure(error:unknown){
 return error instanceof Error&&(/failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|outdated optimize dep/i.test(error.message)||error instanceof TypeError&&error.message==='Load failed');
}
export interface StartupRetry {startedAt:number;attempts:number}
export const startupRetryKey='bench.startup-retry';
export const startupRetryLimit=3;
export function nextStartupRetry(serialized:string|null,now=Date.now()):StartupRetry|null{
 let previous:StartupRetry={startedAt:now,attempts:0};
 try{
  const value=JSON.parse(serialized||'null');
  if(value&&Number.isFinite(value.startedAt)&&value.startedAt<=now&&Number.isInteger(value.attempts)&&value.attempts>=0)previous=value;
 }catch{/* A malformed browser-only counter starts a new bounded attempt. */}
 return previous.attempts<startupRetryLimit?{startedAt:previous.startedAt,attempts:previous.attempts+1}:null;
}
