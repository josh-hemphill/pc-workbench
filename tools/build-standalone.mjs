import { build } from 'esbuild';
import { inject } from 'postject';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as http from 'node:http';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.includes('--runtime')) throw Error('Custom runtimes are unsupported: use the current host or the verified official Windows x64 runtime.');
if (args.some((arg, index) => index % 2 === 0 && arg !== '--target') || args.length % 2) throw Error('Usage: node tools/build-standalone.mjs [--target win-x64|host-platform-architecture]');
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const host = `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`;
const target = option('--target') || host;
const supported = [...new Set([host, 'win-x64'])];
if (!supported.includes(target)) throw Error(`Unsupported target ${target}. Choose ${supported.join(', ')}.`);
if (Number(process.versions.node.split('.')[0]) < 24) throw Error('Build with Node.js 24 or newer (includes native node:sqlite).');
// A SEA blob must match its runtime exactly. Snapshots/code caches are intentionally disabled for cross-platform builds.
const version = process.version;
const buildDir = path.join(root, '.standalone', target);
const binDir = path.join(root, 'bin');
await fs.mkdir(buildDir, { recursive: true });
await fs.mkdir(binDir, { recursive: true });
const index = path.join(root, 'dist', 'index.html');
try { await fs.access(index); } catch { throw Error('Frontend build missing. Run pnpm build before packaging.'); }
const assets = {};
async function collect(directory, relative = '') {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const name = path.posix.join(relative, entry.name), filename = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(filename, name);
    else if (entry.isFile()) assets[`frontend:/${name}`] = filename;
    else throw Error(`Frontend assets must be regular files: ${filename}`);
  }
}
await collect(path.join(root, 'dist'));
const bundle = path.join(buildDir, 'app.cjs');
await build({ entryPoints: [path.join(root, 'server', 'standalone.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', target: 'node24', define: { 'import.meta.url': '""' }, logLevel: 'warning' });
const blob = path.join(buildDir, 'app.blob');
const configFile = path.join(buildDir, 'sea-config.json');
await fs.writeFile(configFile, JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false, assets }, null, 2));
const result = spawnSync(process.execPath, ['--experimental-sea-config', configFile], { cwd: root, stdio: 'inherit' });
if (result.status !== 0) throw Error(`SEA preparation failed: ${result.error?.message || result.status}`);

let runtime;
let runtimeSource = 'local matching Node.js runtime';
if (!runtime && target === host) runtime = await fs.realpath(process.execPath);
if (!runtime && target === 'win-x64') {
  runtime = path.join(buildDir, 'node.exe');
  runtimeSource = `https://nodejs.org/dist/${version}/win-x64/node.exe`;
  // Respect corporate/build-environment proxy settings without requiring curl at build time.
  http.setGlobalProxyFromEnv?.();
  async function download(url) {
    let response;
    try { response = await fetch(url); }
    catch (error) { throw new Error(`Cannot download ${url}. Check network/proxy access; when using a proxy, build with Node.js 24.19 or newer.`, { cause: error }); }
    if (!response.ok) throw Error(`Download failed (${response.status}): ${url}`);
    return Buffer.from(await response.arrayBuffer());
  }
  const sums = (await download(`https://nodejs.org/dist/${version}/SHASUMS256.txt`)).toString('utf8');
  const expected = sums.split('\n').find(line => line.trim().endsWith('win-x64/node.exe'))?.split(/\s+/)[0];
  if (!expected) throw Error(`Official checksums omit the Windows runtime for ${version}.`);
  let binary;
  try { binary = await fs.readFile(runtime); } catch { /* Download absent cached runtime. */ }
  if (!binary || createHash('sha256').update(binary).digest('hex') !== expected) binary = await download(runtimeSource);
  if (createHash('sha256').update(binary).digest('hex') !== expected) throw Error('Official Node.js runtime checksum mismatch.');
  await fs.writeFile(runtime, binary);
} else if (!runtime) throw Error(`Unsupported cross-build ${target}.`);
runtime = path.resolve(runtime);
const executable = path.join(binDir, `pc-workbench-${target}${target.startsWith('win-') ? '.exe' : ''}`);
const temporary = `${executable}.${process.pid}.tmp`;
if (path.resolve(executable) === path.resolve(process.execPath)) throw Error('Refusing to overwrite the running Node.js executable.');
try {
  await fs.copyFile(runtime, temporary);
  if (target === 'win-x64') {
    // Authenticode covers the original bytes. Remove its certificate directory before changing the PE.
    const binary = await fs.readFile(temporary);
    const pe = binary.readUInt32LE(0x3c);
    if (binary.toString('ascii', 0, 2) !== 'MZ' || binary.readUInt32LE(pe) !== 0x4550 || binary.readUInt16LE(pe + 4) !== 0x8664) throw Error('Runtime is not a Windows x64 PE executable.');
    const optional = pe + 24;
    if (binary.readUInt16LE(optional) !== 0x20b) throw Error('Runtime is not a 64-bit PE executable.');
    const certificateEntry = optional + 112 + 4 * 8;
    const certificateOffset = binary.readUInt32LE(certificateEntry), certificateSize = binary.readUInt32LE(certificateEntry + 4);
    binary.fill(0, certificateEntry, certificateEntry + 8);
    await fs.writeFile(temporary, certificateOffset && certificateOffset + certificateSize === binary.length ? binary.subarray(0, certificateOffset) : binary);
  }
  if (target.startsWith('darwin-')) {
    const unsigned = spawnSync('codesign', ['--remove-signature', temporary], { stdio: 'inherit' });
    if (unsigned.status !== 0) throw Error('Remove the macOS runtime signature on a macOS build host before injecting.');
  }
  await inject(temporary, 'NODE_SEA_BLOB', await fs.readFile(blob), { sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', machoSegmentName: 'NODE_SEA', overwrite: true });
  if (target.startsWith('darwin-')) {
    const signed = spawnSync('codesign', ['--sign', '-', temporary], { stdio: 'inherit' });
    if (signed.status !== 0) throw Error('Ad-hoc signing failed.');
  }
  await fs.chmod(temporary, 0o755);
  await fs.rename(temporary, executable);
} catch (error) { await fs.rm(temporary, { force: true }); throw error; }
const sha256 = createHash('sha256').update(await fs.readFile(executable)).digest('hex');
await fs.writeFile(`${executable}.sha256`, `${sha256}  ${path.basename(executable)}\n`);
await fs.writeFile(`${executable}.build.json`, JSON.stringify({ target, nodeVersion: version, runtimeSource, builtAt: new Date().toISOString(), frontendAssets: Object.keys(assets).length, sha256 }, null, 2));
console.log(`Standalone executable: ${executable}\nSHA-256: ${sha256}`);
