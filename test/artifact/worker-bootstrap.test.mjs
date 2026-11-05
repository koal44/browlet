import assert from 'node:assert/strict';
import { once } from 'node:events';
import { cpSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve, sep } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';

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
    test(`relocated ${extension} package is its own ${kind} worker entry`, { timeout: 30_000 }, async (t) => {
      const { thread, errors } = start(t, entryPath, { jsThreadEntry: entryURL, data: { kind, data: undefined, creatorEnvSnapshot: null } });
      assert.deepEqual(await once(thread, 'message'), [{ type: 'ready' }]);
      assert.equal(await thread.terminate(), 1);
      assert.deepEqual(errors, []);
    });
  }

  test(`${extension} startup can be cancelled before host readiness`, { timeout: 30_000 }, async (t) => {
    const { thread, errors } = start(t, entryPath, { jsThreadEntry: entryURL, data: { kind: 'dedicated', creatorEnvSnapshot: null } });
    const messages = [];
    thread.on('message', (message) => { messages.push(message); });
    // Native cancellation before any execution may report normal exit rather
    // than the nonzero code used when interrupting an already-running isolate.
    assert.ok([0, 1].includes(await thread.terminate()));
    assert.deepEqual(messages, []);
    assert.deepEqual(errors, []);
  });

  test(`${extension} worker reports the unfinished settings/service boundary`, { timeout: 30_000 }, async (t) => {
    const { thread, exited } = start(t, entryPath, { jsThreadEntry: entryURL, data: { kind: 'dedicated', creatorEnvSnapshot: null } });
    await once(thread, 'message');
    const failure = once(thread, 'error');
    thread.postMessage({ type: 'message', data: { type: 'start', url: 'https://example.test/worker.js' } });
    const [error] = await failure;
    assert.equal(error.message, 'Worker settings and shared-service transport are not implemented');
    assert.equal(await exited, 1);
  });

  for (const message of [{ type: 'unexpected' }, {}]) {
    test(`${extension} worker diagnoses unknown input kind: ${JSON.stringify(message)}`, { timeout: 30_000 }, async (t) => {
      const { thread, exited } = start(t, entryPath, { jsThreadEntry: entryURL, data: { kind: 'dedicated', creatorEnvSnapshot: null } });
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

function start(t, entryPath, workerData) {
  // No eval, source checkout, TypeScript loader, or caller-supplied bootstrap in
  // the production entry. The foreign-worker test uses its own ordinary file.
  const thread = new Worker(entryPath, { workerData });
  const errors = [];
  thread.on('error', (error) => { errors.push(error); });
  const exited = new Promise((resolveExit) => { thread.once('exit', resolveExit); });
  t.after(async () => { await thread.terminate(); });
  return { thread, errors, exited };
}
