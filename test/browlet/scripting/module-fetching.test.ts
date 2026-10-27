import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import * as scriptClasses from '../../../src/browlet/scripting/script';
import { JSModuleRequest, type ModuleScript, type ModuleType } from '../../../src/browlet/scripting/script';
import { ScriptFetchOptions } from '../../../src/browlet/scripting/script-fetch-options';
import type { PerformScriptFetch } from '../../../src/browlet/scripting/script-fetching';
import { utf8Encode } from '../../../src/encoding/index';
import { FetchHeaders } from '../../../src/fetch/headers';
import { FetchResponse } from '../../../src/fetch/response';
import { serializeURL } from '../../../src/url/index';
import { mockHTTPTransport } from '../../fetch/transport-fixture';
import { getRelevantRealm } from '../../support/browlet-binding';
import { createScriptState } from '../../support/script-state';

afterEach(() => vi.restoreAllMocks());

describe('module request type', () => {
  it.each([
    [undefined, 'javascript-or-wasm'], ['css', 'css'], ['json', 'json'], ['text', 'text'],
    ['javascript-or-wasm', null], ['javascript', null], ['wasm', null], ['unknown', null], ['', null],
  ] as const)('selects the supported type for attribute %s', (attribute, expected) => {
    const request = moduleRequest(attribute) ?? new JSModuleRequest('./module');
    const type: ModuleType | null = request.getModuleType();
    expect(type).toBe(expected);
  });
});

