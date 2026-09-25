import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createServer as createHTTPSServer } from 'node:https';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeHTTPTransport } from '../../../src/browlet/loader/node-transport';
import { FetchHeaders } from '../../../src/fetch/headers';
import type { HTTPTransportListener, HTTPTransportRequest } from '../../../src/fetch/http/transport';
import type { NetworkPartitionKey } from '../../../src/fetch/http/network-partition';
import { obtainURLOrigin, parseURL } from '../../../src/url/url';
import { obtainSite } from '../../../src/url/origin';
import { closeServer, listen } from './http-fixture';

const servers: Server[] = [];
const transports: NodeHTTPTransport[] = [];
const cert = readFileSync('test/browlet/loader/fixtures/localhost-cert.pem');
const key = readFileSync('test/browlet/loader/fixtures/localhost-key.pem');

afterEach(async () => {
  await Promise.all(transports.splice(0).map((transport) => transport.close()));
  await Promise.all(servers.splice(0).map(closeServer));
});

describe('Node HTTP transport', () => {
  it('sends the method, path, query, byte body, and repeated fields without URL credentials or fragments', async () => {
    const seen = Promise.withResolvers<{ method: string | undefined; url: string | undefined; bytes: number[]; auth: string | undefined; values: string | undefined; }>();
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        seen.resolve({ method: request.method, url: request.url, bytes: [...Buffer.concat(chunks)], auth: request.headers.authorization, values: request.headers['x-value'] as string | undefined });
        response.writeHead(201, ['Set-Cookie', 'a=1', 'Set-Cookie', 'b=2', 'Strict-Transport-Security', 'max-age=10', 'Strict-Transport-Security', 'max-age=20']);
        response.end('done');
      });
    });
    servers.push(server);
    const origin = await listen(server);
    const transport = makeTransport();
    const request = wireRequest(origin.replace('://', '://name:secret@') + '/upload?x=1#hidden');
    request.method = 'POST';
    request.body = Uint8Array.of(0, 1, 254, 255);
    request.headers.append('X-Value', 'one');
    request.headers.append('X-Value', 'two');
    const result = await exchange(transport, request);
    expect(await seen.promise).toEqual({ method: 'POST', url: '/upload?x=1', bytes: [0, 1, 254, 255], auth: undefined, values: 'one, two' });
    expect(result.status).toBe(201);
    expect(result.body.toString()).toBe('done');
    expect(result.hasValidTLS).toBe(false);
    expect(result.headers.getSetCookie()).toEqual(['a=1', 'b=2']);
    expect(result.headers.list.filter(([name]) => name.toLowerCase() === 'strict-transport-security'))
      .toEqual([['Strict-Transport-Security', 'max-age=10'], ['Strict-Transport-Security', 'max-age=20']]);
  });

  it('delivers redirect responses without following them', async () => {
    const paths: string[] = [];
    const server = createServer((request, response) => {
      paths.push(request.url!);
      response.writeHead(302, { Location: '/other' });
      response.end();
    });
    servers.push(server);
    const result = await exchange(makeTransport(), wireRequest(await listen(server)));
    expect(result.status).toBe(302);
    expect(result.headers.get('Location')).toBe('/other');
    expect(paths).toEqual(['/']);
  });

  it('completes a 304 with a representation Content-Length and no response body', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(304, { ETag: '"one"', 'Content-Length': '123' });
      response.end();
    });
    servers.push(server);
    const request = wireRequest(await listen(server));
    request.headers.append('If-None-Match', '"one"');
    const result = await exchange(makeTransport(), request);
    expect(result.status).toBe(304);
    expect(result.headers.get('Content-Length')).toBe('123');
    expect(result.body).toHaveLength(0);
  });

  it('accepts an unsolicited 100 Continue before the final response', async () => {
    const server = createServer((_request, response) => { response.writeContinue(); response.end('done'); });
    servers.push(server);
    const result = await exchange(makeTransport(), wireRequest(await listen(server)));
    expect(result.status).toBe(200);
    expect(result.body.toString()).toBe('done');
  });

  it('separates informational responses, an unknown final status, and trailers', async () => {
    const server = createServer((_request, response) => {
      response.writeProcessing();
      response.writeEarlyHints({ link: '</asset>; rel=preload' });
      response.writeHead(299, 'Local success', { 'X-Phase': 'final', Trailer: 'X-Phase' });
      response.write('done');
      response.addTrailers({ 'X-Phase': 'trailer' });
      response.end();
    });
    servers.push(server);
    const responses: { status: number; message: string; headers: FetchHeaders; }[] = [];
    const chunks: Uint8Array[] = [];
    const request = wireRequest(await listen(server));
    await new Promise<void>((resolve, reject) => makeTransport().dispatch(request, {
      onHeaders(status, message, headers) { responses.push({ status, message, headers }); },
      onData(bytes) { chunks.push(bytes); }, onEnd: resolve, onError: reject,
    }));
    expect(responses.map(({ status }) => status)).toEqual([102, 103, 299]);
    expect(responses[1]!.headers.get('Link')).toBe('</asset>; rel=preload');
    expect(responses[2]!.message).toBe('Local success');
    expect(responses[2]!.headers.get('Link')).toBeNull();
    expect(responses[2]!.headers.get('X-Phase')).toBe('final');
    expect(Buffer.concat(chunks).toString()).toBe('done');
  });

  it.each([408, 413, 503])('returns %i and Retry-After without replaying the request', async (status) => {
    let requests = 0;
    const server = createServer((_request, response) => {
      requests++;
      response.writeHead(status, { 'Retry-After': '120' });
      response.end('later');
    });
    servers.push(server);
    const result = await exchange(makeTransport(), wireRequest(await listen(server)));
    expect(result.status).toBe(status);
    expect(result.headers.get('Retry-After')).toBe('120');
    expect(result.body.toString()).toBe('later');
    expect(requests).toBe(1);
  });

  it('fails an unsolicited protocol upgrade', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(101, { Connection: 'Upgrade', Upgrade: 'websocket' });
      response.end();
    });
    servers.push(server);
    await expect(exchange(makeTransport(), wireRequest(await listen(server))))
      .rejects.toMatchObject({ code: 'UND_ERR_SOCKET' });
  });

  it('reports a connection failure without replaying an already sent request', async () => {
    let requests = 0;
    const server = createServer((request) => { requests++; request.socket.destroy(); });
    servers.push(server);
    await expect(exchange(makeTransport(), wireRequest(await listen(server))))
      .rejects.toMatchObject({ code: 'UND_ERR_SOCKET' });
    expect(requests).toBe(1);
  });

  it('reuses value-equal partitions and separates different partitions, credentials, and forced connections', async () => {
    const ports: number[] = [];
    const server = createServer((request, response) => { ports.push(request.socket.remotePort!); response.end('ok'); });
    servers.push(server);
    const url = await listen(server);
    const transport = makeTransport();
    const request = wireRequest(url);
    request.partitionKey = partition('https://one.test/');
    await exchange(transport, request);
    request.partitionKey = partition('https://one.test/');
    await exchange(transport, request);
    request.partitionKey = partition('https://two.test/');
    await exchange(transport, request);
    request.includeCredentials = true;
    await exchange(transport, request);
    request.forceNewConnection = true;
    await exchange(transport, request);
    expect(ports[0]).toBe(ports[1]);
    expect(new Set(ports).size).toBe(4);
  });

  it('pauses real response callbacks and resumes the unread message without losing bytes', async () => {
    const server = createServer((_request, response) => response.end(Buffer.alloc(256 * 1024, 7)));
    servers.push(server);
    const paused = Promise.withResolvers<void>();
    const done = Promise.withResolvers<void>();
    let size = 0;
    const control = makeTransport().dispatch(wireRequest(await listen(server)), {
      onHeaders() {},
      onData(bytes) {
        expect(bytes.every((byte) => byte === 7)).toBe(true);
        size += bytes.byteLength;
        if (size === bytes.byteLength) { control.pause(); paused.resolve(); }
      },
      onEnd: done.resolve,
      onError: done.reject,
    });
    await paused.promise;
    const stoppedAt = size;
    // A Node turn is an observation boundary, not an arbitrary timer delay.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(size).toBe(stoppedAt);
    expect(size).toBeLessThan(256 * 1024);
    control.resume();
    await done.promise;
    expect(size).toBe(256 * 1024);
  });

  it('cancels a queued request before it gets a socket', async () => {
    const paths: string[] = [];
    const server = createServer((request, response) => {
      paths.push(request.url!);
      if (request.url === '/third') { response.end('done'); return; }
      response.writeHead(200);
      response.write('waiting');
    });
    servers.push(server);
    const origin = await listen(server);
    const transport = makeTransport();
    const active = Array.from({ length: 6 }, (_, index) => {
      const started = Promise.withResolvers<void>();
      const failed = Promise.withResolvers<unknown>();
      const control = transport.dispatch(wireRequest(origin + `/active-${index}`), {
        onHeaders: () => started.resolve(), onData() {}, onEnd() {}, onError: failed.resolve,
      });
      return { started: started.promise, failed: failed.promise, control };
    });
    await Promise.all(active.map((entry) => entry.started));
    const secondFailed = Promise.withResolvers<unknown>();
    const canceled = vi.fn(secondFailed.resolve);
    const second = transport.dispatch(wireRequest(origin + '/second'), {
      onHeaders() {}, onData() {}, onEnd() {}, onError: canceled,
    });
    second.abort();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(canceled).toHaveBeenCalledOnce();
    for (const entry of active) entry.control.abort();
    for (const entry of active) expect(await entry.failed).toMatchObject({ code: 'UND_ERR_ABORTED' });
    expect(await secondFailed.promise).toMatchObject({ code: 'UND_ERR_ABORTED' });
    await exchange(transport, wireRequest(origin + '/third'));
    expect(canceled).toHaveBeenCalledOnce();
    expect(paths).not.toContain('/second');
    expect(paths).toHaveLength(7);
    expect(paths.at(-1)).toBe('/third');
  });
});

