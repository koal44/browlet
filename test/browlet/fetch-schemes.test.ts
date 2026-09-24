import { afterEach, describe, expect, it, vi } from 'vitest';
import { Browlet } from '../../src/browlet/browlet';
import { getRelevantRealm } from '../../src/browlet/bindings';
import { createEnvironmentRecord, type WindowEnvironment } from '../../src/browlet/scripting/environment';
import { navigationAndTraversalTaskSource } from '../../src/browlet/scripting/tasks';
import { UserAgent } from '../../src/browlet/user-agent';
import { utf8Decode } from '../../src/encoding/codecs/utf-8';
import { fetch } from '../../src/fetch/fetch';
import { FetchParams } from '../../src/fetch/params';
import { FetchRequest } from '../../src/fetch/request';
import { FetchResponse } from '../../src/fetch/response';
import { FetchTimingInfo } from '../../src/fetch/timing';
import { BlobImpl } from '../../src/file/blob';
import { InternalError } from '../../src/infra/internal-error';
import type { JSEnvironment } from '../../src/js-engine/environment';
import { copyURL, parseURL } from '../../src/url/url';
import { readBodyBytes } from '../fetch/body-fixture';
import { createPolicyEnvironment } from './browsing/policy/environment-fixture';
import { observe } from './streams/implementation-fixture';

afterEach(() => vi.restoreAllMocks());

describe('Fetch §4.3: scheme dispatch', () => {
  it.each(['about:blank', 'about:blank?query#fragment'])('returns an empty HTML body for %s', async (url) => {
    const params = createParams(url);
    const response = await observe(params.schemeFetch());
    expect(response.type).toBe('default');
    expect(response.status).toBe(200);
    expect(response.statusMessage).toBe('OK');
    expect(response.headerList.list).toEqual([['Content-Type', 'text/html;charset=utf-8']]);
    expect(response.body).not.toBeNull();
    expect(response.body!.length).toBe(0);
    expect(await readBodyBytes(response.body!)).toEqual(new Uint8Array());
  });

  it.each(['about:config', 'about:Blank', 'about:/blank', 'file:///private.txt', 'ftp://example.test/a', 'custom:resource'])(
    'returns a network error for %s', async (url) => {
      const response = await observe(createParams(url).schemeFetch());
      expect(response.type).toBe('error');
      expect(response.status).toBe(0);
      expect(response.body).toBeNull();
    },
  );

  it.each(['aborted', 'terminated'] as const)('stops a %s fetch before scheme processing', async (state) => {
    const params = createParams('https://example.test/resource');
    if (state === 'aborted') params.controller.abort(params.env);
    else params.controller.terminate();
    const http = vi.spyOn(params, 'httpFetch');
    const response = await observe(params.schemeFetch());
    expect(response.type).toBe('error');
    expect(response.aborted).toBe(state === 'aborted');
    expect(http).not.toHaveBeenCalled();
  });

  it.each(['http', 'https'])('delegates %s directly to HTTP fetch without another override', async (scheme) => {
    const params = createParams(`${scheme}://example.test/resource`);
    const pending = params.request.userAgent.hostPromises.withResolvers<FetchResponse>();
    const http = vi.spyOn(params, 'httpFetch').mockReturnValue(pending.promise);
    const override = vi.spyOn(params, 'overrideFetch');
    const result = observe(params.schemeFetch());
    expect(http).toHaveBeenCalledExactlyOnceWith();
    expect(http.mock.contexts[0]).toBe(params);
    expect(override).not.toHaveBeenCalled();
    const response = new FetchResponse();
    pending.resolve(response);
    expect(await result).toBe(response);
  });

  it('dispatches the current URL after a redirect instead of the original URL', async () => {
    const params = createParams('https://example.test/start');
    params.request.urlList.push(parseURL('about:blank').url!);
    const http = vi.spyOn(params, 'httpFetch');
    expect((await observe(params.schemeFetch())).statusMessage).toBe('OK');
    expect(http).not.toHaveBeenCalled();
  });
});

