import { createServer, type Server } from 'node:http';
import { createServer as createHTTPSServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Browlet } from '../../src/browlet/browlet';
import { getBindingContext, getRelevantRealm, project } from '../../src/browlet/bindings';
import { NodeHTTPTransport } from '../../src/browlet/loader/node-transport';
import { FetchBody } from '../../src/fetch/body';
import { FetchParams } from '../../src/fetch/params';
import { FetchRequest } from '../../src/fetch/request';
import { FetchResponse, ResponseImpl } from '../../src/fetch/response';
import { FetchTimingInfo } from '../../src/fetch/timing';
import type { HTTPAuthentication } from '../../src/fetch/http/authentication';
import { observe } from './streams/implementation-fixture';
import { closeServer, listen } from './loader/http-fixture';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});

describe('HTTP transaction request preparation', () => {
  it('sends browser headers and exact content length without mutating the original header list', async () => {
    const f = await fixture();
    f.request.method = 'POST';
    f.request.initiator = 'prefetch';
    f.request.referrer = f.env.parseURL(f.origin + '/referrer').url!;
    f.request.body = FetchBody.fromBytes(Uint8Array.of(1, 2, 3), f.env);
    const progress: number[] = [];
    const end = Promise.withResolvers<void>();
    f.params.processRequestBodyChunkLength = (length) => progress.push(length);
    f.params.processRequestEndOfBody = () => end.resolve();
    const response = await observe(f.params.httpNetworkOrCacheFetch());
    const seen = JSON.parse(await f.text(response)) as EchoResponse;
    await end.promise;
    expect(seen.body).toEqual([1, 2, 3]);
    expect(seen.headers).toMatchObject({
      'content-length': '3', 'user-agent': f.env.userAgent.defaultUserAgentValue,
      referer: f.origin + '/referrer', origin: f.origin, 'sec-purpose': 'prefetch',
      'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'no-cors', 'accept-encoding': 'gzip, deflate, br',
    });
    expect(f.request.headerList.list).toEqual([]);
    expect(f.request.body.stream.disturbed).toBe(true);
    expect(progress.reduce((sum, value) => sum + value, 0)).toBe(3);
    expect(response.requestIncludesCredentials).toBe(true);
    expect(f.params.timingInfo.finalConnectionTimingInfo?.connectionEndTime).toBeGreaterThan(0);
    expect(f.params.timingInfo.finalNetworkRequestStartTime).toBeGreaterThan(0);
    expect(f.params.timingInfo.finalNetworkResponseStartTime).toBeGreaterThanOrEqual(f.params.timingInfo.finalNetworkRequestStartTime);
  });

  it.each(['POST', 'PUT'])('sends an explicit zero length for a bodyless %s', async (method) => {
    const f = await fixture();
    f.request.method = method;
    const seen = JSON.parse(await f.text(await observe(f.params.httpNetworkOrCacheFetch()))) as EchoResponse;
    expect(seen.headers['content-length']).toBe('0');
  });

  it('prepares range and reload fields while preserving author cache directives', async () => {
    const f = await fixture();
    f.request.cacheMode = 'reload';
    f.request.headerList.append('Range', 'bytes=0-2');
    f.request.headerList.append('Cache-Control', 'max-age=10');
    const response = await observe(f.params.httpNetworkOrCacheFetch());
    const seen = JSON.parse(await f.text(response)) as EchoResponse;
    expect(seen.headers).toMatchObject({ 'accept-encoding': 'identity', pragma: 'no-cache', 'cache-control': 'max-age=10' });
    expect(response.rangeRequested).toBe(true);
  });

  it('counts the current keepalive body only once and rejects a combined body budget over 64 KiB', async () => {
    const f = await fixture();
    f.request.method = 'POST';
    f.request.keepalive = true;
    f.request.body = FetchBody.fromBytes(new Uint8Array(40 * 1024), f.env);
    f.env.fetchGroup.fetchRecords.push({ request: f.request, controller: f.params.controller });
    expect((await observe(f.params.httpNetworkOrCacheFetch())).status).toBe(200);
    const second = new FetchRequest(f.request.currentURL, f.env, f.env.userAgent);
    second.populateFromClient();
    second.referrer = null;
    second.method = 'POST';
    second.keepalive = true;
    second.body = FetchBody.fromBytes(new Uint8Array(25 * 1024), f.env);
    const params = new FetchParams(second, new FetchTimingInfo(), f.env);
    f.env.fetchGroup.fetchRecords.push({ request: second, controller: params.controller });
    expect((await observe(params.httpNetworkOrCacheFetch())).type).toBe('error');
  });
});