describe('Node HTTPS transport', () => {
  it('reports authenticated TLS only after certificate verification succeeds', async () => {
    const server = createHTTPSServer({ key, cert }, (_request, response) => response.end('secure'));
    servers.push(server);
    const request = wireRequest(await listen(server, 'https'));
    const result = await exchange(makeTransport(cert), request);
    expect(result.hasValidTLS).toBe(true);
    expect(result.body.toString()).toBe('secure');
  });

  it('rejects an untrusted certificate without a plaintext fallback', async () => {
    let requests = 0;
    const server = createHTTPSServer({ key, cert }, (_request, response) => { requests++; response.end(); });
    servers.push(server);
    await expect(exchange(makeTransport(), wireRequest(await listen(server, 'https'))))
      .rejects.toMatchObject({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
    expect(requests).toBe(0);
  });
});

function makeTransport(ca?: Buffer) {
  const transport = new NodeHTTPTransport(ca);
  transports.push(transport);
  return transport;
}

function wireRequest(url: string): HTTPTransportRequest {
  return { url: parseURL(url).url!, method: 'GET', headers: new FetchHeaders(), body: null, partitionKey: null, includeCredentials: false, forceNewConnection: false };
}

function partition(url: string): NetworkPartitionKey {
  return [obtainSite(obtainURLOrigin(parseURL(url).url!)), null];
}

function exchange(transport: NodeHTTPTransport, request: HTTPTransportRequest) {
  return new Promise<{ status: number; headers: FetchHeaders; hasValidTLS: boolean; body: Buffer; }>((resolve, reject) => {
    let status = 0;
    let headers = new FetchHeaders();
    let hasValidTLS = false;
    const chunks: Uint8Array[] = [];
    const listener: HTTPTransportListener = {
      onHeaders(value, _message, fields, tls) { status = value; headers = fields; hasValidTLS = tls; },
      onData(bytes) { chunks.push(bytes); },
      onEnd() { resolve({ status, headers, hasValidTLS, body: Buffer.concat(chunks) }); },
      onError: reject,
    };
    transport.dispatch(request, listener);
  });
}
