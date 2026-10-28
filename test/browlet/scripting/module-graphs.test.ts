import { afterEach, describe, expect, it, vi } from 'vitest';

import { internalType } from '../../../src/infra/index';
import { Browlet } from '../../../src/browlet/browlet';
import * as scriptClasses from '../../../src/browlet/scripting/script';
import { JSSourceTextModuleRecord, type JavaScriptModuleScript, type ModuleScript } from '../../../src/browlet/scripting/script';
import { ScriptFetchOptions } from '../../../src/browlet/scripting/script-fetch-options';
import { fetchDescendantsAndLink, type PerformScriptFetch } from '../../../src/browlet/scripting/script-fetching';
import { FetchHeaders } from '../../../src/fetch/headers';
import { mockHTTPTransport } from '../../fetch/transport-fixture';
import { getRelevantRealm } from '../../support/browlet-binding';
import { createScriptState } from '../../support/script-state';
import { runInHostTask } from '../../support/tasks';

afterEach(() => vi.restoreAllMocks());

// These isolate HTML's orchestration using real owner Promises and controlled
// loading/linking completion. Engine execution is covered in module-execution.test.ts.
describe('module script graph entry points', () => {
  it('loads and links an external graph after retrieving its root from the module map', async () => {
    const { env, url, script, loading, load, link } = await createFixture();
    env.moduleMap.set(url, 'javascript-or-wasm', script);
    const complete = vi.fn();

    env.fetchExternalModuleScriptGraph(url, new ScriptFetchOptions(), complete);

    expect(load).toHaveBeenCalledExactlyOnceWith({
      errorToRethrow: null, destination: 'script', performFetch: null, fetchClient: env,
    });
    expect(link).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    loading.resolve(undefined);
    await runInHostTask(() => { env.realm.agent.eventLoop.performMicrotaskCheckpoint(); });
    expect(link).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledExactlyOnceWith(script);
  });

  it('reports an external root fetch failure without loading descendants', async () => {
    const { env, url, load, link } = await createFixture();
    mockHTTPTransport(env.userAgent, (_request, listener) => {
      listener.onHeaders(404, '', new FetchHeaders([['Content-Type', 'text/javascript']]), true);
      listener.onEnd();
    });

    const result = await new Promise<ModuleScript | null>((complete) => {
      env.fetchExternalModuleScriptGraph(url, new ScriptFetchOptions(), complete);
    });

    expect(result).toBeNull();
    expect(load).not.toHaveBeenCalled();
    expect(link).not.toHaveBeenCalled();
  });

  it('creates the inline root with its base URL and options before loading descendants', async () => {
    const { env, url, script, loading, load, link } = await createFixture();
    const options = new ScriptFetchOptions();
    const construct = vi.spyOn(scriptClasses, 'JavaScriptModuleScript').mockImplementation(function() { return script; });
    const complete = vi.fn();

    env.fetchInlineModuleScriptGraph('export default 1;', url, options, complete);

    expect(construct).toHaveBeenCalledExactlyOnceWith('export default 1;', env, url, options);
    expect(load).toHaveBeenCalledOnce();
    expect(complete).not.toHaveBeenCalled();
    loading.resolve(undefined);
    await runInHostTask(() => { env.realm.agent.eventLoop.performMicrotaskCheckpoint(); });
    expect(link).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledExactlyOnceWith(script);
  });

  it.each(['fulfillment', 'rejection'] as const)(
    'reports a modulepreload root before loading descendants, without reporting again on %s', async (outcome) => {
      const { env, url, script, loading, load, link } = await createFixture();
      env.moduleMap.set(url, 'javascript-or-wasm', script);
      const complete = vi.fn();
      load.mockImplementation((state) => {
        expect(complete).toHaveBeenCalledExactlyOnceWith(script);
        expect(state.destination).toBe('script');
        return loading.promise;
      });

      env.fetchModulepreloadModuleScriptGraph(url, 'script', new ScriptFetchOptions(), complete);

      expect(load).toHaveBeenCalledOnce();
      if (outcome === 'fulfillment') loading.resolve(undefined);
      else loading.reject(new Error('Dependency fetch failed'));
      await runInHostTask(() => { env.realm.agent.eventLoop.performMicrotaskCheckpoint(); });
      expect(link).toHaveBeenCalledTimes(outcome === 'fulfillment' ? 1 : 0);
      expect(complete).toHaveBeenCalledExactlyOnceWith(script);
    },
  );

  it('reports a failed modulepreload root without requesting descendants', async () => {
    const { env, url, load } = await createFixture();
    env.moduleMap.set(url, 'javascript-or-wasm', null);
    const complete = vi.fn();

    env.fetchModulepreloadModuleScriptGraph(url, 'script', new ScriptFetchOptions(), complete);

    expect(complete).toHaveBeenCalledExactlyOnceWith(null);
    expect(load).not.toHaveBeenCalled();
  });
});