// Real Fetch or its specified custom hook; only the unfinished module creation steps are replaced.
describe('fetch a single module script', () => {
  it('uses the fetch client for requests and the target settings for creation and caching', async () => {
    const { env, url, scripts, create } = await createFixture();
    const fetchClient = await createEnvironment();
    const referrer = fetchClient.parseURL('https://modules.test/parent.js')!;
    const options = Object.assign(new ScriptFetchOptions(), {
      cryptographicNonce: 'nonce', integrityMetadata: 'sha256-test', parserMetadata: 'parser-inserted',
      credentialsMode: 'include', referrerPolicy: 'no-referrer', renderBlocking: true, fetchPriority: 'high',
    });
    const complete = vi.fn();
    const performFetch = vi.fn<PerformScriptFetch>((request, isTopLevel, respond) => {
      expect(request.env).toBe(fetchClient);
      expect(request.client).toBe(fetchClient);
      expect(request.referrer).toBe(referrer);
      expect(request).toMatchObject({
        mode: 'cors', destination: 'script', initiatorType: 'script', credentialsMode: 'include',
        cryptographicNonceMetadata: 'nonce', integrityMetadata: 'sha256-test', parserInserted: true,
        referrerPolicy: 'no-referrer', renderBlocking: true, priority: 'high',
      });
      expect(isTopLevel).toBe(true);
      const response = new FetchResponse();
      response.urlList = [url];
      response.headerList.append('Content-Type', 'text/javascript');
      respond(response.filter('basic'), utf8Encode('export default 1;'));
    });

    env.fetchSingleModuleScript(url, fetchClient, 'script', options, referrer, undefined, true, complete, performFetch);

    expect(create.javascript).toHaveBeenCalledExactlyOnceWith('export default 1;', env, url, options);
    expect(complete).toHaveBeenCalledExactlyOnceWith(scripts.javascript);
    expect(env.moduleMap.get(url, 'javascript-or-wasm')).toBe(scripts.javascript);
    expect(fetchClient.moduleMap.entries).toHaveLength(0);
  });

  it.each([
    ['worker', true, 'same-origin'], ['sharedworker', true, 'same-origin'],
    ['serviceworker', true, 'same-origin'], ['worker', false, 'cors'],
    ['script', true, 'cors'], ['paintworklet', true, 'cors'],
  ] as const)('sets mode for destination %s, top-level %s', async (destination, isTopLevel, mode) => {
    const { env, url } = await createFixture();
    const performFetch = vi.fn<PerformScriptFetch>((request, topLevel) => {
      expect(request.mode).toBe(mode);
      expect(request.destination).toBe(destination);
      expect(request.referrer).toBeUndefined();
      expect(topLevel).toBe(isTopLevel);
    });

    env.fetchSingleModuleScript(url, env, destination, new ScriptFetchOptions(), 'client', undefined, isTopLevel, vi.fn(), performFetch);

    expect(performFetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    [undefined, 'text/javascript; charset=windows-1252', 'javascript', 'script'],
    [undefined, 'application/wasm', 'wasm', 'script'],
    ['css', 'text/css', 'css', 'style'],
    ['json', 'application/problem+json', 'json', 'json'],
    ['json', 'text/json', 'json', 'json'],
    ['text', null, 'text', 'text'],
    ['text', 'application/wasm', 'text', 'text'],
  ] as const)('selects creation for type %s and MIME %s', async (type, mime, kind, destination) => {
    const { env, url, scripts, create } = await createFixture();
    const bytes = kind === 'wasm' ? new Uint8Array([0, 97, 115, 109]) : utf8Encode('\uFEFF€');
    const options = new ScriptFetchOptions();
    const complete = vi.fn();
    const performFetch: PerformScriptFetch = (request, _topLevel, respond) => {
      expect(request.destination).toBe(destination);
      expect(request.referrer).toBeNull();
      const response = new FetchResponse();
      response.urlList = [url];
      if (mime !== null) response.headerList.append('Content-Type', mime);
      respond(response, bytes);
    };

    env.fetchSingleModuleScript(
      url, env, 'script', options, 'no-referrer', moduleRequest(type), false, complete, performFetch,
    );

    expect(complete).toHaveBeenCalledExactlyOnceWith(scripts[kind]);
    if (kind === 'wasm') expect(create.wasm).toHaveBeenCalledExactlyOnceWith(bytes, env, url, options);
    else if (kind === 'javascript') expect(create.javascript).toHaveBeenCalledExactlyOnceWith('€', env, url, options);
    else expect(create[kind]).toHaveBeenCalledExactlyOnceWith('€', env);
    for (const [other, creator] of Object.entries(create)) {
      if (other !== kind) expect(creator).not.toHaveBeenCalled();
    }
  });

  it('shares pending callbacks and publishes a cached result before running them', async () => {
    const { env, url, scripts, create } = await createFixture();
    const sameURL = env.parseURL('https://modules.test:443/dir/../module.js')!;
    const options = new ScriptFetchOptions();
    let respond!: Parameters<PerformScriptFetch>[2];
    const performFetch = vi.fn<PerformScriptFetch>((_request, _topLevel, callback) => { respond = callback; });
    const order: string[] = [];
    const first = vi.fn((script) => {
      order.push('first');
      expect(script).toBe(scripts.javascript);
      env.fetchSingleModuleScript(sameURL, env, 'script', options, 'client', undefined, true, (cached) => {
        order.push('cached');
        expect(cached).toBe(script);
      }, performFetch);
    });
    const second = vi.fn((script) => {
      order.push('second');
      expect(script).toBe(scripts.javascript);
    });
    env.fetchSingleModuleScript(url, env, 'script', options, 'client', undefined, true, first, performFetch);
    env.fetchSingleModuleScript(sameURL, env, 'script', options, 'client', undefined, false, second, performFetch);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    expect(performFetch).toHaveBeenCalledTimes(1);
    const response = new FetchResponse();
    response.urlList = [url];
    response.headerList.append('Content-Type', 'text/javascript');

    respond(response, utf8Encode('source'));

    expect(order).toEqual(['first', 'cached', 'second']);
    expect(create.javascript).toHaveBeenCalledTimes(1);
    expect(performFetch).toHaveBeenCalledTimes(1);
    expect(env.moduleMap.entries).toHaveLength(1);
  });

  it('keeps module types, query strings, and fragments separate in the module map', async () => {
    const { env, url } = await createFixture();
    const performFetch = vi.fn<PerformScriptFetch>();
    for (const [requestURL, type] of [
      [url, undefined], [url, 'json'],
      [env.parseURL('https://modules.test/module.js?version=2')!, undefined],
      [env.parseURL('https://modules.test/module.js#other')!, undefined],
    ] as const) {
      env.fetchSingleModuleScript(
        requestURL, env, 'script', new ScriptFetchOptions(), 'client', moduleRequest(type), true, vi.fn(), performFetch,
      );
    }

    expect(performFetch).toHaveBeenCalledTimes(4);
    expect(env.moduleMap.entries).toHaveLength(4);
  });

  it('returns a retained null without starting a fetch', async () => {
    const { env, url } = await createFixture();
    env.moduleMap.set(url, 'javascript-or-wasm', null);
    const performFetch = vi.fn<PerformScriptFetch>();
    const complete = vi.fn();

    env.fetchSingleModuleScript(url, env, 'script', new ScriptFetchOptions(), 'client', undefined, true, complete, performFetch);

    expect(complete).toHaveBeenCalledExactlyOnceWith(null);
    expect(performFetch).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, null], [undefined, 'text/plain'], ['css', 'text/javascript'], ['json', 'text/plain'],
  ] as const)('removes a MIME mismatch for type %s and MIME %s before notifying all waiters', async (type, mime) => {
    const { env, url, create } = await createFixture();
    const request = moduleRequest(type);
    let respond!: Parameters<PerformScriptFetch>[2];
    const performFetch = vi.fn<PerformScriptFetch>((_request, _topLevel, callback) => { respond = callback; });
    const retry = vi.fn();
    const first = vi.fn((script) => {
      expect(script).toBeNull();
      expect(env.moduleMap.get(url, type ?? 'javascript-or-wasm')).toBeUndefined();
      env.fetchSingleModuleScript(url, env, 'script', new ScriptFetchOptions(), 'client', request, true, retry, performFetch);
    });
    const second = vi.fn();
    env.fetchSingleModuleScript(url, env, 'script', new ScriptFetchOptions(), 'client', request, true, first, performFetch);
    env.fetchSingleModuleScript(url, env, 'script', new ScriptFetchOptions(), 'client', request, true, second, performFetch);
    const response = new FetchResponse();
    response.urlList = [url];
    if (mime !== null) response.headerList.append('Content-Type', mime);

    respond(response, utf8Encode('source'));

    expect(first).toHaveBeenCalledExactlyOnceWith(null);
    expect(second).toHaveBeenCalledExactlyOnceWith(null);
    expect(retry).not.toHaveBeenCalled();
    expect(performFetch).toHaveBeenCalledTimes(2);
    for (const creator of Object.values(create)) expect(creator).not.toHaveBeenCalled();
  });

  it.each(['HTTP error', 'null body', 'network error', 'body error'] as const)(
    'removes failed fetches from the module map: %s', async (failure) => {
      const { env, url, create } = await createFixture();
      mockHTTPTransport(env.userAgent, (_request, listener) => {
        if (failure === 'network error') {
          listener.onError(new Error('connection failed'));
          return;
        }
        listener.onHeaders(failure === 'HTTP error' ? 404 : failure === 'null body' ? 204 : 200, '', new FetchHeaders([
          ['Content-Type', 'text/javascript'],
        ]), true);
        if (failure === 'body error') listener.onError(new Error('body failed'));
        else listener.onEnd();
      });

      const result = await new Promise<ModuleScript | null>((complete) => {
        env.fetchSingleModuleScript(url, env, 'script', new ScriptFetchOptions(), 'client', undefined, true, complete);
      });

      expect(result).toBeNull();
      expect(env.moduleMap.entries).toHaveLength(0);
      expect(create.javascript).not.toHaveBeenCalled();
    },
  );

  it.each(['same-origin', 'cross-origin'] as const)(
    'uses a redirected response URL for creation but retains the original map key: %s', async (origin) => {
      const { env, url, create, scripts } = await createFixture();
      const finalURL = origin === 'same-origin' ? 'https://modules.test/final.js' : 'https://other.test/final.js';
      const options = new ScriptFetchOptions();
      const requests: string[] = [];
      mockHTTPTransport(env.userAgent, (request, listener) => {
        requests.push(serializeURL(request.url));
        if (requests.length === 1) {
          listener.onHeaders(302, '', new FetchHeaders([['Location', finalURL]]), true);
          listener.onEnd();
        } else {
          listener.onHeaders(200, '', new FetchHeaders([
            ['Content-Type', 'text/javascript; charset=windows-1252'],
            ['Access-Control-Allow-Origin', '*'], ['Access-Control-Expose-Headers', 'Referrer-Policy'],
            ['Referrer-Policy', 'no-referrer'],
          ]), true);
          listener.onData(utf8Encode('\uFEFF€'));
          listener.onEnd();
        }
      });

      const result = await new Promise<ModuleScript | null>((complete) => {
        env.fetchSingleModuleScript(url, env, 'script', options, 'client', undefined, true, complete);
      });

      expect(requests).toEqual([serializeURL(url), finalURL]);
      expect(result).toBe(scripts.javascript);
      expect(create.javascript.mock.calls[0]![0]).toBe('€');
      expect(serializeURL(create.javascript.mock.calls[0]![2])).toBe(finalURL);
      expect(options.referrerPolicy).toBe('no-referrer');
      expect(env.moduleMap.get(url, 'javascript-or-wasm')).toBe(scripts.javascript);
      expect(env.moduleMap.get(env.parseURL(finalURL)!, 'javascript-or-wasm')).toBeUndefined();
    },
  );
});

