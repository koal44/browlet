import { afterEach, describe, expect, it, vi } from 'vitest';

import { internalType } from '../../../src/infra/index';
import { utf8Encode } from '../../../src/encoding/index';
import { Browlet } from '../../../src/browlet/browlet';
import type { BrowletEnvironment } from '../../../src/browlet/environment';
import * as scriptClasses from '../../../src/browlet/scripting/script';
import { JSSourceTextModuleRecord, type JavaScriptModuleScript, type ModuleScript } from '../../../src/browlet/scripting/script';
import {
  fetchWorkletModuleWorkerScriptGraph, type ModuleGraphLoadingState, type PerformScriptFetch,
} from '../../../src/browlet/scripting/script-fetching';
import { ModuleResponsesMap } from '../../../src/browlet/worklets/module-responses-map';
import { FetchHeaders } from '../../../src/fetch/headers';
import { FetchRequest } from '../../../src/fetch/request';
import { FetchResponse } from '../../../src/fetch/response';
import type { HTTPTransportListener } from '../../../src/fetch/transport';
import { mockHTTPTransport } from '../../fetch/transport-fixture';
import { getRelevantRealm } from '../../support/browlet-binding';
import { createScriptState } from '../../support/script-state';

afterEach(() => vi.restoreAllMocks());

// Real environments, Fetch, and owner Promises; only script creation and the unfinished
// module-record operations are replaced. These do not claim worker/worklet global startup.
describe('worker module graphs', () => {
  it('fetches with the outside client and creates and links in the target environment', async () => {
    const fetchClient = await createEnvironment();
    const target = await createModule();
    const url = fetchClient.parseURL('https://modules.test/worker.js')!;
    const construct = mockCreation(target);
    const transport = mockHTTPTransport(fetchClient.userAgent, (request, listener) => {
      expect(request.headers.get('Sec-Fetch-Mode')).toBe('same-origin');
      respond(listener);
    });
    const complete = vi.fn();

    target.env.fetchModuleWorkerScriptGraph(url, fetchClient, 'worker', 'include', complete);
    const state = await target.started;

    expect(transport).toHaveBeenCalledOnce();
    expect(construct).toHaveBeenCalledExactlyOnceWith('export default 1;', target.env, url,
      expect.objectContaining({ credentialsMode: 'include' }));
    expect(state).toEqual({ errorToRethrow: null, fetchClient, destination: 'worker', performFetch: null });
    expect(fetchClient.moduleMap.get(url, 'javascript-or-wasm')).toBeUndefined();
    expect(target.env.moduleMap.get(url, 'javascript-or-wasm')).toBe(target.script);
    expect(complete).not.toHaveBeenCalled();
    finish(target);
    expect(complete).toHaveBeenCalledExactlyOnceWith(target.script);
  });

  it('reports a failed worker root without creating or linking a module', async () => {
    const fetchClient = await createEnvironment();
    const target = await createModule();
    const construct = mockCreation(target);
    mockHTTPTransport(fetchClient.userAgent, (_request, listener) => respond(listener, 404));
    const url = fetchClient.parseURL('https://modules.test/missing.js')!;

    const result = await new Promise<ModuleScript | null>((complete) => {
      target.env.fetchModuleWorkerScriptGraph(url, fetchClient, 'sharedworker', 'same-origin', complete);
    });

    expect(result).toBeNull();
    expect(construct).not.toHaveBeenCalled();
    expect(target.load).not.toHaveBeenCalled();
    expect(target.link).not.toHaveBeenCalled();
  });

  it.each(['omit', 'same-origin', 'include'] as const)(
    'sets the shared graph defaults with %s credentials and retains the custom hook for descendants', async (credentialsMode) => {
      const fetchClient = await createEnvironment();
      const target = await createModule();
      const url = fetchClient.parseURL('https://modules.test/root.js')!;
      const construct = mockCreation(target);
      const complete = vi.fn();
      const performFetch = vi.fn<PerformScriptFetch>((request, isTopLevel, processResponse) => {
        expect(request.client).toBe(fetchClient);
        expect(request.env).toBe(fetchClient);
        expect(isTopLevel).toBe(true);
        expect(request).toMatchObject({
          destination: 'paintworklet', mode: 'cors', initiatorType: 'script', credentialsMode,
          cryptographicNonceMetadata: '', integrityMetadata: '', parserInserted: false,
          referrerPolicy: '', priority: 'auto', renderBlocking: false,
        });
        const response = new FetchResponse();
        response.urlList = [url];
        response.headerList.append('Content-Type', 'text/javascript');
        processResponse(response, utf8Encode('export default 1;'));
      });

      fetchWorkletModuleWorkerScriptGraph(url, fetchClient, 'paintworklet', credentialsMode, target.env, complete, performFetch);
      const state = await target.started;

      expect(construct).toHaveBeenCalledOnce();
      expect(state).toEqual({ errorToRethrow: null, fetchClient, destination: 'paintworklet', performFetch });
      finish(target);
      expect(complete).toHaveBeenCalledExactlyOnceWith(target.script);
    },
  );
});

