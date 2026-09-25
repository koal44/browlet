import { createServer, type IncomingHttpHeaders, type RequestListener, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Browlet } from '../../src/browlet/browlet';
import { getBindingContext, getRelevantRealm, project } from '../../src/browlet/bindings';
import { fetch } from '../../src/fetch/fetch';
import { FetchParams } from '../../src/fetch/params';
import { FetchRequest } from '../../src/fetch/request';
import { FetchResponse, isFilteredResponse, ResponseImpl } from '../../src/fetch/response';
import { FetchTimingInfo } from '../../src/fetch/timing';
import { closeServer, listen } from './loader/http-fixture';
import { observe } from './streams/implementation-fixture';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});

describe('CORS preflight transactions', () => {
  it('sends OPTIONS first, reuses its permissions, and exposes only the actual response', async () => {
    const wire: { method: string; headers: IncomingHttpHeaders; }[] = [];
    const f = await fixture((request, response) => {
      wire.push({ method: request.method!, headers: request.headers });
      response.writeHead(200, {
        'Access-Control-Allow-Origin': request.headers.origin!,
        'Access-Control-Allow-Methods': 'PUT',
        'Access-Control-Allow-Headers': 'X-A, X-Z',
        'Access-Control-Max-Age': '60',
        'Cache-Control': 'no-store',
      });
      response.end(request.method === 'OPTIONS' ? 'unused preflight body' : 'actual response');
    });
    const first = f.params();
    first.timingInfo.startTime = 12;
    const preparation = vi.spyOn(FetchParams.prototype, 'httpNetworkOrCacheFetch');
    expect(await f.text(await observe(first.httpFetch(true)))).toBe('actual response');
    const preflight = (preparation.mock.contexts as FetchParams[]).find((params) => params.request.method === 'OPTIONS')!;
    expect(preflight.request.client).toBe(f.env);
    expect(preflight.request.determineNetworkPartitionKey()).toEqual(first.request.determineNetworkPartitionKey());
    expect(preflight.request.webDriverId).toBe(first.request.webDriverId);
    expect(preflight.controller).toBe(first.controller);
    expect(preflight.timingInfo).not.toBe(first.timingInfo);
    expect(first.timingInfo.startTime).toBe(12);
    expect(await f.text(await observe(f.params().httpFetch(true)))).toBe('actual response');
    expect(wire.map(({ method }) => method)).toEqual(['OPTIONS', 'PUT', 'PUT']);
    expect(wire[0]!.headers).toMatchObject({
      accept: '*/*', origin: 'http://127.0.0.1',
      'access-control-request-method': 'PUT', 'access-control-request-headers': 'x-a,x-z',
    });
    expect(wire[0]!.headers['x-a']).toBeUndefined();
    expect(wire[1]!.headers['access-control-request-method']).toBeUndefined();
    expect(first.controller.state).toBe('ongoing');
  });

  it('omits authentication from OPTIONS and validates it using the original credentials mode', async () => {
    const wire: IncomingHttpHeaders[] = [];
    const f = await fixture((request, response) => {
      wire.push(request.headers);
      response.writeHead(200, {
        'Access-Control-Allow-Origin': request.headers.origin!, 'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'PUT', 'Access-Control-Allow-Headers': 'X-A,X-Z',
      });
      response.end('ready');
    });
    const params = f.params();
    params.request.credentialsMode = 'include';
    const cookies = new FetchResponse();
    cookies.headerList.append('Set-Cookie', 'session=existing; Path=/');
    cookies.parseAndStoreCookies(params.request);
    const authentication = f.env.userAgent.httpAuthentication;
    authentication.store(params.request.currentURL, { username: 'user', password: 'secret', realm: 'test' }, authentication.generation);
    expect(await f.text(await observe(params.httpFetch(true)))).toBe('ready');
    expect(wire[0]!.authorization).toBeUndefined();
    expect(wire[0]!.cookie).toBeUndefined();
    expect(wire[1]!.authorization).toBe('Basic dXNlcjpzZWNyZXQ=');
    expect(wire[1]!.cookie).toBe('session=existing');
  });

  it.each([
    ['missing origin', { 'Access-Control-Allow-Origin': undefined }, 'PUT', false],
    ['wildcard origin with credentials', { 'Access-Control-Allow-Origin': '*' }, 'PUT', true],
    ['missing credential permission', { 'Access-Control-Allow-Credentials': undefined }, 'PUT', true],
    ['unlisted method', { 'Access-Control-Allow-Methods': 'DELETE' }, 'PUT', false],
    ['method case', { 'Access-Control-Allow-Methods': 'put' }, 'PUT', false],
    ['malformed method list', { 'Access-Control-Allow-Methods': 'PUT, bad method' }, 'PUT', false],
    ['malformed header list', { 'Access-Control-Allow-Headers': 'X-A, bad header' }, 'PUT', false],
    ['unlisted header', { 'Access-Control-Allow-Headers': 'X-A' }, 'PUT', false],
    ['credentialed method wildcard', { 'Access-Control-Allow-Methods': '*' }, 'PUT', true],
    ['credentialed header wildcard', { 'Access-Control-Allow-Headers': '*' }, 'PUT', true],
  ] as const)('rejects %s before sending the actual request', async (_name, overrides, method, credentials) => {
    const wire: string[] = [];
    const f = await fixture((request, response) => {
      wire.push(request.method!);
      const headers = {
        'Access-Control-Allow-Origin': 'http://127.0.0.1', 'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'PUT', 'Access-Control-Allow-Headers': 'X-A,X-Z', ...overrides,
      };
      for (const [name, value] of Object.entries(headers)) {
        if (value !== undefined) response.setHeader(name, value);
      }
      response.end();
    });
    const params = f.params(method);
    params.request.credentialsMode = credentials ? 'include' : 'omit';
    expect((await observe(params.httpFetch(true))).type).toBe('error');
    expect(wire).toEqual(['OPTIONS']);
    expect(f.env.userAgent.corsPreflightCache.matchesMethod(method, params.request)).toBe(false);
  });

  it.each([302, 401, 403])('rejects a %i preflight without following redirects or prompting', async (status) => {
    const wire: string[] = [];
    const f = await fixture((request, response) => {
      wire.push(request.url!);
      response.writeHead(status, {
        'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'PUT',
        'Access-Control-Allow-Headers': '*', Location: '/redirect', 'WWW-Authenticate': 'Basic realm="test"',
      });
      response.end();
    });
    const prompt = vi.fn(() => null);
    f.env.userAgent.httpAuthentication.onPrompt = prompt;
    expect((await observe(f.params().httpFetch(true))).type).toBe('error');
    expect(wire).toEqual(['/resource']);
    expect(prompt).not.toHaveBeenCalled();
  });

  it('accepts anonymous wildcards but requires Authorization to be named explicitly', async () => {
    let allowAuthorization = false;
    const methods: string[] = [];
    const f = await fixture((request, response) => {
      methods.push(request.method!);
      response.writeHead(200, {
        'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': '*',
        'Access-Control-Allow-Headers': allowAuthorization ? '*, Authorization' : '*',
      });
      response.end('ready');
    });
    expect(await f.text(await observe(f.params().httpFetch(true)))).toBe('ready');
    const authorized = f.params();
    authorized.request.headerList.append('Authorization', 'Bearer authored');
    expect((await observe(authorized.httpFetch(true))).type).toBe('error');
    allowAuthorization = true;
    expect(await f.text(await observe(authorized.httpFetch(true)))).toBe('ready');
    expect(methods).toEqual(['OPTIONS', 'PUT', 'OPTIONS', 'OPTIONS', 'PUT']);
  });

  it('accepts absent allow-methods for a safelisted method or an explicitly forced preflight', async () => {
    const f = await fixture((request, response) => {
      response.writeHead(204, { 'Access-Control-Allow-Origin': request.headers.origin!, 'Access-Control-Allow-Headers': 'X-A,X-Z' });
      response.end();
    });
    expect((await observe(f.params('GET').httpFetch(true))).status).toBe(204);
    const forced = f.params('POST');
    forced.request.useCORSPreflight = true;
    expect((await observe(forced.httpFetch(true))).status).toBe(204);
    expect(f.env.userAgent.corsPreflightCache.matchesMethod('POST', forced.request)).toBe(true);
  });

  it.each([undefined, 'invalid', '-1', ['60', '120']])('defaults an absent or invalid max-age %s to five seconds', async (age) => {
    let preflights = 0;
    const f = await fixture((request, response) => {
      if (request.method === 'OPTIONS') preflights++;
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Access-Control-Allow-Methods', 'PUT');
      response.setHeader('Access-Control-Allow-Headers', '*');
      if (age !== undefined) response.setHeader('Access-Control-Max-Age', age);
      response.end('ready');
    });
    const clock = vi.spyOn(f.env.userAgent, 'unsafeSharedCurrentTime').mockReturnValue(0);
    expect(await f.text(await observe(f.params().httpFetch(true)))).toBe('ready');
    clock.mockReturnValue(4999);
    expect(await f.text(await observe(f.params().httpFetch(true)))).toBe('ready');
    expect(preflights).toBe(1);
    clock.mockReturnValue(5000);
    expect(await f.text(await observe(f.params().httpFetch(true)))).toBe('ready');
    expect(preflights).toBe(2);
  });

  it('cancels an in-flight preflight with its parent and never sends the actual request', async () => {
    const started = Promise.withResolvers<void>();
    const methods: string[] = [];
    const f = await fixture((request) => { methods.push(request.method!); started.resolve(); });
    const params = f.params();
    const pending = observe(params.httpFetch(true));
    await started.promise;
    params.controller.abort(f.env);
    expect(await pending).toMatchObject({ type: 'error', aborted: true });
    expect(methods).toEqual(['OPTIONS']);
    expect(f.env.userAgent.corsPreflightCache.matchesMethod('PUT', params.request)).toBe(false);
  });
});

