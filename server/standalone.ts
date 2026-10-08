import { getAsset, getAssetKeys, isSea } from 'node:sea';
import path from 'node:path';
import { createApp } from './index';
import { resolveRuntimeConfig } from './runtime-config';

const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

if (!isSea()) throw Error('This entry is built into the standalone executable. Use pnpm dev for development.');
if (process.argv.includes('--help')) {
  console.log('PC Workbench standalone\nOpen the printed localhost URL in a browser.\nSettings and data are stored in the user configuration directory.\nBENCH_DATA_DIR and PORT environment variables override the saved settings.\nPress Ctrl+C to stop.');
} else {
  const assets: Record<string, { data: Buffer; mime: string }> = {};
  for (const key of getAssetKeys()) {
    if (!key.startsWith('frontend:')) continue;
    const url = key.slice('frontend:'.length);
    assets[url] = { data: Buffer.from(getAsset(key)), mime: mimeTypes[path.extname(url)] || 'application/octet-stream' };
  }
  if (!assets['/index.html']) throw Error('Packaged frontend is missing. Rebuild the executable.');
  const config = resolveRuntimeConfig({ standalone: true });
  const server = createApp(config.dataDir, { assets }).listen(config.port, '127.0.0.1', () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : config.port;
    console.log(`PC Workbench: http://127.0.0.1:${port}\nData: ${config.dataDir}\nSettings: ${config.configFile}\nPress Ctrl+C to stop.`);
  });
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    server.close(error => { process.exitCode = error ? 1 : 0; });
    server.closeIdleConnections();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  server.once('error', error => { console.error(error.message); process.exitCode = 1; });
}