describe('worklet module response sharing', () => {
  it('shares one download across pending and later globals, but creates and links separate modules', async () => {
    const fetchClient = await createEnvironment();
    const first = await createModule();
    const second = await createModule();
    const later = await createModule();
    const construct = mockCreation(first, second, later);
    const url = fetchClient.parseURL('https://modules.test/worklet.js')!;
    const sameURL = fetchClient.parseURL('https://modules.test/worklet.js')!;
    const responses = new ModuleResponsesMap();
    const dispatched = Promise.withResolvers<HTTPTransportListener>();
    const transport = mockHTTPTransport(fetchClient.userAgent, (_request, listener) => dispatched.resolve(listener));
    const queued: (() => void)[] = [];
    const delivery = vi.spyOn(second.env.exec, 'queueTask').mockImplementation((source, steps) => {
      expect(source).toBe('network');
      queued.push(steps);
      return { remove() {} };
    });
    const completeFirst = vi.fn();
    const completeSecond = vi.fn();
    const completeLater = vi.fn();

    first.env.fetchWorkletScriptGraph(url, fetchClient, 'paintworklet', 'omit', responses, completeFirst);
    second.env.fetchWorkletScriptGraph(sameURL, fetchClient, 'paintworklet', 'omit', responses, completeSecond);
    expect(responses.get(sameURL)).toBe('fetching');
    respond(await dispatched.promise);
    await first.started;

    expect(transport).toHaveBeenCalledOnce();
    expect(construct).toHaveBeenCalledOnce();
    expect(delivery).toHaveBeenCalledExactlyOnceWith('network', expect.any(Function));
    expect(second.load).not.toHaveBeenCalled();
    expect(completeSecond).not.toHaveBeenCalled();
    expect(responses.get(url)).not.toBe('fetching');
    queued.shift()!();
    await second.started;

    // A new global replays the cached response without another download or pending-response task.
    const laterDelivery = vi.spyOn(later.env.exec, 'queueTask');
    later.env.fetchWorkletScriptGraph(url, fetchClient, 'paintworklet', 'omit', responses, completeLater);
    expect(later.load).toHaveBeenCalledOnce();
    expect(laterDelivery).not.toHaveBeenCalled();
    expect(construct).toHaveBeenCalledTimes(3);
    expect(transport).toHaveBeenCalledOnce();
    expect(fetchClient.moduleMap.entries).toHaveLength(0);
    for (const target of [first, second, later]) {
      expect(target.env.moduleMap.get(url, 'javascript-or-wasm')).toBe(target.script);
      finish(target);
    }
    expect(completeFirst).toHaveBeenCalledExactlyOnceWith(first.script);
    expect(completeSecond).toHaveBeenCalledExactlyOnceWith(second.script);
    expect(completeLater).toHaveBeenCalledExactlyOnceWith(later.script);
  });

  it('passes the response-sharing hook to descendant loading too', async () => {
    const fetchClient = await createEnvironment();
    const target = await createModule();
    mockCreation(target);
    const url = fetchClient.parseURL('https://modules.test/root.js')!;
    const dependencyURL = fetchClient.parseURL('https://modules.test/dep.js')!;
    const responses = new ModuleResponsesMap();
    const transport = mockHTTPTransport(fetchClient.userAgent, (_request, listener) => respond(listener));
    target.env.fetchWorkletScriptGraph(url, fetchClient, 'audioworklet', 'same-origin', responses, vi.fn());
    const state = await target.started;
    expect(state.performFetch).not.toBeNull();
    const request = new FetchRequest(dependencyURL, fetchClient);
    request.client = fetchClient;
    request.destination = 'audioworklet';

    const response = await new Promise<FetchResponse>((complete) => {
      state.performFetch!(request, false, (result) => complete(result));
    });
    const replay = vi.fn();
    state.performFetch!(request, false, replay);

    expect(transport).toHaveBeenCalledTimes(2);
    expect(replay).toHaveBeenCalledExactlyOnceWith(response, utf8Encode('export default 1;'));
    expect(responses.get(dependencyURL)).toEqual([response, utf8Encode('export default 1;')]);
    finish(target);
  });

  it.each(['HTTP error', 'null body', 'network error', 'body error', 'wrong MIME'] as const)(
    'retains a %s response for waiting and later globals without retrying', async (failure) => {
      const fetchClient = await createEnvironment();
      const first = await createModule();
      const second = await createModule();
      const later = await createModule();
      const construct = mockCreation(first, second, later);
      const url = fetchClient.parseURL('https://modules.test/failure.js')!;
      const responses = new ModuleResponsesMap();
      const dispatched = Promise.withResolvers<HTTPTransportListener>();
      const transport = mockHTTPTransport(fetchClient.userAgent, (_request, listener) => dispatched.resolve(listener));
      const responseReceived = Promise.withResolvers<void>();
      vi.spyOn(fetchClient.userAgent, 'webDriverBiDiResponseCompleted').mockImplementation(() => responseReceived.resolve());
      const initial = [first, second].map((target) => new Promise<ModuleScript | null>((complete) => {
        target.env.fetchWorkletScriptGraph(url, fetchClient, 'paintworklet', 'omit', responses, complete);
      }));
      const listener = await dispatched.promise;
      if (failure === 'network error') {
        listener.onError(new Error('Connection failed'));
      } else {
        listener.onHeaders(failure === 'HTTP error' ? 404 : failure === 'null body' ? 204 : 200, '', new FetchHeaders([
          ['Content-Type', failure === 'wrong MIME' ? 'text/plain' : 'text/javascript'],
        ]), true);
        if (failure === 'body error') {
          // Let Fetch publish the headers before failing the body; otherwise this is a network error.
          await responseReceived.promise;
          listener.onError(new Error('Body failed'));
        } else {
          listener.onEnd();
        }
      }

      expect(await Promise.all(initial)).toEqual([null, null]);
      const completeLater = vi.fn();
      later.env.fetchWorkletScriptGraph(url, fetchClient, 'paintworklet', 'omit', responses, completeLater);

      expect(completeLater).toHaveBeenCalledExactlyOnceWith(null);
      expect(transport).toHaveBeenCalledOnce();
      expect(construct).not.toHaveBeenCalled();
      for (const target of [first, second, later]) {
        expect(target.env.moduleMap.entries).toHaveLength(0);
        expect(target.load).not.toHaveBeenCalled();
      }
      const cached = responses.get(url);
      expect(cached).not.toBeUndefined();
      expect(cached).not.toBe('fetching');
      if (failure === 'body error') expect(cached?.[1]).toBe('failure');
      if (failure === 'null body' || failure === 'network error') expect(cached?.[1]).toBeNull();
    },
  );
});

