import {createApp,type AppOptions} from './app';
import {resolveRuntimeConfig} from './runtime-config';
import {assertSettingsSeparation} from './settings';
import type {Server} from 'node:http';
export function startNodeServer(options:Pick<AppOptions,'assets'|'sourceRoot'>={},desktopOwned=false):Server {
 const config=resolveRuntimeConfig({standalone:!!options.assets,sourceRoot:options.sourceRoot});
 assertSettingsSeparation(config);
 const app=createApp(config.dataDir,{...options,runtimeConfig:config});
 const server=app.listen(config.port,'127.0.0.1',error=>{
  if(error)return;
  const address=server.address();if(!address||typeof address==='string')throw Error('Invalid local server address.');
  console.log(JSON.stringify({type:'ready',origin:`http://127.0.0.1:${address.port}`,pid:process.pid}));
 });
 let closing=false;
 function close(){if(closing)return;closing=true;server.close();server.closeIdleConnections();setTimeout(()=>server.closeAllConnections(),5000).unref();}
 const onSignal=()=>close();process.on('SIGINT',onSignal);process.on('SIGTERM',onSignal);
 let pending='';
 const onData=(chunk:string)=>{pending+=chunk;if(pending.length>65536){close();return;}const lines=pending.split('\n');pending=lines.pop()!;for(const line of lines)if(line.trim()==='shutdown')close();};
 if(desktopOwned){process.stdin.setEncoding('utf8');process.stdin.on('data',onData);process.stdin.on('end',close);process.stdin.resume();}
 function cleanup(){process.off('SIGINT',onSignal);process.off('SIGTERM',onSignal);if(desktopOwned){process.stdin.off('data',onData);process.stdin.off('end',close);process.stdin.pause();}}
 server.once('close',cleanup);
 server.once('error',error=>{console.error(error);process.exitCode=1;cleanup();});
 return server;
}