describe('HTTP transaction credentials and retries', () => {
  it('stores each cookie before headers resolve and sends cookies only when credentials are allowed', async () => {
    const f = await fixture(createServer((request, response) => {
      response.setHeader('Set-Cookie', ['first=1; SameSite=Lax', 'second=2; SameSite=Lax']);
      response.end(request.headers.cookie ?? 'none');
    }));
    expect(await f.text(await observe(f.params.httpNetworkOrCacheFetch()))).toBe('none');
    expect(await f.text(await observe(f.params.httpNetworkOrCacheFetch()))).toBe('first=1; second=2');
    f.request.credentialsMode = 'omit';
    expect(await f.text(await observe(f.params.httpNetworkOrCacheFetch()))).toBe('none');
  });

  it('leaves a declined origin challenge available to its consumer', async () => {
    const f = await fixture(createServer((_request, response) => {
      response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="private"' });
      response.end('authentication required');
    }));
    const response = await observe(f.params.httpNetworkOrCacheFetch());
    expect(response.status).toBe(401);
    expect(await f.text(response)).toBe('authentication required');
    expect(f.authentication.prompt).toHaveBeenCalledOnce();
    expect(f.params.controller.state).toBe('ongoing');
  });

  it('replays a retained body once on a fresh connection after 421, including redirect-error requests', async () => {
    const bodies: Buffer[] = [];
    const ports: number[] = [];
    const f = await fixture(createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        bodies.push(Buffer.concat(chunks));
        ports.push(request.socket.remotePort!);
        response.statusCode = bodies.length === 1 ? 421 : 200;
        response.end('result');
      });
    }));
    f.request.traversableForUserPrompts = null;
    f.request.redirectMode = 'error';
    f.request.method = 'POST';
    f.request.body = FetchBody.fromBytes(Uint8Array.of(3, 4, 5), f.env);
    const response = await observe(f.params.httpNetworkOrCacheFetch());
    expect(response.status).toBe(200);
    expect(await f.text(response)).toBe('result');
    expect(bodies.map((bytes) => [...bytes])).toEqual([[3, 4, 5], [3, 4, 5]]);
    expect(ports[0]).not.toBe(ports[1]);
    expect(f.params.controller.state).toBe('ongoing');
  });

  it('stops after one fresh-connection retry when 421 persists', async () => {
    let exchanges = 0;
    const f = await fixture(createServer((_request, response) => {
      exchanges++;
      response.writeHead(421);
      response.end('misdirected');
    }));
    const response = await observe(f.params.httpNetworkOrCacheFetch());
    expect(response.status).toBe(421);
    expect(await f.text(response)).toBe('misdirected');
    expect(exchanges).toBe(2);
  });

  it('releases an unread redirect body before following without aborting the Fetch controller', async () => {
    const f = await fixture(createServer((_request, response) => {
      response.writeHead(302, { Location: '/next' });
      response.write(Buffer.alloc(96 * 1024));
    }));
    const response = await observe(f.params.httpNetworkOrCacheFetch());
    const discard = vi.fn(response.discardBody!);
    response.discardBody = discard;
    vi.spyOn(f.params, 'mainFetch').mockReturnValue(f.env.userAgent.hostPromises.resolve(new FetchResponse()));
    await observe(f.params.httpRedirectFetch(response));
    expect(discard).toHaveBeenCalledOnce();
    expect(f.params.controller.state).toBe('ongoing');
  });
});

