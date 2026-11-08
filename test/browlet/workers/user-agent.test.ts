import { once } from 'node:events';
import { resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkerUserAgentConnection } from '../../../src/browlet/integration/workers/user-agent';
import { createWindowEnvironment } from '../../../src/browlet/integration/web-idl/index';
import { AgentCluster, WindowAgent } from '../../../src/browlet/scripting/index';
import { UserAgent } from '../../../src/browlet/user-agent';
import type { BrowletEnvironment } from '../../../src/browlet/environment/index';
import { BlobImpl } from '../../../src/file/index';
import { areSameOrigin, createOpaqueOrigin, obtainURLOrigin, parseURL, type Origin } from '../../../src/url/index';
import { createManualEventLoop } from '../../support/browlet-agent';

const connections = new Set<WorkerUserAgentConnection>();
const workers = new Set<Worker>();

afterEach(async () => {
  for (const connection of connections) connection.close();
  await Promise.all([...workers].map((worker) => worker.terminate()));
  connections.clear();
  workers.clear();
  vi.restoreAllMocks();
});

describe('Worker UserAgent URL connection', { timeout: 30_000 }, () => {
  it('reads live browser preferences and configured trust without copying its stores', async () => {
    const env = createEnvironment();
    const { request } = await connect(env);
    const url = 'http://development.test/module.js';
    expect(await request({ type: 'preferences', url })).toMatchObject({
      trusted: false, offline: false, storageEnabled: true, scriptingEnabled: true,
    });
    env.userAgent.defaultUserAgentValue = 'test browser';
    env.userAgent.defaultAcceptLanguage = 'es';
    env.userAgent.assumeNoInternetConnectivity = true;
    env.userAgent.storageEnabled = false;
    env.userAgent.storageQuotaBytes = 12345;
    env.userAgent.scriptingEnabled = false;
    const origin = obtainURLOrigin(parseURL(url).url!);
    if (origin.kind !== 'tuple') throw new Error('Expected tuple origin');
    env.userAgent.trustworthyOrigins.push(origin);
    expect(await request({ type: 'preferences', url })).toEqual({
      userAgent: 'test browser', language: 'es', offline: true, storageEnabled: false,
      quota: 12345, scriptingEnabled: false, trusted: true, hasLoadingNavigable: false,
    });
  });

  it('checks Blob URL trust using the captured creator origin without transporting entry methods', async () => {
    const origin = createOpaqueOrigin();
    const env = createEnvironment('data:text/javascript,', new UserAgent(), origin);
    vi.spyOn(env.userAgent, 'isOriginPotentiallyTrustworthy')
      .mockImplementation((candidate) => areSameOrigin(candidate, origin));
    const { request } = await connect(env);
    const url = env.userAgent.blobURLStore.add(new BlobImpl(['trusted'], {}, env), env);
    expect(await request({ type: 'preferences', url })).toMatchObject({ trusted: true });
  });

  it('releases collected captures while the connection stays open and can capture the registration again', async () => {
    const env = createEnvironment();
    const { connection, request } = await connect(env);
    const url = env.userAgent.blobURLStore.add(new BlobImpl(['retained'], {}, env), env);
    const handle = getHandle(await request({ type: 'parse', url }));
    expect(getHandle(await request({ type: 'parse', url }))).toBe(handle);
    expect(await request({ type: 'forget' })).toEqual({ collected: true });
    await vi.waitFor(() => { expect(connection.getBlobEntry(handle)).toBeNull(); });
    expect(getHandle(await request({ type: 'parse', url }))).toBe(handle);
    expect(connection.getBlobEntry(handle)?.obtainObject(env)).not.toBeNull();
  });

  it('looks up current registrations synchronously and retains captures across owner and worker revocation', async () => {
    const env = createEnvironment();
    const { connection, request } = await connect(env);
    const store = env.userAgent.blobURLStore;
    const blob = new BlobImpl(['hello'], { type: 'text/plain' }, env);
    const url = store.add(blob, env);
    const first = await request({ type: 'parse', url: `${url}#first` });
    expect(first).toMatchObject({ url: `${url}#first`, entry: { env: { origin: env.origin } }, checkpoint: false });
    const handle = getHandle(first);
    expect(env.userAgent.obtainBlobObject(connection.getBlobEntry(handle), env)).toBe(blob);
    expect(getHandle(await request({ type: 'parse', url }))).toBe(handle);

    store.revoke(url, env);
    expect(await request({ type: 'parse', url })).toEqual({ url, entry: null, checkpoint: false });
    expect(env.userAgent.obtainBlobObject(connection.getBlobEntry(handle), env)).toBe(blob);

    const secondURL = store.add(new BlobImpl(['second'], {}, env), env);
    const second = await request({ type: 'parse', url: secondURL });
    // Resolution ignores fragments; removal uses the complete serialized key.
    expect(await request({ type: 'revoke', url: `${secondURL}#fragment` })).toEqual({ checkpoint: false });
    expect(store.resolve(parseURL(secondURL).url!)).not.toBeNull();
    expect(await request({ type: 'revoke', url: secondURL })).toEqual({ checkpoint: false });
    expect(store.resolve(parseURL(secondURL).url!)).toBeNull();
    expect(connection.getBlobEntry(getHandle(second))).not.toBeNull();
    expect(await request({ type: 'parse', url: secondURL })).toEqual({ url: secondURL, entry: null, checkpoint: false });

    connection.close();
    expect(connection.getBlobEntry(handle)).toBeNull();
    expect(await request({ type: 'parse', url })).toMatchObject({ error: 'Worker UserAgent connection is closed or already in use' });
    // Ordinary parsing remains local even after the remote registration service closes.
    expect(await request({ type: 'parse', url: '../dep.js', base: 'https://worker.test/lib/root.js' }))
      .toEqual({ url: 'https://worker.test/dep.js', entry: null, checkpoint: false });
  });

  it('retains the full owner entry while unsupported worker entry services fail explicitly', async () => {
    const env = createEnvironment();
    const { connection, request } = await connect(env);
    const blob = new BlobImpl(['retained'], {}, env);
    const url = env.userAgent.blobURLStore.add(blob, env);
    const result = await request({ type: 'entry-dependencies', url });
    expect(result).toMatchObject({
      entry: { env: { origin: env.origin } },
      errors: [
        'Worker UserAgent Blob backing transport is not connected',
        'Worker UserAgent Blob partition access transport is not connected',
        'Worker UserAgent Blob creator UserAgent transport is not connected',
        'Worker UserAgent Blob creator URL transport is not connected',
        'Worker UserAgent Blob creator policy transport is not connected',
      ],
    });
    const entry = connection.getBlobEntry(getHandle(result));
    expect(entry?.env).toBe(env);
    expect(entry?.isSamePartition(env)).toBe(true);
    expect(entry?.obtainObject(env)).toBe(blob);
    expect(await request({ type: 'parse', url })).toMatchObject({ entry: { env: { origin: env.origin } } });
  });

  it('keeps browser ownership separate and enforces the caller partition for revocation', async () => {
    const owner = createEnvironment();
    const foreign = createEnvironment('https://foreign.test/', owner.userAgent);
    const otherBrowser = createEnvironment();
    const url = owner.userAgent.blobURLStore.add(new BlobImpl(['private'], {}, owner), owner);
    const foreignConnection = await connect(foreign);
    const otherConnection = await connect(otherBrowser);
    // Resolution itself is not the File API access check.
    const found = await foreignConnection.request({ type: 'parse', url });
    expect(found).toMatchObject({ entry: { env: { origin: owner.origin } } });
    expect(owner.userAgent.obtainBlobObject(foreignConnection.connection.getBlobEntry(getHandle(found)), foreign)).toBeNull();
    expect(await foreignConnection.request({ type: 'revoke', url })).toEqual({ checkpoint: false });
    expect(owner.userAgent.blobURLStore.resolve(parseURL(url).url!)).not.toBeNull();
    expect(await otherConnection.request({ type: 'parse', url })).toEqual({ url, entry: null, checkpoint: false });
  });

  it('preserves opaque creator identity across the endpoint', async () => {
    const origin = createOpaqueOrigin();
    const env = createEnvironment('data:text/javascript,', new UserAgent(), origin);
    const { request } = await connect(env);
    const url = env.userAgent.blobURLStore.add(new BlobImpl([], {}, env), env);
    const result = await request({ type: 'parse', url });
    expect(result).toMatchObject({ entry: { env: { origin } } });
    expect(await request({ type: 'revoke', url })).toEqual({ checkpoint: false });
    expect(env.userAgent.blobURLStore.resolve(parseURL(url).url!)).toBeNull();
    expect(areSameOrigin(origin, env.origin)).toBe(true);
  });

  it('propagates a service failure, permits the next call, and wakes an outstanding call on close', async () => {
    const env = createEnvironment();
    const { connection, request } = await connect(env);
    const url = env.userAgent.blobURLStore.add(new BlobImpl([], {}, env), env);
    const lookup = vi.spyOn(env.userAgent.blobURLStore, 'resolve');
    lookup.mockImplementationOnce(() => { throw new Error('lookup failed'); });
    expect(await request({ type: 'parse', url })).toEqual({ error: 'lookup failed' });
    expect(await request({ type: 'parse', url })).toMatchObject({ entry: { env: { origin: env.origin } } });
    lookup.mockImplementationOnce(() => { connection.close(); return null; });
    expect(await request({ type: 'parse', url })).toEqual({ error: 'Worker UserAgent connection closed before replying' });
  });

  it('releases captured registrations when the worker endpoint closes', async () => {
    const env = createEnvironment();
    const { connection, request } = await connect(env);
    const url = env.userAgent.blobURLStore.add(new BlobImpl([], {}, env), env);
    const handle = getHandle(await request({ type: 'parse', url }));
    expect(await request({ type: 'close' })).toEqual({ closed: true });
    await vi.waitFor(() => { expect(connection.getBlobEntry(handle)).toBeNull(); });
  });
});

