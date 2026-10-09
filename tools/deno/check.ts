// vue-tsc needs TypeScript's JavaScript compiler API; use the pinned TS 6 package.
// Both the CLI and compiler execute in this Deno process.
import { createRequire } from 'node:module';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { run } from 'vue-tsc';
const root=fileURLToPath(new URL('../../',import.meta.url));
const require=createRequire(import.meta.url);
process.argv=[Deno.execPath(),'vue-tsc','--noEmit','--project',`${root}/tsconfig.json`];
run(require.resolve('typescript/lib/tsc'));
