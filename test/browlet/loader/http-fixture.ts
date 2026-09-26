import type { Server } from 'node:net';

/** Bind a loopback server to an available port; no outside network or fixed test port. */
export async function listen(server: Server, scheme = 'http', hostname = '127.0.0.1'): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, hostname, () => { server.removeListener('error', reject); resolve(); });
  });
  const address = server.address();
  if (typeof address !== 'object' || address === null) throw new Error('Expected a TCP server address');
  return `${scheme}://${hostname.includes(':') ? `[${hostname}]` : hostname}:${address.port}`;
}

export async function closeServer(server: Server & { closeAllConnections?: () => void; }): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections?.();
  });
}
