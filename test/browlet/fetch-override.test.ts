import { afterEach, describe, expect, it, vi } from 'vitest';
import { Browlet } from '../../src/browlet/browlet';
import { getRelevantRealm } from '../../src/browlet/bindings';
import { UserAgent } from '../../src/browlet/user-agent';
import { utf8Decode, utf8Encode } from '../../src/encoding/codecs/utf-8';
import { FetchBody } from '../../src/fetch/body';
import { fetch } from '../../src/fetch/fetch';
import { FetchParams } from '../../src/fetch/params';
import { FetchRequest } from '../../src/fetch/request';
import { FetchResponse } from '../../src/fetch/response';
import { FetchTimingInfo } from '../../src/fetch/timing';
import { InternalError } from '../../src/infra/internal-error';
import type { PromiseValue } from '../../src/infra/promises';
import type { JSEnvironment } from '../../src/js-engine/environment';
import { parseURL } from '../../src/url/url';

afterEach(() => vi.restoreAllMocks());

describe('Fetch response overrides', () => {
  it('defaults to no override and dispatches scheme fetch with the same Fetch state', async () => {
    const { params, userAgent, request, env } = createFixture();
    const override = vi.spyOn(userAgent, 'potentiallyOverrideResponse');
    const response = new FetchResponse();
    const scheme = vi.spyOn(params, 'schemeFetch').mockReturnValue(userAgent.hostPromises.resolve(response));
    const http = vi.spyOn(params, 'httpFetch');
    expect(await responseFrom(params.overrideFetch('scheme-fetch'))).toBe(response);
    expect(override).toHaveBeenCalledExactlyOnceWith(request, env);
    expect(override.mock.results[0]!.value).toBeNull();
    expect(scheme).toHaveBeenCalledExactlyOnceWith();
    expect(scheme.mock.contexts[0]).toBe(params);
    expect(http).not.toHaveBeenCalled();
  });

  it.each([false, true])('forwards the HTTP preflight choice %s and waits for dispatch', async (preflight) => {
    const { params, userAgent } = createFixture();
    const pending = userAgent.hostPromises.withResolvers<FetchResponse>();
    const http = vi.spyOn(params, 'httpFetch').mockReturnValue(pending.promise);
    const scheme = vi.spyOn(params, 'schemeFetch');
    const result = responseFrom(preflight ? params.overrideFetch('http-fetch', true) : params.overrideFetch('http-fetch'));
    expect(http).toHaveBeenCalledExactlyOnceWith(preflight);
    expect(http.mock.contexts[0]).toBe(params);
    expect(scheme).not.toHaveBeenCalled();
    const response = new FetchResponse();
    pending.resolve(response);
    expect(await result).toBe(response);
  });

  it.each(['scheme-fetch', 'http-fetch'] as const)('returns a supplied response without %s dispatch', async (type) => {
    const { params, userAgent, request, env } = createFixture();
    const scheme = vi.spyOn(params, 'schemeFetch');
    const http = vi.spyOn(params, 'httpFetch');
    const response = new FetchResponse().filter('cors');
    const override = vi.spyOn(userAgent, 'potentiallyOverrideResponse').mockReturnValue(response);
    expect(await responseFrom(params.overrideFetch(type, true))).toBe(response);
    expect(override).toHaveBeenCalledExactlyOnceWith(request, env);
    expect(scheme).not.toHaveBeenCalled();
    expect(http).not.toHaveBeenCalled();
  });

  it('accepts an intentional network-error response without falling through to HTTP', async () => {
    const { params, userAgent } = createFixture();
    const response = FetchResponse.networkError();
    vi.spyOn(userAgent, 'potentiallyOverrideResponse').mockReturnValue(response);
    const http = vi.spyOn(params, 'httpFetch');
    expect(await responseFrom(params.overrideFetch('http-fetch'))).toBe(response);
    expect(http).not.toHaveBeenCalled();
  });

  it('keeps response policy on the request owner instead of sharing overrides between browsers', async () => {
    const first = createFixture();
    const second = createFixture();
    const blocked = FetchResponse.networkError();
    vi.spyOn(first.userAgent, 'potentiallyOverrideResponse').mockReturnValue(blocked);
    const ordinary = new FetchResponse();
    const scheme = vi.spyOn(second.params, 'schemeFetch').mockReturnValue(second.userAgent.hostPromises.resolve(ordinary));
    expect(await responseFrom(first.params.overrideFetch('scheme-fetch'))).toBe(blocked);
    expect(await responseFrom(second.params.overrideFetch('scheme-fetch'))).toBe(ordinary);
    expect(scheme).toHaveBeenCalledOnce();
  });

  it('propagates an override implementation failure without dispatching a replacement request', async () => {
    const { params, userAgent } = createFixture();
    const failure = new InternalError('Override implementation failed');
    vi.spyOn(userAgent, 'potentiallyOverrideResponse').mockImplementation(() => { throw failure; });
    const scheme = vi.spyOn(params, 'schemeFetch');
    await expect(responseFrom(params.overrideFetch('scheme-fetch'))).rejects.toBe(failure);
    expect(scheme).not.toHaveBeenCalled();
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

function createFixture() {
  const userAgent = new UserAgent();
  const env = userAgent.sandbox;
  const request = new FetchRequest(parseURL('https://example.test/resource').url!, null, userAgent);
  return { userAgent, env, request, params: new FetchParams(request, new FetchTimingInfo(), env) };
}

async function createWindowFixture() {
  const browlet = new Browlet({ route: () => '', reporting: false });
  await browlet.navigate('https://example.test/page');
  const env = getRelevantRealm(browlet.window).env;
  const { userAgent } = env;
  const request = new FetchRequest(parseURL('https://example.test/resource').url!, env, userAgent);
  return { env, userAgent, request };
}

function responseFrom(response: PromiseValue<FetchResponse>) {
  const result = Promise.withResolvers<FetchResponse>();
  response.observe(result.resolve, result.reject);
  return result.promise;
}

function consume(request: FetchRequest, env: JSEnvironment) {
  const result = Promise.withResolvers<{ response: FetchResponse; body: Uint8Array | null | 'failure'; }>();
  fetch(request, {
    processResponseConsumeBody: (response, body) => result.resolve({ response, body }),
  }, env);
  return result.promise;
}
