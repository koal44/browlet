import { EventEmitter, once } from 'node:events';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { threadId, type WorkerOptions } from 'node:worker_threads';
import type * as WorkerThreads from 'node:worker_threads';
import { afterEach, assert, beforeEach, describe, expect, inject, it, vi } from 'vitest';

import { addon, type JSThreadExit } from '../../../src/js-engine/index';
import { utf8Encode } from '../../../src/encoding/index';
import { BlobData, BlobImpl } from '../../../src/file/index';
import { FetchHeaders, type FetchRequest } from '../../../src/fetch/index';
import {
  WorkerThread, queueNodeTask, type WorkerThreadInit, type CreatorEnvironmentSnapshot,
} from '../../../src/browlet/integration/host/index';
import { createWindowEnvironment, createWorkerEnvironment } from '../../../src/browlet/integration/web-idl/index';
import type { BrowletEnvironment } from '../../../src/browlet/environment/index';
import type { StructuredSerializeWithTransferResult } from '../../../src/browlet/scripting/structured-data/index';
import {
  AgentCluster, DedicatedWorkerAgent, EventLoop, WindowAgent, createTaskSource, domManipulationTaskSource,
} from '../../../src/browlet/scripting/index';
import { UserAgent } from '../../../src/browlet/user-agent';
import { BrowsingContext, DocumentState, TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { MessageChannelImpl, MessagePortImpl } from '../../../src/browlet/communication/index';
import { WorkerImpl } from '../../../src/browlet/workers/index';
import type { ErrorEvent, MessageChannel, MessageEvent, MessagePort, Window, Worker } from '../../../src/browlet/platform';
import { PolicyContainer } from '../../../src/browlet/browsing/policy/index';
import { ContentSecurityPolicy, CSPList } from '../../../src/browlet/browsing/policy/csp/index';
import {
  areSameOrigin, copyOrigin, createOpaqueOrigin, obtainURLOrigin, parseURL, serializeOrigin, serializeURL,
  type Origin,
} from '../../../src/url/index';
import { createManualEventLoop } from '../../support/browlet-agent';
import { unwrap } from '../../support/browlet-binding';
import { mockHTTPTransport } from '../../fetch/transport-fixture';

// Production owns a fixed entry. Redirect only the native loader in these
// lifecycle tests so the fixture can block or fail without production commands.
// The real JSThread still performs execution, cloning, and teardown.
const entry = vi.hoisted((): { path: string | null; worker: WorkerThreads.Worker | null; } => ({ path: null, worker: null }));
vi.mock('node:worker_threads', async (importOriginal) => {
  const original = await importOriginal<typeof WorkerThreads>();
  return {
    ...original,
    Worker: class extends original.Worker {
      constructor(entryPath: string | URL, options: WorkerOptions = {}) {
        const fixturePath = entry.path;
        // The unit pool reuses modules between files. Cached JSThread imports
        // must use the requested entry after this suite releases its override.
        super(fixturePath ?? entryPath, fixturePath === null ? options : {
          ...options,
          // Retarget the marker too, so importing the source adapter does not
          // also start its production runtime.
          workerData: { ...options.workerData as object, jsThreadEntry: pathToFileURL(fixturePath).href },
        });
        if (fixturePath !== null) entry.worker = this;
      }
    },
  };
});
const threads = new Set<WorkerThread>();
const fixturePath = inject('workerFixturePath');
assert(fixturePath !== undefined, 'The worker fixture must be compiled before test collection');

beforeEach(() => {
  entry.path = fixturePath;
  entry.worker = null;
});

afterEach(async () => {
  try {
    await Promise.all([...threads].map((thread) => thread.terminate()));
  } finally {
    threads.clear();
    entry.path = null;
    entry.worker = null;
    vi.restoreAllMocks();
  }
});

// Each entry loads the compiled production graph in a fresh isolate. Source
// compilation precedes test workers; native startup and all waits remain bounded.
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
    const { implementation, worker } = createTerminationWorker();
    const { thread } = createThread({ kind: 'dedicated', data: {}, worker: implementation });
    await thread.ready;
    assert(entry.worker !== null);
    const nativeThread = entry.worker;
    const failure = new Error('Native termination failed');
    const terminate = vi.spyOn(nativeThread, 'terminate').mockRejectedValueOnce(failure);
    try {
      const completion = thread.closed;
      expect(worker.terminate()).toBeUndefined();
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

  it('stops a worker even when canceling its script fetch throws', async () => {
    const { creatorEnv, producer, implementation, worker, messages, drain } = createTerminationWorker();
    const dispatched = Promise.withResolvers<void>();
    const failure = new Error('Fetch cleanup failed during termination');
    const abort = vi.fn(() => { throw failure; });
    vi.spyOn(creatorEnv.userAgent.httpTransport, 'dispatch').mockImplementation(() => {
      dispatched.resolve();
      return { pause() {}, resume() {}, abort };
    });
    const { thread, request } = createThread({ kind: 'dedicated', data: {}, worker: implementation });
    await thread.ready;
    assert(entry.worker !== null);
    const nativeThread = entry.worker;
    const state = new Int32Array(new SharedArrayBuffer(8));
    try {
      thread.fetchScript(createScriptRequest(creatorEnv));
      await dispatched.promise;
      expect(await request({ type: 'block', state })).toBe('entering loop');
      await vi.waitFor(() => { expect(Atomics.load(state, 0)).toBe(1); }, { timeout: 5000 });
      producer.postMessage('pending delivery', []);
      const outcome = Promise.resolve(thread.closed).then((exit) => exit, (error: unknown) => error);
      expect(worker.terminate()).toBeUndefined();
      expect(await outcome).toBe(failure);
      expect(nativeThread.threadId).toBe(-1);
      expect(Atomics.load(state, 1)).toBe(0);
      expect(abort).toHaveBeenCalledOnce();
      expect(thread.terminate()).toBe(thread.closed);
      producer.postMessage('after failed cleanup', []);
      drain();
      expect(messages).toEqual([]);
    } finally {
      await nativeThread.terminate();
      // The failure is intentional; keep fixture cleanup from rethrowing it.
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

  it.each(['dedicated', 'shared'] as const)('keeps the creator responsive and stops a blocked %s worker without running finally', async (kind) => {
    const state = new Int32Array(new SharedArrayBuffer(8));
    const { thread, request } = createThread({ kind, data: {} });
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

  it.each(['classic', 'module'])('Worker.terminate() aborts the HTML %s runner and clears its outside delivery queue', async (scriptType) => {
    const { creatorEnv, producer, implementation, worker, messages, drain } = createTerminationWorker();
    const state = new Int32Array(new SharedArrayBuffer(20));
    const { thread, request } = createThread({ kind: 'dedicated', data: {}, worker: implementation });
    await thread.ready;
    expect(await request({ type: 'block-worker-script', scriptType, state })).toBe('entering worker script');
    await vi.waitFor(() => { expect(Atomics.load(state, 0)).toBe(1); }, { timeout: 5000 });
    // Real HTML deliveries already queued in the creator. Cross-isolate port
    // transport remains separate; no mock replaces the queue or native stop.
    producer.postMessage('pending delivery', []);
    const other = new MessageChannelImpl(creatorEnv);
    const unrelated = creatorEnv.project(other.port2) as MessagePort;
    const received: unknown[] = [];
    unrelated.onmessage = (event) => { received.push((event as MessageEvent).data); };
    other.port1.postMessage('unrelated delivery', []);
    expect(worker.terminate()).toBeUndefined();
    expect(worker.terminate()).toBeUndefined();
    drain();
    expect(messages).toEqual([]);
    expect(received).toEqual(['unrelated delivery']);
    expect(await thread.closed).toEqual({ code: 1, error: undefined, terminated: true });
    // Only the entry marker changed: no catch, finally, pending reaction, or error event.
    expect(Array.from(state)).toEqual([1, 0, 0, 0, 0]);
    producer.postMessage('after native exit', []);
    drain();
    expect(messages).toEqual([]);
    expect(() => thread.send({ type: 'inspect' })).toThrow('not running');
    expect(worker.terminate()).toBeUndefined();
  });

  it('can terminate while host startup is still blocked', async () => {
    const { producer, implementation, worker, messages, drain } = createTerminationWorker();
    const state = new Int32Array(new SharedArrayBuffer(8));
    const { thread } = createThread({ kind: 'dedicated', data: { mode: 'wait-before-ready', state }, worker: implementation });
    await vi.waitFor(() => { expect(Atomics.load(state, 0)).toBe(1); }, { timeout: 5000 });
    producer.postMessage('pending before readiness', []);
    const rejection = expect(thread.ready).rejects.toThrow('terminated during startup');
    expect(worker.terminate()).toBeUndefined();
    expect(await thread.closed).toMatchObject({ code: 1, terminated: true });
    await rejection;
    producer.postMessage('after startup termination', []);
    drain();
    expect(messages).toEqual([]);
  });

  it('uses the receiver execution owner when Worker.terminate() is borrowed across realms', async () => {
    const first = createTerminationWorker();
    const second = createTerminationWorker();
    const { thread } = createThread({ kind: 'dedicated', data: {}, worker: second.implementation });
    await thread.ready;
    const terminate = Reflect.get(first.worker, 'terminate');
    expect(Reflect.apply(terminate, second.worker, [])).toBeUndefined();
    expect(await thread.closed).toMatchObject({ code: 1, terminated: true });
  });

  it('reports bootstrap failures without an uncaught error in the creator', async () => {
    const { implementation, worker, producer, messages, drain } = createTerminationWorker();
    const { thread } = createThread({ kind: 'dedicated', data: { mode: 'throw-before-ready' }, worker: implementation });
    await expect(thread.ready).rejects.toThrow('bootstrap failed');
    expect(await thread.closed).toMatchObject({ code: 1, error: { message: 'bootstrap failed' }, terminated: false });
    expect(worker.terminate()).toBeUndefined();
    producer.postMessage('after failed startup', []);
    drain();
    expect(messages).toEqual([]);
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

  it('preserves queued outside deliveries on natural exit while disconnecting the channel', async () => {
    const { producer, implementation, worker, messages, drain } = createTerminationWorker();
    const { thread } = createThread({ kind: 'dedicated', data: {}, worker: implementation });
    await thread.ready;
    producer.postMessage('sent before closing', []);
    thread.send({ type: 'disconnect' });
    expect(await thread.closed).toEqual({ code: 0, error: undefined, terminated: false });
    expect(worker.terminate()).toBeUndefined();
    producer.postMessage('after exit', []);
    drain();
    expect(messages).toEqual(['sent before closing']);
  });

  it('rejects uncloneable host inputs while keeping a started thread usable', async () => {
    expect(() => createThread({ kind: 'dedicated', data: () => {} })).toThrow();
    const { thread, request } = createThread();
    await thread.ready;
    expect(() => thread.send(() => {})).toThrow();
    expect(await request({ type: 'echo', data: 42 })).toBe(42);
  });
});

describe('Worker error transport', { timeout: 30_000 }, () => {
  it.each(['classic', 'module'])('queues an uncanceled %s error on the Worker and then its owner', async (scriptType) => {
    const { implementation, worker, creatorEnv, drain } = createTerminationWorker();
    const scope = creatorEnv.global as unknown as Window;
    const order: string[] = [];
    const errors: ErrorEvent[] = [];
    const sources: unknown[] = [];
    const ownerCalls: unknown[][] = [];
    worker.addEventListener('error', (event) => {
      order.push('worker');
      errors.push(event as ErrorEvent);
      sources.push(creatorEnv.responsibleEventLoop.currentlyRunningTask?.source);
    });
    scope.addEventListener('error', (event) => { order.push('owner'); errors.push(event as ErrorEvent); });
    scope.onerror = function(this: unknown, ...args: unknown[]) { ownerCalls.push([this, ...args]); return true; };
    const { thread, request } = createThread({ kind: 'dedicated', data: {}, worker: implementation });
    await thread.ready;

    expect(await request({ type: 'report-worker-error', scriptType })).toEqual([
      { message: 'worker failed', errorType: 'function', trusted: true },
    ]);
    expect(order).toEqual([]);
    drain();

    expect(order).toEqual(['worker', 'owner']);
    expect(sources).toEqual([domManipulationTaskSource]);
    expect(errors).toHaveLength(2);
    for (const event of errors) {
      expect(event).toBeInstanceOf(scope.ErrorEvent);
      expect(event).toMatchObject({
        message: 'worker failed', filename: '', lineno: 0, colno: 0,
        error: null, isTrusted: true, cancelable: true, bubbles: false,
      });
    }
    expect(errors[0]!.target).toBe(worker);
    expect(errors[1]!.target === scope.window).toBe(true);
    expect(ownerCalls).toHaveLength(1);
    expect(ownerCalls[0]![0] === scope.window).toBe(true);
    expect(ownerCalls[0]!.slice(1)).toEqual(['worker failed', '', 0, 0, null]);
  });

  it.each(['classic', 'module'])('does not forward a locally canceled %s error', async (scriptType) => {
    const { implementation, worker, creatorEnv, drain } = createTerminationWorker();
    const outsideError = vi.fn(() => false);
    worker.onerror = outsideError;
    const ownerError = vi.fn(() => true);
    (creatorEnv.global as unknown as Window).onerror = ownerError;
    const { thread, request } = createThread({ kind: 'dedicated', data: {}, worker: implementation });
    await thread.ready;

    expect(await request({ type: 'report-worker-error', scriptType, cancelInside: true })).toHaveLength(1);
    drain();

    expect(outsideError).not.toHaveBeenCalled();
    expect(ownerError).not.toHaveBeenCalled();
  });

  it('lets the outside one-argument onerror handler cancel owner propagation by returning false', async () => {
    const { implementation, worker, creatorEnv, drain } = createTerminationWorker();
    const calls: unknown[][] = [];
    worker.onerror = function(this: unknown, ...args: unknown[]) { calls.push([this, ...args]); return false; };
    const ownerError = vi.fn(() => true);
    (creatorEnv.global as unknown as Window).onerror = ownerError;
    const { thread, request } = createThread({ kind: 'dedicated', data: {}, worker: implementation });
    await thread.ready;

    await request({ type: 'report-worker-error', scriptType: 'classic' });
    drain();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(2);
    expect(calls[0]![0]).toBe(worker);
    expect(calls[0]![1]).toMatchObject({ error: null, defaultPrevented: true });
    expect(ownerError).not.toHaveBeenCalled();
  });

  it('retains classic-script muting across the isolate boundary', async () => {
    const { implementation, worker, drain } = createTerminationWorker();
    const errors: ErrorEvent[] = [];
    worker.addEventListener('error', (event) => { event.preventDefault(); errors.push(event as ErrorEvent); });
    const { thread, request } = createThread({ kind: 'dedicated', data: {}, worker: implementation });
    await thread.ready;

    expect(await request({ type: 'report-worker-error', scriptType: 'classic', muted: true })).toEqual([
      { message: 'Script error.', errorType: 'object', trusted: true },
    ]);
    drain();

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ message: 'Script error.', filename: '', lineno: 0, colno: 0, error: null });
  });

  it('preserves source diagnostics and drops a non-cloneable exception at the native boundary', async () => {
    const { implementation, worker, creatorEnv, drain } = createTerminationWorker();
    const errors: ErrorEvent[] = [];
    worker.addEventListener('error', (event) => { errors.push(event as ErrorEvent); });
    const scope = creatorEnv.global as unknown as Window;
    scope.onerror = () => true;
    scope.addEventListener('error', (event) => { errors.push(event as ErrorEvent); });
    const { thread, request } = createThread({ kind: 'dedicated', data: {}, worker: implementation });
    await thread.ready;
    const errorInfo = { message: 'diagnostic', filename: 'https://creator.test/worker.js', lineno: 12, colno: 34 };

    expect(await request({ type: 'report-diagnostics', errorInfo })).toBe('reported');
    drain();

    expect(errors).toHaveLength(2);
    for (const event of errors) expect(event).toMatchObject({ ...errorInfo, error: null });
  });

  it('propagates through a live parent worker across two isolate boundaries', async () => {
    const traceTiming = process.env.CI === 'true' || process.env.BROWLET_TRACE_WORKER === '1';
    const trace = (phase: string) => {
      if (traceTiming) {
        console.error(JSON.stringify({ workerTiming: phase, threadId, ms: Number(process.hrtime.bigint()) / 1e6 }));
      }
    };
    trace('test starts');
    const { implementation, worker, creatorEnv, drain } = createTerminationWorker();
    trace('outside environment ready');
    const errors: ErrorEvent[] = [];
    worker.addEventListener('error', (event) => { event.preventDefault(); errors.push(event as ErrorEvent); });
    const { thread, request } = createThread({ kind: 'dedicated', data: { traceTiming }, worker: implementation });
    trace('parent created');
    await thread.ready;
    trace('parent ready observed');

    expect(await request({ type: 'nested-error' })).toEqual([{ message: 'worker failed', error: null }]);
    trace('nested reply received');
    expect(errors).toEqual([]);
    drain();
    trace('outside error delivery drained');

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ message: 'worker failed', error: null });
    expect(errors[0]).toBeInstanceOf((creatorEnv.global as unknown as Window).ErrorEvent);
  });
});

describe('Structured data across worker isolates', { timeout: 30_000 }, () => {
  it('round-trips cycles, repeated values, and transferred buffers through the existing HTML serializer', async () => {
    const creatorEnv = createCreatorEnvironment();
    const buffer = new ArrayBuffer(3);
    new Uint8Array(buffer).set([1, 2, 3]);
    let reads = 0;
    const value = {
      get buffer() { reads++; return buffer; },
      map: new Map<object, object>(),
      repeated: [buffer, buffer],
    };
    value.map.set(value, value);
    const serialized = creatorEnv.serializeWithTransfer(value, [buffer]);
    expect(buffer.byteLength).toBe(0);
    const { thread, request } = createThread({ kind: 'dedicated', data: {}, creatorEnv });
    await thread.ready;

    const reply = await request({ type: 'round-trip-structured-data', serialized }) as StructuredDataReply;
    expect(reply.inspection).toEqual({ realm: true });
    const clone = creatorEnv.deserializeWithTransfer(reply.serialized).deserialized as typeof value;

    expect(reads).toBe(1);
    expect(clone).not.toBe(value);
    expect(clone.map.get(clone)).toBe(clone);
    expect(clone.repeated[0]).toBe(clone.buffer);
    expect(clone.repeated[1]).toBe(clone.buffer);
    expect(Object.getPrototypeOf(clone)).toBe(creatorEnv.realm.objectPrototype);
    expect(clone.buffer).toBeInstanceOf(creatorEnv.realm.ArrayBuffer);
    expect([...new Uint8Array(clone.buffer)]).toEqual([1, 2, 3]);
  });

  it.each(['dedicated', 'shared'] as const)('enforces the shared-memory cluster restriction in a %s isolate', async (kind) => {
    const { creatorEnv } = createTerminationWorker();
    creatorEnv.realm.agent.agentCluster!.crossOriginIsolationMode = 'concrete';
    creatorEnv.realm.crossOriginIsolated = true;
    expect(creatorEnv.crossOriginIsolatedCapability).toBe(true);
    const buffer = new SharedArrayBuffer(4);
    const transferred = new ArrayBuffer(6);
    const serialized = creatorEnv.serializeWithTransfer({ buffer, repeated: buffer, transferred }, [transferred]);
    const { thread, request } = createThread({ kind, data: {}, creatorEnv });
    await thread.ready;

    const reply = await request({ type: 'round-trip-structured-data', kind: 'shared-memory', serialized });
    if (kind === 'shared') {
      expect(reply).toMatchObject({ error: { name: 'DataCloneError' }, transferByteLengths: [6] });
      expect(new Uint8Array(buffer)[0]).toBe(0);
      return;
    }
    const received = reply as StructuredDataReply;
    expect(received.inspection).toEqual({ realm: true });
    const clone = creatorEnv.deserializeWithTransfer(received.serialized).deserialized as { buffer: SharedArrayBuffer; repeated: SharedArrayBuffer; };
    expect(clone.buffer).not.toBe(buffer);
    expect(clone.repeated).toBe(clone.buffer);
    expect(clone.buffer).toBeInstanceOf(creatorEnv.realm.SharedArrayBuffer);
    expect(new Uint8Array(buffer)[0]).toBe(77);
    new Uint8Array(clone.buffer)[1] = 88;
    expect(new Uint8Array(buffer)[1]).toBe(88);
  });

  it.each(['dedicated', 'shared'] as const)('enforces the Wasm Module cluster restriction in a %s isolate', async (kind) => {
    const { creatorEnv } = createTerminationWorker();
    const wasm = (creatorEnv.global as unknown as Window & typeof globalThis).WebAssembly;
    // (module (func (export "read") (result i32) i32.const 7))
    const module = new wasm.Module(new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127,
      3, 2, 1, 0, 7, 8, 1, 4, 114, 101, 97, 100, 0, 0,
      10, 6, 1, 4, 0, 65, 7, 11,
    ]));
    const serialized = creatorEnv.serializeWithTransfer({ module, repeated: module }, []);
    const { thread, request } = createThread({ kind, data: {}, creatorEnv });
    await thread.ready;

    const reply = await request({ type: 'round-trip-structured-data', kind: 'wasm', serialized });
    if (kind === 'shared') {
      expect(reply).toMatchObject({ error: { name: 'DataCloneError' } });
      return;
    }
    const received = reply as StructuredDataReply;
    expect(received.inspection).toEqual({ realm: true, result: 7 });
    const clone = creatorEnv.deserializeWithTransfer(received.serialized).deserialized as { module: WebAssembly.Module; repeated: WebAssembly.Module; };
    expect(clone.module).not.toBe(module);
    expect(clone.repeated).toBe(clone.module);
    expect(clone.module).toBeInstanceOf(wasm.Module);
    const read = Reflect.get(new wasm.Instance(clone.module).exports, 'read') as () => number;
    expect(read()).toBe(7);
  });
});

describe('Dedicated worker message channel across isolates', { timeout: 30_000 }, () => {
  it('retains messages posted before native readiness and inside-global composition', async () => {
    const { implementation, worker, messages, drain } = createTerminationWorker();
    const { thread, request } = createThread({ kind: 'dedicated', data: {}, worker: implementation });
    thread.connectMessagePort();
    worker.postMessage({ early: true });
    await thread.ready;
    await request({ type: 'prepare-worker-messages' });
    await request({ type: 'start-worker-messages' });
    await vi.waitFor(() => { drain(); expect(messages).toHaveLength(2); });
    expect(messages[0]).toMatchObject({ value: { early: true } });
  });

  it('keeps both HTML queues disabled until startup enables them, then preserves FIFO and checkpoints', async () => {
    const outside = createTerminationWorker(false);
    const { implementation, worker, creatorEnv, messages, drain } = outside;
    const { thread, request } = createThread({ kind: 'dedicated', data: {}, worker: implementation });
    await thread.ready;
    expect(await request({ type: 'prepare-worker-messages' })).toBe('prepared');
    thread.connectMessagePort();
    const value = { number: 1 };
    worker.postMessage(value);
    value.number = 99;
    worker.postMessage({ number: 2 });
    expect(await request({ type: 'inspect-worker-messages' })).toBe(0);

    const queue = vi.spyOn(creatorEnv.realm, 'queueGlobalTask');
    expect(await request({ type: 'start-worker-messages' })).toBe(0);
    await vi.waitFor(() => { expect(queue).toHaveBeenCalledTimes(4); });
    drain();
    expect(messages).toEqual([]);
    implementation.outsidePort.start();
    drain();
    expect(messages).toEqual([
      { value: { number: 1 }, trusted: true, target: true, realm: true, bufferRealm: true },
      { checkpoint: 1 },
      { value: { number: 2 }, trusted: true, target: true, realm: true, bufferRealm: true },
      { checkpoint: 2 },
    ]);
    expect(Object.getPrototypeOf(messages[0])).toBe(creatorEnv.realm.objectPrototype);
  });

  it('transfers ArrayBuffers synchronously and reconstructs repeated references in each receiving realm', async () => {
    const { worker, creatorEnv, messages, receive } = await createMessagingWorker();
    const buffer = new ArrayBuffer(3);
    new Uint8Array(buffer).set([4, 5, 6]);
    worker.postMessage({ buffer, alias: buffer }, [buffer]);
    expect(buffer.byteLength).toBe(0);
    await receive(2);
    const reply = messages[0] as { value: { buffer: ArrayBuffer; alias: ArrayBuffer; }; bufferRealm: boolean; };
    expect(reply.bufferRealm).toBe(true);
    expect(reply.value.alias).toBe(reply.value.buffer);
    expect(reply.value.buffer).toBeInstanceOf(creatorEnv.realm.ArrayBuffer);
    expect([...new Uint8Array(reply.value.buffer)]).toEqual([4, 5, 6]);
  });

  it('reports synchronous serialization failures without damaging the connected channel', async () => {
    const { worker, messages, receive } = await createMessagingWorker();
    expect(() => worker.postMessage(() => {})).toThrow(expect.objectContaining({ name: 'DataCloneError' }));
    worker.postMessage({ after: 'failure' });
    await receive(2);
    expect(messages[0]).toMatchObject({ value: { after: 'failure' } });
  });

  it('delivers messageerror through the worker global when the message carries a different cluster restriction', async () => {
    const outside = createTerminationWorker();
    const { worker, messages, receive } = await createMessagingWorker(outside);
    const foreign = createCreatorEnvironment();
    foreign.realm.agent.agentCluster!.crossOriginIsolationMode = 'concrete';
    foreign.realm.crossOriginIsolated = true;
    // Feed a real record from a different serialization owner through the pipe.
    // Native SAB support must not bypass HTML's receiving restriction.
    vi.spyOn(outside.creatorEnv, 'serializeWithTransfer').mockImplementation((value, transfer) =>
      foreign.serializeWithTransfer(value, transfer));
    worker.postMessage({ buffer: new SharedArrayBuffer(4) });
    await receive(1);
    expect(messages).toEqual(['messageerror']);
  });

  it('preserves trusted outside events and runs their callbacks only on the creator HTML loop', async () => {
    const { worker, creatorEnv, messages, drain, request } = await createMessagingWorker();
    const events: MessageEvent[] = [];
    worker.addEventListener('message', (event) => { events.push(event as MessageEvent); });
    const queue = vi.spyOn(creatorEnv.realm, 'queueGlobalTask');
    expect(await request({ type: 'send-worker-messages', values: ['one', 'two'] })).toBe('sent');
    await vi.waitFor(() => { expect(queue).toHaveBeenCalledTimes(2); });
    expect(messages).toEqual([]);
    drain();
    expect(messages).toEqual(['one', 'two']);
    for (const event of events) {
      expect(event).toBeInstanceOf((creatorEnv.global as unknown as Window).MessageEvent);
      expect(event).toMatchObject({ isTrusted: true, target: worker, source: null, origin: '', ports: [] });
    }
  });

  it('discards queued and in-flight outside messages when terminated', async () => {
    const { worker, creatorEnv, messages, drain, request, thread, implementation } = await createMessagingWorker();
    const queue = vi.spyOn(creatorEnv.realm, 'queueGlobalTask');
    expect(await request({ type: 'send-worker-messages', values: Array.from({ length: 100 }, (_, i) => i) })).toBe('sent');
    await vi.waitFor(() => { expect(queue).toHaveBeenCalled(); });
    worker.terminate();
    await thread.closed;
    drain();
    expect(messages).toEqual([]);
    expect(implementation.outsidePort.isEntangledOutsideGlobal()).toBe(false);
  });

  it('delivers messages sent before cooperative close and releases the native channel', async () => {
    const { thread, messages, receive, implementation } = await createMessagingWorker();
    thread.send({ type: 'close-worker-messages' });
    await thread.closed;
    await receive(1);
    expect(messages).toEqual(['before close']);
    expect(implementation.outsidePort.isEntangledOutsideGlobal()).toBe(false);
  });
});

describe('MessagePort transfer across isolates', { timeout: 30_000 }, () => {
  it('moves queued and in-flight messages, retaining start gating and receiving-realm identity', async () => {
    const { worker, creatorEnv, messages, receive, drain } = await createMessagingWorker(undefined, true);
    const { port1, port2 } = creatorEnv.project(new MessageChannelImpl(creatorEnv)) as MessageChannel;
    const original: unknown[] = [];
    port2.onmessage = (event) => { original.push((event as MessageEvent).data); };
    port1.postMessage('before transfer');
    worker.postMessage({ type: 'hold', name: 'moved', port: port2 }, [port2]);
    port1.postMessage('in flight');
    port2.close();
    await receive(1);
    expect(messages).toEqual([{ type: 'held', name: 'moved', identity: true, realm: true, frozenPorts: true }]);
    expect(original).toEqual([]);
    worker.postMessage({ type: 'start', name: 'moved' });
    await receive(6);
    expect(messages).toEqual([
      expect.objectContaining({ type: 'held' }),
      { type: 'started', name: 'moved' },
      { type: 'port-message', name: 'moved', value: 'before transfer', trusted: true, target: true, realm: true, nestedIdentity: true },
      { type: 'checkpoint', name: 'moved' },
      { type: 'port-message', name: 'moved', value: 'in flight', trusted: true, target: true, realm: true, nestedIdentity: true },
      { type: 'checkpoint', name: 'moved' },
    ]);
    const replies: unknown[] = [];
    port1.onmessage = (event) => { replies.push((event as MessageEvent).data); };
    worker.postMessage({ type: 'send', name: 'moved', value: 'reply' });
    await vi.waitFor(() => { drain(); expect(replies).toEqual(['reply']); });
    port1.close();
  });

  it('can return a disabled port with queued messages and then transfer it again', async () => {
    const { worker, creatorEnv, messages, receive, drain } = await createMessagingWorker(undefined, true);
    const { port1, port2 } = creatorEnv.project(new MessageChannelImpl(creatorEnv)) as MessageChannel;
    const events: MessageEvent[] = [];
    worker.addEventListener('message', (event) => { events.push(event as MessageEvent); });
    port1.postMessage('before first trip');
    worker.postMessage({ type: 'hold', name: 'first', port: port2 }, [port2]);
    await receive(1);
    port1.postMessage('while held');
    worker.postMessage({ type: 'return', name: 'first' });
    await receive(2);
    const returned = events[1]!.ports[0]!;
    expect(events[1]!.data).toEqual({ type: 'returned', port: returned });
    expect(returned).toBeInstanceOf((creatorEnv.global as unknown as Window).MessagePort);
    const original: unknown[] = [];
    returned.addEventListener('message', (event) => { original.push((event as MessageEvent).data); });
    drain();
    expect(original).toEqual([]);
    worker.postMessage({ type: 'hold', name: 'again', port: returned }, [returned]);
    port1.postMessage('third trip');
    worker.postMessage({ type: 'start', name: 'again' });
    await receive(10);
    expect(messages.filter((message) => (message as { type: string; }).type === 'port-message')).toEqual([
      expect.objectContaining({ value: 'before first trip' }),
      expect.objectContaining({ value: 'while held' }),
      expect.objectContaining({ value: 'third trip' }),
    ]);
    expect(original).toEqual([]);
    port1.close();
  });

  it('moves nested transferred ports and buffers inside a pending port queue', async () => {
    const { worker, creatorEnv, messages, receive, drain } = await createMessagingWorker(undefined, true);
    const outer = creatorEnv.project(new MessageChannelImpl(creatorEnv)) as MessageChannel;
    const inner = creatorEnv.project(new MessageChannelImpl(creatorEnv)) as MessageChannel;
    const buffer = new ArrayBuffer(3);
    new Uint8Array(buffer).set([7, 8, 9]);
    const events: MessageEvent[] = [];
    worker.addEventListener('message', (event) => { events.push(event as MessageEvent); });
    inner.port1.postMessage('nested before transfer');
    outer.port1.postMessage({ port: inner.port2, buffer }, [inner.port2, buffer]);
    expect(buffer.byteLength).toBe(0);
    worker.postMessage({ type: 'hold', name: 'outer', port: outer.port2 }, [outer.port2]);
    inner.port1.postMessage('nested in flight');
    worker.postMessage({ type: 'start', name: 'outer' });
    await receive(4);
    expect(messages[2]).toMatchObject({ type: 'port-message', nestedIdentity: true });
    const nested = events[2]!.ports[0]!;
    const value = (events[2]!.data as { value: { port: MessagePort; buffer: ArrayBuffer; }; }).value;
    expect(value.port).toBe(nested);
    expect(value.buffer).toBeInstanceOf(creatorEnv.realm.ArrayBuffer);
    expect([...new Uint8Array(value.buffer)]).toEqual([7, 8, 9]);
    const received: unknown[] = [];
    nested.addEventListener('message', (event) => { received.push((event as MessageEvent).data); });
    drain();
    expect(received).toEqual([]);
    nested.start();
    await vi.waitFor(() => { drain(); expect(received).toEqual(['nested before transfer', 'nested in flight']); });
    inner.port1.close();
    nested.close();
    outer.port1.close();
  });

  it('keeps both transferred endpoints paired and updates ownership when they return to one global', async () => {
    const { worker, creatorEnv, messages, receive, drain } = await createMessagingWorker(undefined, true);
    const { port1, port2 } = creatorEnv.project(new MessageChannelImpl(creatorEnv)) as MessageChannel;
    const events: MessageEvent[] = [];
    worker.addEventListener('message', (event) => { events.push(event as MessageEvent); });
    worker.postMessage({ type: 'pair', ports: [port1, port2] }, [port1, port2]);
    await receive(3);
    expect(messages).toEqual([
      { type: 'pair', identities: true },
      expect.objectContaining({ type: 'port-message', value: 'both ends arrived' }),
      { type: 'checkpoint', name: 'receiver' },
    ]);
    worker.postMessage({ type: 'return', name: 'sender' });
    await receive(4);
    const sender = events[3]!.ports[0]!;
    const senderImpl = unwrap<MessagePortImpl>(sender);
    expect(senderImpl.isEntangledOutsideGlobal()).toBe(true);
    worker.postMessage({ type: 'return', name: 'receiver' });
    await receive(5);
    const receiver = events[4]!.ports[0]!;
    const receiverImpl = unwrap<MessagePortImpl>(receiver);
    await vi.waitFor(() => {
      expect(senderImpl.isEntangledOutsideGlobal()).toBe(false);
      expect(receiverImpl.isEntangledOutsideGlobal()).toBe(false);
    });
    const received: unknown[] = [];
    receiver.onmessage = (event) => { received.push((event as MessageEvent).data); };
    sender.postMessage('back together');
    await vi.waitFor(() => { drain(); expect(received).toEqual(['back together']); });
    // HTML serializes and detaches the target, but deliberately drops this message.
    const buffer = new ArrayBuffer(1);
    sender.postMessage({ receiver, buffer }, [receiver, buffer]);
    expect(buffer.byteLength).toBe(0);
    await vi.waitFor(() => { expect(senderImpl.isEntangledOutsideGlobal()).toBe(false); });
    drain();
    expect(received).toEqual(['back together']);
    sender.close();
  });

  it('receives worker-created ports and preserves their queue through a local structured clone', async () => {
    const { worker, creatorEnv, receive, drain } = await createMessagingWorker(undefined, true);
    const events: MessageEvent[] = [];
    worker.addEventListener('message', (event) => { events.push(event as MessageEvent); });
    worker.postMessage({ type: 'create' });
    await receive(1);
    const original = events[0]!.ports[0]!;
    const window = creatorEnv.global as unknown as Window;
    const moved = window.structuredClone(original, { transfer: [original] });
    expect(moved).not.toBe(original);
    expect(moved).toBeInstanceOf(window.MessagePort);
    original.close();
    const received: unknown[] = [];
    moved.onmessage = (event) => { received.push((event as MessageEvent).data); };
    await vi.waitFor(() => { drain(); expect(received).toEqual(['queued in worker', 'sent after transfer']); });
    moved.close();
  });

  it('keeps a port usable after a failed serialization and disconnects it when its worker terminates', async () => {
    const { worker, creatorEnv, receive, thread, drain } = await createMessagingWorker(undefined, true);
    const { port1, port2 } = creatorEnv.project(new MessageChannelImpl(creatorEnv)) as MessageChannel;
    expect(() => worker.postMessage({ port: port2, bad: () => {} }, [port2])).toThrow(
      expect.objectContaining({ name: 'DataCloneError' }),
    );
    worker.postMessage({ type: 'hold', name: 'working', port: port2 }, [port2]);
    await receive(1);
    const impl = unwrap<MessagePortImpl>(port1);
    expect(impl.isEntangledOutsideGlobal()).toBe(true);
    const received: unknown[] = [];
    port1.addEventListener('message', (event) => { received.push((event as MessageEvent).data); });
    const queue = vi.spyOn(creatorEnv.realm, 'queueGlobalTask');
    worker.postMessage({ type: 'send', name: 'working', value: 'queued before termination' });
    await vi.waitFor(() => { expect(queue).toHaveBeenCalledTimes(2); });
    await thread.terminate();
    await vi.waitFor(() => { expect(impl.isEntangledOutsideGlobal()).toBe(false); });
    drain();
    expect(received).toEqual([]);
    port1.start();
    drain();
    expect(received).toEqual(['queued before termination']);
    port1.close();
  });

  it('forwards an endpoint between two worker isolates without routing its messages through the creator', async () => {
    const first = await createMessagingWorker(undefined, true);
    const second = await createMessagingWorker(undefined, true);
    const events: MessageEvent[] = [];
    first.worker.addEventListener('message', (event) => { events.push(event as MessageEvent); });
    first.worker.postMessage({ type: 'create' });
    await first.receive(1);
    const port = events[0]!.ports[0]!;
    second.worker.postMessage({ type: 'hold', name: 'forwarded', port }, [port]);
    second.worker.postMessage({ type: 'start', name: 'forwarded' });
    await second.receive(6);
    expect(second.messages).toEqual([
      expect.objectContaining({ type: 'held', identity: true, realm: true }),
      { type: 'started', name: 'forwarded' },
      expect.objectContaining({ type: 'port-message', value: 'queued in worker' }),
      { type: 'checkpoint', name: 'forwarded' },
      expect.objectContaining({ type: 'port-message', value: 'sent after transfer' }),
      { type: 'checkpoint', name: 'forwarded' },
    ]);
    first.worker.postMessage({ type: 'start', name: 'created' });
    await first.receive(2);
    second.worker.postMessage({ type: 'send', name: 'forwarded', value: 'between isolates' });
    await first.receive(4);
    expect(first.messages[2]).toMatchObject({ type: 'port-message', value: 'between isolates' });
  });

  it('releases transferred endpoints when receiving HTML rejects the message', async () => {
    const outside = createTerminationWorker();
    const { worker, creatorEnv, messages, receive } = await createMessagingWorker(outside, true);
    const { port1, port2 } = creatorEnv.project(new MessageChannelImpl(creatorEnv)) as MessageChannel;
    const foreign = createCreatorEnvironment();
    foreign.realm.agent.agentCluster!.crossOriginIsolationMode = 'concrete';
    foreign.realm.crossOriginIsolated = true;
    // Use an actual incompatible cluster restriction, not a mocked deserializer.
    const serialize = vi.spyOn(creatorEnv, 'serializeWithTransfer').mockImplementation((value, transfer) =>
      foreign.serializeWithTransfer(value, transfer));
    worker.postMessage({ port: port2, buffer: new SharedArrayBuffer(4) }, [port2]);
    serialize.mockRestore();
    await receive(1);
    expect(messages).toEqual(['messageerror']);
    await vi.waitFor(() => { expect(unwrap<MessagePortImpl>(port1).isEntangledOutsideGlobal()).toBe(false); });
    port1.close();
    worker.postMessage({ type: 'create' });
    await receive(2);
    expect(messages[1]).toMatchObject({ type: 'created' });
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

/** Fixture response containing HTML serialization records after a native transport round trip. */
interface StructuredDataReply {
  inspection: { realm: boolean; result?: number; };
  serialized: StructuredSerializeWithTransferResult;
}

function createThread(initialization: WorkerThreadInit = { kind: 'dedicated', data: {} }) {
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

/** Real outside Worker and controlled HTML deliveries; native execution still uses the isolate fixture. */
function createTerminationWorker(enablePort = true) {
  const creatorEnv = createCreatorEnvironment();
  const document = creatorEnv.window.document;
  document.browsingContext = new BrowsingContext(creatorEnv.realm.windowProxy);
  document.makeActive();
  const traversable = new TopLevelTraversable(DocumentState.create(document));
  const implementation = new WorkerImpl(creatorEnv);
  const worker = creatorEnv.project(implementation) as Worker;
  const producer = new MessagePortImpl(creatorEnv);
  producer.entangle(implementation.outsidePort);
  if (enablePort) implementation.outsidePort.start();
  const messages: unknown[] = [];
  worker.onmessage = (event) => { messages.push((event as MessageEvent).data); };
  return {
    traversable, creatorEnv, producer, implementation, worker, messages,
    drain: () => { while (creatorEnv.responsibleEventLoop.runTaskTurn()) { /* Drain runnable outside work. */ } },
  };
}

/** Compose only the existing messaging facilities; production shared services remain unfinished. */
async function createMessagingWorker(outside = createTerminationWorker(), portTransfers = false) {
  const { thread, request } = createThread({ kind: 'dedicated', data: {}, worker: outside.implementation });
  await thread.ready;
  await request({ type: 'prepare-worker-messages', portTransfers });
  thread.connectMessagePort();
  await request({ type: 'start-worker-messages' });
  return {
    ...outside, thread, request,
    async receive(this: void, count: number): Promise<void> {
      await vi.waitFor(() => { outside.drain(); expect(outside.messages).toHaveLength(count); });
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
