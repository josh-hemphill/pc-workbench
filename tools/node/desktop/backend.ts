// Manage the Node HTTP server and release workspace resources on shutdown.
import type { Server } from 'node:http';

export interface Application {
  listen(port: number, host: string, callback: (error?: Error) => void): Server;
  locals: { closeStore: () => void };
}
export type ApplicationFactory = () => Application;

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
        this.server = this.app.listen(options.port ?? 0, '127.0.0.1', (error) => {
          // Express 5 also invokes its listen callback on binding failures.
          if (error) { fail(error); return; }
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