async function createEnvironment(): Promise<BrowletEnvironment> {
  const browser = new Browlet({ route: () => '', reporting: false });
  await browser.navigate('https://modules.test/page');
  return getRelevantRealm(browser.window).env;
}

async function createModule() {
  const env = await createEnvironment();
  const script: JavaScriptModuleScript = createScriptState(env);
  const record = new JSSourceTextModuleRecord(script);
  script.record = record;
  const loading = env.exec.Promise.withResolvers(internalType<void>());
  const started = Promise.withResolvers<ModuleGraphLoadingState>();
  const load = vi.spyOn(record, 'loadRequestedModules').mockImplementation((state) => {
    started.resolve(state);
    return loading.promise;
  });
  const link = vi.spyOn(record, 'link').mockImplementation(() => {});
  return { env, script, loading, started: started.promise, load, link };
}

function mockCreation(...targets: Awaited<ReturnType<typeof createModule>>[]) {
  return vi.spyOn(scriptClasses, 'JavaScriptModuleScript').mockImplementation(function(_source, env, baseURL, options) {
    const target = targets.find((candidate) => candidate.env === env)!;
    target.script.baseURL = baseURL;
    target.script.fetchOptions = options;
    return target.script;
  });
}

function finish(target: Awaited<ReturnType<typeof createModule>>) {
  target.loading.resolve(undefined);
  target.env.realm.agent.eventLoop.performMicrotaskCheckpoint();
  expect(target.link).toHaveBeenCalledOnce();
}

function respond(listener: HTTPTransportListener, status = 200) {
  listener.onHeaders(status, '', new FetchHeaders([['Content-Type', 'text/javascript']]), true);
  listener.onData(utf8Encode('export default 1;'));
  listener.onEnd();
}
