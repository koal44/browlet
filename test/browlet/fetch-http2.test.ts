import { readFileSync } from 'node:fs';
import { constants, createSecureServer, type Http2SecureServer } from 'node:http2';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { getBindingContext, getRelevantRealm, project, unwrap } from '../../src/browlet/bindings';
import { Browlet } from '../../src/browlet/browlet';
import { NodeHTTPTransport } from '../../src/browlet/loader/node-transport';
import { FetchBody } from '../../src/fetch/body';
import { FetchRequest } from '../../src/fetch/request';
import { ResponseImpl, type FetchResponse } from '../../src/fetch/response';
import type { ReadableStreamImpl } from '../../src/streams/readable-stream';
import { closeServer, listen } from './loader/http-fixture';
import { createFetchOperation } from './fetch-fixture';

const tls = {
  cert: readFileSync('test/browlet/loader/fixtures/localhost-cert.pem'),
  key: readFileSync('test/browlet/loader/fixtures/localhost-key.pem'),
  strictSingleValueFields: false,
};
const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

describe('Fetch over HTTP/2', () => {
  it('streams an author-created body through public fetch without exposing transport objects', async () => {
    const server = createSecureServer(tls, (request, response) => request.pipe(response));
    const { browlet } = await fixture(server);
    expect(await browlet.evaluate(async () => {
      let count = 0;
      const body = new ReadableStream({
        pull(controller) {
          controller.enqueue(new TextEncoder().encode('chunk' + count++));
          if (count === 3) controller.close();
        },
      });
      const init = { method: 'POST', body, duplex: 'half' };
      const response = await fetch('/upload', init);
      return [response instanceof Response, response.body instanceof ReadableStream, await response.text()];
    })).toEqual([true, true, 'chunk0chunk1chunk2']);
  });

  it('streams a source-less page upload and reports its transmitted bytes and completion', async () => {
    const server = createSecureServer(tls, (request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => response.end(Buffer.concat(chunks)));
    });
    const f = await fixture(server);
    await f.browlet.evaluate(() => {
      let index = 0;
      Reflect.set(globalThis, 'uploadStream', new ReadableStream({
        pull(controller) {
          controller.enqueue(new Uint8Array([65 + index++, 65 + index++]));
          if (index === 4) controller.close();
        },
      }));
    });
    const stream = unwrap<ReadableStreamImpl>(Reflect.get(f.browlet.window, 'uploadStream') as ReadableStream);
    f.request.method = 'POST';
    f.request.body = new FetchBody(stream, f.env);
    expect(f.request.body.source).toBeNull();
    const progress: number[] = [];
    const end = Promise.withResolvers<void>();
    f.operation.options.processRequestBodyChunkLength = (length) => progress.push(length);
    f.operation.options.processRequestEndOfBody = () => end.resolve();
    expect((await f.receive()).status).toBe(200);
    expect(await f.browlet.evaluate(async () => (globalThis as unknown as NetworkPage).networkResponse.text())).toBe('ABCD');
    await end.promise;
    expect(progress.reduce((sum, length) => sum + length, 0)).toBe(4);
  });

  it('cancels an unfinished upload when the server finishes its response', async () => {
    const server = createSecureServer(tls, (_request, response) => response.end());
    const { browlet } = await fixture(server);
    expect(await browlet.evaluate(async () => {
      const canceled = Promise.withResolvers<unknown>();
      const body = new ReadableStream({
        start(stream) { stream.enqueue(new Uint8Array([1])); },
        cancel(value) { canceled.resolve(value); },
      });
      const init = { method: 'POST', body, duplex: 'half' };
      const response = await fetch('/early', init);
      await response.text();
      await canceled.promise;
      return true;
    })).toBe(true);
  });

  it('does not replay a refused request whose body came through the upload iterator', async () => {
    let requests = 0;
    const server = createSecureServer(tls);
    server.on('stream', (stream) => {
      requests++;
      stream.on('error', () => {}); // The deliberately refused server stream also emits an error.
      stream.close(constants.NGHTTP2_REFUSED_STREAM);
    });
    const f = await fixture(server);
    f.request.method = 'POST';
    f.request.body = FetchBody.fromBytes(Uint8Array.of(1, 2, 3), f.env);
    expect((await f.receive()).type).toBe('error');
    expect(f.operation.controller.state).toBe('terminated');
    expect(requests).toBe(1);
  });

  it('validates a cached representation over HTTP/2 and then reuses its complete body', async () => {
    let exchanges = 0;
    const server = createSecureServer(tls, (request, response) => {
      exchanges++;
      const validating = request.headers['if-none-match'] === '"one"';
      response.writeHead(validating ? 304 : 200, [
        'etag', '"one"', 'content-length', '6', 'cache-control', validating ? 'max-age=300' : 'max-age=0',
        'vary', 'accept', 'vary', 'accept-language',
      ]);
      response.end(validating ? '' : 'cached');
    });
    const f = await fixture(server);
    await f.receive();
    expect(await f.browlet.evaluate(async () => (globalThis as unknown as NetworkPage).networkResponse.text())).toBe('cached');
    expect((await f.receive()).cacheUsage).toBe('validated');
    expect(await f.browlet.evaluate(async () => (globalThis as unknown as NetworkPage).networkResponse.text())).toBe('cached');
    expect((await f.receive()).cacheUsage).toBe('local');
    expect(await f.browlet.evaluate(async () => (globalThis as unknown as NetworkPage).networkResponse.text())).toBe('cached');
    expect(exchanges).toBe(2);
  });

  it('records Early Hints timing before the final response', async () => {
    const server = createSecureServer(tls);
    server.on('stream', (stream) => {
      stream.additionalHeaders({ ':status': 103, link: '</asset>; rel=preload' });
      stream.respond({ ':status': 200 });
      stream.end('done');
    });
    const f = await fixture(server);
    const hint = Promise.withResolvers<FetchResponse>();
    f.request.mode = 'navigate';
    f.request.destination = 'document';
    f.operation.options.processEarlyHintsResponse = hint.resolve;
    const response = await f.receive();
    expect(response.status).toBe(200);
    expect((await hint.promise).headerList.get('Link')).toBe('</asset>; rel=preload');
    expect(f.operation.controller.extractFullTimingInfo().firstInterimNetworkResponseStartTime).toBeGreaterThan(0);
    expect(f.operation.controller.extractFullTimingInfo().finalNetworkResponseStartTime)
      .toBeGreaterThanOrEqual(f.operation.controller.extractFullTimingInfo().firstInterimNetworkResponseStartTime);
  });

  it('decodes repeated Content-Encoding, selects the last MIME type, and learns only the first HSTS field', async () => {
    const plain = 'some plain text';
    const encoded = brotliCompressSync(gzipSync(plain));
    const server = createSecureServer(tls, (_request, response) => {
      response.writeHead(200, [
        'content-encoding', 'gzip', 'content-encoding', 'br',
        'content-type', 'text/plain', 'content-type', 'text/html',
        'strict-transport-security', 'max-age=300; includeSubDomains', 'strict-transport-security', 'max-age=0',
      ]);
      response.end(encoded);
    });
    const f = await fixture(server);
    f.request.mode = 'navigate';
    f.request.destination = 'document';
    const response = await f.receive();
    expect(response.status).toBe(200);
    expect(await f.browlet.evaluate(async () => {
      const blob = await (globalThis as unknown as NetworkPage).networkResponse.blob();
      return { type: blob.type, text: await blob.text() };
    })).toEqual({ type: 'text/html', text: plain });
    expect(response.bodyInfo).toMatchObject({ encodedSize: encoded.length, decodedSize: plain.length });
    expect(f.env.userAgent.hstsStore.hosts.get('localhost')?.includeSubDomains).toBe(true);
    expect(f.env.userAgent.hstsStore.requiresHTTPS(f.request.currentURL.host)).toBe(true);
    expect(f.operation.controller.extractFullTimingInfo().finalConnectionTimingInfo?.alpnNegotiatedProtocol).toEqual(new TextEncoder().encode('h2'));
  });

  it('rejects repeated Location fields without following either target', async () => {
    const paths: string[] = [];
    const server = createSecureServer(tls, (request, response) => {
      paths.push(request.url);
      response.writeHead(302, ['location', '/A', 'location', '/B']);
      response.end();
    });
    const f = await fixture(server);
    const response = await f.receive();
    expect(response.type).toBe('error');
    expect(paths).toEqual(['/resource']);
  });
});

async function fixture(server: Http2SecureServer) {
  const origin = (await listen(server, 'https')).replace('127.0.0.1', 'localhost');
  cleanup.push(() => closeServer(server));
  const browlet = new Browlet({ route: () => '', reporting: false });
  await browlet.navigate(origin);
  const realm = getRelevantRealm(browlet.window);
  const env = realm.env;
  env.userAgent.httpTransport = new NodeHTTPTransport(env.userAgent, tls.cert);
  cleanup.push(() => env.userAgent.httpTransport.close());
  const request = new FetchRequest(env.parseURL(origin + '/resource').url!, env, env.userAgent);
  request.populateFromClient();
  request.referrer = null;
  const operation = createFetchOperation(request, env);
  const receive = async () => {
    const response = await operation.start();
    const context = getBindingContext(realm);
    Reflect.set(browlet.window, 'networkResponse', project(context.construct(ResponseImpl, [response, 'response'])));
    return response;
  };
  return { browlet, env, request, operation, receive };
}

interface NetworkPage { networkResponse: Response; }
