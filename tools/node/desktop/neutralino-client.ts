import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {getAsset,isSea} from 'node:sea';
export const neutralinoClientKey='pc-workbench-neutralino-client';
export function neutralinoClient():string {
 if(isSea())return getAsset(neutralinoClientKey,'utf8');
 const require=createRequire(path.join(process.cwd(),'package.json'));
 return fs.readFileSync(path.join(path.dirname(require.resolve('@neutralinojs/lib')),'neutralino.js'),'utf8');
}