describe('fetch descendants and link a module script', () => {
  it('returns a script with its parse error instead of treating it as a fetch failure', async () => {
    const { env, script, load } = await createFixture();
    const error = new SyntaxError('Invalid module');
    script.record = null;
    script.parseError = error;
    const complete = vi.fn();

    fetchDescendantsAndLink(script, env, 'script', complete);

    expect(script.errorToRethrow).toBe(error);
    expect(complete).toHaveBeenCalledExactlyOnceWith(script);
    expect(load).not.toHaveBeenCalled();
  });

  it('passes the separate fetch client, destination, and custom fetch hook into dependency loading', async () => {
    const { env, script, loading, load, link } = await createFixture();
    const { env: fetchClient } = await createFixture();
    const performFetch = vi.fn<PerformScriptFetch>();
    const complete = vi.fn();

    fetchDescendantsAndLink(script, fetchClient, 'worker', complete, performFetch);

    expect(load).toHaveBeenCalledExactlyOnceWith({
      errorToRethrow: null, destination: 'worker', performFetch, fetchClient,
    });
    expect(script.env).toBe(env);
    expect(complete).not.toHaveBeenCalled();
    loading.resolve(undefined);
    await runInHostTask(() => { env.realm.agent.eventLoop.performMicrotaskCheckpoint(); });
    expect(link).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledExactlyOnceWith(script);
  });

  it.each([false, true])('distinguishes a loading failure from a recorded module error (%s)', async (hasModuleError) => {
    const { env, script, loading, load, link } = await createFixture();
    const error = new SyntaxError('Dependency parse error');
    const complete = vi.fn();
    fetchDescendantsAndLink(script, env, 'script', complete);
    if (hasModuleError) load.mock.calls[0]![0].errorToRethrow = error;

    loading.reject(new Error('Loading rejected'));
    await runInHostTask(() => { env.realm.agent.eventLoop.performMicrotaskCheckpoint(); });

    expect(link).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledExactlyOnceWith(hasModuleError ? script : null);
    expect(script.errorToRethrow).toBe(hasModuleError ? error : null);
  });

  it('retains a linking exception on the completed script', async () => {
    const { env, script, loading, link } = await createFixture();
    const error = new SyntaxError('Missing export');
    link.mockImplementation(() => { throw error; });
    const complete = vi.fn();
    fetchDescendantsAndLink(script, env, 'script', complete);

    loading.resolve(undefined);
    await runInHostTask(() => { env.realm.agent.eventLoop.performMicrotaskCheckpoint(); });

    expect(link).toHaveBeenCalledOnce();
    expect(script.errorToRethrow).toBe(error);
    expect(complete).toHaveBeenCalledExactlyOnceWith(script);
  });
});

async function createFixture() {
  const browser = new Browlet({ route: () => '', reporting: false });
  await browser.navigate('https://modules.test/page');
  const env = getRelevantRealm(browser.window).env;
  const url = env.parseURL('https://modules.test/module.js')!;
  const script: JavaScriptModuleScript = createScriptState(env);
  script.baseURL = url;
  script.fetchOptions = new ScriptFetchOptions();
  const record = new JSSourceTextModuleRecord(script, env.realm.compileModule('', 'fixture.js'));
  script.record = record;
  const loading = env.InternalPromise.withResolvers(internalType<void>());
  const load = vi.spyOn(record, 'loadRequestedModules').mockReturnValue(loading.promise);
  const link = vi.spyOn(record, 'link').mockImplementation(() => {});
  return { env, url, script, loading, load, link };
}