describe('Blob scheme responses and access', () => {
  it.each(['text/plain', ''])('returns Blob bytes with length and %j Content-Type', async (type) => {
    const { params, blob } = createBlob('0123456789', type);
    const response = await observe(params.schemeFetch());
    expect(response.status).toBe(200);
    expect(response.statusMessage).toBe('OK');
    expect(response.headerList.list).toEqual([['Content-Length', '10'], ['Content-Type', type]]);
    expect(response.rangeRequested).toBe(false);
    expect(response.body!.source).toBe(blob);
    expect(utf8Decode(await readBodyBytes(response.body!))).toBe('0123456789');
  });

  it('returns a readable zero-length Blob body', async () => {
    const { params } = createBlob('');
    const response = await observe(params.schemeFetch());
    expect(response.status).toBe(200);
    expect(response.headerList.get('Content-Length')).toBe('0');
    expect(await readBodyBytes(response.body!)).toEqual(new Uint8Array());
  });

  it.each(['HEAD', 'POST', 'get'])('rejects the %s method', async (method) => {
    const { params } = createBlob();
    params.request.method = method;
    expect((await observe(params.schemeFetch())).type).toBe('error');
  });

  it('uses the captured entry after revocation and rejects a fresh parse', async () => {
    const { params, env, url } = createBlob();
    env.userAgent.blobURLStore.revoke(url, env);
    expect(utf8Decode(await readBodyBytes((await observe(params.schemeFetch())).body!))).toBe('0123456789');
    const fresh = createParams(url, env);
    expect(fresh.request.currentURL.blobURLEntry).toBeNull();
    expect((await observe(fresh.schemeFetch())).type).toBe('error');
  });

  it('denies a different partition, including iframe navigation, but permits top-level navigation', async () => {
    const { params, env } = createBlob();
    const other = createPolicyEnvironment('https://other.test/', undefined, env.userAgent);
    params.request.client = other;
    for (const destination of ['', 'iframe', 'document'] as const) {
      params.request.destination = destination;
      const response = await observe(params.schemeFetch());
      expect(response.type).toBe(destination === 'document' ? 'default' : 'error');
    }
  });

  it('permits clientless top-level navigation through its explicit exemption', async () => {
    const { params } = createBlob();
    params.request.client = null;
    params.request.destination = 'document';
    const response = await observe(params.schemeFetch());
    expect(utf8Decode(await readBodyBytes(response.body!))).toBe('0123456789');
  });

  it('requires a partition context even when a clientless Blob request retains its origin', async () => {
    const { params } = createBlob();
    params.request.populateFromClient();
    params.request.client = null;
    await expect(observe(params.schemeFetch())).rejects.toThrow(InternalError);
  });

  it('uses the reserved environment before the client, including a reservation without a realm', async () => {
    const { params, env } = createBlob();
    const other = createPolicyEnvironment('https://other.test/', undefined, env.userAgent);
    const reserved = createEnvironmentRecord({
      userAgent: env.userAgent, creationURL: copyURL(env.creationURL),
      topLevelOrigin: env.topLevelOrigin, topLevelCreationURL: env.topLevelCreationURL,
      targetBrowsingContext: null, isSecureContext: true,
    });
    params.request.client = other;
    params.request.reservedClient = reserved;
    expect(params.request.determineEnvironment()).toBe(reserved);
    expect((await observe(params.schemeFetch())).status).toBe(200);
    params.request.client = null;
    expect((await observe(params.schemeFetch())).status).toBe(200);
    params.request.client = env;
    params.request.reservedClient = other;
    expect((await observe(params.schemeFetch())).type).toBe('error');
  });

  it('only exempts an attached top-level Window fetching its exact creation URL', async () => {
    const { params, env } = createBlob();
    const other = createPolicyEnvironment('https://other.test/', undefined, env.userAgent);
    other.creationURL = copyURL(params.request.currentURL);
    params.request.client = other;
    expect(other.isTopLevelWindow).toBe(true);
    expect((await observe(params.schemeFetch())).status).toBe(200);
    params.request.currentURL.fragment = 'different';
    expect((await observe(params.schemeFetch())).type).toBe('error');
    params.request.currentURL.fragment = null;
    other.window.getAssociatedDocument().browsingContext = null;
    expect(other.isTopLevelWindow).toBe(false);
    expect((await observe(params.schemeFetch())).type).toBe('error');
  });

  it('does not grant a nested Window the top-level self-fetch exemption', async () => {
    const { params, env } = createBlob();
    const parent = createPolicyEnvironment('https://other.test/', undefined, env.userAgent);
    const child = createPolicyEnvironment('https://other.test/child', parent);
    child.creationURL = copyURL(params.request.currentURL);
    params.request.client = child;
    expect(child.isTopLevelWindow).toBe(false);
    expect((await observe(params.schemeFetch())).type).toBe('error');
  });
});

