import { afterEach, describe, expect, it, vi } from 'vitest';
import { itPassesWith } from '../../test-runtime';

import type { InternalPromise } from '../../../src/infra/index';
import { idlType } from '../../../src/web-idl/core/index';
import { Browlet } from '../../../src/browlet/browlet';
import type { BrowletEnvironment } from '../../../src/browlet/environment';
import { ClassicScript, TextModuleScript, emptyCompletionValue, type ScriptCompletion } from '../../../src/browlet/scripting/script';
import { ScriptFetchOptions } from '../../../src/browlet/scripting/script-fetch-options';
import { createTaskSource } from '../../../src/browlet/scripting/event-loop';
import { getRelevantRealm } from '../../support/browlet-binding';

afterEach(() => vi.restoreAllMocks());

describe('run a classic script', () => {
  it.each(['disabled', 'inactive'] as const)('returns an empty completion for %s settings without entering execution', (policy) => {
    const { env, script, loop } = fixture();
    const evaluate = vi.spyOn(script.record!, 'evaluate');
    const prepare = vi.spyOn(loop, 'prepareToRunScript');
    if (policy === 'disabled') env.userAgent.scriptingEnabled = false;
    else env.window.document.browsingContext = null;

    expect(script.run()).toEqual({ type: 'normal', value: emptyCompletionValue });
    expect(evaluate).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it('prepares the task settings, preserves the completion, and cleans up', () => {
    const { env, script, loop } = fixture();
    const completion: ScriptCompletion = { type: 'normal', value: undefined };
    vi.spyOn(script.record!, 'evaluate').mockImplementation(() => {
      expect(loop.runningExecutionContext).toBe(env.realmExecutionContext);
      expect(loop.currentlyRunningTask!.scriptEvaluationEnvironments.has(env)).toBe(true);
      return completion;
    });
    const checkpoint = vi.spyOn(loop, 'performMicrotaskCheckpoint');
    let result: ScriptCompletion | undefined;
    loop.queueTask(createTaskSource('classic-script-test'), env.window.document, () => { result = script.run(); });
    expect(loop.runTaskTurn()).toBe(true);
    expect(result).toBe(completion);
    expect(result!.value).not.toBe(emptyCompletionValue);
    expect(loop.executionContextStack).toHaveLength(0);
    expect(checkpoint).toHaveBeenCalled();
  });

  it('reports a stored parse error while its realm context is still prepared', () => {
    const { env, loop } = fixture();
    const script = new ClassicScript('const =', env, env.apiBaseURL, new ScriptFetchOptions());
    const report = vi.spyOn(env, 'reportException').mockImplementation((error) => {
      expect(error).toBe(script.parseError);
      expect(script.record).toBeNull();
      expect(loop.runningExecutionContext).toBe(env.realmExecutionContext);
      expect(loop.runningScript).toBeNull();
    });
    expect(script.run()).toEqual({ type: 'throw', value: script.parseError });
    expect(report).toHaveBeenCalledExactlyOnceWith(script.parseError, false, script);
    expect(loop.executionContextStack).toHaveLength(0);
  });

  it.each([false, true])('rethrows only after cleanup, with muted errors %s', (muted) => {
    const { env, script, loop } = fixture();
    const error = new env.realm.Error('private details');
    script.errorToRethrow = error;
    script.mutedErrors = muted;
    const report = vi.spyOn(env, 'reportException');
    let thrown: unknown;
    try { script.run(true); } catch (reason) { thrown = reason; }
    expect(loop.executionContextStack).toHaveLength(0);
    expect(report).not.toHaveBeenCalled();
    if (!muted) {
      expect(thrown).toBe(error);
    } else {
      expect(thrown).toBeInstanceOf(env.DOMException);
      expect(thrown).toMatchObject({ name: 'NetworkError', message: '' });
    }
  });

  it('reports an evaluation throw without changing its completion', () => {
    const { env, script, loop } = fixture();
    const completion: ScriptCompletion = { type: 'throw', value: 42 };
    vi.spyOn(script.record!, 'evaluate').mockReturnValue(completion);
    const report = vi.spyOn(env, 'reportException').mockImplementation(() => {});
    expect(script.run()).toBe(completion);
    expect(report).toHaveBeenCalledExactlyOnceWith(42, false, script);
    expect(loop.executionContextStack).toHaveLength(0);
  });

  it('returns a realm-owned QuotaExceededError after a termination outcome', () => {
    const { env, script, loop } = fixture();
    vi.spyOn(script.record!, 'evaluate').mockReturnValue(null);
    Reflect.set(env.global, 'QuotaExceededError', () => { throw new Error('author replacement'); });
    const report = vi.spyOn(env, 'reportException');
    const result = script.run(true);
    expect(result.type).toBe('throw');
    expect(result.value).toMatchObject({ name: 'QuotaExceededError', quota: null, requested: null });
    expect(getRelevantRealm(result.value as object)).toBe(env.realm);
    expect(loop.executionContextStack).toHaveLength(0);
    expect(report).not.toHaveBeenCalled();
  });

  it('runs retained code in its existing Window and exposes the active script during execution', () => {
    const { env, loop } = fixture();
    const script = new ClassicScript('inspect(); var retainedCount = (typeof retainedCount === "undefined" ? 0 : retainedCount) + 1; ({ count: retainedCount })',
      env, env.apiBaseURL, new ScriptFetchOptions());
    const inspect = vi.fn(() => {
      expect(loop.executionContextStack).toHaveLength(2);
      expect(loop.executionContextStack[0]).toBe(env.realmExecutionContext);
      expect(loop.runningExecutionContext!.realm).toBe(env.realm);
      expect(loop.runningExecutionContext!.scriptOrModule).toBe(script.record);
      expect(loop.runningScript).toBe(script);
    });
    Reflect.set(env.global, 'inspect', inspect);
    expect(Reflect.has(env.global, 'retainedCount')).toBe(false);
    const parse = vi.spyOn(env.realm, 'parseScript');
    const sourceEvaluation = vi.spyOn(env.realm, 'evaluate');

    const first = script.run();
    expect(first.type).toBe('normal');
    expect(first.value).toEqual({ count: 1 });
    expect(Object.getPrototypeOf(first.value)).toBe(env.realm.objectPrototype);
    expect(script.run()).toEqual({ type: 'normal', value: { count: 2 } });
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(parse).not.toHaveBeenCalled();
    expect(sourceEvaluation).not.toHaveBeenCalled();
    expect(loop.executionContextStack).toHaveLength(0);
  });

  it('preserves a thrown value, restores the outer script, and can execute again', () => {
    const { env, loop } = fixture();
    const reason = new env.realm.Error('retained failure');
    Reflect.set(env.global, 'reason', reason);
    const nested = new ClassicScript('throw reason', env, env.apiBaseURL, new ScriptFetchOptions());
    const outer = new ClassicScript('nested(); 42', env, env.apiBaseURL, new ScriptFetchOptions());
    const invokeNested = vi.fn(() => {
      const context = loop.runningExecutionContext;
      expect(loop.runningScript).toBe(outer);
      expect(() => nested.run(true)).toThrow(reason);
      expect(loop.runningExecutionContext).toBe(context);
      expect(loop.runningScript).toBe(outer);
    });
    Reflect.set(env.global, 'nested', invokeNested);
    expect(outer.run()).toEqual({ type: 'normal', value: 42 });
    expect(invokeNested).toHaveBeenCalledOnce();
    const report = vi.spyOn(env, 'reportException').mockImplementation(() => {});
    expect(nested.run()).toEqual({ type: 'throw', value: reason });
    expect(report).toHaveBeenCalledExactlyOnceWith(reason, false, nested);
    expect(loop.executionContextStack).toHaveLength(0);
    expect(outer.run()).toEqual({ type: 'normal', value: 42 });
  });

  // Approved stock limitations: Node's separate global proxy and ambient queue.
  // The source path is a control for the pre-existing global-var discrepancy.
  itPassesWith('nativeGlobals').each(['source', 'retained'] as const)('shares global var declarations with Window globalThis (%s)', (path) => {
    const { env } = fixture();
    const source = 'var retainedGlobal = 42; globalThis.retainedGlobal';
    const value = path === 'source'
      ? env.realm.evaluate(source, 'global-var.js')
      : new ClassicScript(source, env, env.apiBaseURL, new ScriptFetchOptions()).run().value;
    expect(value).toBe(42);
  });

  itPassesWith('explicitQueues')('leaves script reactions for the task cleanup checkpoint', () => {
    const { env, loop } = fixture();
    const trace: string[] = [];
    Reflect.set(env.global, 'record', (value: string) => { trace.push(value); });
    const script = new ClassicScript('Promise.resolve().then(() => record("reaction")); record("script");',
      env, env.apiBaseURL, new ScriptFetchOptions());
    loop.queueTask(createTaskSource('retained-script-test'), env.window.document, () => {
      const cleanup = loop.cleanUpAfterRunningScript.bind(loop);
      vi.spyOn(loop, 'cleanUpAfterRunningScript').mockImplementationOnce((settings) => {
        expect(trace).toEqual(['script']);
        expect(loop.runningExecutionContext).toBe(env.realmExecutionContext);
        cleanup(settings);
      });
      script.run();
      expect(trace).toEqual(['script', 'reaction']);
    });
    expect(loop.runTaskTurn()).toBe(true);
    expect(loop.executionContextStack).toHaveLength(0);
  });
});

describe('run a module script', () => {
  it.each(['disabled', 'inactive'] as const)('resolves without evaluation or preparation for %s settings', async (policy) => {
    const { env, module, loop } = fixture();
    const evaluate = vi.spyOn(module.record!, 'evaluate');
    const prepare = vi.spyOn(loop, 'prepareToRunScript');
    if (policy === 'disabled') env.userAgent.scriptingEnabled = false;
    else env.window.document.browsingContext = null;
    const result = module.run();
    expect(evaluate).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    // Observing the resolved promise subsequently enters its realm's Promise job.
    await expect(observe(result, env)).resolves.toBeUndefined();
  });

  it('returns the evaluation promise and cleans up before it settles', async () => {
    const { env, module, loop } = fixture();
    const pending = env.InternalPromise.withResolvers(idlType.undefined);
    vi.spyOn(module.record!, 'evaluate').mockImplementation(() => {
      expect(loop.runningExecutionContext).toBe(env.realmExecutionContext);
      return pending.promise;
    });
    const result = module.run();
    expect(result).toBe(pending.promise);
    expect(loop.executionContextStack).toHaveLength(0);
    pending.resolve(undefined);
    await expect(observe(result, env)).resolves.toBeUndefined();
  });

  it.each([false, true])('retains the stored error and honors preventErrorReporting %s', async (prevent) => {
    const { env, module, loop } = fixture();
    const reason = new env.realm.SyntaxError('dependency failed');
    module.errorToRethrow = reason;
    const evaluate = vi.spyOn(module.record!, 'evaluate');
    const report = vi.spyOn(env, 'reportException').mockImplementation(() => {});
    const result = module.run(prevent);
    await expect(observe(result, env)).rejects.toBe(reason);
    expect(evaluate).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledTimes(prevent ? 0 : 1);
    if (!prevent) expect(report).toHaveBeenCalledWith(reason);
    expect(loop.executionContextStack).toHaveLength(0);
  });

  it('reports a later evaluation rejection without replacing its promise', async () => {
    const { env, module } = fixture();
    const pending = env.InternalPromise.withResolvers(idlType.undefined);
    const reason = new env.realm.Error('top-level await rejected');
    const report = vi.spyOn(env, 'reportException').mockImplementation(() => {});
    vi.spyOn(module.record!, 'evaluate').mockReturnValue(pending.promise);
    const result = module.run();
    expect(result).toBe(pending.promise);
    expect(report).not.toHaveBeenCalled();
    pending.reject(reason);
    await expect(observe(result, env)).rejects.toBe(reason);
    expect(report).toHaveBeenCalledExactlyOnceWith(reason);
  });

  it('rejects with a realm-owned QuotaExceededError for termination', async () => {
    const { env, module, loop } = fixture();
    vi.spyOn(module.record!, 'evaluate').mockReturnValue(null);
    let reason: unknown;
    await observe(module.run(true), env).catch((error: unknown) => { reason = error; });
    expect(reason).toMatchObject({ name: 'QuotaExceededError', quota: null, requested: null });
    expect(getRelevantRealm(reason as object)).toBe(env.realm);
    expect(loop.executionContextStack).toHaveLength(0);
  });

  it('evaluates the linked synthetic record and preserves its default export', async () => {
    const { env, module, loop } = fixture();
    const report = vi.spyOn(env, 'reportException');
    module.record!.link();
    await expect(observe(module.run(), env)).resolves.toBeUndefined();
    expect(Reflect.get(env.realm.getModuleNamespace(module.record!.code), 'default')).toBe('text');
    expect(loop.executionContextStack).toHaveLength(0);
    expect(report).not.toHaveBeenCalled();
  });
});

function fixture() {
  const browser = new Browlet({ route: () => '', reporting: false });
  const env = getRelevantRealm(browser.window).env;
  return {
    env,
    loop: env.responsibleEventLoop,
    script: new ClassicScript('', env, env.apiBaseURL, new ScriptFetchOptions()),
    module: new TextModuleScript('text', env),
  };
}

function observe<T>(promise: InternalPromise<T>, env: BrowletEnvironment): Promise<T> {
  const result = new Promise<T>((resolve, reject) => { promise.observe(resolve, reject); });
  env.responsibleEventLoop.performMicrotaskCheckpoint();
  return result;
}
