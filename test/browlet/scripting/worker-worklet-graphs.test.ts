import { afterEach, describe, expect, it, vi } from 'vitest';

import { internalType } from '../../../src/infra/index';
import { utf8Encode } from '../../../src/encoding/index';
import { Browlet } from '../../../src/browlet/browlet';
import type { BrowletEnvironment } from '../../../src/browlet/environment/index';
import * as scriptClasses from '../../../src/browlet/scripting/script';
import { CompiledSourceTextModule, type JSModuleScript, type ModuleScript } from '../../../src/browlet/scripting/script';
import { ModuleRequest } from '../../../src/browlet/scripting/module-request';
import {
  fetchWorkletModuleWorkerScriptGraph, type PerformScriptFetch,
} from '../../../src/browlet/scripting/script-fetching';
import type { ImportedModuleFetchOptions } from '../../../src/browlet/scripting/module-loading';
import { ModuleResponsesMap } from '../../../src/browlet/worklets/module-responses-map';
import { FetchHeaders } from '../../../src/fetch/headers';
import { FetchRequest } from '../../../src/fetch/request';
import { FetchResponse } from '../../../src/fetch/response';
import type { HTTPTransportListener } from '../../../src/fetch/transport';
import { mockHTTPTransport } from '../../fetch/transport-fixture';
import { getRelevantRealm } from '../../support/browlet-binding';
import { type Fixture, useFixture } from '../../support/fixture';
import { createScriptState } from '../../support/script-state';
import { runInHostTask } from '../../support/tasks';

afterEach(() => vi.restoreAllMocks());

// Real environments, Fetch, and owner Promises; only script creation and the unfinished
// module-record operations are replaced. These do not claim worker/worklet global startup.
describe('worker module graphs', () => {
  const fixture = useFixture((scope) => createGraphFixture(scope, 1));

  it('fetches with the outside client and creates and links in the target environment', async () => {
    const { scope, fetchClient, targets } = fixture();
    const target = targets[0]!;
    const url = fetchClient.parseURL('https://modules.test/worker.js')!;
    const construct = mockCreation(target);
    const transport = mockHTTPTransport(fetchClient.userAgent, (request, listener) => {
      expect(request.headers.get('Sec-Fetch-Mode')).toBe('same-origin');
      respond(listener);
    });
    const complete = vi.fn();

    target.env.fetchModuleWorkerScriptGraph(url, fetchClient, 'worker', 'include', complete);
    const options = await scope.waitFor(target.started);

    expect(transport).toHaveBeenCalledOnce();
    expect(construct).toHaveBeenCalledExactlyOnceWith('export default 1;', target.env, url,
      expect.objectContaining({ credentialsMode: 'include' }));
    expect(options).toEqual({ fetchClient, destination: 'worker', performFetch: null });
    expect(fetchClient.moduleMap.get(url, 'javascript-or-wasm')).toBeUndefined();
    expect(target.env.moduleMap.get(url, 'javascript-or-wasm')).toBe(target.script);
    expect(complete).not.toHaveBeenCalled();
    await scope.waitFor(finish(target));
    expect(complete).toHaveBeenCalledExactlyOnceWith(target.script);
  });

  it('reports a failed worker root without creating or linking a module', async () => {
    const { scope, fetchClient, targets } = fixture();
    const target = targets[0]!;
    const construct = mockCreation(target);
    mockHTTPTransport(fetchClient.userAgent, (_request, listener) => respond(listener, 404));
    const url = fetchClient.parseURL('https://modules.test/missing.js')!;

    const result = await scope.waitFor(new Promise<ModuleScript | null>((complete) => {
      target.env.fetchModuleWorkerScriptGraph(url, fetchClient, 'sharedworker', 'same-origin', complete);
    }));

    expect(result).toBeNull();
    expect(construct).not.toHaveBeenCalled();
    expect(target.load).not.toHaveBeenCalled();
    expect(target.link).not.toHaveBeenCalled();
  });

  it.each(['omit', 'same-origin', 'include'] as const)(
    'sets the shared graph defaults with %s credentials and retains the custom hook for descendants', async (credentialsMode) => {
      const { scope, fetchClient, targets } = fixture();
      const target = targets[0]!;
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
      const options = await scope.waitFor(target.started);

      expect(construct).toHaveBeenCalledOnce();
      expect(options).toEqual({ fetchClient, destination: 'paintworklet', performFetch });
      await scope.waitFor(finish(target));
      expect(complete).toHaveBeenCalledExactlyOnceWith(target.script);
    },
  );
});