describe('Blob byte ranges', () => {
  it.each([
    ['bytes=2-5', '2345', 'bytes 2-5/10'],
    ['bytes=7-', '789', 'bytes 7-9/10'],
    ['bytes=-3', '789', 'bytes 7-9/10'],
    ['bytes=-10', '0123456789', 'bytes 0-9/10'],
    ['bytes=-20', '0123456789', 'bytes 0-9/10'],
    ['bytes=-999999999999999999999999999', '0123456789', 'bytes 0-9/10'],
    ['bytes=0-0', '0', 'bytes 0-0/10'],
    ['bytes=0-99', '0123456789', 'bytes 0-9/10'],
    ['bytes=8-999999999999999999999999999', '89', 'bytes 8-9/10'],
    ['bytes \t=\t 2 \t- \t5', '2345', 'bytes 2-5/10'],
  ])('handles %s without losing integer precision', async (range, text, contentRange) => {
    const { params } = createBlob();
    params.request.headerList.append('Range', range);
    const response = await observe(params.schemeFetch());
    expect(response.status).toBe(206);
    expect(response.statusMessage).toBe('Partial Content');
    expect(response.rangeRequested).toBe(true);
    expect(response.headerList.list).toEqual([
      ['Content-Length', String(text.length)], ['Content-Type', 'text/plain'], ['Content-Range', contentRange],
    ]);
    expect(utf8Decode(await readBodyBytes(response.body!))).toBe(text);
  });

  it.each(['bytes=10-', 'bytes=999999999999999999999-', 'bytes=7-3', 'bytes=-', 'bytes=0-1,3-4', 'items=0-1', 'Bytes=0-1'])(
    'returns a network error for %s', async (range) => {
      const { params } = createBlob();
      params.request.headerList.append('Range', range);
      const response = await observe(params.schemeFetch());
      expect(response.type).toBe('error');
      expect(response.body).toBeNull();
    },
  );

  it.each([
    ['0123456789', 'bytes=-0'], ['', 'bytes=-1'], ['', 'bytes=-0'], ['', 'bytes=0-'], ['', 'bytes=0-0'],
  ])('rejects an empty range on %j with %s', async (text, range) => {
    const { params } = createBlob(text);
    params.request.headerList.append('Range', range);
    expect((await observe(params.schemeFetch())).type).toBe('error');
  });
});

describe('Data scheme responses', () => {
  it.each(['GET', 'HEAD', 'POST', 'PUT'])('constructs the data response for %s before main-fetch body filtering', async (method) => {
    const params = createParams('data:application/octet-stream;base64,AP8=#fragment');
    params.request.method = method;
    const response = await observe(params.schemeFetch());
    expect(response.type).toBe('default');
    expect(response.status).toBe(200);
    expect(response.statusMessage).toBe('OK');
    expect(response.headerList.list).toEqual([['Content-Type', 'application/octet-stream']]);
    expect(response.body!.stream.env).toBe(params.env);
    expect(response.body!.length).toBe(2);
    expect(await readBodyBytes(response.body!)).toEqual(Uint8Array.of(0, 255));
  });

  it.each(['data:text/plain', 'data:;base64,WA='])('returns a network error for malformed %s', async (url) => {
    const response = await observe(createParams(url).schemeFetch());
    expect(response.type).toBe('error');
    expect(response.status).toBe(0);
    expect(response.body).toBeNull();
  });
});

