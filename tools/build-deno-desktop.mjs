import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--target')) throw Error('Usage: node tools/build-deno-desktop.mjs [--target win-x64|linux-x64]');
const target = args[1] || 'win-x64';
const triples = { 'win-x64': 'x86_64-pc-windows-msvc', 'linux-x64': 'x86_64-unknown-linux-gnu' };
if (!triples[target]) throw Error('Supported prototype targets: win-x64, linux-x64.');
const version = '2.9.7';
const localDeno = path.join(root, '.standalone', 'deno-tools', process.platform === 'win32' ? 'deno.exe' : 'deno');
const deno = process.env.BENCH_DENO_BIN || await fs.access(localDeno).then(() => localDeno, () => 'deno');
const versionResult = spawnSync(deno, ['--version'], { encoding: 'utf8' });
if (versionResult.status !== 0 || !versionResult.stdout.startsWith(`deno ${version} `)) throw Error(`Install Deno ${version}, or set BENCH_DENO_BIN to its executable. This prototype pins the reviewed backend.`);
const backend = path.join(root, 'bin', `pc-workbench-${target}${target === 'win-x64' ? '.exe' : ''}`);
try { await fs.access(backend); } catch { throw Error(`Missing ${backend}. Build the matching SEA server first.`); }
const backendBinary = await fs.readFile(backend);
if (!backendBinary.includes(Buffer.from('--desktop'))) throw Error('The server lacks desktop IPC support. Rebuild it.');
// Stage outside the pnpm workspace: Deno otherwise discovers package.json and
// can embed the entire npm snapshot, including unused Electron tooling.
const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'pc-workbench-deno-stage-'));
const buildDirectory = path.join(root, '.standalone', 'deno-prototype', target);
const name = `pc-workbench-deno-prototype-${target}`;
const output = path.join(buildDirectory, name);
await fs.mkdir(buildDirectory, { recursive: true });
try {
  for (const filename of ['deno.json', 'main.ts', 'backend.ts']) await fs.copyFile(path.join(root, 'prototypes', 'deno', filename), path.join(stage, filename));
  const result = spawnSync(deno, ['desktop', '--backend', 'webview', '--target', triples[target], '--output', output, '--no-code-cache', '--allow-read', '--allow-run', '--allow-net=127.0.0.1', '--allow-env', '--no-prompt', 'main.ts'], { cwd: stage, stdio: 'inherit' });
  if (result.status !== 0) throw Error(`Deno desktop build failed: ${result.error?.message || result.status}`);
} finally { await fs.rm(stage, { recursive: true, force: true }); }
const serverName = `pc-workbench-server${target === 'win-x64' ? '.exe' : ''}`;
await fs.copyFile(backend, path.join(output, serverName));
if (target !== 'win-x64') await fs.chmod(path.join(output, serverName), 0o755);
await fs.copyFile(path.join(root, 'prototypes', 'deno', 'README.md'), path.join(output, 'README.md'));
const files = [];
async function inspect(directory, prefix = '') {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name), relative = prefix + entry.name;
    if (entry.isDirectory()) await inspect(filename, `${relative}/`);
    else if (entry.isFile()) { const data = await fs.readFile(filename); files.push({ path: relative, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') }); }
    else throw Error(`Unexpected packaging entry: ${filename}`);
  }
}
await inspect(output);
const manifest = { prototype: true, target, denoVersion: version, backend: 'webview', nodeBackendSHA256: createHash('sha256').update(backendBinary).digest('hex'), builtAt: new Date().toISOString(), files };
await fs.writeFile(path.join(output, 'build.json'), JSON.stringify(manifest, null, 2));
const binDirectory = path.join(root, 'bin');
await fs.mkdir(binDirectory, { recursive: true });
const zipPath = path.join(binDirectory, `${name}.zip`);
await fs.rm(zipPath, { force: true });
const zip = process.platform === 'win32'
  ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Compress-Archive -LiteralPath $env:BENCH_DENO_PACKAGE_DIR -DestinationPath $env:BENCH_DENO_PACKAGE_ZIP -Force'], { env: { ...process.env, BENCH_DENO_PACKAGE_DIR: output, BENCH_DENO_PACKAGE_ZIP: zipPath }, stdio: 'inherit' })
  : spawnSync('zip', ['-q', '-r', zipPath, name], { cwd: buildDirectory, stdio: 'inherit' });
if (zip.status !== 0) throw Error(`ZIP creation failed (${zip.error?.message || zip.status}); the application directory remains at ${output}. Unix hosts require zip.`);
const sha256 = createHash('sha256').update(await fs.readFile(zipPath)).digest('hex');
await fs.writeFile(`${zipPath}.sha256`, `${sha256}  ${path.basename(zipPath)}\n`);
await fs.writeFile(`${zipPath}.build.json`, JSON.stringify({ ...manifest, sha256 }, null, 2));
console.log(`Deno prototype: ${zipPath}\nSHA-256: ${sha256}`);
