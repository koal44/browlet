import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import * as scriptClasses from '../../../src/browlet/scripting/script';
import type { ClassicScript } from '../../../src/browlet/scripting/script';
import { ScriptFetchOptions } from '../../../src/browlet/scripting/script-fetch-options';
import { fetchClassicScript, type PerformScriptFetch } from '../../../src/browlet/scripting/script-fetching';
import { utf8Encode, type Encoding } from '../../../src/encoding/index';
import { FetchHeaders } from '../../../src/fetch/headers';
import type { FetchRequest } from '../../../src/fetch/request';
import { FetchResponse } from '../../../src/fetch/response';
import type { HTTPTransportListener } from '../../../src/fetch/transport';
import { serializeURL } from '../../../src/url/core/index';
import { mockHTTPTransport } from '../../fetch/transport-fixture';
import { getRelevantRealm } from '../../support/browlet-binding';
import { createScriptState } from '../../support/script-state';

afterEach(() => vi.restoreAllMocks());

// Exercise Fetch and decoding, replacing only the explicitly unfinished creation dependency.
// These are handoff tests, not evidence of parsing, evaluation, or worker startup.
describe('fetch a classic script', () => {
  it.each([
    ['no-cors', 'no-cors', 'include'],
    ['anonymous', 'cors', 'same-origin'],
    ['use-credentials', 'cors', 'include'],
  ] as const)('sets up a %s request and delivers its source to creation', async (cors, mode, credentialsMode) => {
    const { env, url, script, create } = await createFixture();
    const options = new ScriptFetchOptions();
    options.cryptographicNonce = 'script-nonce';
    options.parserMetadata = 'parser-inserted';
    options.credentialsMode = 'omit'; // Classic requests take credentials from the CORS setting.
    options.referrerPolicy = 'no-referrer';
    options.renderBlocking = true;
    options.fetchPriority = 'high';
    const makeRequest = vi.spyOn(env.userAgent, 'createPotentialCORSRequest');
    mockHTTPTransport(env.userAgent, (_request, listener) => respond(listener));

    const result = await new Promise<ClassicScript | null>((complete) => {
      env.fetchClassicScript(url, options, cors, 'UTF-8', complete);
    });

    expect(makeRequest).toHaveBeenCalledExactlyOnceWith(url, 'script', cors);
    const request = makeRequest.mock.results[0]!.value as FetchRequest;
    expect(request.client).toBe(env);
    expect(request).toMatchObject({
      destination: 'script', initiatorType: 'script', mode, credentialsMode,
      cryptographicNonceMetadata: 'script-nonce', parserInserted: true, referrerPolicy: 'no-referrer',
      renderBlocking: true, priority: 'high', useURLCredentials: true,
    });
    expect(create).toHaveBeenCalledExactlyOnceWith('source', env, expect.any(Object), options, false, url);
    expect(serializeURL(create.mock.calls[0]![2])).toBe(serializeURL(url));
    expect(result).toBe(script);
  });

  it.each([
    ['charset overrides fallback', 'text/plain; charset=windows-1252', 'UTF-8', new Uint8Array([0x80]), '€'],
    ['unknown charset uses fallback', 'text/plain; charset=unknown', 'windows-1252', new Uint8Array([0x80]), '€'],
    ['missing MIME uses fallback', null, 'windows-1252', new Uint8Array([0x80]), '€'],
    ['BOM overrides charset', 'text/javascript; charset=windows-1252', 'windows-1252', utf8Encode('\uFEFF€'), '€'],
    ['an empty byte sequence is source', 'text/javascript', 'UTF-8', new Uint8Array(), ''],
  ] satisfies [string, string | null, Encoding, Uint8Array, string][])(
    'decodes source: %s', async (_name, mime, encoding, bytes, source) => {
      const { env, url, create, script } = await createFixture();
      mockHTTPTransport(env.userAgent, (_request, listener) => respond(listener, bytes, mime));

      const result = await new Promise<ClassicScript | null>((complete) => {
        fetchClassicScript(url, env, new ScriptFetchOptions(), 'no-cors', encoding, complete);
      });

      expect(result).toBe(script);
      expect(create.mock.calls[0]![0]).toBe(source);
    },
  );

  it('retains the original source URL while using the redirected response URL as the base', async () => {
    const { env, url, create } = await createFixture();
    const requests: string[] = [];
    mockHTTPTransport(env.userAgent, (request, listener) => {
      requests.push(serializeURL(request.url));
      if (requests.length === 1) {
        listener.onHeaders(302, '', new FetchHeaders([['Location', '/redirected.js']]), true);
        listener.onEnd();
      } else {
        respond(listener);
      }
    });

    await new Promise<ClassicScript | null>((complete) => {
      fetchClassicScript(url, env, new ScriptFetchOptions(), 'no-cors', 'UTF-8', complete);
    });

    expect(requests).toEqual(['https://scripts.test/script.js', 'https://scripts.test/redirected.js']);
    expect(serializeURL(create.mock.calls[0]![2])).toBe('https://scripts.test/redirected.js');
    expect(create.mock.calls[0]![5]).toBe(url);
  });

  it.each(['no-cors', 'anonymous'] as const)('preserves response tainting for cross-origin %s scripts', async (cors) => {
    const { env, create, script } = await createFixture();
    const url = env.parseURL('https://other.test/script.js')!;
    mockHTTPTransport(env.userAgent, (_request, listener) => {
      listener.onHeaders(200, '', new FetchHeaders([
        ['Content-Type', 'text/javascript'], ['Access-Control-Allow-Origin', 'https://scripts.test'],
      ]), true);
      listener.onData(utf8Encode('cross-origin source'));
      listener.onEnd();
    });

    const result = await new Promise<ClassicScript | null>((complete) => {
      fetchClassicScript(url, env, new ScriptFetchOptions(), cors, 'UTF-8', complete);
    });

    expect(result).toBe(script);
    expect(create.mock.calls[0]![0]).toBe('cross-origin source');
    expect(create.mock.calls[0]![4]).toBe(cors === 'no-cors');
  });

  it.each(['HTTP error', 'null body', 'network error', 'body error', 'nosniff'] as const)(
    'reports null and never creates a script on %s', async (failure) => {
      const { env, url, create } = await createFixture();
      mockHTTPTransport(env.userAgent, (_request, listener) => {
        if (failure === 'network error') {
          listener.onError(new Error('connection failed'));
          return;
        }
        const headers = new FetchHeaders([['Content-Type', 'text/plain']]);
        if (failure === 'nosniff') headers.append('X-Content-Type-Options', 'nosniff');
        listener.onHeaders(failure === 'HTTP error' ? 404 : failure === 'null body' ? 204 : 200, '', headers, true);
        if (failure === 'body error') listener.onError(new Error('body failed'));
        else listener.onEnd();
      });
      const complete = vi.fn<(script: ClassicScript | null) => void>();

      const result = await new Promise<ClassicScript | null>((resolve) => {
        fetchClassicScript(url, env, new ScriptFetchOptions(), 'no-cors', 'UTF-8', (script) => {
          complete(script);
          resolve(script);
        });
      });

      expect(result).toBeNull();
      expect(complete).toHaveBeenCalledExactlyOnceWith(null);
      expect(create).not.toHaveBeenCalled();
    },
  );

  it.each([true, false])('lets Fetch enforce integrity before creation (matches: %s)', async (matches) => {
    const { env, url, script, create } = await createFixture();
    const options = new ScriptFetchOptions();
    options.integrityMetadata = `sha256-${createHash('sha256').update(matches ? 'source' : 'different').digest('base64')}`;
    mockHTTPTransport(env.userAgent, (_request, listener) => respond(listener));

    const result = await new Promise<ClassicScript | null>((complete) => {
      fetchClassicScript(url, env, options, 'no-cors', 'UTF-8', complete);
    });

    expect(result).toBe(matches ? script : null);
    expect(create).toHaveBeenCalledTimes(matches ? 1 : 0);
  });
});