describe('Scheme responses through main Fetch', () => {
  it('filters and consumes a Blob range through the automatic Window event loop', async () => {
    const browlet = new Browlet({ route: () => '', reporting: false });
    await browlet.navigate('https://example.test/');
    const window = browlet.window as Window & typeof globalThis;
    const env = getRelevantRealm(window).env;
    const url = window.URL.createObjectURL(new window.Blob(['0123456789'], { type: 'text/plain' }));
    const request = new FetchRequest(env.parseURL(url).url!, env, env.userAgent);
    request.addRangeHeader(2, 5);
    const { response, body } = await consume(request, env);
    expect(response.type).toBe('basic');
    expect(response.status).toBe(206);
    expect(response.url).toBe(request.currentURL);
    expect(response.headerList.get('Content-Range')).toBe('bytes 2-5/10');
    expect(utf8Decode(body as Uint8Array)).toBe('2345');
  });

  it('reads a captured Blob after its creator Document is destroyed', async () => {
    const browlet = new Browlet({ route: () => '', reporting: false });
    await browlet.navigate('https://example.test/');
    const window = browlet.window as Window & typeof globalThis;
    const realm = getRelevantRealm(window);
    const env = realm.env;
    const url = window.URL.createObjectURL(new window.Blob(['survives destruction']));
    const request = new FetchRequest(env.parseURL(url).url!, env, env.userAgent);
    const sandbox = env.userAgent.sandbox;
    const destroyed = Promise.withResolvers<void>();
    realm.queueGlobalTask(navigationAndTraversalTaskSource, () => {
      realm.getAssociatedDocument().destroy();
      destroyed.resolve();
    });
    await destroyed.promise;
    expect(env.parseURL(url).url!.blobURLEntry).toBeNull();
    const { response, body } = await consume(request, sandbox);
    expect(response.status).toBe(200);
    expect(utf8Decode(body as Uint8Array)).toBe('survives destruction');
  });

  it.each(['same-origin', 'cors', 'no-cors'] as const)('delivers a basic data response for %s mode through the Window event loop', async (mode) => {
    const browlet = new Browlet({ route: () => '', reporting: false });
    await browlet.navigate('https://example.test/');
    const env = getRelevantRealm(browlet.window).env;
    const request = new FetchRequest(env.parseURL('data:;charset=UTF-8,hello%20world#fragment').url!, env, env.userAgent);
    request.mode = mode;
    request.localURLsOnly = true;
    const http = vi.spyOn(FetchParams.prototype, 'httpFetch');
    const completed = Promise.withResolvers<void>();
    const consumed = Promise.withResolvers<{ response: FetchResponse; body: Uint8Array | null | 'failure'; }>();
    fetch(request, {
      processResponseEndOfBody: () => completed.resolve(),
      processResponseConsumeBody: (response, body) => consumed.resolve({ response, body }),
    }, env);
    const { response, body } = await consumed.promise;
    await completed.promise;
    expect(response.type).toBe('basic');
    expect(response.status).toBe(200);
    expect(response.url).toBe(request.currentURL);
    expect(response.headerList.get('Content-Type')).toBe('text/plain;charset=UTF-8');
    expect(utf8Decode(body as Uint8Array)).toBe('hello world');
    expect(request.done).toBe(true);
    expect(http).not.toHaveBeenCalled();
  });

  it('removes the data body for HEAD in main fetch', async () => {
    const params = createParams('data:,hello', createPolicyEnvironment('https://example.test/'));
    params.request.method = 'HEAD';
    const { response, body } = await consume(params.request, params.env);
    expect(response.status).toBe(200);
    expect(response.headerList.get('Content-Type')).toBe('text/plain;charset=US-ASCII');
    expect(response.body).toBeNull();
    expect(body).toBeNull();
  });

  it('delivers a readable empty data body for a clientless navigation', async () => {
    const params = createParams('data:,', createPolicyEnvironment('https://example.test/'));
    params.request.populateFromClient();
    params.request.client = null;
    params.request.mode = 'navigate';
    params.request.destination = 'document';
    const { response, body } = await consume(params.request, params.env);
    expect(response.type).toBe('basic');
    expect(response.status).toBe(200);
    expect(body).toEqual(new Uint8Array());
  });

  it('delivers a malformed data URL as a network error through main fetch', async () => {
    const params = createParams('data:;base64,invalid!', createPolicyEnvironment('https://example.test/'));
    const { response, body } = await consume(params.request, params.env);
    expect(response.type).toBe('error');
    expect(response.status).toBe(0);
    expect(body).toBeNull();
  });

  it.each(['hello', 'changed'])('applies integrity verification to the decoded data body %s', async (text) => {
    const params = createParams(`data:,${text}`, createPolicyEnvironment('https://example.test/'));
    // SHA-256 of the decoded bytes "hello".
    params.request.integrityMetadata = 'sha256-LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ=';
    const { response, body } = await consume(params.request, params.env);
    expect(response.type).toBe(text === 'hello' ? 'basic' : 'error');
    expect(body).toEqual(text === 'hello' ? new TextEncoder().encode('hello') : null);
  });
});

function createParams(url: string, client: WindowEnvironment | null = null, userAgent = client?.userAgent ?? new UserAgent()) {
  const request = new FetchRequest(userAgent.parseURL(url).url!, client, userAgent);
  return new FetchParams(request, new FetchTimingInfo(), userAgent.sandbox);
}

function createBlob(text = '0123456789', type = 'text/plain') {
  const env = createPolicyEnvironment('https://example.test/creator');
  const blob = new BlobImpl([text], { type }, env);
  const url = env.userAgent.blobURLStore.add(blob, env);
  return { env, blob, url, params: createParams(url, env) };
}

function consume(request: FetchRequest, env: JSEnvironment) {
  const result = Promise.withResolvers<{ response: FetchResponse; body: Uint8Array | null | 'failure'; }>();
  fetch(request, {
    useParallelQueue: true,
    processResponseConsumeBody: (response, body) => result.resolve({ response, body }),
  }, env);
  return result.promise;
}