describe('fetch a single imported module script', () => {
  it.each(['json', 'css', 'text'])('sets up a %s descendant and keeps the perform-fetch hook', async (type) => {
    const { env, url } = await createFixture();
    const performFetch = vi.fn<PerformScriptFetch>((request, topLevel) => {
      expect(topLevel).toBe(false);
      expect(request.mode).toBe('cors');
      expect(request.destination).toBe(type === 'css' ? 'style' : type);
    });

    env.fetchSingleImportedModuleScript(
      url, env, 'worker', new ScriptFetchOptions(), 'client', moduleRequest(type)!, vi.fn(), performFetch,
    );

    expect(performFetch).toHaveBeenCalledTimes(1);
  });

  it.each(['javascript-or-wasm', 'javascript', 'wasm', 'unknown', ''])('rejects an unsupported explicit type %s', async (type) => {
    const { env, url } = await createFixture();
    const complete = vi.fn();
    const performFetch = vi.fn<PerformScriptFetch>();

    env.fetchSingleImportedModuleScript(
      url, env, 'script', new ScriptFetchOptions(), 'client', moduleRequest(type)!, complete, performFetch,
    );

    expect(complete).toHaveBeenCalledExactlyOnceWith(null);
    expect(performFetch).not.toHaveBeenCalled();
    expect(env.moduleMap.entries).toHaveLength(0);
  });

  it('rejects CSS when the target realm does not expose CSSStyleSheet, even if the global has that property', async () => {
    const { env, url } = await createFixture();
    expect('CSSStyleSheet' in env.global).toBe(true);
    env.realm.globalNames = new Set(['DedicatedWorker', 'Worker']);
    const complete = vi.fn();
    const performFetch = vi.fn<PerformScriptFetch>();

    env.fetchSingleImportedModuleScript(
      url, env, 'worker', new ScriptFetchOptions(), 'client', moduleRequest('css')!, complete, performFetch,
    );

    expect(complete).toHaveBeenCalledExactlyOnceWith(null);
    expect(performFetch).not.toHaveBeenCalled();
    expect(env.isModuleTypeAllowed('json')).toBe(true);
    expect(env.isModuleTypeAllowed('text')).toBe(true);
  });

  it('accepts a JavaScript request without a type attribute', async () => {
    const { env, url } = await createFixture();
    const performFetch = vi.fn<PerformScriptFetch>();

    env.fetchSingleImportedModuleScript(
      url, env, 'script', new ScriptFetchOptions(), 'client', new JSModuleRequest('./module.js'), vi.fn(), performFetch,
    );

    expect(performFetch).toHaveBeenCalledWith(expect.any(Object), false, expect.any(Function));
  });
});

