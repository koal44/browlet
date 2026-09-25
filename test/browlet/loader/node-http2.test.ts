import { readFileSync } from 'node:fs';
import { constants, createSecureServer, type Http2SecureServer, type ServerHttp2Session, type ServerHttp2Stream } from 'node:http2';
import { afterEach, describe, expect, it } from 'vitest';
import { NodeHTTPTransport } from '../../../src/browlet/loader/node-transport';
import { FetchHeaders } from '../../../src/fetch/headers';
import { getMIMETypeEssence } from '../../../src/mime/index';
import type { HTTPConnection, HTTPTransportRequest } from '../../../src/fetch/http/transport';
import { obtainURLOrigin, parseURL } from '../../../src/url/url';
import { obtainSite } from '../../../src/url/origin';
import { closeServer, listen } from './http-fixture';

const tls = {
  cert: readFileSync('test/browlet/loader/fixtures/localhost-cert.pem'),
  key: readFileSync('test/browlet/loader/fixtures/localhost-key.pem'),
  allowHTTP1: true,
  strictSingleValueFields: false,
};
const servers: Http2SecureServer[] = [];
const transports: NodeHTTPTransport[] = [];

afterEach(async () => {
  await Promise.all(transports.splice(0).map((transport) => transport.close()));
  await Promise.all(servers.splice(0).map(closeServer));
});