describe('HTTP response metadata', () => {
  it('delivers Early Hints on the caller task destination before the final response', async () => {
    const f = await fixture(createServer((_request, response) => {
      response.writeEarlyHints({ link: '</asset.css>; rel=preload; as=style' });
      response.end('ready');
    }));
    const hint = Promise.withResolvers<FetchResponse>();
    f.params.processEarlyHintsResponse = hint.resolve;
    const response = await observe(f.params.httpNetworkOrCacheFetch());
    expect(await f.text(response)).toBe('ready');
    const interim = await hint.promise;
    expect(interim.status).toBe(103);
    expect(interim.headerList.get('Link')).toBe('</asset.css>; rel=preload; as=style');
    expect(f.params.timingInfo.firstInterimNetworkResponseStartTime).toBeGreaterThan(0);
    expect(f.params.timingInfo.finalNetworkResponseStartTime).toBeGreaterThanOrEqual(f.params.timingInfo.firstInterimNetworkResponseStartTime);
  });

  it('learns HSTS from the first verified redirect field before a consumer follows Location', async () => {
    const cert = readFileSync('test/browlet/loader/fixtures/localhost-cert.pem');
    const key = readFileSync('test/browlet/loader/fixtures/localhost-key.pem');
    const server = createHTTPSServer({ cert, key }, (_request, response) => {
      response.writeHead(302, ['Location', 'http://localhost/next', 'Strict-Transport-Security', 'max-age=300; includeSubDomains', 'Strict-Transport-Security', 'max-age=0']);
      response.end();
    });
    const f = await fixture(server, 'https');
    f.env.userAgent.httpTransport = new NodeHTTPTransport(cert, f.env.userAgent.connectionPool);
    f.request.urlList = [f.env.parseURL(f.origin.replace('127.0.0.1', 'localhost')).url!];
    const response = await observe(f.params.httpNetworkOrCacheFetch());
    expect(response.status).toBe(302);
    expect(f.env.userAgent.hstsStore.hosts.get('localhost')?.includeSubDomains).toBe(true);
    expect(f.env.userAgent.hstsStore.requiresHTTPS(f.request.currentURL.host)).toBe(true);
  });
});

async function fixture(server: Server = createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => chunks.push(chunk));
  request.on('end', () => response.end(JSON.stringify({ headers: request.headers, body: [...Buffer.concat(chunks)] })));
}), scheme = 'http') {
  const origin = await listen(server, scheme);
  cleanup.push(() => closeServer(server));
  const browlet = new Browlet({ route: () => '', reporting: false });
  await browlet.navigate(origin);
  const realm = getRelevantRealm(browlet.window);
  const env = realm.env;
  cleanup.push(() => env.userAgent.httpTransport.close());
  // Control the missing authentication owner explicitly; do not fake the browser environment.
  const authentication = {
    getAuthorization: vi.fn<HTTPAuthentication['getAuthorization']>(() => null),
    applyProxyAuthentication: vi.fn<HTTPAuthentication['applyProxyAuthentication']>(),
    prompt: vi.fn<HTTPAuthentication['prompt']>(() => env.userAgent.hostPromises.resolve(false)),
    store: vi.fn<HTTPAuthentication['store']>(),
  };
  Object.assign(env.userAgent, { httpAuthentication: authentication });
  const request = new FetchRequest(env.parseURL(origin + '/resource').url!, env, env.userAgent);
  request.populateFromClient();
  request.referrer = null;
  const params = new FetchParams(request, new FetchTimingInfo(), env);
  const text = (response: FetchResponse) => {
    const context = getBindingContext(realm);
    Reflect.set(browlet.window, 'networkResponse', project(context.construct(ResponseImpl, response, 'response')));
    return browlet.evaluate(async () => (globalThis as unknown as { networkResponse: Response; }).networkResponse.text());
  };
  return { browlet, env, origin, request, params, authentication, text };
}

interface EchoResponse { headers: Record<string, string>; body: number[]; }
