/** Let the desktop proxy consume Deno's shell-assigned address exactly once. */
export function startDesktopProxy(
  handler: (request: Request) => Response | Promise<Response>,
  onListen: (address: Deno.NetAddr) => void,
): Deno.HttpServer {
  const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen }, handler);
  // In Deno 2.9.7, Deno.serve and node:http track consumption independently.
  // Leaving this set makes the first Express server bind the proxy port too.
  // The shell's serve notification has already fired; retain its proxy address.
  Deno.env.delete('DENO_SERVE_ADDRESS');
  return server;
}