describe('CORS and timing through main Fetch', () => {
  it('filters delivered headers and treats timing permission independently of CORS access', async () => {
    let timingAllowed = false;
    const f = await fixture((_request, response) => {
      response.writeHead(200, {
        'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'PUT', 'Access-Control-Allow-Headers': '*',
        'Access-Control-Expose-Headers': 'X-Visible', 'X-Visible': 'public', 'X-Hidden': 'private',
        'Timing-Allow-Origin': timingAllowed ? '*' : 'https://wrong.test',
      });
      response.end('body');
    });
    const first = f.params();
    const delivered = await f.complete(first.request);
    expect(delivered.response.type).toBe('cors');
    expect(delivered.response.headerList.get('X-Visible')).toBe('public');
    expect(delivered.response.headerList.get('X-Hidden')).toBeNull();
    expect(delivered.body).toEqual(new TextEncoder().encode('body'));
    expect(first.request.timingAllowFailed).toBe(true);
    expect(delivered.response.timingAllowPassed).toBe(false);
    timingAllowed = true;
    expect((await f.complete(f.params().request)).response.timingAllowPassed).toBe(true);
  });

  it('clears matching preflight permissions when the actual response fails CORS', async () => {
    let preflights = 0;
    const f = await fixture((request, response) => {
      if (request.method === 'OPTIONS') {
        preflights++;
        response.writeHead(204, {
          'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'PUT',
          'Access-Control-Allow-Headers': '*', 'Access-Control-Max-Age': '60',
        });
      }
      response.end();
    });
    const first = f.params();
    expect((await f.complete(first.request)).response.type).toBe('error');
    expect(f.env.userAgent.corsPreflightCache.matchesMethod('PUT', first.request)).toBe(false);
    expect((await f.complete(f.params().request)).response.type).toBe('error');
    expect(preflights).toBe(2);
  });

  it('keeps a denied redirect timing check sticky and uses null origin at the next cross-origin hop', async () => {
    const observedOrigins: string[] = [];
    const target = createServer((request, response) => {
      observedOrigins.push(request.headers.origin!);
      response.writeHead(200, {
        'Access-Control-Allow-Origin': 'null', 'Timing-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'PUT', 'Access-Control-Allow-Headers': 'X-A,X-Z',
      });
      response.end('redirected');
    });
    const targetOrigin = await listen(target);
    cleanup.push(() => closeServer(target));
    const f = await fixture((request, response) => {
      response.writeHead(request.method === 'OPTIONS' ? 204 : 307, {
        Location: targetOrigin, 'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'PUT', 'Access-Control-Allow-Headers': 'X-A,X-Z',
      });
      response.end();
    });
    const params = f.params();
    const result = await f.complete(params.request);
    expect(result.response.type).toBe('cors');
    expect(result.body).toEqual(new TextEncoder().encode('redirected'));
    expect(observedOrigins).toEqual(['null', 'null']);
    expect(params.request.timingAllowFailed).toBe(true);
    expect(result.response.timingAllowPassed).toBe(false);
  });

  it('retains navigation redirect permissions for checking against the destination origin', async () => {
    const f = await fixture((request, response) => {
      if (request.url === '/resource') {
        response.writeHead(302, { Location: '/final', 'Timing-Allow-Origin': '*' });
      } else {
        response.writeHead(200, { 'Timing-Allow-Origin': '*' });
      }
      response.end();
    });
    const params = f.params('GET');
    params.request.mode = 'navigate';
    params.request.destination = 'document';
    params.request.headerList.list = [];
    const { response } = await f.complete(params.request);
    expect(response.type).toBe('basic');
    expect(isFilteredResponse(response) ? response.internalResponse.navigationTimingAllowValuesList : []).toEqual([['*']]);
    expect(response.isNavigationTimingAllowed(f.env.origin)).toBe(true);
  });
});

