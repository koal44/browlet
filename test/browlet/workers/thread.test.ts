import { EventEmitter, once } from 'node:events';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { threadId, type WorkerOptions } from 'node:worker_threads';
import type * as WorkerThreads from 'node:worker_threads';
import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest';

import { addon, type JSThreadExit } from '../../../src/js-engine/index';
import { utf8Encode } from '../../../src/encoding/index';
import { BlobData, BlobImpl } from '../../../src/file/index';
import { FetchHeaders, type FetchRequest } from '../../../src/fetch/index';
import {
  WorkerThread, queueNodeTask, type WorkerThreadInitialization, type CreatorEnvironmentSnapshot,
} from '../../../src/browlet/integration/host/index';
import { createWindowEnvironment, createWorkerEnvironment } from '../../../src/browlet/integration/web-idl/index';
import type { BrowletEnvironment } from '../../../src/browlet/environment/index';
import { AgentCluster, DedicatedWorkerAgent, EventLoop, WindowAgent, createTaskSource } from '../../../src/browlet/scripting/index';
import { UserAgent } from '../../../src/browlet/user-agent';
import { PolicyContainer } from '../../../src/browlet/browsing/policy/index';
import { ContentSecurityPolicy, CSPList } from '../../../src/browlet/browsing/policy/csp/index';
import {
  areSameOrigin, copyOrigin, createOpaqueOrigin, obtainURLOrigin, parseURL, serializeOrigin, serializeURL,
  type Origin,
} from '../../../src/url/index';
import { createManualEventLoop } from '../../support/browlet-agent';
import { mockHTTPTransport } from '../../fetch/transport-fixture';

// Production owns a fixed entry. Redirect only the native loader in these
// lifecycle tests so the fixture can block or fail without production commands.
// The real JSThread still performs execution, cloning, and teardown.
const entry = vi.hoisted((): { path: string; worker: WorkerThreads.Worker | null; } => ({ path: '', worker: null }));
vi.mock('node:worker_threads', async (importOriginal) => {
  const original = await importOriginal<typeof WorkerThreads>();
  return {
    ...original,
    Worker: class extends original.Worker {
      constructor(_entryPath: string, options: WorkerOptions) {
        // Retarget the marker too: importing the source adapter in the fixture
        // must not also start its production runtime.
        super(entry.path, {
          ...options,
          workerData: { ...options.workerData as object, jsThreadEntry: pathToFileURL(entry.path).href },
        });
        entry.worker = this;
      }
    },
  };
});
const threads = new Set<WorkerThread>();

beforeEach(() => {
  entry.path = resolve(__dirname, 'fixtures/thread.cjs');
  entry.worker = null;
});

afterEach(async () => {
  await Promise.all([...threads].map((thread) => thread.terminate()));
  threads.clear();
  vi.restoreAllMocks();
});

