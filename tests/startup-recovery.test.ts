import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isModuleLoadFailure,nextStartupRetry,startupRetryLimit,type StartupRetry} from '../src/startup-recovery.ts';
test('startup retries only recognizable module transport failures, not application exceptions',()=>{
 for(const message of ['Failed to fetch dynamically imported module: http://localhost/src/main.ts','error loading dynamically imported module','Importing a module script failed.','504 Outdated Optimize Dep','Load failed'])assert(isModuleLoadFailure(new TypeError(message)));
 for(const error of [new TypeError('Cannot read properties of undefined'),new SyntaxError('Unexpected token'),new Error('Invalid settings'),new TypeError('Failed to fetch'),null,'Failed to fetch dynamically imported module'])assert(!isModuleLoadFailure(error));
});
test('module recovery stops after a bounded number of reloads across documents',()=>{
 let stored:string|null=null;for(let i=1;i<=startupRetryLimit;i++){const next:StartupRetry=nextStartupRetry(stored,1000+i)!;assert.equal(next.attempts,i);stored=JSON.stringify(next);}
 assert.equal(nextStartupRetry(stored,2000),null);
 assert.equal(nextStartupRetry(stored,1000000),null);
 assert.equal(nextStartupRetry(null,1000000)!.attempts,1);
});
test('bad counters and clock changes cannot leave a new startup permanently blocked',()=>{
 for(const stored of ['bad json','null','{}','{"startedAt":9000,"attempts":3}','{"startedAt":0,"attempts":-1}','{"startedAt":0,"attempts":1.5}'])assert.deepEqual(nextStartupRetry(stored,1000),{startedAt:1000,attempts:1});
});