async function fixture(respond: RequestListener) {
  const server: Server = createServer(respond);
  const origin = await listen(server);
  cleanup.push(() => closeServer(server));
  const browlet = new Browlet({ route: () => '', reporting: false });
  await browlet.navigate('http://127.0.0.1/');
  const realm = getRelevantRealm(browlet.window);
  const env = realm.env;
  cleanup.push(() => env.userAgent.httpTransport.close());
  const params = (method = 'PUT') => {
    const request = new FetchRequest(env.parseURL(origin + '/resource').url!, env, env.userAgent);
    request.populateFromClient();
    request.method = method;
    request.mode = 'cors';
    request.unsafeRequest = true;
    request.responseTainting = 'cors';
    request.referrer = null;
    request.headerList.append('X-Z', 'z');
    request.headerList.append('X-A', 'a');
    return new FetchParams(request, new FetchTimingInfo(), env);
  };
  const text = (response: FetchResponse) => {
    const context = getBindingContext(realm);
    Reflect.set(browlet.window, 'networkResponse', project(context.construct(ResponseImpl, response, 'response')));
    return browlet.evaluate(async () => (globalThis as unknown as { networkResponse: Response; }).networkResponse.text());
  };
  const complete = (request: FetchRequest) => {
    const result = Promise.withResolvers<{ response: FetchResponse; body: Uint8Array | null | 'failure'; }>();
    fetch(request, { processResponseConsumeBody: (response, body) => result.resolve({ response, body }) }, env);
    return result.promise;
  };
  return { browlet, env, origin, params, text, complete };
}
