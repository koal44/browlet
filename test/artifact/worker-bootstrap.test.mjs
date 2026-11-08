import assert from 'node:assert/strict';
import { on, once } from 'node:events';
import { cpSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve, sep } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MessageChannel, Worker } from 'node:worker_threads';

const root = fileURLToPath(new URL('../..', import.meta.url));
// Relocate only published files. Installed dependencies are available above this
// directory, but no source files, fixtures, or TypeScript loaders are copied.
// This worktree shares node_modules through a junction. Match the actual module
// URL that Node loads, just as production obtains it from import.meta.url.
const artifactRoot = realpathSync(resolve(root, 'node_modules'));
const relocated = mkdtempSync(join(artifactRoot, ".browlet-worker # artifact's-"));
after(() => {
  assert.ok(resolve(relocated).startsWith(artifactRoot + sep));
  rmSync(relocated, { recursive: true, force: true });
});
cpSync(join(root, 'packages/browlet/package.json'), join(relocated, 'package.json'));
cpSync(join(root, 'packages/browlet/dist'), join(relocated, 'dist'), { recursive: true });

for (const extension of ['mjs', 'cjs']) {
  const entryPath = join(relocated, 'dist', `index.${extension}`);
  const entryURL = pathToFileURL(entryPath).href;

  test(`relocated ${extension} package retains its public surface without a bootstrap artifact`, async () => {
    const require = createRequire(entryPath);
    const api = extension === 'mjs' ? await import(entryURL) : require(entryPath);
    assert.deepEqual(Object.keys(api), ['Browlet']);
    assert.equal(readdirSync(join(relocated, 'dist')).includes('worker-bootstrap.cjs'), false);
    assert.throws(() => require.resolve('#browlet-worker-bootstrap'));
    assert.throws(() => require.resolve('browlet/worker-bootstrap'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
  });

  for (const kind of ['dedicated', 'shared']) {
    test(`relocated ${extension} package is its own ${kind} worker entry and composes its environment`, { timeout: 30_000 }, async (t) => {
      const { thread, errors } = start(t, entryPath, { jsThreadEntry: entryURL, data: configuredStartup(t, kind) });
      // Readiness is emitted only after production realm/environment composition.
      // There is no source fixture or replacement Window/UserAgent in this isolate.
      assert.deepEqual(await once(thread, 'message'), [{ type: 'ready' }]);
      assert.equal(await thread.terminate(), 1);
      assert.deepEqual(errors, []);
    });
  }

  test(`${extension} production startup requests its root and reports a rejected response`, { timeout: 30_000 }, async (t) => {
    const { thread, errors } = start(t, entryPath, { jsThreadEntry: entryURL, data: configuredStartup(t, 'dedicated') });
    const messages = on(thread, 'message');
    t.after(async () => { await messages.return(); });
    assert.deepEqual((await messages.next()).value, [{ type: 'ready' }]);
    assert.deepEqual((await messages.next()).value, [{ type: 'fetch-script' }]);
    thread.postMessage({
      type: 'script-response', snapshot: {
        type: 'error', aborted: false, urlList: [], status: 0, statusMessage: '', headers: [], bodyBytes: null,
        policyContainer: null, embedderPolicyAllowed: true, outsideCrossOriginIsolatedCapability: false,
      },
    });
    assert.deepEqual((await messages.next()).value, [{ type: 'script-fetch-failed' }]);
    // The real parent WorkerThread consumes this message and terminates the
    // execution owner. This raw transport test performs that final host action.
    assert.equal(await thread.terminate(), 1);
    assert.deepEqual(errors, []);
  });

  test(`${extension} production startup retains the accepted-response service dependency`, { timeout: 30_000 }, async (t) => {
    const startup = configuredStartup(t, 'dedicated');
    const { thread, exited } = start(t, entryPath, { jsThreadEntry: entryURL, data: startup });
    const messages = on(thread, 'message');
    t.after(async () => { await messages.return(); });
    assert.deepEqual((await messages.next()).value, [{ type: 'ready' }]);
    assert.deepEqual((await messages.next()).value, [{ type: 'fetch-script' }]);
    await messages.return();
    const failure = once(thread, 'error');
    thread.postMessage({
      type: 'script-response', snapshot: {
        type: 'default', aborted: false, urlList: [startup.script.url], status: 200, statusMessage: 'OK',
        headers: [['Content-Type', 'text/javascript']], bodyBytes: new TextEncoder().encode('throw new Error("script ran");'),
        policyContainer: startup.creatorEnvSnapshot.policyContainer,
        embedderPolicyAllowed: true, outsideCrossOriginIsolatedCapability: false,
      },
    });
    const [error] = await failure;
    assert.equal(error.message, 'Worker script execution requires owner monitoring and shared services');
    assert.equal(await exited, 1);
  });

  test(`${extension} startup can be cancelled before host readiness`, { timeout: 30_000 }, async (t) => {
    const { thread, errors } = start(t, entryPath, { jsThreadEntry: entryURL, data: configuredStartup(t, 'dedicated') });
    const messages = [];
    thread.on('message', (message) => { messages.push(message); });
    // Native cancellation before any execution may report normal exit rather
    // than the nonzero code used when interrupting an already-running isolate.
    assert.ok([0, 1].includes(await thread.terminate()));
    assert.deepEqual(messages, []);
    assert.deepEqual(errors, []);
  });

  test(`${extension} worker reports the unfinished service/execution boundary`, { timeout: 30_000 }, async (t) => {
    const { thread, exited } = start(t, entryPath, { jsThreadEntry: entryURL, data: configuredStartup(t, 'dedicated') });
    await once(thread, 'message');
    const failure = once(thread, 'error');
    thread.postMessage({ type: 'message', data: { type: 'start', url: 'https://example.test/worker.js' } });
    const [error] = await failure;
    assert.equal(error.message, 'Worker shared services and script execution are not implemented');
    assert.equal(await exited, 1);
  });

  for (const message of [{ type: 'unexpected' }, {}]) {
    test(`${extension} worker diagnoses unknown input kind: ${JSON.stringify(message)}`, { timeout: 30_000 }, async (t) => {
      const { thread, exited } = start(t, entryPath, { jsThreadEntry: entryURL, data: configuredStartup(t, 'dedicated') });
      await once(thread, 'message');
      const failure = once(thread, 'error');
      // Deliberately bypass the typed host sender to test the receive boundary.
      thread.postMessage(message);
      const [error] = await failure;
      assert.equal(error.message, 'Unknown worker thread input message kind');
      assert.equal(await exited, 1);
    });
  }

  for (const marker of [undefined, 'file:///another-installed-copy/index.mjs']) {
    test(`${extension} ordinary import in another worker, ${marker ? 'different' : 'absent'} startup marker`,
      { timeout: 30_000 }, async (t) => {
        const { thread, exited, errors } = start(t,
          fileURLToPath(new URL('./fixtures/worker-import.mjs', import.meta.url)),
          { entryURL, extension, jsThreadEntry: marker },
        );
        assert.deepEqual(await once(thread, 'message'), [{ type: 'imported', exports: ['Browlet'] }]);
        assert.equal(await exited, 0);
        assert.deepEqual(errors, []);
      });
  }
}

/** Supply only the private wire records; the relocated bundle must construct all implementations itself. */
function configuredStartup(t, kind) {
  const channel = new MessageChannel();
  const state = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  t.after(() => { channel.port1.close(); channel.port2.close(); });
  // These bundle tests exercise startup, not browser services. Fail a surprise
  // synchronous service request explicitly instead of leaving the worker waiting.
  channel.port1.on('message', (message) => {
    channel.port1.postMessage({ type: 'response', result: null, error: `Unexpected artifact service request: ${message.type}` });
    Atomics.store(state, 0, 2); // The private service protocol's replied state.
    Atomics.notify(state, 0);
  });
  const host = { kind: 'domain', value: 'creator.test' };
  const origin = { kind: 'tuple', scheme: 'https', host, port: null, domain: null };
  const url = {
    scheme: 'https', username: '', password: '', host, port: null,
    path: ['worker.js'], query: null, fragment: null, blobURLEntry: null,
  };
  return {
    kind, data: undefined, ownerState: 'active',
    userAgent: {
      port: channel.port2, state,
      scriptingPolicy: new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)).fill(1),
    },
    script: { url, origin, type: 'classic', credentials: 'same-origin', name: 'artifact', environmentId: 'worker-client', extendedLifetime: false },
    creatorEnvSnapshot: {
      environmentId: 'creator-client', agentClusterId: 'creator-cluster', crossOriginIsolationMode: 'none', isOriginKeyed: false,
      creationURL: url, apiBaseURL: url, topLevelCreationURL: url, origin, topLevelOrigin: origin,
      isSecureContext: true, hasCrossSiteAncestor: false, crossOriginIsolatedCapability: false,
      policyContainer: {
        cspList: undefined, referrerPolicy: 'strict-origin-when-cross-origin',
        embedderPolicy: { value: 'unsafe-none', reportingEndpoint: '', reportOnlyValue: 'unsafe-none', reportOnlyReportingEndpoint: '' },
        integrityPolicy: { sources: [], blockedDestinations: [], endpoints: [] },
        reportOnlyIntegrityPolicy: { sources: [], blockedDestinations: [], endpoints: [] },
      },
    },
  };
}

function start(t, entryPath, workerData) {
  // No eval, source checkout, TypeScript loader, or caller-supplied bootstrap in
  // the production entry. The foreign-worker test uses its own ordinary file.
  const transferList = workerData.data?.userAgent === undefined ? [] : [workerData.data.userAgent.port];
  const thread = new Worker(entryPath, { workerData, transferList });
  const errors = [];
  thread.on('error', (error) => { errors.push(error); });
  const exited = new Promise((resolveExit) => { thread.once('exit', resolveExit); });
  t.after(async () => { await thread.terminate(); });
  return { thread, errors, exited };
}