/** Create the real browser/caller identity without fetching or executing a document. */
function createEnvironment(url = 'https://worker.test/', userAgent: UserAgent = new UserAgent(), origin?: Origin) {
  const agent = new WindowAgent(createManualEventLoop());
  new AgentCluster().add(agent);
  const creationURL = parseURL(url).url!;
  origin ??= obtainURLOrigin(creationURL);
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

/** Transfer a connection into a real isolate while keeping the browser owner and its stores here. */
async function connect(env: BrowletEnvironment) {
  const connection = new WorkerUserAgentConnection(env.userAgent, env);
  connections.add(connection);
  const worker = new Worker(resolve(__dirname, 'fixtures/user-agent.cjs'), {
    workerData: connection.init, transferList: [connection.init.port],
  });
  workers.add(worker);
  expect((await once(worker, 'message'))[0]).toBe('ready');
  return {
    connection,
    async request(this: void, message: {
      type: 'parse' | 'revoke' | 'close' | 'preferences' | 'forget' | 'entry-dependencies';
      url?: string;
      base?: string;
    }): Promise<unknown> {
      const reply = once(worker, 'message');
      worker.postMessage(message);
      return (await reply)[0];
    },
  };
}

/** Narrow the fixture's untyped native reply without asserting a TypeScript conversion. */
function getHandle(result: unknown): number {
  if (typeof result !== 'object' || result === null || !('entry' in result)) throw new Error('Missing registration');
  const entry = result.entry;
  if (typeof entry !== 'object' || entry === null || !('id' in entry) || typeof entry.id !== 'number') {
    throw new Error('Missing registration handle');
  }
  return entry.id;
}
