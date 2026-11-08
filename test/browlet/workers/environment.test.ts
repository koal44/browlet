import { describe, expect, it } from 'vitest';

import { createOpaqueOrigin, obtainURLOrigin, parseURL, serializeURL } from '../../../src/url/index';
import { BlobImpl } from '../../../src/file/index';
import { StorageKey } from '../../../src/storage/index';
import { FetchTimingInfo, ResponseBodyInfo } from '../../../src/fetch/timing';
import { BrowsingContext, Navigable, TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { DocumentState } from '../../../src/browlet/browsing/navigation/state/index';
import { PolicyContainer } from '../../../src/browlet/browsing/policy/index';
import type { BrowletEnvironment } from '../../../src/browlet/environment/index';
import { createWindowEnvironment, createWorkerEnvironment } from '../../../src/browlet/integration/web-idl/index';
import { PerformanceImpl } from '../../../src/browlet/performance/index';
import {
  AgentCluster, createTaskSource, DedicatedWorkerAgent, SharedWorkerAgent, WindowAgent,
} from '../../../src/browlet/scripting/index';
import { UnsafeMoment, monotonicClock } from '../../../src/timing/index';
import { UserAgent } from '../../../src/browlet/user-agent';
import { DedicatedWorkerGlobalImpl, SharedWorkerGlobalImpl } from '../../../src/browlet/workers/index';
import type { DedicatedWorkerGlobalScope, SharedWorkerGlobalScope, Performance, PerformanceEntry } from '../../../src/browlet/platform';
import { createManualEventLoop, createManualUserAgent } from '../../support/browlet-agent';
import { getBindingContext } from '../../support/browlet-binding';

describe('Worker realm and settings setup (HTML §10.2.4 and §10.2.6.2)', () => {
  it.each([false, true])('composes the %s shared global with its own realm, resources, and initial owner', (shared) => {
    const outsideEnv = createOutsideEnvironment();
    const env = createWorker(outsideEnv, shared);
    const global = env.globalImplementation;
    const scope = env.global as unknown as DedicatedWorkerGlobalScope | SharedWorkerGlobalScope;
    expect(global).toBeInstanceOf(shared ? SharedWorkerGlobalImpl : DedicatedWorkerGlobalImpl);
    expect(env.realm.agent).toBeInstanceOf(shared ? SharedWorkerAgent : DedicatedWorkerAgent);
    expect((env.realm.agent as DedicatedWorkerAgent | SharedWorkerAgent).globalScope).toBe(global);
    expect(env.realm.env).toBe(env);
    expect(env.realm.baseEnv).toBe(env);
    expect(env.realmExecutionContext).toBe(env.realm.executionContext);
    expect(env.realmExecutionContext.realm).toBe(env.realm);
    expect(env.realm.globalNames).toEqual(new Set(['Worker', shared ? 'SharedWorker' : 'DedicatedWorker']));
    expect(global.ownerSet.size).toBe(1);
    expect(global.ownerSet.has(outsideEnv.window.document)).toBe(true);
    expect(env.realm.agent.agentCluster === outsideEnv.realm.agent.agentCluster).toBe(!shared);
    expect(scope.self).toBe(scope);
    expect(scope.name).toBe('test worker');
    expect(scope.location.href).toBe('https://creator.test/worker.js');
    expect(scope.navigator).toBe(scope.navigator);
    expect(Reflect.has(scope, 'document')).toBe(false);
    expect(Reflect.has(scope, 'Window')).toBe(false);
    expect(env.getAssociatedDocument()).toBeNull();
    expect(env.getWindowOrWorkerGlobalScopeMixin()).not.toBe(outsideEnv.getWindowOrWorkerGlobalScopeMixin());
    expect(env.id).not.toBe(outsideEnv.id);
    expect(env.executionReady).toBe(false);
    expect(env.discarded).toBe(false);
    expect(env.targetBrowsingContext).toBeNull();
    expect(env.activeServiceWorker).toBeNull();
    expect(env.topLevelCreationURL).toBeNull();
    expect(env.topLevelOrigin).toBe(outsideEnv.topLevelOrigin);
    expect(env.origin).toBe(outsideEnv.origin);
    expect(env.isSecureContext).toBe(true);
    if (global instanceof DedicatedWorkerGlobalImpl) expect(global.ports).toEqual([]);
    else expect(global).toMatchObject({ type: 'module', credentials: 'include', extendedLifetime: true });
  });

  it.each([false, true])('retains Blob registrations at parse time when the browser store is local, shared: %s', (shared) => {
    const outsideEnv = createOutsideEnvironment();
    const env = createWorker(outsideEnv, shared);
    const store = outsideEnv.userAgent.blobURLStore;
    const url = store.add(new BlobImpl(['export {};'], { type: 'text/javascript' }, outsideEnv), outsideEnv);
    const outside = outsideEnv.parseURL(url)!;
    const inside = env.parseURL(`${url}#module`)!;
    expect(outside.blobURLEntry).not.toBeNull();
    expect(inside.blobURLEntry).toBe(outside.blobURLEntry);
    expect(serializeURL(inside)).toBe(`${url}#module`);

    store.remove(url);
    expect(inside.blobURLEntry).toBe(outside.blobURLEntry);
    expect(env.parseURL(url)!.blobURLEntry).toBeNull();
    expect(outsideEnv.parseURL(url)!.blobURLEntry).toBeNull();
  });

  it('takes shared-worker identity from its creator, separately from its script URL', () => {
    const outsideEnv = createOutsideEnvironment();
    const env = createWorker(outsideEnv, true, 'https://scripts.test/shared.js');
    const global = env.globalImplementation as SharedWorkerGlobalImpl;
    expect(global.constructorStorageKey.equals(StorageKey.obtainForNonStoragePurposes(outsideEnv))).toBe(true);
    expect(serializeURL(global.constructorURL)).toBe('https://scripts.test/shared.js');
    expect(env.origin).toBe(outsideEnv.origin);
    // Fetch/constructor admission, including same-origin checks, is deliberately not this setup helper's job.
  });

  it.each([false, true])('keeps creator-derived settings when the creating Window replaces its Document, shared: %s', (shared) => {
    const outsideEnv = createOutsideEnvironment();
    const originalOrigin = outsideEnv.origin;
    const originalTopLevelOrigin = outsideEnv.topLevelOrigin;
    const document = outsideEnv.window.document;
    const env = createWorker(outsideEnv, shared);
    const replacement = outsideEnv.createDocument();
    replacement.origin = createOpaqueOrigin();
    outsideEnv.window.setAssociatedDocument(replacement);
    outsideEnv.topLevelOrigin = replacement.origin;
    expect(env.origin).toBe(originalOrigin);
    expect(env.topLevelOrigin).toBe(originalTopLevelOrigin);
    expect(env.globalImplementation.ownerSet.size).toBe(1);
    expect(env.globalImplementation.ownerSet.has(document)).toBe(true);
  });

  it.each([
    ['https://creator.test/', false],
    ['https://sub.creator.test/', false],
    ['https://other.test/', true],
    ['http://creator.test/', true],
  ] as const)('inherits cookie-site ancestry from a creating frame at %s', (frameURL, crossSite) => {
    const userAgent = createManualUserAgent();
    const parent = TopLevelTraversable.create(userAgent, null, '');
    parent.activeDocument!.origin = obtainURLOrigin(parseURL('https://creator.test/').url!);
    const [, document] = BrowsingContext.createTopLevel(userAgent);
    document.origin = obtainURLOrigin(parseURL(frameURL).url!);
    const child = new Navigable(DocumentState.create(document), parent);
    expect(document.getNodeNavigable()).toBe(child);
    expect(document.env.hasCrossSiteAncestor).toBe(crossSite);

    for (const shared of [false, true]) {
      const env = createWorker(document.env, shared);
      expect(env.hasCrossSiteAncestor).toBe(crossSite);
      const nested = createWorker(env);
      expect(nested.hasCrossSiteAncestor).toBe(crossSite);
    }
  });

  it.each([false, true])('treats data workers as cross-site even for a top-level creator, shared: %s', (shared) => {
    const outsideEnv = TopLevelTraversable.create(createManualUserAgent(), null, '').activeWindow!.env;
    expect(outsideEnv.hasCrossSiteAncestor).toBe(false);
    const ordinary = createWorker(outsideEnv, shared);
    const data = createWorker(outsideEnv, shared, 'data:text/javascript,');
    expect(ordinary.hasCrossSiteAncestor).toBe(false);
    expect(data.hasCrossSiteAncestor).toBe(true);
    expect(data.origin).not.toBe(outsideEnv.origin);
  });

  it.each([false, true])('gives a data URL its own opaque origin and cross-site ancestry, shared: %s', (shared) => {
    const outsideEnv = createOutsideEnvironment();
    const first = createWorker(outsideEnv, shared, 'data:text/javascript,');
    const second = createWorker(outsideEnv, shared, 'data:text/javascript,');
    expect(first.origin.kind).toBe('opaque');
    expect(first.origin).not.toBe(second.origin);
    expect(first.origin).not.toBe(outsideEnv.origin);
    expect(first.hasCrossSiteAncestor).toBe(true);
    expect(first.isSecureContext).toBe(true);
    expect(first.topLevelOrigin).toBe(outsideEnv.topLevelOrigin);
  });

  it('inherits security from the owner rather than upgrading it because the script URL uses HTTPS', () => {
    const outsideEnv = createOutsideEnvironment('http://creator.test/');
    const env = createWorker(outsideEnv, false, 'https://scripts.test/worker.js');
    expect(outsideEnv.isSecureContext).toBe(false);
    expect(env.isSecureContext).toBe(false);
  });

  it('uses the creating worker as a nested owner and preserves its inherited settings', () => {
    const parent = createWorker(createOutsideEnvironment(), false, 'data:text/javascript,');
    const child = createWorker(parent);
    expect(child.globalImplementation.ownerSet.size).toBe(1);
    expect(child.globalImplementation.ownerSet.has(parent.globalImplementation)).toBe(true);
    expect(child.origin).toBe(parent.origin);
    expect(child.hasCrossSiteAncestor).toBe(true);
    expect(child.isSecureContext).toBe(parent.isSecureContext);
    expect(child.topLevelOrigin).toBe(parent.topLevelOrigin);
    expect(child.moduleMap).not.toBe(parent.moduleMap);
    expect(child.getWindowOrWorkerGlobalScopeMixin()).not.toBe(parent.getWindowOrWorkerGlobalScopeMixin());
  });

  it('reads response-dependent URL, policy, module-map, and isolation state from the global', () => {
    const env = createWorker(createOutsideEnvironment());
    const global = env.globalImplementation;
    const initialOrigin = env.origin;
    const responseURL = parseURL('https://creator.test/redirected.js').url!;
    const policy = new PolicyContainer();
    global.url = responseURL;
    env.creationURL = responseURL;
    global.policyContainer = policy;
    global.crossOriginIsolatedCapability = true;
    expect(env.apiBaseURL).toBe(responseURL);
    expect(env.getReferrerSource()).toBe(responseURL);
    expect(env.getReportingSource()).toBe(responseURL);
    expect(env.policyContainer).toBe(policy);
    expect(env.moduleMap).toBe(global.moduleMap);
    expect(env.crossOriginIsolatedCapability).toBe(true);
    expect(env.origin).toBe(initialOrigin);
  });

  it('coarsens the original creation time using the worker capability without reading a new creation time', () => {
    const env = createWorker(createOutsideEnvironment());
    const input = new UnsafeMoment(monotonicClock, 1234.56789);
    expect(env.timeOrigin).toEqual(input.coarsen(false));
    env.globalImplementation.crossOriginIsolatedCapability = true;
    expect(env.timeOrigin).toEqual(input.coarsen(true));
  });

  it('routes a global event through the worker loop and its callback settings', () => {
    const outsideEnv = createOutsideEnvironment();
    const env = createWorker(outsideEnv);
    const scope = env.global as unknown as DedicatedWorkerGlobalScope;
    const called: boolean[] = [];
    scope.addEventListener('probe', () => {
      called.push(env.responsibleEventLoop.getIncumbentEnvironment() === env);
    });
    env.realm.queueGlobalTask(createTaskSource('worker setup probe'), () => {
      env.globalImplementation.fireEvent('probe');
    });
    expect(called).toEqual([]);
    expect(outsideEnv.responsibleEventLoop.hasRunnableTasks()).toBe(false);
    expect(env.responsibleEventLoop.runTaskTurn()).toBe(true);
    expect(called).toEqual([true]);
    expect(env.responsibleEventLoop.executionContextStack).toEqual([]);
    expect(env.responsibleEventLoop.backupIncumbentEnvironmentStack).toEqual([]);
  });

  it.each([false, true])('owns resource timing and observer delivery in the worker realm, shared: %s', (shared) => {
    const outsideEnv = createOutsideEnvironment();
    const env = createWorker(outsideEnv, shared);
    const scope = env.global as unknown as DedicatedWorkerGlobalScope | SharedWorkerGlobalScope;
    // Public worker-global forwarding remains §10.3 work; exercise the retained owner's actual binding.
    const performance = getBindingContext(env.realm).project(PerformanceImpl, env.getWindowOrWorkerGlobalScopeMixin().performance) as Performance;
    const received: PerformanceEntry[] = [];
    const callbackOwners: boolean[] = [];
    const observer = new scope.PerformanceObserver((list) => {
      expect(list).toBeInstanceOf(scope.PerformanceObserverEntryList);
      received.push(...list.getEntries());
      callbackOwners.push(env.responsibleEventLoop.getIncumbentEnvironment() === env);
    });
    observer.observe({ type: 'resource' });
    expect(scope.PerformanceObserver.supportedEntryTypes).toEqual(['resource']);
    expect(performance.timeOrigin).toBe(env.getTimeOriginTimestamp().toTimestamp());

    // Supply completed Fetch measurements; actual worker startup/Fetch transport remains separate.
    const timing = new FetchTimingInfo();
    timing.startTime = env.timeOrigin.milliseconds + 10;
    timing.endTime = env.timeOrigin.milliseconds + 30;
    env.markResourceTiming(timing, parseURL('https://creator.test/resource').url!, 'fetch', undefined, new ResponseBodyInfo(), 200, true);
    const entry = performance.getEntriesByType('resource')[0]!;
    expect(entry).toBeInstanceOf(scope.PerformanceResourceTiming);
    expect(entry).toMatchObject({ startTime: 10, duration: 20, navigationId: 0 });
    expect(received).toEqual([]);
    expect(outsideEnv.responsibleEventLoop.hasRunnableTasks()).toBe(false);
    expect(env.responsibleEventLoop.runTaskTurn()).toBe(true);
    expect(received).toEqual([entry]);
    expect(callbackOwners).toEqual([true]);
    observer.disconnect();
  });
});

/** Exercise settings composition without claiming a worker thread, fetch, or running script. */
function createWorker(outsideEnv: BrowletEnvironment, shared = false, scriptURL = 'https://creator.test/worker.js') {
  const agent = outsideEnv.userAgent.obtainDedicatedOrSharedWorkerAgent(outsideEnv, shared);
  if (!(agent instanceof DedicatedWorkerAgent || agent instanceof SharedWorkerAgent)) {
    throw new Error('Expected a dedicated or shared worker agent');
  }
  return createWorkerEnvironment({
    agent, outsideEnv, url: parseURL(scriptURL).url!, unsafeWorkerCreationTime: 1234.56789,
    type: 'module', name: 'test worker', credentials: 'include', extendedLifetime: shared,
  });
}

/** A Window with real settings and a Document, without navigation or a network request. */
function createOutsideEnvironment(url = 'https://creator.test/') {
  const userAgent = new UserAgent();
  const agent = new WindowAgent(createManualEventLoop());
  new AgentCluster().add(agent);
  const creationURL = parseURL(url).url!;
  const origin = obtainURLOrigin(creationURL);
  const env = createWindowEnvironment({
    agent, userAgent, creationURL, origin, parent: null,
    topLevelCreationURL: creationURL, topLevelOrigin: origin,
  });
  const document = env.createDocument();
  document.origin = origin;
  document.url = creationURL;
  env.window.setAssociatedDocument(document);
  return env;
}
