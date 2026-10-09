// Build tooling only: the delivered native application remains Deno-only.
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { createIExpressConfig } from './windows-single-config.ts';

if (Deno.build.os !== 'windows' || Deno.build.arch !== 'x86_64') {
  throw Error('Single-executable packaging uses Windows x64’s built-in IExpress. Run deno task package:windows:single on Windows x64. Other hosts can cross-build the standard ZIP with deno task package:windows.');
}
if (Deno.version.deno !== '2.9.7') throw Error('This prototype requires Deno 2.9.7.');
const root = fileURLToPath(new URL('../../', import.meta.url));
const systemRoot = Deno.env.get('SystemRoot');
if (!systemRoot || !path.isAbsolute(systemRoot)) throw Error('SystemRoot must identify the Windows installation directory.');
const iexpress = path.join(systemRoot, 'System32', 'iexpress.exe');
await Deno.stat(iexpress).catch(() => { throw Error(`Windows IExpress is not available at ${iexpress}.`); });

const built = await new Deno.Command(Deno.execPath(), {
  cwd: root, args: ['task', 'package:windows'], stdin: 'inherit', stdout: 'inherit', stderr: 'inherit',
}).spawn().status;
if (!built.success) throw Error(`Native Windows package build failed (${built.code}).`);

const name = 'pc-workbench-deno-prototype-win-x64';
const bundle = path.join(root, '.standalone', 'deno-prototype', 'win-x64', name);
const output = path.join(root, 'bin', `${name}-single.exe`);
const stage = await Deno.makeTempDir({ prefix: 'pc-workbench-iexpress-' });
// Keep the launcher's original basename: it locates the adjacent runtime DLL.
const payload = [`${name}.exe`, `${name}.dll`];
try {
  await Deno.copyFile(path.join(bundle, `${name}.exe`), path.join(stage, payload[0]));
  await Deno.copyFile(path.join(bundle, `${name}.dll`), path.join(stage, payload[1]));
  const sed = path.join(stage, 'package.sed');
  const target = path.join(stage, 'pc-workbench-single.exe');
  // Win32 INI readers support UTF-16LE with BOM, including Unicode user paths.
  const config = createIExpressConfig(stage, target, payload[0], payload);
  await Deno.writeFile(sed, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(config, 'utf16le')]));
  console.log('Creating a single self-extracting executable with Windows IExpress...');
  const packed = await new Deno.Command(iexpress, {
    cwd: stage, args: ['/N', '/Q', sed], stdout: 'inherit', stderr: 'inherit',
  }).spawn().status;
  if (!packed.success) throw Error(`IExpress packaging failed (${packed.code}).`);
  const bytes = await Deno.readFile(target).catch(() => { throw Error('IExpress did not create its output executable. The standard ZIP remains available.'); });
  if (bytes.length < 1024 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) throw Error('IExpress output is not a Windows executable.');
  await Deno.copyFile(target, output);
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(byte => byte.toString(16).padStart(2, '0')).join('');
  const sourceManifest = JSON.parse(await Deno.readTextFile(path.join(bundle, 'build.json')));
  const payloadFiles = sourceManifest.files.filter((file: { path: string }) => payload.includes(file.path));
  if (payloadFiles.length !== payload.length) throw Error('The source package manifest does not describe both runtime files.');
  await Deno.writeTextFile(`${output}.sha256`, `${sha256}  ${path.basename(output)}\n`);
  await Deno.writeTextFile(`${output}.build.json`, JSON.stringify({
    ...sourceManifest, files: payloadFiles, distribution: 'single self-extracting Windows executable',
    extraction: 'Windows temporary directory; configuration and database retain their user storage locations',
    requires: ['Windows x64', 'Microsoft Edge WebView2 Runtime', 'Microsoft Visual C++ 2015–2022 Redistributable (x64)'],
    payload, bytes: bytes.length, sha256,
  }, null, 2));
  console.log(`Single executable: ${output}\nSHA-256: ${sha256}`);
} finally { await Deno.remove(stage, { recursive: true }); }
