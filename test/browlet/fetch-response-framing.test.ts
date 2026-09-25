import { readFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { createSecureServer, Http2ServerResponse, type ServerHttp2Stream } from 'node:http2';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Browlet } from '../../src/browlet/browlet';
import { getBindingContext, getRelevantRealm, project } from '../../src/browlet/bindings';
import { NodeHTTPTransport } from '../../src/browlet/loader/node-transport';
import { FetchParams } from '../../src/fetch/params';
import { FetchRequest } from '../../src/fetch/request';
import { type FetchResponse, ResponseImpl } from '../../src/fetch/response';
import { FetchTimingInfo } from '../../src/fetch/timing';
import { observe } from './streams/implementation-fixture';
import { closeServer, listen } from './loader/http-fixture';

const tls = {
  cert: readFileSync('test/browlet/loader/fixtures/localhost-cert.pem'),
  key: readFileSync('test/browlet/loader/fixtures/localhost-key.pem'),
};
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});

describe.each(['http/1.1', 'h2'] as const)('Fetch response framing over %s', (protocol) => {
  it.each([
    ['HEAD', 200, '123'], ['GET', 304, '123'], ['GET', 204, null], ['GET', 205, '0'],
  ] as const)('delivers no body for %s/%i while retaining representation metadata', async (method, status, length) => {
    const f = await fixture(protocol, (response) => {
      response.statusCode = status;
      response.setHeader('Content-Encoding', 'gzip');
      if (length !== null) response.setHeader('Content-Length', length);
      response.end();
    });
    f.params.request.method = method;
    const received = Promise.withResolvers<{ response: FetchResponse; body: Uint8Array | null | 'failure'; }>();
    f.params.processResponseConsumeBody = (response, body) => received.resolve({ response, body });
    f.params.mainFetch();
    const { response, body } = await received.promise;
    expect(response.status).toBe(status);
    expect(response.body).toBeNull();
    expect(body).toBeNull();
    expect(response.headerList.get('Content-Length')).toBe(length);
    expect(response.headerList.get('Content-Encoding')).toBe('gzip');
    expect(response.bodyInfo).toMatchObject({ encodedSize: 0, decodedSize: 0 });
    expect(f.params.controller.state).toBe('ongoing');
  });

  it('rejects a page body read when the response ends before its declared length', async () => {
    const f = await fixture(protocol, (response) => {
      response.setHeader('Content-Length', '10');
      if (response instanceof Http2ServerResponse) {
        response.end('short');
      } else {
        response.write('short');
        response.socket!.end();
      }
    });
    const response = await f.receive();
    expect(response.status).toBe(200);
    expect(await f.browlet.evaluate(async () => {
      try { await (globalThis as unknown as NetworkPage).networkResponse.text(); return false; }
      catch (error) { return error instanceof TypeError; }
    })).toBe(true);
    expect(f.params.controller.state).toBe('terminated');
  });
});

async function fixture(protocol: 'http/1.1' | 'h2', respond: (response: ServerResponse | Http2ServerResponse) => void) {
  const server = protocol === 'h2' ? createSecureServer(tls) : createServer();
  server.on('request', (_request: unknown, response: ServerResponse | Http2ServerResponse) => respond(response));
  // The deliberately truncated HTTP/2 response can also error its server stream.
  if (protocol === 'h2') server.on('stream', (stream: ServerHttp2Stream) => { stream.on('error', () => {}); });
  const origin = await listen(server, protocol === 'h2' ? 'https' : 'http');
  cleanup.push(() => closeServer(server));
  const browlet = new Browlet({ route: () => '', reporting: false });
  await browlet.navigate(origin);
  const realm = getRelevantRealm(browlet.window);
  const env = realm.env;
  env.userAgent.httpTransport = new NodeHTTPTransport(tls.cert, env.userAgent.connectionPool);
  cleanup.push(() => env.userAgent.httpTransport.close());
  const request = new FetchRequest(env.parseURL(origin + '/resource').url!, env, env.userAgent);
  request.populateFromClient();
  request.referrer = null;
  const params = new FetchParams(request, new FetchTimingInfo(), env);
  params.taskDestination = env.exec.global;
  const receive = async () => {
    const response = await observe(params.httpNetworkOrCacheFetch());
    const context = getBindingContext(realm);
    Reflect.set(browlet.window, 'networkResponse', project(context.construct(ResponseImpl, response, 'response')));
    return response;
  };
  return { browlet, params, receive };
}

interface NetworkPage { networkResponse: Response; }
