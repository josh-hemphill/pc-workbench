import { getAsset, getAssetKeys, isSea } from 'node:sea';
import path from 'node:path';
import { createApp } from './index';
import { resolveRuntimeConfig } from './runtime-config';
import { attachDesktopControl } from './desktop-control';
import type { Server } from 'node:http';

const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

const desktop=process.argv.includes('--desktop');
const reportError=(error:unknown)=>{
  const message=error instanceof Error?error.message:String(error);
  if(desktop&&!process.stdout.destroyed)process.stdout.write(JSON.stringify({type:'error',message})+'\n');else console.error(message);
  process.exitCode=1;
};

if(process.argv.includes('--help')) {
  console.log('PC Workbench standalone\nOpen the printed localhost URL in a browser.\nSettings and data are stored in the user configuration directory.\nBENCH_DATA_DIR and PORT environment variables override the saved settings.\nPress Ctrl+C to stop.\n--desktop: JSON ready/error output and bounded stdin shutdown control for the desktop wrapper; stdin EOF stops the server.');
}else {
  let server:Server|undefined,closeApp:(()=>void)|undefined,disposeControl:(()=>void)|undefined,closing=false;
  let forceClose:NodeJS.Timeout|undefined;
  const shutdown=()=>{
    if(closing)return;
    closing=true;disposeControl?.();
    if(desktop)process.stdin.destroy();
    if(!server){closeApp?.();return;}
    server.close(error=>{if(forceClose)clearTimeout(forceClose);if(error)reportError(error);});
    server.closeIdleConnections();
    // A disconnected wrapper must not leave a hung client request holding the workspace open.
    forceClose=setTimeout(()=>server?.closeAllConnections(),5000);forceClose.unref();
  };
  try {
    if(!isSea())throw Error('This entry is built into the standalone executable. Use pnpm dev for development.');
    const assets:Record<string,{data:Buffer;mime:string}>={};
    for(const key of getAssetKeys()) {
      if(!key.startsWith('frontend:'))continue;
      const url=key.slice('frontend:'.length);
      assets[url]={data:Buffer.from(getAsset(key)),mime:mimeTypes[path.extname(url)]||'application/octet-stream'};
    }
    if(!assets['/index.html'])throw Error('Packaged frontend is missing. Rebuild the executable.');
    const config=resolveRuntimeConfig({standalone:true}),app=createApp(config.dataDir,{assets});
    closeApp=app.locals.closeStore;
    server=app.listen(config.port,'127.0.0.1',(error?:Error)=>{
      // Express 5 also invokes the listen callback on an error; readiness requires a bound socket.
      if(error||closing)return;
      const address=server!.address(),port=typeof address==='object'&&address?address.port:config.port;
      const url=`http://127.0.0.1:${port}`;
      if(desktop)process.stdout.write(JSON.stringify({type:'ready',url})+'\n');
      else console.log(`PC Workbench: ${url}\nData: ${config.dataDir}\nSettings: ${config.configFile}\nPress Ctrl+C to stop.`);
    });
    if(desktop){disposeControl=attachDesktopControl(process.stdin,shutdown);process.stdout.on('error',shutdown);}
    process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
    server.once('close',()=>{disposeControl?.();process.off('SIGINT',shutdown);process.off('SIGTERM',shutdown);});
    server.once('error',error=>{disposeControl?.();if(desktop)process.stdin.destroy();process.off('SIGINT',shutdown);process.off('SIGTERM',shutdown);reportError(error);});
  }catch(error){disposeControl?.();if(server)shutdown();else closeApp?.();reportError(error);}
}