// Each entry loads the production TypeScript graph in a fresh isolate. Allow for
// that source-fixture overhead; native startup and all waits remain bounded.
describe('Worker isolate startup host', { timeout: 30_000 }, () => {
  it.each(['dedicated', 'shared'] as const)('starts a %s agent and its real task loop in another isolate', async (kind) => {
    const { thread, request } = createThread({ kind, data: {} });
    await thread.ready;
    const result = await request({ type: 'inspect' });
    expect(result).toMatchObject({
      isMainThread: false, pid: process.pid, kind, canBlock: true,
      hasEnvironment: false, ownsTask: true, separateRealm: true,
      addon: typeof addon.createContextHandle === 'function', nodeBase: process.env.NODE_BASE,
    });
    expect((result as { threadId: number; }).threadId).not.toBe(threadId);
  });

  it('clones startup data without sharing ordinary creator objects', async () => {
    const data = { nested: { value: 17 } };
    const { thread, request } = createThread({ kind: 'dedicated', data });
    data.nested.value = 29;
    await thread.ready;
    expect(await request({ type: 'inspect' })).toMatchObject({ data: { nested: { value: 17 } } });
    expect(data.nested.value).toBe(29);
  });

  it('observes internal lifecycle completion without advancing the creator event loop', async () => {
    const creatorEnv = createCreatorEnvironment();
    const checkpoint = vi.spyOn(creatorEnv.realm.agent.eventLoop, 'performMicrotaskCheckpoint');
    const { thread } = createThread({ kind: 'dedicated', data: {}, creatorEnv });
    const trace: string[] = [];
    await new Promise<void>((resolveReady, rejectReady) => {
      thread.ready.observe(() => { trace.push('ready'); resolveReady(); }, rejectReady);
    });
    const completion = thread.terminate();
    expect(completion).toBe(thread.closed);
    const exit = await new Promise<JSThreadExit>((resolveExit, rejectExit) => {
      completion.observe((result) => { trace.push('closed'); resolveExit(result); }, rejectExit);
    });
    expect(exit).toEqual({ code: 1, error: undefined, terminated: true });
    expect(trace).toEqual(['ready', 'closed']);
    expect(checkpoint).not.toHaveBeenCalled();
    expect(await thread.closed).toBe(exit);
    expect(thread.terminate()).toBe(completion);
  });

  it('propagates a native termination failure through the shared internal completion', async () => {
    const { thread } = createThread();
    await thread.ready;
    assert(entry.worker !== null);
    const nativeThread = entry.worker;
    const failure = new Error('Native termination failed');
    const terminate = vi.spyOn(nativeThread, 'terminate').mockRejectedValueOnce(failure);
    try {
      const completion = thread.terminate();
      expect(completion).toBe(thread.closed);
      await expect(completion).rejects.toBe(failure);
      expect(thread.terminate()).toBe(completion);
      expect(terminate).toHaveBeenCalledOnce();
    } finally {
      // The injected failure leaves the real isolate running. Stop it through
      // Node after observing the rejected host completion.
      terminate.mockRestore();
      await nativeThread.terminate();
      threads.delete(thread);
    }
  });

  it('keeps control-looking values inside the message payload in both directions', async () => {
    const { thread, request } = createThread();
    await thread.ready;
    const data = { type: 'script-response', snapshot: { type: 'ready' } };
    expect(await request({ type: 'echo', data })).toEqual(data);
  });

  it('diagnoses unknown output kinds instead of delivering them as host data', async () => {
    const { thread, request } = createThread();
    await thread.ready;
    assert(entry.worker !== null);
    const nativeThread = entry.worker;
    // Inject at the native receive boundary so the synchronous host error is
    // observable here rather than an uncaught error from Node's event loop.
    for (const message of [{ type: 'unexpected', data: 42 }, {}]) {
      expect(() => nativeThread.emit('message', message)).toThrow('Unknown worker thread output message kind');
    }
    expect(await request({ type: 'echo', data: 42 })).toBe(42);
  });

  it.each(['dedicated', 'shared'] as const)('fetches a %s script through creator stores and delivers it on the worker networking queue', async (kind) => {
    const creatorEnv = createCreatorEnvironment();
    creatorEnv.userAgent.cookieStore.parseAndStoreCookie(
      'session=creator; Secure; SameSite=None', true, { kind: 'domain', value: 'creator.test' }, [''], true, false, true,
    );
    const source = 'globalThis.scriptRan = true;';
    const requests: { cookie: string | null; destination: string | null; }[] = [];
    const transport = mockHTTPTransport(creatorEnv.userAgent, (request, listener) => {
      requests.push({ cookie: request.headers.get('Cookie'), destination: request.headers.get('Sec-Fetch-Dest') });
      if (serializeURL(request.url).endsWith('/worker.js')) {
        listener.onHeaders(302, '', new FetchHeaders([['Location', '/final.js']]), false);
      } else {
        listener.onHeaders(200, 'OK', new FetchHeaders([
          ['Content-Type', 'text/javascript'], ['Content-Security-Policy', "script-src 'none'"],
          ['Set-Cookie', 'loaded=yes; Secure; SameSite=None'],
        ]), true);
        listener.onData(utf8Encode(source));
      }
      listener.onEnd();
    });
    const { thread, fetchScript } = createThread({ kind, data: {}, creatorEnv });
    await thread.ready;
    // The creator's manual event loop never advances. Fetch must not depend on
    // its Document being runnable to hand the response to the worker's loop.
    const destination = kind === 'shared' ? 'sharedworker' : 'worker';
    const result = await fetchScript(createScriptRequest(creatorEnv, 'https://creator.test/worker.js', destination));
    expect(result).toMatchObject({
      ownsNetworkingTask: true, type: 'default', status: 200, statusMessage: 'OK',
      urls: ['https://creator.test/worker.js', 'https://creator.test/final.js'],
      bodyBytes: utf8Encode(source), blobPolicyContainer: null, scriptRan: false,
    });
    expect((result as { headers: [string, string][]; }).headers).toContainEqual(['Content-Security-Policy', "script-src 'none'"]);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(requests).toEqual([
      { cookie: 'session=creator', destination }, { cookie: 'session=creator', destination },
    ]);
    expect([...creatorEnv.userAgent.cookieStore.cookies].map(({ name, value }) => [name, value])).toContainEqual(['loaded', 'yes']);
  });

  it('enforces the creator CSP before network dispatch', async () => {
    const creatorEnv = createCreatorEnvironment();
    creatorEnv.policyContainer.cspList = new CSPList(creatorEnv.origin);
    creatorEnv.policyContainer.cspList.policies.push(ContentSecurityPolicy.parse("worker-src 'none'", 'header', 'enforce'));
    const transport = mockHTTPTransport(creatorEnv.userAgent, () => { throw new Error('Blocked request reached HTTP'); });
    const { thread, fetchScript } = createThread({ kind: 'dedicated', data: {}, creatorEnv });
    await thread.ready;
    expect(await fetchScript(createScriptRequest(creatorEnv))).toMatchObject({
      ownsNetworkingTask: true, type: 'error', status: 0, bodyBytes: null,
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it('carries captured Blob bytes and creator policies without transporting the live registration', async () => {
    const creatorEnv = createCreatorEnvironment();
    creatorEnv.policyContainer.referrerPolicy = 'no-referrer';
    const blobCreator = createCreatorEnvironment('https://creator.test/other', creatorEnv.userAgent);
    blobCreator.policyContainer.referrerPolicy = 'origin';
    const policies = blobCreator.policyContainer.toSnapshot();
    const source = 'globalThis.scriptRan = true;';
    const store = creatorEnv.userAgent.blobURLStore;
    const url = store.add(new BlobImpl([source], { type: 'text/javascript' }, blobCreator), blobCreator);
    const captured = createScriptRequest(creatorEnv, url);
    store.revoke(url, creatorEnv);
    const { thread, fetchScript } = createThread({ kind: 'dedicated', data: {}, creatorEnv });
    await thread.ready;
    expect(await fetchScript(captured)).toMatchObject({
      ownsNetworkingTask: true, status: 200, urls: [url], hasBlobEntry: false,
      bodyBytes: utf8Encode(source), blobPolicyContainer: policies, scriptRan: false,
    });
    // A newly parsed URL cannot reacquire the revoked registration.
    expect(await fetchScript(createScriptRequest(creatorEnv, url))).toMatchObject({ type: 'error', status: 0 });
  });

  it.each(['network', 'empty'] as const)('preserves %s failure or absence rather than inventing script bytes', async (kind) => {
    const creatorEnv = createCreatorEnvironment();
    mockHTTPTransport(creatorEnv.userAgent, (_request, listener) => {
      if (kind === 'network') { listener.onError(new Error('network failed')); return; }
      listener.onHeaders(204, '', new FetchHeaders([['Content-Type', 'text/javascript']]), false);
      listener.onEnd();
    });
    const { thread, fetchScript } = createThread({ kind: 'dedicated', data: {}, creatorEnv });
    await thread.ready;
    expect(await fetchScript(createScriptRequest(creatorEnv))).toMatchObject({
      ownsNetworkingTask: true,
      status: kind === 'network' ? 0 : 204, bodyBytes: null,
    });
  });

  it('preserves a body read failure separately from a network error or an absent body', async () => {
    const creatorEnv = createCreatorEnvironment();
    const data = BlobData.fromSource({
      size: 3, snapshotState: undefined, read: () => Promise.reject(new Error('unreadable Blob source')),
    });
    const blob = BlobImpl.create(data, 'text/javascript', undefined, creatorEnv);
    const url = creatorEnv.userAgent.blobURLStore.add(blob, creatorEnv);
    const { thread, fetchScript } = createThread({ kind: 'dedicated', data: {}, creatorEnv });
    await thread.ready;
    expect(await fetchScript(createScriptRequest(creatorEnv, url))).toMatchObject({
      ownsNetworkingTask: true, type: 'default', status: 200, bodyBytes: 'failure',
    });
  });

  it.each(['terminated', 'failed'] as const)('cancels a pending script fetch when its worker is %s', async (outcome) => {
    const creatorEnv = createCreatorEnvironment();
    const dispatched = Promise.withResolvers<void>();
    const abort = vi.fn();
    vi.spyOn(creatorEnv.userAgent.httpTransport, 'dispatch').mockImplementation(() => {
      dispatched.resolve();
      return { pause() {}, resume() {}, abort };
    });
    const { thread } = createThread({ kind: 'dedicated', data: {}, creatorEnv });
    await thread.ready;
    thread.fetchScript(createScriptRequest(creatorEnv));
    expect(() => thread.fetchScript(createScriptRequest(creatorEnv))).toThrow('already pending');
    await dispatched.promise;
    if (outcome === 'terminated') {
      await thread.terminate();
    } else {
      thread.send({ type: 'fail' });
      await thread.closed;
    }
    expect(abort).toHaveBeenCalledOnce();
    expect(() => thread.fetchScript(createScriptRequest(creatorEnv))).toThrow('not running');
  });

  it('rejects closed when local fetch cleanup fails after native exit', async () => {
    const creatorEnv = createCreatorEnvironment();
    const dispatched = Promise.withResolvers<void>();
    const failure = new Error('Fetch cleanup failed');
    const abort = vi.fn(() => { throw failure; });
    vi.spyOn(creatorEnv.userAgent.httpTransport, 'dispatch').mockImplementation(() => {
      dispatched.resolve();
      return { pause() {}, resume() {}, abort };
    });
    const { thread } = createThread({ kind: 'dedicated', data: {}, creatorEnv });
    await thread.ready;
    assert(entry.worker !== null);
    const nativeThread = entry.worker;
    try {
      thread.fetchScript(createScriptRequest(creatorEnv));
      await dispatched.promise;
      const rejection = expect(thread.closed).rejects.toBe(failure);
      thread.send({ type: 'disconnect' });
      await rejection;
      expect(abort).toHaveBeenCalledOnce();
      expect(thread.terminate()).toBe(thread.closed);
    } finally {
      await nativeThread.terminate();
      // This test intentionally consumed the cleanup rejection above.
      threads.delete(thread);
    }
  });

  it.each(['dedicated', 'shared'] as const)('carries %s creator environment snapshots and identities into the actual isolate', async (kind) => {
    const creatorEnv = createCreatorEnvironment();
    const document = creatorEnv.window.document;
    const origin = createOpaqueOrigin(true);
    document.origin = origin;
    creatorEnv.topLevelOrigin = { ...origin };
    const { thread, request } = createThread({ kind, data: {}, creatorEnv });
    const snapshot = structuredClone(thread.creatorEnvSnapshot!);
    // Mutating both the original environment and the local snapshot after posting
    // cannot change the worker's copy. The retained owner is the old Document.
    const replacement = creatorEnv.createDocument();
    replacement.origin = createOpaqueOrigin();
    creatorEnv.window.setAssociatedDocument(replacement);
    creatorEnv.topLevelOrigin = replacement.origin;
    thread.creatorEnvSnapshot!.apiBaseURL.host = { kind: 'domain', value: 'changed.test' };
    await thread.ready;
    expect(thread.owner).toBe(document);
    expect(thread.creatorEnv).toBe(creatorEnv);
    const result = await request({ type: 'inspect' }) as ThreadInspection;
    expect(result).toMatchObject({
      creatorEnvSnapshot: snapshot, hasEnvironment: false, cluster: { localMembers: 1 },
    });
    expect(result.cluster!.id === snapshot.agentClusterId).toBe(kind === 'dedicated');
    expect(areSameOrigin(result.creatorEnvSnapshot!.origin, origin)).toBe(true);
    expect(serializeURL(result.creatorEnvSnapshot!.apiBaseURL)).toBe('https://creator.test/');
    // Navigation replaces the origin, but not the environment or its cluster.
    const next = WorkerThread.captureCreatorEnvironment(creatorEnv);
    expect(next.environmentId).toBe(snapshot.environmentId);
    expect(next.agentClusterId).toBe(snapshot.agentClusterId);
    expect(next.origin).not.toEqual(snapshot.origin);
  });

  it.each(['dedicated', 'shared'] as const)('restores %s creator policies in the receiving isolate', async (kind) => {
    const creatorEnv = createCreatorEnvironment();
    const container = createCreatorPolicies(creatorEnv.origin);
    creatorEnv.window.document.policyContainer = container;
    const { thread, request } = createThread({ kind, data: {}, creatorEnv });
    const expected = container.toSnapshot();
    // Neither later meta/policy changes nor navigation can alter the sent data.
    container.cspList!.policies[0]!.directives.get('worker-src')!.tokens.push('*');
    container.embedderPolicy.value = 'unsafe-none';
    container.reportOnlyIntegrityPolicy.endpoints.push('late');
    creatorEnv.window.setAssociatedDocument(creatorEnv.createDocument());
    await thread.ready;
    expect(await request({ type: 'inspect-policy', url: 'https://creator.test/worker.js' })).toEqual({
      snapshot: expected,
      policies: [{ disposition: 'enforce', matches: true }, { disposition: 'report', matches: false }],
    });
    expect(await request({ type: 'inspect-policy', url: 'https://other.test/worker.js' })).toMatchObject({
      policies: [{ disposition: 'enforce', matches: false }, { disposition: 'report', matches: false }],
    });
  });

  it('carries Blob URL records into another isolate without copying their cached live registrations', async () => {
    const creatorEnv = createCreatorEnvironment();
    const url = parseURL('blob:https://creator.test/registered-blob').url!;
    url.blobURLEntry = { env: creatorEnv };
    creatorEnv.creationURL = url;
    creatorEnv.window.document.url = url;
    creatorEnv.topLevelCreationURL = url;
    const { thread, request } = createThread({ kind: 'dedicated', data: {}, creatorEnv });
    await thread.ready;
    const result = await request({ type: 'inspect' }) as ThreadInspection;
    const snapshot = result.creatorEnvSnapshot!;
    for (const copy of [snapshot.creationURL, snapshot.apiBaseURL, snapshot.topLevelCreationURL!]) {
      expect(copy).toEqual({ ...url, blobURLEntry: null });
      expect(serializeURL(copy)).toBe('blob:https://creator.test/registered-blob');
    }
    expect(url.blobURLEntry.env).toBe(creatorEnv);
  });

  it.each(['dedicated', 'shared'] as const)('forwards %s worker identities to a nested dedicated isolate', async (kind) => {
    const creatorEnv = createCreatorEnvironment();
    const origin = createOpaqueOrigin(true);
    creatorEnv.window.document.origin = origin;
    creatorEnv.topLevelOrigin = copyOrigin(origin);
    const cluster = creatorEnv.realm.agent.agentCluster!;
    cluster.crossOriginIsolationMode = 'logical';
    cluster.isOriginKeyed = true;
    const { thread, request } = createThread({ kind, data: {}, creatorEnv });
    await thread.ready;
    const result = await request({ type: 'nested', url: 'https://creator.test/worker.js' }) as NestedInspection;
    expect(result.parentThreadId).not.toBe(threadId);
    expect(result.child.threadId).not.toBe(threadId);
    expect(result.child.threadId).not.toBe(result.parentThreadId);
    expect(result.retainedOwner).toBe(true);
    expect(result.parentEnvSnapshot.environmentId).not.toBe(creatorEnv.id);
    expect(result.child.creatorEnvSnapshot).toEqual(result.parentEnvSnapshot);
    expect(areSameOrigin(result.child.creatorEnvSnapshot!.origin, origin)).toBe(true);
    expect(areSameOrigin(result.child.creatorEnvSnapshot!.topLevelOrigin!, origin)).toBe(true);
    expect(result.child.cluster).toEqual({
      id: result.parentEnvSnapshot.agentClusterId,
      crossOriginIsolationMode: kind === 'dedicated' ? 'logical' : 'none',
      isOriginKeyed: true, localMembers: 1,
    });
    expect(result.parentEnvSnapshot.agentClusterId === cluster.id).toBe(kind === 'dedicated');
    expect(cluster.agents.size).toBe(1);
  }, 60_000);

  it('forwards a data worker\'s new opaque origin without replacing its top-level partition', async () => {
    const creatorEnv = createCreatorEnvironment('https://[::1]:8443/page');
    creatorEnv.window.document.policyContainer = createCreatorPolicies(creatorEnv.origin);
    const { thread, request } = createThread({ kind: 'dedicated', data: {}, creatorEnv });
    await thread.ready;
    const result = await request({ type: 'nested', url: 'data:text/javascript,' }) as NestedInspection;
    const creator = result.child.creatorEnvSnapshot!;
    expect(creator.origin.kind).toBe('opaque');
    expect(areSameOrigin(creator.origin, creatorEnv.origin)).toBe(false);
    expect(areSameOrigin(creator.origin, result.parentEnvSnapshot.origin)).toBe(true);
    expect(areSameOrigin(creator.topLevelOrigin!, creatorEnv.origin)).toBe(true);
    expect(creator.hasCrossSiteAncestor).toBe(true);
    expect(result.child.cluster!.id).toBe(creatorEnv.realm.agent.agentCluster!.id);
    // The data worker has a fresh origin, but inherited CSP still interprets
    // 'self' against the original resource origin through the next isolate hop.
    expect(creator.policyContainer).toEqual(creatorEnv.policyContainer.toSnapshot());
    expect(areSameOrigin(creator.policyContainer.cspList!.selfOrigin, creatorEnv.origin)).toBe(true);
    expect(areSameOrigin(creator.policyContainer.cspList!.selfOrigin, creator.origin)).toBe(false);
  }, 60_000);

  it('acknowledges host setup, rather than merely Node starting its thread', async () => {
    const state = new Int32Array(new SharedArrayBuffer(8));
    const { thread } = createThread({ kind: 'dedicated', data: { mode: 'wait-before-ready', state } });
    let ready = false;
    void thread.ready.then(() => { ready = true; }, () => {});
    await vi.waitFor(() => { expect(Atomics.load(state, 0)).toBe(1); }, { timeout: 5000 });
    expect(ready).toBe(false);
    expect(() => thread.send({ type: 'inspect' })).toThrow('not running');
    Atomics.store(state, 1, 1);
    Atomics.notify(state, 1);
    await thread.ready;
    expect(ready).toBe(true);
  });

  it('delivers internal messages as tasks with a checkpoint before the next task', async () => {
    const { thread, request } = createThread();
    await thread.ready;
    expect(await request({ type: 'checkpoint' })).toEqual(['task', 'microtask', 'next task']);
  });

  it('keeps the creator responsive and stops blocked execution without running its finally block', async () => {
    const state = new Int32Array(new SharedArrayBuffer(8));
    const { thread, request } = createThread();
    await thread.ready;
    expect(await request({ type: 'block', state })).toBe('entering loop');
    await vi.waitFor(() => { expect(Atomics.load(state, 0)).toBe(1); }, { timeout: 5000 });
    const creator = new WindowAgent(new EventLoop({ requestTurn: queueNodeTask }));
    const progressed = Promise.withResolvers<boolean>();
    creator.eventLoop.queueTask(createTaskSource('creator progress'), null, () => { progressed.resolve(true); });
    expect(await progressed.promise).toBe(true);
    const exit = await thread.terminate();
    expect(exit).toEqual({ code: 1, error: undefined, terminated: true });
    expect(Atomics.load(state, 1)).toBe(0);
    expect(await thread.terminate()).toBe(exit);
    expect(() => thread.send({ type: 'inspect' })).toThrow('not running');
    expect(await Promise.resolve(19).then((value) => value + 1)).toBe(20);
  });

  it('can terminate while host startup is still blocked', async () => {
    const state = new Int32Array(new SharedArrayBuffer(8));
    const { thread } = createThread({ kind: 'dedicated', data: { mode: 'wait-before-ready', state } });
    await vi.waitFor(() => { expect(Atomics.load(state, 0)).toBe(1); }, { timeout: 5000 });
    const rejection = expect(thread.ready).rejects.toThrow('terminated during startup');
    expect(await thread.terminate()).toMatchObject({ code: 1, terminated: true });
    await rejection;
  });

  it('reports bootstrap failures without an uncaught error in the creator', async () => {
    const { thread } = createThread({ kind: 'dedicated', data: { mode: 'throw-before-ready' } });
    await expect(thread.ready).rejects.toThrow('bootstrap failed');
    expect(await thread.closed).toMatchObject({ code: 1, error: { message: 'bootstrap failed' }, terminated: false });
  });

  it('reports a missing bootstrap file through readiness and teardown', async () => {
    entry.path = resolve(__dirname, 'fixtures/missing-worker-bootstrap.cjs');
    const thread = new WorkerThread({ kind: 'dedicated', data: {} }, () => {});
    threads.add(thread);
    await expect(thread.ready).rejects.toMatchObject({ code: 'MODULE_NOT_FOUND' });
    expect(await thread.closed).toMatchObject({
      code: 1, error: { code: 'MODULE_NOT_FOUND' }, terminated: false,
    });
  });

  it('rejects readiness if the entry exits without acknowledging setup', async () => {
    const { thread } = createThread({ kind: 'dedicated', data: { mode: 'exit-before-ready' } });
    await expect(thread.ready).rejects.toThrow('exited before completing startup');
    expect(await thread.closed).toEqual({ code: 0, error: undefined, terminated: false });
  });

  it('retains failures that occur after readiness', async () => {
    const { thread } = createThread();
    await thread.ready;
    thread.send({ type: 'fail' });
    expect(await thread.closed).toMatchObject({ code: 1, error: { message: 'worker host task failed' }, terminated: false });
  });

  it('releases the control channel and observes normal native teardown', async () => {
    const { thread } = createThread();
    await thread.ready;
    thread.send({ type: 'disconnect' });
    expect(await thread.closed).toEqual({ code: 0, error: undefined, terminated: false });
    expect(() => thread.send({ type: 'inspect' })).toThrow('not running');
  });

  it('rejects uncloneable host inputs while keeping a started thread usable', async () => {
    expect(() => createThread({ kind: 'dedicated', data: () => {} })).toThrow();
    const { thread, request } = createThread();
    await thread.ready;
    expect(() => thread.send(() => {})).toThrow();
    expect(await request({ type: 'echo', data: 42 })).toBe(42);
  });
});

describe('Creator environment snapshot', () => {
  it('copies URL and tuple-origin records without sharing their mutable data', () => {
    const env = createCreatorEnvironment('https://[::1]:8443/page#fragment');
    const snapshot = WorkerThread.captureCreatorEnvironment(env);
    expect(snapshot).toMatchObject({
      creationURL: env.creationURL, apiBaseURL: env.apiBaseURL, topLevelCreationURL: env.topLevelCreationURL,
      origin: { kind: 'tuple', scheme: 'https', host: { kind: 'ipv6', pieces: [0, 0, 0, 0, 0, 0, 0, 1] }, port: 8443, domain: null },
      isSecureContext: true, hasCrossSiteAncestor: env.hasCrossSiteAncestor, crossOriginIsolatedCapability: false,
    });
    expect(structuredClone(snapshot)).toEqual(snapshot);
    env.creationURL.fragment = 'changed';
    if (!Array.isArray(env.creationURL.path)) throw new Error('Expected a hierarchical URL');
    env.creationURL.path.push('changed');
    if (env.creationURL.host?.kind !== 'ipv6') throw new Error('Expected an IPv6 URL host');
    env.creationURL.host.pieces[7] = 3;
    if (env.origin.kind !== 'tuple') throw new Error('Expected a tuple origin');
    env.origin.port = 443;
    if (env.origin.host.kind !== 'ipv6') throw new Error('Expected an IPv6 host');
    env.origin.host.pieces[7] = 2;
    for (const url of [snapshot.creationURL, snapshot.apiBaseURL, snapshot.topLevelCreationURL!]) {
      expect(serializeURL(url)).toBe('https://[::1]:8443/page#fragment');
    }
    expect(serializeOrigin(snapshot.origin)).toBe('https://[::1]:8443');
    expect(serializeOrigin(snapshot.topLevelOrigin!)).toBe('https://[::1]:8443');
  });

  it('retains opaque-origin equality across copies and launches without conflating distinct origins', () => {
    const env = createCreatorEnvironment();
    const origin = createOpaqueOrigin(true);
    env.window.document.origin = origin;
    env.topLevelOrigin = { ...origin };
    const first = WorkerThread.captureCreatorEnvironment(env);
    const second = WorkerThread.captureCreatorEnvironment(env);
    expect(second).toEqual(first);
    expect(first.origin).toEqual(first.topLevelOrigin);
    expect(first.origin).toMatchObject({ kind: 'opaque', potentiallyTrustworthy: true });
    const different = createOpaqueOrigin(true);
    expect(serializeOrigin(different)).toBe(serializeOrigin(origin));
    env.topLevelOrigin = different;
    expect(WorkerThread.captureCreatorEnvironment(env).topLevelOrigin).not.toEqual(first.origin);
  });

  it('keeps different creators distinct and preserves an absent top-level origin', () => {
    const first = WorkerThread.captureCreatorEnvironment(createCreatorEnvironment());
    const env = createCreatorEnvironment();
    env.topLevelOrigin = null;
    env.topLevelCreationURL = null;
    const second = WorkerThread.captureCreatorEnvironment(env);
    expect(first.origin).toEqual(second.origin);
    expect(second.environmentId).not.toBe(first.environmentId);
    expect(second.agentClusterId).not.toBe(first.agentClusterId);
    expect(second.topLevelOrigin).toBeNull();
    expect(second.topLevelCreationURL).toBeNull();
  });

  it('captures the worker global as a nested creator and retains its inherited identities', () => {
    const creatorEnv = createCreatorEnvironment();
    const agent = creatorEnv.userAgent.obtainDedicatedOrSharedWorkerAgent(creatorEnv, false);
    if (!(agent instanceof DedicatedWorkerAgent)) throw new Error('Expected a dedicated worker agent');
    const env = createWorkerEnvironment({
      agent, outsideEnv: creatorEnv, url: parseURL('data:text/javascript,').url!, unsafeWorkerCreationTime: 1234,
      type: 'classic', name: 'creator', credentials: 'same-origin', extendedLifetime: false,
    });
    const outside = WorkerThread.captureCreatorEnvironment(creatorEnv);
    const creator = WorkerThread.captureCreatorEnvironment(env);
    expect(creator).toMatchObject({
      agentClusterId: outside.agentClusterId, origin: { kind: 'opaque' },
      topLevelOrigin: outside.topLevelOrigin, hasCrossSiteAncestor: true,
    });
    expect(creator.environmentId).not.toBe(outside.environmentId);
  });

  it('does not clone a cached Blob entry and its live environment into the startup data', () => {
    const env = createCreatorEnvironment();
    const url = parseURL('blob:https://creator.test/registered-blob').url!;
    url.blobURLEntry = { env };
    env.creationURL = url;
    env.window.document.url = url;
    env.topLevelCreationURL = url;
    const snapshot = WorkerThread.captureCreatorEnvironment(env);
    for (const copy of [snapshot.creationURL, snapshot.apiBaseURL, snapshot.topLevelCreationURL!]) {
      expect(copy).toEqual({ ...url, blobURLEntry: null });
    }
    expect(structuredClone(snapshot)).toEqual(snapshot);
    expect(url.blobURLEntry.env).toBe(env);
  });
});

/** Diagnostic replies from the private host fixture, never author messages. */
interface ThreadInspection {
  threadId: number;
  creatorEnvSnapshot: CreatorEnvironmentSnapshot | null;
  cluster: { id: string; crossOriginIsolationMode: string; isOriginKeyed: boolean; localMembers: number; } | null;
}

interface NestedInspection {
  parentThreadId: number;
  parentEnvSnapshot: CreatorEnvironmentSnapshot;
  retainedOwner: boolean;
  child: ThreadInspection;
}

function createThread(initialization: WorkerThreadInitialization = { kind: 'dedicated', data: {} }) {
  const messages = new EventEmitter();
  const thread = new WorkerThread(initialization, (message) => { messages.emit('message', message); });
  threads.add(thread);
  return {
    thread,
    async fetchScript(this: void, request: FetchRequest): Promise<unknown> {
      const reply = once(messages, 'message');
      thread.fetchScript(request);
      return (await reply)[0];
    },
    async request(this: void, message: unknown): Promise<unknown> {
      const reply = once(messages, 'message');
      thread.send(message);
      return (await reply)[0];
    },
  };
}

/** Reuse HTML's request setup without creating or parsing a script in the creator realm. */
function createScriptRequest(
  env: BrowletEnvironment, url = 'https://creator.test/worker.js',
  destination: 'worker' | 'sharedworker' = 'worker',
): FetchRequest {
  let request!: FetchRequest;
  env.fetchClassicWorkerScript(env.parseURL(url)!, env, destination, () => {
    throw new Error('This transport test must not create a script');
  }, (prepared) => { request = prepared; });
  return request;
}

/** Real Window/Document owners without navigation or network activity. */
function createCreatorEnvironment(url = 'https://creator.test/', userAgent = new UserAgent()) {
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

function createCreatorPolicies(origin: Origin): PolicyContainer {
  const container = new PolicyContainer();
  container.cspList = new CSPList(origin);
  container.cspList.policies.push(
    ContentSecurityPolicy.parse("worker-src 'self'", 'header', 'enforce'),
    ContentSecurityPolicy.parse("worker-src 'none'; report-to monitored", 'header', 'report'),
  );
  container.embedderPolicy.value = 'require-corp';
  container.embedderPolicy.reportOnlyValue = 'credentialless';
  container.embedderPolicy.reportingEndpoint = 'enforced';
  container.embedderPolicy.reportOnlyReportingEndpoint = 'monitored';
  container.referrerPolicy = 'no-referrer';
  container.integrityPolicy.blockedDestinations.push('script');
  container.reportOnlyIntegrityPolicy.blockedDestinations.push('style');
  container.reportOnlyIntegrityPolicy.endpoints.push('integrity');
  return container;
}