describe('worklet module graphs', () => {
  const fixture = useFixture((scope) => createGraphFixture(scope, 1));

  it('does not deliver a retired fixture response through the next constructor mock', async () => {
    const { scope, fetchClient, targets } = fixture();
    const target = targets[0]!;
    const url = fetchClient.parseURL('https://modules.test/retired.js')!;
    const dispatched = Promise.withResolvers<HTTPTransportListener>();
    const completed = Promise.withResolvers<ModuleScript | null>();
    mockCreation(target);
    mockHTTPTransport(fetchClient.userAgent, (_request, listener) => dispatched.resolve(listener));
    target.env.fetchWorkletScriptGraph(url, fetchClient, 'paintworklet', 'omit', new ModuleResponsesMap(), completed.resolve);
    const listener = await scope.waitFor(dispatched.promise);

    // Reproduce a test ending while its response is still outstanding.
    await scope.dispose();
    const followingConstructor = mockCreation();
    respond(listener);
    expect(await completed.promise).toBeNull();
    await runInHostTask(() => {});

    expect(followingConstructor).not.toHaveBeenCalled();
  });

  it('passes the response-sharing hook to descendant loading too', async () => {
    const { scope, fetchClient, targets } = fixture();
    const target = targets[0]!;
    mockCreation(target);
    const url = fetchClient.parseURL('https://modules.test/root.js')!;
    const dependencyURL = fetchClient.parseURL('https://modules.test/dep.js')!;
    const responses = new ModuleResponsesMap();
    const transport = mockHTTPTransport(fetchClient.userAgent, (_request, listener) => respond(listener));
    target.env.fetchWorkletScriptGraph(url, fetchClient, 'audioworklet', 'same-origin', responses, vi.fn());
    const options = await scope.waitFor(target.started);
    expect(options.performFetch).not.toBeNull();
    const request = new FetchRequest(dependencyURL, fetchClient);
    request.client = fetchClient;
    request.destination = 'audioworklet';

    const response = await scope.waitFor(new Promise<FetchResponse>((complete) => {
      options.performFetch!(request, false, (result) => complete(result));
    }));
    const replay = vi.fn();
    options.performFetch!(request, false, replay);

    expect(transport).toHaveBeenCalledTimes(2);
    expect(replay).toHaveBeenCalledExactlyOnceWith(response, utf8Encode('export default 1;'));
    expect(responses.get(dependencyURL)).toEqual([response, utf8Encode('export default 1;')]);
    await scope.waitFor(finish(target));
  });
});