describe('Node HTTP/2 transport', () => {
  it('negotiates h2 and preserves original repeated fields and literal commas', async () => {
    const server = createSecureServer(tls, (_request, response) => {
      response.writeHead(200, [
        'strict-transport-security', 'max-age=10', 'strict-transport-security', 'max-age=20',
        'content-type', 'text/plain', 'content-type', 'text/html',
        'location', '/A', 'location', '/B', 'set-cookie', 'a=1', 'set-cookie', 'b=2',
        'x-literal-comma', 'one, two',
      ]);
      response.end('secure');
    });
    const f = await fixture(server);
    const result = await exchange(f.transport, wireRequest(f.origin));
    expect(result.connection?.protocol).toBe('h2');
    expect(result.connection?.timingInfo.alpnNegotiatedProtocol).toEqual(new TextEncoder().encode('h2'));
    expect(result.connection?.hasValidTLS).toBe(true);
    expect(result.body.toString()).toBe('secure');
    expect(result.headers.list.filter(([name]) => name === 'strict-transport-security'))
      .toEqual([['strict-transport-security', 'max-age=10'], ['strict-transport-security', 'max-age=20']]);
    expect(getMIMETypeEssence(result.headers.extractMIMEType()!)).toBe('text/html');
    expect(result.headers.extractValues('Location', (value) => [value], false)).toBeNull();
    expect(result.headers.getSetCookie()).toEqual(['a=1', 'b=2']);
    expect(result.headers.list.filter(([name]) => name === 'x-literal-comma')).toEqual([['x-literal-comma', 'one, two']]);
    expect(result.headers.list.some(([name]) => name.startsWith(':'))).toBe(false);
  });

  it('delivers interim headers separately from the final response', async () => {
    const server = createSecureServer(tls);
    server.on('stream', (stream) => {
      stream.additionalHeaders({ ':status': 100 });
      stream.additionalHeaders({ ':status': 102 });
      stream.additionalHeaders({ ':status': 103, link: ['</one>; rel=preload', '</two>; rel=preload'] });
      stream.respond({ ':status': 299 });
      stream.end('done');
    });
    const f = await fixture(server);
    const responses: { status: number; headers: FetchHeaders; }[] = [];
    await new Promise<void>((resolve, reject) => f.transport.dispatch(wireRequest(f.origin), {
      onHeaders(status, _message, headers) { responses.push({ status, headers }); },
      onData() {}, onEnd: resolve, onError: reject,
    }));
    expect(responses.map(({ status }) => status)).toEqual([100, 102, 103, 299]);
    expect(responses[2]!.headers.list.filter(([name]) => name === 'link'))
      .toEqual([['link', '</one>; rel=preload'], ['link', '</two>; rel=preload']]);
    expect(responses[3]!.headers.get('Link')).toBeNull();
  });

  it.each([false, true])('replays a refused byte request once, then stops (refuse again: %s)', async (refuseAgain) => {
    let requests = 0;
    const bodies: Buffer[] = [];
    const server = createSecureServer(tls);
    server.on('stream', (stream) => {
      requests++;
      if (requests === 1 || refuseAgain) {
        stream.on('error', () => {}); // The deliberately refused server stream also emits an error.
        stream.close(constants.NGHTTP2_REFUSED_STREAM);
        return;
      }
      stream.on('data', (bytes: Buffer) => bodies.push(bytes));
      stream.on('end', () => { stream.respond({ ':status': 200 }); stream.end('accepted'); });
    });
    const f = await fixture(server);
    const request = wireRequest(f.origin);
    request.method = 'POST';
    request.body = Uint8Array.of(1, 2, 3);
    const pending = exchange(f.transport, request);
    if (refuseAgain) {
      await expect(pending).rejects.toMatchObject({ http2ErrorCode: constants.NGHTTP2_REFUSED_STREAM });
    } else {
      expect((await pending).body.toString()).toBe('accepted');
      expect(Buffer.concat(bodies)).toEqual(Buffer.from([1, 2, 3]));
    }
    expect(requests).toBe(2);
  });

  it('multiplexes concurrent requests on an established session', async () => {
    const sessions = new Set<ServerHttp2Session>();
    const pending: ServerHttp2Stream[] = [];
    const server = createSecureServer(tls);
    server.on('session', (session) => sessions.add(session));
    server.on('stream', (stream, headers) => {
      stream.respond({ ':status': 200 });
      if (headers[':path'] === '/warmup') { stream.end(); return; }
      pending.push(stream);
      // Both requests must reach the server before either response can finish.
      if (pending.length === 2) for (const response of pending) response.end('together');
    });
    const f = await fixture(server);
    await exchange(f.transport, wireRequest(f.origin + '/warmup'));
    const results = await Promise.all(['/one', '/two'].map((path) => exchange(f.transport, wireRequest(f.origin + path))));
    expect(results.map(({ body }) => body.toString())).toEqual(['together', 'together']);
    expect(sessions.size).toBe(1);
  });

  it('pauses one response without blocking another stream on the session', async () => {
    const server = createSecureServer(tls);
    server.on('stream', (stream, headers) => {
      stream.respond({ ':status': 200 });
      stream.end(headers[':path'] === '/large' ? Buffer.alloc(256 * 1024, 7) : 'small');
    });
    const f = await fixture(server);
    await exchange(f.transport, wireRequest(f.origin));
    const paused = Promise.withResolvers<void>();
    const done = Promise.withResolvers<void>();
    let size = 0;
    const control = f.transport.dispatch(wireRequest(f.origin + '/large'), {
      onHeaders() {},
      onData(bytes) {
        expect(bytes.every((byte) => byte === 7)).toBe(true);
        size += bytes.length;
        if (size === bytes.length) { control.pause(); paused.resolve(); }
      },
      onEnd: done.resolve, onError: done.reject,
    });
    await paused.promise;
    const stoppedAt = size;
    expect((await exchange(f.transport, wireRequest(f.origin + '/small'))).body.toString()).toBe('small');
    expect(size).toBe(stoppedAt);
    expect(size).toBeLessThan(256 * 1024);
    control.resume();
    await done.promise;
    expect(size).toBe(256 * 1024);
  });

  it('resets a canceled stream and keeps its session available', async () => {
    const closed = Promise.withResolvers<boolean>();
    const sessions = new Set<ServerHttp2Session>();
    const server = createSecureServer(tls);
    server.on('session', (session) => sessions.add(session));
    server.on('stream', (stream, headers) => {
      stream.respond({ ':status': 200 });
      if (headers[':path'] !== '/cancel') { stream.end('alive'); return; }
      stream.once('close', () => closed.resolve(stream.aborted));
      stream.write('waiting');
    });
    const f = await fixture(server);
    const started = Promise.withResolvers<void>();
    const failed = Promise.withResolvers<unknown>();
    const control = f.transport.dispatch(wireRequest(f.origin + '/cancel'), {
      onHeaders: () => started.resolve(), onData() {}, onEnd() {}, onError: failed.resolve,
    });
    await started.promise;
    control.abort();
    expect(await failed.promise).toMatchObject({ code: 'UND_ERR_ABORTED' });
    // Fetch requires a reset, not a particular RST_STREAM code.
    expect(await closed.promise).toBe(true);
    expect((await exchange(f.transport, wireRequest(f.origin + '/next'))).body.toString()).toBe('alive');
    expect(sessions.size).toBe(1);
  });

  it('honors the peer stream limit and cancels a queued request without sending it', async () => {
    const paths: string[] = [];
    const started = Promise.withResolvers<ServerHttp2Stream>();
    const server = createSecureServer({ ...tls, settings: { maxConcurrentStreams: 1 } });
    server.on('stream', (stream, headers) => {
      paths.push(headers[':path']!);
      stream.respond({ ':status': 200 });
      if (headers[':path'] === '/active') { stream.write('held'); started.resolve(stream); }
      else { stream.end('done'); }
    });
    const f = await fixture(server);
    await exchange(f.transport, wireRequest(f.origin + '/warmup'));
    const active = exchange(f.transport, wireRequest(f.origin + '/active'));
    const held = await started.promise;
    const failed = Promise.withResolvers<unknown>();
    const queued = f.transport.dispatch(wireRequest(f.origin + '/queued'), {
      onHeaders() {}, onData() {}, onEnd() {}, onError: failed.resolve,
    });
    queued.abort();
    expect(await failed.promise).toMatchObject({ code: 'UND_ERR_ABORTED' });
    held.end();
    await active;
    await exchange(f.transport, wireRequest(f.origin + '/next'));
    expect(paths).toEqual(['/warmup', '/active', '/next']);
  });

  it('separates credentials, partitions, and forced new connections under HTTP/2', async () => {
    const server = createSecureServer(tls, (_request, response) => response.end());
    const f = await fixture(server);
    const request = wireRequest(f.origin);
    const first = await exchange(f.transport, request);
    const reused = await exchange(f.transport, request);
    expect(reused.connection).toBe(first.connection);
    request.includeCredentials = true;
    const credentialed = await exchange(f.transport, request);
    expect(credentialed.connection).not.toBe(first.connection);
    request.partitionKey = [obtainSite(obtainURLOrigin(parseURL('https://partition.test').url!)), null];
    const partitioned = await exchange(f.transport, request);
    expect(partitioned.connection).not.toBe(credentialed.connection);
    request.forceNewConnection = true;
    expect((await exchange(f.transport, request)).connection).not.toBe(partitioned.connection);
  });
});

async function fixture(server: Http2SecureServer) {
  servers.push(server);
  const origin = await listen(server, 'https');
  const transport = new NodeHTTPTransport(tls.cert);
  transports.push(transport);
  return { origin, transport };
}

function wireRequest(url: string): HTTPTransportRequest {
  return { url: parseURL(url).url!, method: 'GET', headers: new FetchHeaders(), body: null, partitionKey: null, includeCredentials: false, forceNewConnection: false };
}

function exchange(transport: NodeHTTPTransport, request: HTTPTransportRequest) {
  return new Promise<{ connection: HTTPConnection | undefined; headers: FetchHeaders; body: Buffer; }>((resolve, reject) => {
    let connection: HTTPConnection | undefined;
    let headers = new FetchHeaders();
    const chunks: Uint8Array[] = [];
    transport.dispatch(request, {
      onConnection(value) { connection = value; return true; },
      onHeaders(_status, _message, fields) { headers = fields; },
      onData(bytes) { chunks.push(bytes); },
      onEnd() { resolve({ connection, headers, body: Buffer.concat(chunks) }); },
      onError: reject,
    });
  });
}
