// The server and native window share one Deno process. No renderer bindings.
import type { Server } from 'node:http';

export interface Application {
  listen(port: number, host: string, callback: () => void): Server;
  locals: { closeStore: () => void };
}
export type ApplicationFactory = () => Application;

export function proxyTarget(requestURL: string, backendOrigin: string): string {
  const incoming = new URL(requestURL);
  const target = new URL(backendOrigin);
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.username || target.password) throw Error('Invalid proxy backend.');
  // Assign fields separately: a path beginning // must never replace the host.
  target.pathname = incoming.pathname; target.search = incoming.search; target.hash = '';
  return target.href;
}

export class Backend {
  readonly ready: Promise<string>;
  readonly status: Promise<{ code: number; success: boolean }>;
  private server?: Server;
  private app?: Application;
  private stopping?: Promise<void>;
  private settled = false;
  private finish!: (status: {code: number; success: boolean}) => void;

  constructor(factory: ApplicationFactory, options: { port?: number; startupTimeoutMs?: number; shutdownTimeoutMs?: number } = {}) {
    this.status = new Promise(resolve => { this.finish = resolve; });
    this.ready = Promise.resolve().then(() => new Promise<string>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const fail = (error: Error) => {
        clearTimeout(timer);
        this.server?.closeAllConnections();
        this.server?.close();
        this.app?.locals.closeStore();
        this.complete(1);
        reject(error);
      };
      try {
        this.app = factory();
        this.server = this.app.listen(options.port ?? 0, '127.0.0.1', () => {
          clearTimeout(timer);
          const address = this.server!.address();
          if (!address || typeof address === 'string') { fail(Error('Invalid local server address.')); return; }
          resolve(`http://127.0.0.1:${address.port}`);
        });
        this.server.once('error', fail);
        this.server.once('close', () => this.complete(this.stopping ? 0 : 1));
        timer = setTimeout(() => fail(Error('Local server startup timed out.')), options.startupTimeoutMs ?? 30000);
      } catch (error) { fail(error instanceof Error ? error : Error(String(error))); }
    }));
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 10000;
  }
  private shutdownTimeoutMs: number;
  private complete(code: number) {
    if (!this.settled) { this.settled = true; this.finish({ code, success: code === 0 }); }
  }
  stop(): Promise<void> {
    return this.stopping ??= Promise.resolve().then(() => this.shutdown());
  }
  private async shutdown() {
    await this.ready.catch(() => {});
    if (this.settled) return;
    const server = this.server!;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        timer = setTimeout(() => {
          // Abort lingering HTTP clients; server close then releases SQLite/lock.
          server.closeAllConnections();
        }, this.shutdownTimeoutMs);
        server.close(error => error ? reject(error) : resolve());
        server.closeIdleConnections();
      });
      this.app!.locals.closeStore();
      this.complete(0);
    } finally { clearTimeout(timer); }
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