describe('worklet module response sharing', () => {
  const fixture = useFixture((scope) => createGraphFixture(scope, 3));

  it('shares one download across pending and later globals, but creates and links separate modules', async () => {
    const { scope, fetchClient, targets } = fixture();
    const first = targets[0]!, second = targets[1]!, later = targets[2]!;
    const construct = mockCreation(first, second, later);
    const url = fetchClient.parseURL('https://modules.test/worklet.js')!;
    const sameURL = fetchClient.parseURL('https://modules.test/worklet.js')!;
    const responses = new ModuleResponsesMap();
    const dispatched = Promise.withResolvers<HTTPTransportListener>();
    const transport = mockHTTPTransport(fetchClient.userAgent, (_request, listener) => dispatched.resolve(listener));
    const queued: (() => void)[] = [];
    const delivery = vi.spyOn(second.env, 'queueTask').mockImplementation((source, task) => {
      expect(source).toBe('network');
      queued.push(task.run);
      return { remove() {} };
    });
    scope.onCleanup(() => {
      delivery.mockRestore();
      // Release callbacks parked by this test before draining the real task queues.
      for (const steps of queued.splice(0)) steps();
    });
    const completeFirst = vi.fn();
    const completeSecond = vi.fn();
    const completeLater = vi.fn();

    first.env.fetchWorkletScriptGraph(url, fetchClient, 'paintworklet', 'omit', responses, completeFirst);
    second.env.fetchWorkletScriptGraph(sameURL, fetchClient, 'paintworklet', 'omit', responses, completeSecond);
    expect(responses.get(sameURL)).toBe('fetching');
    respond(await scope.waitFor(dispatched.promise));
    await scope.waitFor(first.started);

    expect(transport).toHaveBeenCalledOnce();
    expect(construct).toHaveBeenCalledOnce();
    expect(delivery).toHaveBeenCalledExactlyOnceWith('network', { run: expect.any(Function) as unknown });
    expect(second.load).not.toHaveBeenCalled();
    expect(completeSecond).not.toHaveBeenCalled();
    expect(responses.get(url)).not.toBe('fetching');
    queued.shift()!();
    await scope.waitFor(second.started);

    // A new global replays the cached response without another download or pending-response task.
    const laterDelivery = vi.spyOn(later.env, 'queueTask');
    later.env.fetchWorkletScriptGraph(url, fetchClient, 'paintworklet', 'omit', responses, completeLater);
    expect(later.load).toHaveBeenCalledOnce();
    expect(laterDelivery).not.toHaveBeenCalled();
    expect(construct).toHaveBeenCalledTimes(3);
    expect(transport).toHaveBeenCalledOnce();
    expect(fetchClient.moduleMap.entries).toHaveLength(0);
    for (const target of [first, second, later]) {
      expect(target.env.moduleMap.get(url, 'javascript-or-wasm')).toBe(target.script);
      await scope.waitFor(finish(target));
    }
    expect(completeFirst).toHaveBeenCalledExactlyOnceWith(first.script);
    expect(completeSecond).toHaveBeenCalledExactlyOnceWith(second.script);
    expect(completeLater).toHaveBeenCalledExactlyOnceWith(later.script);
  });

  it.each(['HTTP error', 'null body', 'network error', 'body error', 'wrong MIME'] as const)(
    'retains a %s response for waiting and later globals without retrying', async (failure) => {
      const { scope, fetchClient, targets } = fixture();
      const first = targets[0]!, second = targets[1]!, later = targets[2]!;
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
      const listener = await scope.waitFor(dispatched.promise);
      if (failure === 'network error') {
        listener.onError(new Error('Connection failed'));
      } else {
        listener.onHeaders(failure === 'HTTP error' ? 404 : failure === 'null body' ? 204 : 200, '', new FetchHeaders([
          ['Content-Type', failure === 'wrong MIME' ? 'text/plain' : 'text/javascript'],
        ]), true);
        if (failure === 'body error') {
          // Let Fetch publish the headers before failing the body; otherwise this is a network error.
          await scope.waitFor(responseReceived.promise);
          listener.onError(new Error('Body failed'));
        } else {
          listener.onEnd();
        }
      }

      expect(await scope.waitFor(Promise.all(initial))).toEqual([null, null]);
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

async function createGraphFixture(scope: Fixture, targetCount: number) {
  const environments = new Set<BrowletEnvironment>();
  // Keep the constructor replacement installed until every old delivery has finished.
  scope.onCleanup(() => { vi.restoreAllMocks(); });
  scope.onCleanup(() => drainEnvironments(environments));
  const fetchClient = await createEnvironment(scope, environments);
  const targets: ReturnType<typeof createModule>[] = [];
  for (let index = 0; index < targetCount; index++) {
    targets.push(createModule(await createEnvironment(scope, environments), scope));
  }
  return { scope, fetchClient, targets };
}

async function createEnvironment(scope: Fixture, environments: Set<BrowletEnvironment>): Promise<BrowletEnvironment> {
  const browser = new Browlet({ route: () => '', reporting: false });
  environments.add(getRelevantRealm(browser.window).env);
  const navigation = browser.navigate('https://modules.test/page').then(() => {
    const env = getRelevantRealm(browser.window).env;
    environments.add(env);
    return env;
  });
  // A setup timeout still waits for this finite, fixture-supplied navigation before draining.
  scope.onCleanup(async () => { await navigation; });
  return scope.waitFor(navigation);
}

function createModule(env: BrowletEnvironment, scope: Fixture) {
  const script: JSModuleScript = createScriptState(env);
  const record = new CompiledSourceTextModule(script, env.realm.compileModule('', 'fixture.js'));
  script.compiled = record;
  const loading = env.InternalPromise.withResolvers(internalType<void>());
  scope.onCleanup(() => { loading.resolve(undefined); });
  const started = Promise.withResolvers<ImportedModuleFetchOptions>();
  vi.spyOn(env, 'fetchSingleImportedModuleScript').mockImplementation((
    _url, fetchClient, destination, _options, _referrer, _request, _complete, performFetch,
  ) => {
    started.resolve({ fetchClient, destination, performFetch: performFetch ?? null });
  });
  const load = vi.spyOn(record, 'loadRequestedModules').mockImplementation((loadDependency) => {
    // Exercise the supplied loader to inspect actual descendant fetch inputs.
    loadDependency.load(record, new ModuleRequest('./dependency.js'), () => {});
    return loading.promise;
  });
  const link = vi.spyOn(record, 'link').mockImplementation(() => {});
  return { env, script, loading, started: started.promise, load, link };
}

function mockCreation(...targets: ReturnType<typeof createModule>[]) {
  return vi.spyOn(scriptClasses, 'JSModuleScript').mockImplementation(function(_source, env, baseURL, options) {
    const target = targets.find((candidate) => candidate.env === env)!;
    target.script.baseURL = baseURL;
    target.script.fetchOptions = options;
    return target.script;
  });
}

function finish(target: ReturnType<typeof createModule>) {
  return runInHostTask(() => {
    target.loading.resolve(undefined);
    target.env.realm.agent.eventLoop.performMicrotaskCheckpoint();
    expect(target.link).toHaveBeenCalledOnce();
  });
}

async function drainEnvironments(environments: Set<BrowletEnvironment>): Promise<void> {
  const owned = [...environments];
  for (const env of owned) env.fetchGroup.terminate();
  // Cancellation queues completion work. Drain it with the original mocks still installed.
  // This is fixture cleanup, not the unfinished HTML Document destruction algorithm.
  do {
    await runInHostTask(() => {
      for (const env of owned) env.responsibleEventLoop.performMicrotaskCheckpoint();
    });
  } while (owned.some((env) => env.fetchGroup.hasPendingFetches() || env.responsibleEventLoop.hasRunnableTasks()));
}

function respond(listener: HTTPTransportListener, status = 200) {
  listener.onHeaders(status, '', new FetchHeaders([['Content-Type', 'text/javascript']]), true);
  listener.onData(utf8Encode('export default 1;'));
  listener.onEnd();
}