async function createEnvironment() {
  const browser = new Browlet({ route: () => '', reporting: false });
  await browser.navigate('https://modules.test/page');
  return getRelevantRealm(browser.window).env;
}

async function createFixture() {
  const env = await createEnvironment();
  const scripts = {
    javascript: createScriptState(env), css: createScriptState(env), json: createScriptState(env),
    text: createScriptState(env), wasm: createScriptState(env),
  };
  // Constructor mocks must be constructible; arrows and mockReturnValue are not suitable here.
  const create = {
    javascript: vi.spyOn(scriptClasses, 'JavaScriptModuleScript').mockImplementation(function() { return scripts.javascript; }),
    css: vi.spyOn(scriptClasses, 'CSSModuleScript').mockImplementation(function() { return scripts.css; }),
    json: vi.spyOn(scriptClasses, 'JSONModuleScript').mockImplementation(function() { return scripts.json; }),
    text: vi.spyOn(scriptClasses, 'TextModuleScript').mockImplementation(function() { return scripts.text; }),
    wasm: vi.spyOn(scriptClasses, 'WebAssemblyModuleScript').mockImplementation(function() { return scripts.wasm; }),
  };
  return { env, url: env.parseURL('https://modules.test/module.js')!, scripts, create };
}

function moduleRequest(type: string | undefined): JSModuleRequest | undefined {
  return type === undefined ? undefined : new JSModuleRequest('./module', [{ key: 'type', value: type }]);
}
