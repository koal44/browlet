import { afterEach, describe, expect, it, vi } from 'vitest';

import { FetchHeaders, FetchResponse } from '../../../src/fetch/index';
import { utf8Encode } from '../../../src/encoding/index';
import { obtainURLOrigin, parseURL, serializeURL } from '../../../src/url/index';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { ContentSecurityPolicy } from '../../../src/browlet/browsing/policy/csp/index';
import { createWorkerEnvironment } from '../../../src/browlet/integration/web-idl/index';
import { ClassicScript, createTaskSource, DedicatedWorkerAgent, ScriptFetchOptions, SharedWorkerAgent } from '../../../src/browlet/scripting/index';
import { fetchClassicWorkerImportedScript, type PerformScriptFetch } from '../../../src/browlet/scripting/script-fetching';
import type { DedicatedWorkerGlobalScope, SecurityPolicyViolationEvent, SharedWorkerGlobalScope } from '../../../src/browlet/platform';
import type { WorkerType } from '../../../src/browlet/workers/index';
import { createManualEventLoop, createManualUserAgent } from '../../support/browlet-agent';
import { runInHostTask } from '../../support/tasks';

afterEach(() => vi.restoreAllMocks());

describe('Worker importScripts (HTML §10.3.1)', () => {
  it.each([false, true])('allows an empty classic-worker import, shared: %s', (shared) => {
    const { scope, env } = createWorker('classic', shared);
    const fetch = vi.spyOn(env, 'fetchClassicWorkerImportedScript');
    expect(scope.importScripts()).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([false, true])('rejects module-worker imports, including an empty list, shared: %s', (shared) => {
    const { scope, env } = createWorker('module', shared);
    const fetch = vi.spyOn(env, 'fetchClassicWorkerImportedScript');
    expect(() => scope.importScripts()).toThrow(env.realm.TypeError);
    expect(() => scope.importScripts('http://[')).toThrow(env.realm.TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('converts every IDL argument before validating URLs, then validates every URL before fetching', () => {
    const { scope, env } = createWorker();
    const fetch = vi.spyOn(env, 'fetchClassicWorkerImportedScript');
    const trace: string[] = [];
    const first = { toString() { trace.push('first'); return 'one.js'; } };
    const second = { toString() { trace.push('second'); return 'http://['; } };
    const third = { toString() { trace.push('third'); return 'three.js'; } };
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Reflect.apply selects valid and invalid receivers explicitly.
    const importScripts = scope.importScripts;
    expect(() => { Reflect.apply(importScripts, scope, [first, second, third]); })
      .toThrow(expect.objectContaining({ name: 'SyntaxError' }));
    expect(trace).toEqual(['first', 'second', 'third']);
    expect(fetch).not.toHaveBeenCalled();
    expect(() => scope.importScripts('http://[')).toThrow(scope.DOMException);
    expect(() => { Reflect.apply(importScripts, {}, []); }).toThrow(env.realm.TypeError);
  });

  it.each([false, true])('queues worker CSP violations without replacing the Trusted Types rejection, shared: %s', (shared) => {
    const { scope, env } = createWorker('classic', shared);
    env.policyContainer.cspList!.policies.push(ContentSecurityPolicy.parse("require-trusted-types-for 'script'", 'header', 'enforce'));
    const events: SecurityPolicyViolationEvent[] = [];
    scope.addEventListener('securitypolicyviolation', (event) => { events.push(event as SecurityPolicyViolationEvent); });
    expect(() => scope.importScripts('import.js')).toThrow(env.realm.TypeError);
    expect(events).toEqual([]);
    env.globalImplementation.url = parseURL('https://worker.test/changed.js').url!;
    expect(env.responsibleEventLoop.runTaskTurn()).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      target: scope, isTrusted: true, bubbles: true, composed: true,
      documentURI: 'https://worker.test/base/worker.js', referrer: '', statusCode: 201,
      effectiveDirective: 'require-trusted-types-for', blockedURI: 'trusted-types-sink', disposition: 'enforce',
    });
  });

  it('applies the Trusted Types sink to all arguments before rejecting a module worker', () => {
    const { scope, env } = createWorker('module');
    env.policyContainer.cspList!.policies.push(ContentSecurityPolicy.parse("require-trusted-types-for 'script'", 'header', 'enforce'));
    expect(() => scope.importScripts('http://[')).toThrow(env.realm.TypeError);
    const calls: unknown[][] = [];
    scope.trustedTypes.createPolicy('default', {
      createScriptURL(input: string, ...args: unknown[]) { calls.push([input, ...args]); return input; },
    });
    expect(() => scope.importScripts('/\uD800.js', 'http://[')).toThrow(env.realm.TypeError);
    expect(calls).toEqual([
      ['/\uFFFD.js', 'TrustedScriptURL', 'WorkerGlobalScope importScripts'],
      ['http://[', 'TrustedScriptURL', 'WorkerGlobalScope importScripts'],
    ]);
  });

  it('accepts TrustedScriptURL without running the default policy', () => {
    const { scope, env } = createWorker();
    env.policyContainer.cspList!.policies.push(ContentSecurityPolicy.parse("require-trusted-types-for 'script'", 'header', 'enforce'));
    scope.trustedTypes.createPolicy('default', { createScriptURL() { throw new Error('default policy ran'); } });
    const trusted = scope.trustedTypes.createPolicy('imports', { createScriptURL: (url) => url });
    expect(() => scope.importScripts(trusted.createScriptURL('http://[')))
      .toThrow(expect.objectContaining({ name: 'SyntaxError' }));
  });

  it('fetches and executes sequentially, including nested imports relative to the worker URL', () => runInHostTask(() => {
    const fixture = createWorker();
    const trace: string[] = [];
    Reflect.set(fixture.env.global, 'trace', trace);
    installSources(fixture, new Map([
      ['nested/first.js', "trace.push('first'); importScripts('child.js');"],
      ['child.js', "trace.push('child'); queueMicrotask(() => trace.push('microtask'));"],
      ['second.js', "trace.push('second');"],
    ]), trace);
    fixture.env.realm.queueGlobalTask(createTaskSource('worker imports test'), {
      run: () => {
        run("importScripts('nested/first.js', 'second.js'); trace.push('returned');", fixture);
      },
    });
    expect(fixture.env.responsibleEventLoop.runTaskTurn()).toBe(true);
    expect(trace).toEqual([
      'fetch:nested/first.js', 'first', 'fetch:child.js', 'child',
      'fetch:second.js', 'second', 'returned', 'microtask',
    ]);
  }));

  it.each(['throw marker;', 'let = ;'])('stops fetching after an imported script fails: %s', (source) => runInHostTask(() => {
    const fixture = createWorker();
    const trace: string[] = [];
    const marker = {};
    Reflect.set(fixture.env.global, 'marker', marker);
    installSources(fixture, new Map([['first.js', source], ['second.js', '']]), trace);
    if (source === 'throw marker;') {
      let caught: unknown;
      try { run("importScripts('first.js', 'second.js');", fixture); } catch (error) { caught = error; }
      expect(caught).toBe(marker);
    } else {
      expect(() => run("importScripts('first.js', 'second.js');", fixture)).toThrow(fixture.env.realm.SyntaxError);
    }
    expect(trace).toEqual(['fetch:first.js']);
  }));

  it('uses the invoked method environment for resolution and the receiver environment for Trusted Types', () => {
    const first = createWorker('classic', false, 'https://first.test/base/worker.js');
    const second = createWorker('classic', false, 'https://second.test/other/worker.js');
    second.env.policyContainer.cspList!.policies.push(ContentSecurityPolicy.parse("require-trusted-types-for 'script'", 'header', 'enforce'));
    const calls: string[] = [];
    second.scope.trustedTypes.createPolicy('default', { createScriptURL(input) { calls.push(input); return input; } });
    const fetch = vi.spyOn(first.env, 'fetchClassicWorkerImportedScript').mockImplementation((url) => {
      expect(serializeURL(url)).toBe('https://first.test/base/dep.js');
      return new ClassicScript('', first.env, url, new ScriptFetchOptions());
    });
    first.scope.importScripts.call(second.scope, 'dep.js');
    expect(calls).toEqual(['dep.js']);
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe('Classic worker-imported script responses (HTML §8.1.4.2)', () => {
  it('builds the default request, decodes UTF-8, and accepts an empty script', () => {
    const { env } = createWorker();
    const url = env.encodingParseURL('import.js')!;
    const hook: PerformScriptFetch = (request, isTopLevel, complete) => {
      expect(request.client).toBe(env);
      expect(request).toMatchObject({
        destination: 'script', initiatorType: 'other', mode: 'no-cors',
        credentialsMode: 'same-origin', parserInserted: false, useURLCredentials: true,
      });
      expect(isTopLevel).toBe(true);
      complete(response('https://worker.test/final.js', 'text/javascript;charset=windows-1252'), utf8Encode('\uFEFFglobalThis.value = "é";'));
    };
    const script = fetchClassicWorkerImportedScript(url, env, hook);
    expect(serializeURL(script.baseURL!)).toBe('https://worker.test/final.js');
    script.run(true);
    expect(Reflect.get(env.global, 'value')).toBe('é');
    expect(fetchClassicWorkerImportedScript(url, env, (_request, _top, complete) => {
      complete(response(serializeURL(url)), new Uint8Array());
    }).errorToRethrow).toBeNull();
  });

  it.each([
    { name: 'null body', status: 200, mime: 'text/javascript', body: null },
    { name: 'body failure', status: 200, mime: 'text/javascript', body: 'failure' },
    { name: 'non-ok status', status: 404, mime: 'text/javascript', body: new Uint8Array() },
    { name: 'missing MIME', status: 200, mime: null, body: new Uint8Array() },
    { name: 'non-JavaScript MIME', status: 200, mime: 'text/plain', body: new Uint8Array() },
  ] satisfies { name: string; status: number; mime: string | null; body: Uint8Array | null | 'failure'; }[])(
    'throws NetworkError for $name', ({ status, mime, body }) => {
      const { env } = createWorker();
      const url = env.encodingParseURL('import.js')!;
      expect(() => fetchClassicWorkerImportedScript(url, env, (_request, _top, complete) => {
        const res = response(serializeURL(url), mime);
        res.status = status;
        complete(res, body);
      })).toThrow(expect.objectContaining({ name: 'NetworkError' }));
    },
  );

  it.each(['data:text/plain,', 'blob:https://worker.test/identity'])('requires JavaScript MIME for %s too', (input) => {
    const { env } = createWorker();
    const url = parseURL(input).url!;
    expect(() => fetchClassicWorkerImportedScript(url, env, (_request, _top, complete) => {
      complete(response(input, 'text/plain'), new Uint8Array());
    })).toThrow(expect.objectContaining({ name: 'NetworkError' }));
  });

  it.each(['basic', 'cors', 'opaque'] as const)('preserves %s response error visibility', (type) => {
    const { env } = createWorker();
    const url = env.encodingParseURL('import.js')!;
    const script = fetchClassicWorkerImportedScript(url, env, (_request, _top, complete) => {
      complete(response('https://other.test/import.js').filter(type), utf8Encode('throw new Error("private detail");'));
    });
    expect(script.mutedErrors).toBe(type === 'opaque');
    expect(() => script.run(true)).toThrow(type === 'opaque'
      ? expect.objectContaining({ name: 'NetworkError', message: '' })
      : 'private detail');
  });

  it('keeps ordinary Fetch and asynchronous hooks at the explicit synchronous-wait boundary', () => {
    const { env, scope } = createWorker();
    expect(() => scope.importScripts('import.js')).toThrow('requires synchronous pause');
    const hook = vi.fn<PerformScriptFetch>();
    expect(() => env.fetchClassicWorkerImportedScript(env.encodingParseURL('import.js')!, hook))
      .toThrow('requires synchronous pause');
    expect(hook).toHaveBeenCalledOnce();
  });
});

/** Real worker bindings/settings; synchronous response hooks deliberately replace the unfinished transport. */
function createWorker(type: WorkerType = 'classic', shared = false, input = 'https://worker.test/base/worker.js') {
  const traversable = TopLevelTraversable.create(createManualUserAgent(), null, '');
  const outsideEnv = traversable.activeWindow!.env;
  const document = traversable.activeDocument!;
  document.url = parseURL('https://worker.test/page').url!;
  document.origin = obtainURLOrigin(document.url);
  const agent = shared ? new SharedWorkerAgent(createManualEventLoop()) : new DedicatedWorkerAgent(createManualEventLoop());
  outsideEnv.realm.agent.agentCluster!.add(agent);
  const env = createWorkerEnvironment({
    agent, outsideEnv, url: parseURL(input).url!, unsafeWorkerCreationTime: 1234,
    type, name: '', credentials: 'same-origin', extendedLifetime: false,
  });
  const rootResponse = response(input);
  rootResponse.status = 201;
  env.globalImplementation.initializePolicyContainer(rootResponse, env);
  env.globalImplementation.initializeScriptResponse({
    response: rootResponse, bodyBytes: new Uint8Array(), policyContainer: env.policyContainer,
    embedderPolicyAllowed: true, outsideCrossOriginIsolatedCapability: false,
  });
  const scope = env.global as unknown as DedicatedWorkerGlobalScope | SharedWorkerGlobalScope;
  return { env, scope };
}

/** Supply completed source bytes through HTML's existing fetch hook, retaining the real parser/evaluator. */
function installSources({ env }: ReturnType<typeof createWorker>, sources: Map<string, string>, trace: string[]) {
  vi.spyOn(env, 'fetchClassicWorkerImportedScript').mockImplementation((url) => fetchClassicWorkerImportedScript(url, env, (_request, _top, complete) => {
    const name = serializeURL(url).slice('https://worker.test/base/'.length);
    trace.push(`fetch:${name}`);
    const source = sources.get(name);
    if (source === undefined) throw new Error(`Unexpected import ${name}`);
    complete(response(serializeURL(url)), utf8Encode(source));
  }));
}

/** Invoke importScripts from a running classic script so nested cleanup preserves checkpoint ordering. */
function run(source: string, { env }: ReturnType<typeof createWorker>) {
  return new ClassicScript(source, env, env.apiBaseURL, new ScriptFetchOptions()).run(true);
}

/** A consumed response whose backing URL and MIME remain available under filtered views. */
function response(input: string, mime: string | null = 'text/javascript') {
  const res = new FetchResponse();
  res.urlList = [parseURL(input).url!];
  res.headerList = new FetchHeaders(mime === null ? [] : [['Content-Type', mime]]);
  return res;
}
