// Dependency-free Deno host code. The renderer receives no native bindings.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
const encoder = new TextEncoder();
export const MESSAGE_LIMIT = 65536;

export function parseReady(line: string): string {
  if (encoder.encode(line).length > MESSAGE_LIMIT) throw Error('Backend startup message exceeds 64 KiB.');
  const message = JSON.parse(line);
  if (message?.type === 'error' && typeof message.message === 'string') throw Error(message.message.slice(0, 8192));
  if (message?.type !== 'ready' || typeof message.url !== 'string') throw Error('Invalid backend readiness message.');
  const url = new URL(message.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('Backend must report a loopback HTTP URL.');
  return url.origin;
}

export function proxyTarget(requestURL: string, backendOrigin: string): string {
  const incoming = new URL(requestURL);
  const target = new URL(backendOrigin);
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.username || target.password) throw Error('Invalid proxy backend.');
  // Assign fields separately: a path beginning // must never replace the host.
  target.pathname = incoming.pathname; target.search = incoming.search; target.hash = '';
  return target.href;
}

export class Backend {
  readonly child: ChildProcessWithoutNullStreams;
  readonly status: Promise<{ code: number; signal: string | null; success: boolean }>;
  readonly ready: Promise<string>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private stopping?: Promise<void>;
  private exited = false;
  private stderr = '';
  private stdout: ReadableStream<Uint8Array>;
  private errorOutput: ReadableStream<Uint8Array>;
  private spawnError?: Error;

  constructor(executable: string, options: { startupTimeoutMs?: number; env?: Record<string, string> } = {}) {
    // Deno.Command does not expose windowsHide. Deno's Node-compatible spawn
    // forwards that flag, avoiding an extra console for the SEA sidecar.
    this.child = spawn(executable, ['--desktop'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...Deno.env.toObject(), ...options.env } });
    this.writer = (Writable.toWeb(this.child.stdin) as WritableStream<Uint8Array>).getWriter();
    this.stdout = Readable.toWeb(this.child.stdout) as ReadableStream<Uint8Array>;
    this.errorOutput = Readable.toWeb(this.child.stderr) as ReadableStream<Uint8Array>;
    let spawned = false;
    this.child.once('spawn', () => { spawned = true; });
    this.status = new Promise(resolve => {
      this.child.once('exit', (code, signal) => { this.exited = true; resolve({ code: code ?? 1, signal, success: code === 0 }); });
      this.child.on('error', error => {
        // A failed kill also emits error; only failed creation confirms no live child.
        if (!spawned) { this.spawnError = error; this.exited = true; resolve({ code: 1, signal: null, success: false }); }
      });
    });
    void this.consumeErrors();
    this.ready = this.readReady(options.startupTimeoutMs ?? 30000);
  }

  private async consumeErrors() {
    try {
      for await (const chunk of this.errorOutput.pipeThrough(new TextDecoderStream())) this.stderr = (this.stderr + chunk).slice(-8192);
    } catch { /* Process loss is reported by status/readiness. */ }
  }

  private async readReady(timeoutMs: number): Promise<string> {
    const reader = this.stdout.getReader();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('Backend startup timed out.')), timeoutMs); });
    const decoder = new TextDecoder();
    const read = async () => {
      let pending = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) throw Error(`Backend stopped before readiness.${this.stderr ? ` ${this.stderr}` : ''}`);
        pending += decoder.decode(value, { stream: true });
        if (encoder.encode(pending).length > MESSAGE_LIMIT) throw Error('Backend startup message exceeds 64 KiB.');
        const newline = pending.indexOf('\n');
        if (newline >= 0) return parseReady(pending.slice(0, newline).trim());
      }
    };
    try { return await Promise.race([read(), timeout, this.status.then(() => { throw this.spawnError ?? Error('Backend stopped before readiness.'); })]); }
    finally { clearTimeout(timer); await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }

  stop(): Promise<void> {
    return this.stopping ??= this.shutdown();
  }

  private async shutdown() {
    if (this.exited) return;
    // Command + EOF uses the same private protocol as Electron. EOF is also the
    // safety net if the Deno host is terminated before async cleanup completes.
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const grace = new Promise<boolean>(resolve => { graceTimer = setTimeout(() => resolve(false), 10000); });
    try {
      await this.writer.write(encoder.encode('{"type":"shutdown"}\n'));
      await this.writer.close();
    } catch { /* Broken pipe: still wait for confirmed exit. */ }
    const confirmed = await Promise.race([this.status.then(() => true), grace]);
    clearTimeout(graceTimer);
    if (confirmed) return;
    try { this.child.kill('SIGKILL'); } catch { /* May already have exited. */ }
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    const forced = await Promise.race([this.status.then(() => true), new Promise<boolean>(resolve => { forceTimer = setTimeout(() => resolve(false), 1000); })]);
    clearTimeout(forceTimer);
    if (!forced) throw Error('Backend termination was not confirmed. Check for a remaining server before restarting.');
  }
}

export async function proxyRequest(request: Request, backendOrigin: string): Promise<Response> {
  const incoming = new URL(request.url);
  const host = request.headers.get('host');
  if (incoming.hostname !== '127.0.0.1' || (host && host !== incoming.host)) return new Response('Local connections only', { status: 403 });
  const origin = request.headers.get('origin');
  if (origin && origin !== incoming.origin) return new Response('Untrusted origin', { status: 403 });
  const headers = new Headers(request.headers);
  for (const name of ['host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-authorization']) headers.delete(name);
  try {
    const response = await fetch(proxyTarget(request.url, backendOrigin), { method: request.method, headers, body: request.body, redirect: 'manual', signal: request.signal });
    const outputHeaders = new Headers(response.headers);
    for (const name of ['connection', 'keep-alive', 'transfer-encoding']) outputHeaders.delete(name);
    // Constrain web content; this is NOT a substitute for native navigation and popup hooks.
    outputHeaders.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'; frame-ancestors 'none'; form-action 'self'");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: outputHeaders });
  } catch { return new Response('The local server is unavailable. Restart the prototype.', { status: 502 }); }
}
