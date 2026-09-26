import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRelevantRealm } from '../../src/browlet/bindings';
import { Browlet } from '../../src/browlet/browlet';
import { UserAgent } from '../../src/browlet/user-agent';
import { utf8Decode, utf8Encode } from '../../src/encoding/codecs/utf-8';
import { FetchBody } from '../../src/fetch/body';
import { fetch } from '../../src/fetch/fetch';
import { FetchHeaders } from '../../src/fetch/headers';
import type { HTTPTransportListener } from '../../src/fetch/transport';
import { FetchRequest } from '../../src/fetch/request';
import { FetchResponse } from '../../src/fetch/response';
import { InternalError } from '../../src/infra/internal-error';
import type { JSEnvironment } from '../../src/js-engine/environment';
import { parseURL } from '../../src/url/url';
import { mockHTTPTransport } from '../fetch/transport-fixture';
import { createPolicyEnvironment } from './browsing/policy/environment-fixture';
import { createFetchOperation, nextFetchTaskError } from './fetch-fixture';

afterEach(() => vi.restoreAllMocks());

describe('Fetch response overrides', () => {
  it('defaults to no override and dispatches the request through its URL scheme', async () => {
    const { operation, userAgent, request, env } = createFixture('about:blank');
    const override = vi.spyOn(userAgent, 'potentiallyOverrideResponse');
    const transport = vi.spyOn(userAgent.httpTransport, 'dispatch');
    const response = await operation.start();
    expect(response.status).toBe(200);
    expect(response.headerList.get('Content-Type')).toBe('text/html;charset=utf-8');
    expect(response.body!.stream.env).toBe(env);
    expect(override).toHaveBeenCalledExactlyOnceWith(request, env);
    expect(override.mock.results[0]!.value).toBeNull();
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([false, true])('forwards the HTTP preflight choice %s and waits for dispatch', async (preflight) => {
    const { operation, userAgent, request } = createFixture();
    request.method = 'PUT';
    request.mode = 'cors';
    request.responseTainting = 'cors';
    request.useCORSPreflight = preflight;
    const waiting = Promise.withResolvers<HTTPTransportListener>();
    const wire = mockHTTPTransport(userAgent, (request, listener) => {
      if (request.method === 'OPTIONS') {
        listener.onHeaders(204, '', new FetchHeaders([
          ['Access-Control-Allow-Origin', '*'], ['Access-Control-Allow-Methods', 'PUT'],
        ]), false);
        listener.onEnd();
      } else { waiting.resolve(listener); }
    });
    const result = operation.start();
    const listener = await waiting.promise;
    expect(wire.mock.calls.map(([request]) => request.method)).toEqual(preflight ? ['OPTIONS', 'PUT'] : ['PUT']);
    listener.onHeaders(201, 'Created', new FetchHeaders([['Access-Control-Allow-Origin', '*']]), false);
    listener.onEnd();
    expect((await result).status).toBe(201);
  });

  it.each(['scheme-fetch', 'http-fetch'] as const)('returns a supplied response without %s dispatch', async (type) => {
    const { operation, userAgent, request, env } = createFixture();
    const transport = vi.spyOn(userAgent.httpTransport, 'dispatch');
    const worker = vi.spyOn(userAgent, 'handleFetch');
    if (type === 'http-fetch') {
      request.mode = 'cors';
      request.responseTainting = 'cors';
    }
    const response = new FetchResponse().filter('cors');
    const override = vi.spyOn(userAgent, 'potentiallyOverrideResponse').mockReturnValue(response);
    expect(await operation.start()).toBe(response);
    expect(override).toHaveBeenCalledExactlyOnceWith(request, env);
    expect(transport).not.toHaveBeenCalled();
    expect(worker).not.toHaveBeenCalled();
  });

  it('accepts an intentional network-error response without falling through to HTTP', async () => {
    const { operation, userAgent } = createFixture();
    const response = FetchResponse.networkError();
    vi.spyOn(userAgent, 'potentiallyOverrideResponse').mockReturnValue(response);
    const transport = vi.spyOn(userAgent.httpTransport, 'dispatch');
    expect(await operation.start()).toBe(response);
    expect(transport).not.toHaveBeenCalled();
  });

  it('keeps response policy on the request owner instead of sharing overrides between browsers', async () => {
    const first = createFixture('about:blank');
    const second = createFixture('about:blank');
    const blocked = FetchResponse.networkError();
    vi.spyOn(first.userAgent, 'potentiallyOverrideResponse').mockReturnValue(blocked);
    expect(await first.operation.start()).toBe(blocked);
    expect((await second.operation.start()).status).toBe(200);
  });

  it('propagates an override implementation failure without dispatching a replacement request', async () => {
    const { operation, userAgent, env } = createFixture();
    const failure = new InternalError('Override implementation failed');
    vi.spyOn(userAgent, 'potentiallyOverrideResponse').mockImplementation(() => { throw failure; });
    const transport = vi.spyOn(userAgent.httpTransport, 'dispatch');
    const error = nextFetchTaskError(env);
    void operation.start();
    expect(await error).toBe(failure);
    expect(transport).not.toHaveBeenCalled();
  });
});

describe('Override responses through main fetch', () => {
  it('runs filtering and body consumption on the supplied execution owner', async () => {
    const { env, userAgent, request } = await createWindowFixture();
    const raw = new FetchResponse();
    raw.headerList.append('Set-Cookie', 'private=1');
    const override = vi.spyOn(userAgent, 'potentiallyOverrideResponse').mockImplementation((_request, owner) => {
      raw.body = FetchBody.fromBytes(utf8Encode('override body'), owner);
      return raw;
    });
    const result = await consume(request, env);
    expect(override).toHaveBeenCalledExactlyOnceWith(request, env);
    expect(request.origin).toBe(env.origin);
    expect(result.response.type).toBe('basic');
    expect(result.response.headerList.has('Set-Cookie')).toBe(false);
    expect(raw.headerList.has('Set-Cookie')).toBe(true);
    expect(utf8Decode(result.body as Uint8Array)).toBe('override body');
    expect(request.done).toBe(true);
  });

  it('applies response blocking to a supplied response', async () => {
    const { env, userAgent, request } = await createWindowFixture();
    request.destination = 'script';
    const raw = new FetchResponse();
    raw.headerList.append('Content-Type', 'text/plain');
    raw.headerList.append('X-Content-Type-Options', 'nosniff');
    vi.spyOn(userAgent, 'potentiallyOverrideResponse').mockReturnValue(raw);
    expect((await consume(request, env)).response.type).toBe('error');
  });

  it.each(['blocked request', 'preloaded response'])('does not consult the override for a %s', async (selection) => {
    const { env, userAgent, request } = await createWindowFixture();
    const override = vi.spyOn(userAgent, 'potentiallyOverrideResponse');
    if (selection === 'blocked request') {
      request.localURLsOnly = true;
    } else {
      vi.spyOn(env, 'consumePreloadedResource').mockImplementation((_url, _destination, _mode, _credentials, _integrity, available) => {
        available(new FetchResponse());
        return true;
      });
    }
    const { response } = await consume(request, env);
    expect(response.type).toBe(selection === 'blocked request' ? 'error' : 'basic');
    expect(override).not.toHaveBeenCalled();
  });
});

function createFixture(url = 'https://example.test/resource') {
  const userAgent = new UserAgent();
  const env = userAgent.sandbox;
  const client = createPolicyEnvironment('https://example.test/', undefined, userAgent);
  const request = new FetchRequest(parseURL(url).url!, client, userAgent);
  if (request.currentURL.scheme === 'about') request.mode = 'navigate';
  request.referrer = null;
  request.populateFromClient();
  return { userAgent, env, request, operation: createFetchOperation(request, env) };
}

async function createWindowFixture() {
  const browlet = new Browlet({ route: () => '', reporting: false });
  await browlet.navigate('https://example.test/page');
  const env = getRelevantRealm(browlet.window).env;
  const { userAgent } = env;
  const request = new FetchRequest(parseURL('https://example.test/resource').url!, env, userAgent);
  return { env, userAgent, request };
}


function consume(request: FetchRequest, env: JSEnvironment) {
  const result = Promise.withResolvers<{ response: FetchResponse; body: Uint8Array | null | 'failure'; }>();
  fetch(request, {
    processResponseConsumeBody: (response, body) => result.resolve({ response, body }),
  }, env);
  return result.promise;
}