describe('fetch a classic worker script', () => {
  it('uses the outside client for fetching and the target environment for script creation', async () => {
    const { env: fetchClient, url } = await createFixture();
    const { env, script, create } = await createFixture();
    const priority = vi.spyOn(fetchClient.userAgent, 'determineFetchPriority');
    mockHTTPTransport(fetchClient.userAgent, (_request, listener) => {
      respond(listener, utf8Encode('\uFEFF€'), 'text/javascript; charset=windows-1252');
    });

    const result = await new Promise<ClassicScript | null>((complete) => {
      env.fetchClassicWorkerScript(url, fetchClient, 'worker', complete);
    });

    expect(priority).toHaveBeenCalledWith(expect.objectContaining({
      env: fetchClient, client: fetchClient, destination: 'worker', initiatorType: 'other',
      mode: 'same-origin', credentialsMode: 'same-origin', parserInserted: false, useURLCredentials: true,
    }));
    expect(create).toHaveBeenCalledExactlyOnceWith('€', env, expect.any(Object), new ScriptFetchOptions());
    expect(result).toBe(script);
  });

  it.each([null, 'text/plain', 'text/javascript'])('checks HTTP worker MIME %j', async (mime) => {
    const { env, url, create, script } = await createFixture();
    mockHTTPTransport(env.userAgent, (_request, listener) => respond(listener, utf8Encode('source'), mime));

    const result = await new Promise<ClassicScript | null>((complete) => {
      env.fetchClassicWorkerScript(url, env, 'sharedworker', complete);
    });

    expect(result).toBe(mime === 'text/javascript' ? script : null);
    expect(create).toHaveBeenCalledTimes(mime === 'text/javascript' ? 1 : 0);
  });

  it('does not impose the HTTP MIME check on data URLs', async () => {
    const { env, create, script } = await createFixture();
    const url = env.parseURL('data:text/plain,source')!;
    const transport = mockHTTPTransport(env.userAgent, () => { throw new Error('Unexpected HTTP fetch'); });

    const result = await new Promise<ClassicScript | null>((complete) => {
      env.fetchClassicWorkerScript(url, env, 'worker', complete);
    });

    expect(result).toBe(script);
    expect(create).toHaveBeenCalledExactlyOnceWith('source', env, url, new ScriptFetchOptions());
    expect(transport).not.toHaveBeenCalled();
  });

  it.each(['success', 'wrong MIME', 'HTTP error', 'null body'] as const)(
    'keeps response validation when a custom fetch supplies %s', async (outcome) => {
      const { env, url, create, script } = await createFixture();
      const finalURL = env.parseURL('https://scripts.test/final.js')!;
      const response = new FetchResponse();
      response.urlList = [url, finalURL];
      response.headerList.append('Content-Type', outcome === 'wrong MIME' ? 'text/plain' : 'text/javascript');
      if (outcome === 'HTTP error') response.status = 404;
      const transport = mockHTTPTransport(env.userAgent, () => { throw new Error('Unexpected HTTP fetch'); });
      const performFetch = vi.fn<PerformScriptFetch>((request, isTopLevel, processResponse) => {
        expect(request.client).toBe(env);
        expect(request.mode).toBe('same-origin');
        expect(isTopLevel).toBe(true);
        processResponse(response.filter('basic'), outcome === 'null body' ? null : utf8Encode('custom source'));
      });

      const result = await new Promise<ClassicScript | null>((complete) => {
        env.fetchClassicWorkerScript(url, env, 'worker', complete, performFetch);
      });

      expect(performFetch).toHaveBeenCalledTimes(1);
      expect(transport).not.toHaveBeenCalled();
      expect(result).toBe(outcome === 'success' ? script : null);
      if (outcome === 'success') {
        expect(create).toHaveBeenCalledExactlyOnceWith('custom source', env, finalURL, new ScriptFetchOptions());
      } else {
        expect(create).not.toHaveBeenCalled();
      }
    },
  );
});

async function createFixture() {
  const browser = new Browlet({ route: () => '', reporting: false });
  await browser.navigate('https://scripts.test/page');
  const env = getRelevantRealm(browser.window).env;
  const url = env.parseURL('https://scripts.test/script.js')!;
  const script: ClassicScript = { ...createScriptState(env), mutedErrors: false, originalSourceURL: null };
  const create = vi.spyOn(scriptClasses, 'ClassicScript').mockImplementation(function() { return script; });
  return { env, url, script, create };
}

function respond(listener: HTTPTransportListener, bytes = utf8Encode('source'), mime: string | null = 'text/javascript') {
  const headers = new FetchHeaders();
  if (mime !== null) headers.append('Content-Type', mime);
  listener.onHeaders(200, '', headers, true);
  listener.onData(bytes);
  listener.onEnd();
}
