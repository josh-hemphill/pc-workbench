import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { durableWrite } from './persistence.ts';
import type { RuntimeConfig } from './runtime-config.ts';
import { defaultUserSettings, userSettingsSchema, type UserSettings, type SettingsSnapshot, type AppSettings, type AppSettingsSnapshot } from '../shared/settings.ts';

export class SettingsConflict extends Error {}
const appSchema = z.object({ version: z.literal(1).optional(), dataDir: z.string().trim().min(1).refine(value => !value.includes('\0')), port: z.number().int().min(1).max(65535).optional() }).strict();
export function canonicalPath(filename: string): string {
  let ancestor = path.resolve(filename);
  const rest: string[] = [];
  while (!fs.existsSync(ancestor)) {
    // Broken links are errors, not missing destinations.
    try { fs.lstatSync(ancestor); throw Error(`Broken storage link: ${ancestor}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw Error(`Cannot resolve storage path: ${filename}`);
    rest.unshift(path.basename(ancestor)); ancestor = parent;
  }
  const resolved = path.join(fs.realpathSync(ancestor), ...rest);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
function within(filename: string, directory: string) {
  const relative = path.relative(canonicalPath(directory), canonicalPath(filename));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
export function assertSettingsSeparation(runtime: RuntimeConfig, dataDir = runtime.dataDir) {
  if (canonicalPath(runtime.configFile) === canonicalPath(runtime.userSettingsFile)) throw Error('App configuration and user preferences must use different files.');
  for (const filename of [runtime.configFile, runtime.userSettingsFile, runtime.cacheDir]) {
    if (within(filename, dataDir)) throw Error(`User settings and cache must be outside the workspace: ${filename}`);
  }
  for (const filename of [runtime.configFile,runtime.userSettingsFile]) {
    if(within(filename,runtime.cacheDir))throw Error('Settings files must not be stored inside the disposable browser cache.');
  }
  if (within(dataDir, runtime.cacheDir)) throw Error('The workspace must not be stored inside the disposable browser cache.');
}
function readFile(filename: string): string | undefined {
  try { return fs.readFileSync(filename, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    try { fs.lstatSync(filename); throw Error(`Settings link is unreadable: ${filename}`); }
    catch (statError) { if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw statError; }
    return undefined;
  }
}
function revision(raw: string | undefined) { return raw === undefined ? 'missing' : createHash('sha256').update(raw).digest('hex'); }
function parseJson(raw: string) { return JSON.parse(raw.replace(/^\uFEFF/, '')); }

/** Short-lived per-file lock plus compare-and-swap protects different workspace processes. */
function replaceFile(filename: string, expected: string, value: unknown) {
  const directory = path.dirname(filename);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = `${filename}.lock`, token = randomUUID();
  let fd: number | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { fd = fs.openSync(lock, 'wx', 0o600); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const owner = JSON.parse(fs.readFileSync(lock, 'utf8'));
      if (!Number.isInteger(owner.pid) || owner.pid < 1) throw Error(`Unreadable settings lock: ${lock}`);
      try { process.kill(owner.pid, 0); }
      catch (probe) {
        if ((probe as NodeJS.ErrnoException).code === 'ESRCH') { fs.unlinkSync(lock); continue; }
        throw probe;
      }
      throw new SettingsConflict('Settings are being saved by another window. Reload and try again.');
    }
  }
  if (fd === undefined) throw new SettingsConflict('Could not acquire the settings lock.');
  const ownedLock=fs.fstatSync(fd);
  try {
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token })); fs.closeSync(fd); fd = undefined;
    try { if (fs.lstatSync(filename).isSymbolicLink()) throw Error('Saving settings through a file symlink is unsupported. Select a regular settings file.'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (revision(readFile(filename)) !== expected) throw new SettingsConflict('Settings changed in another window. Reload settings before saving.');
    durableWrite(filename, `${JSON.stringify(value, null, 2)}\n`, 0o600);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    // Even a failed lock-header write must release our own file. Do not remove a replacement lock.
    try {
      const current=fs.lstatSync(lock);
      if(current.dev===ownedLock.dev&&current.ino===ownedLock.ino)fs.unlinkSync(lock);
    }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  }
}

export class SettingsStore {
  readonly runtime: RuntimeConfig;
  constructor(runtime: RuntimeConfig) {
    this.runtime = runtime;
    assertSettingsSeparation(runtime);
    this.user(); this.app(); // Invalid files stop startup instead of silently using defaults.
  }
  user(): SettingsSnapshot<UserSettings> {
    const raw = readFile(this.runtime.userSettingsFile);
    try {
      const value = raw === undefined ? structuredClone(defaultUserSettings) : userSettingsSchema.parse(parseJson(raw));
      return { value, revision: revision(raw), exists: raw !== undefined };
    } catch (error) { throw Error(`Cannot load user settings at ${this.runtime.userSettingsFile}. Fix the file or use a compatible application; it has not been changed. ${error instanceof Error ? error.message : error}`); }
  }
  saveUser(value: unknown, expected: string) {
    const validated = userSettingsSchema.parse(value);
    assertSettingsSeparation(this.runtime);
    replaceFile(this.runtime.userSettingsFile, expected, validated);
    return this.user();
  }
  app(): AppSettingsSnapshot {
    const raw = readFile(this.runtime.configFile);
    const parsed = raw === undefined ? undefined : appSchema.parse(parseJson(raw));
    const configuredPath = parsed?.dataDir;
    if(configuredPath?.startsWith('~')&&configuredPath!=='~'&&!configuredPath.startsWith('~/')&&!configuredPath.startsWith('~\\'))throw Error('Use ~/ for the current user’s home directory.');
    const expanded = configuredPath === '~' ? this.runtime.homeDir : configuredPath?.startsWith('~/') || configuredPath?.startsWith('~\\') ? path.join(this.runtime.homeDir, configuredPath.slice(2)) : configuredPath;
    const value: AppSettings = { version: 1, dataDir: expanded ? path.resolve(path.dirname(this.runtime.configFile), expanded) : this.runtime.defaultDataDir, port: parsed?.port ?? 3001 };
    const nextLaunch = { dataDir: this.runtime.overrides.dataDir ? this.runtime.dataDir : value.dataDir, port: this.runtime.overrides.port ? this.runtime.port : value.port };
    return { value, revision: revision(raw), exists: raw !== undefined, effective: { dataDir: this.runtime.dataDir, port: this.runtime.port }, nextLaunch,
      locations: { configFile: this.runtime.configFile, userSettingsFile: this.runtime.userSettingsFile, cacheDir: this.runtime.cacheDir }, overrides: this.runtime.overrides,
      restartRequired: canonicalPath(nextLaunch.dataDir) !== canonicalPath(this.runtime.dataDir) || nextLaunch.port !== this.runtime.port };
  }
  previewApp(value: unknown) {
    const settings = appSchema.required().parse(value);
    if (!path.isAbsolute(settings.dataDir)) throw Error('Enter an absolute workspace directory path.');
    assertSettingsSeparation(this.runtime, settings.dataDir);
    let ancestor = settings.dataDir;
    while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
    if (!fs.statSync(ancestor).isDirectory()) throw Error('Workspace path must be a directory.');
    fs.accessSync(ancestor, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
    const exists = fs.existsSync(settings.dataDir);
    const database = path.join(settings.dataDir, 'workbench.sqlite');
    if (fs.existsSync(database) && !fs.statSync(database).isFile()) throw Error('workbench.sqlite must be a regular file.');
    if (fs.existsSync(database)) fs.accessSync(database, fs.constants.R_OK | fs.constants.W_OK);
    // Never open, create, or lock the selected workspace during validation.
    return { value: settings, exists, hasDatabase: fs.existsSync(database), hasLegacyCsv: exists && fs.readdirSync(settings.dataDir).some(name => name.endsWith('.csv')), lockPresent: fs.existsSync(path.join(settings.dataDir, '.server-lock.json')) };
  }
  saveApp(value: unknown, expected: string) {
    const preview = this.previewApp(value);
    replaceFile(this.runtime.configFile, expected, preview.value);
    return this.app();
  }
}
