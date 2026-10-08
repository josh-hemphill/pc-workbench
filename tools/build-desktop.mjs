import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import os from 'node:os';
import { build, Platform, Arch } from 'electron-builder';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const base = require('../desktop/electron-builder.cjs');
const metadata = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const electronVersion = require('electron/package.json').version;
const server = path.join(root, 'bin', 'pc-workbench-win-x64.exe');
try { await fs.access(server); } catch { throw Error('Build the current Windows backend first: pnpm package:windows'); }
const backendBinary = await fs.readFile(server);
if (!backendBinary.includes(Buffer.from('--desktop'))) throw Error('The backend lacks desktop IPC support. Rebuild it with pnpm package:windows.');
const backendSHA256 = createHash('sha256').update(backendBinary).digest('hex');
// Keep the dependency-free shell outside the pnpm workspace so packaging never pulls the web/server dependency tree into app.asar.
const appDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pc-workbench-desktop-app-'));
const output = path.join(root, '.standalone', 'desktop-output');
await fs.mkdir(appDir, { recursive: true });
for (const filename of ['main.cjs', 'protocol.cjs']) await fs.copyFile(path.join(root, 'desktop', filename), path.join(appDir, filename));
await fs.writeFile(path.join(appDir, 'package.json'), JSON.stringify({ name: 'pc-workbench-desktop', productName: 'PC Workbench', version: metadata.version, description: 'Local PC configuration, inventory and installation management', author: 'PC Workbench contributors', main: 'main.cjs', private: true }, null, 2));
try {
  await build({ projectDir: appDir, targets: Platform.WINDOWS.createTarget(['portable'], Arch.x64), config: { ...base, electronVersion, directories: { app: appDir, output }, extraResources: [{ from: server, to: 'pc-workbench-server.exe' }] }, publish: 'never' });
} finally { await fs.rm(appDir, { recursive: true, force: true }); }
const packaged = path.join(output, 'pc-workbench-desktop-win-x64.exe');
const target = path.join(root, 'bin', 'pc-workbench-desktop-win-x64.exe');
const temporary = `${target}.${process.pid}.tmp`;
await fs.copyFile(packaged, temporary);
await fs.rename(temporary, target);
const sha256 = createHash('sha256').update(await fs.readFile(target)).digest('hex');
await fs.writeFile(`${target}.sha256`, `${sha256}  ${path.basename(target)}\n`);
await fs.writeFile(`${target}.build.json`, JSON.stringify({ target: 'win-x64', appVersion: metadata.version, electronVersion, nodeVersion: process.version, backendSHA256, builtAt: new Date().toISOString(), sha256 }, null, 2));
console.log(`Desktop executable: ${target}\nSHA-256: ${sha256}`);
