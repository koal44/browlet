import { afterEach, assert, describe, expect, it, vi } from 'vitest';

import { parseURL } from '../../../src/url/index';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/index';
import { createWorkerEnvironment } from '../../../src/browlet/integration/web-idl/index';
import {
  AgentCluster, ClassicScript, DedicatedWorkerAgent, JavaScriptModuleScript, ScriptFetchOptions, SharedWorkerAgent,
} from '../../../src/browlet/scripting/index';
import type { DedicatedWorkerGlobalScope, ErrorEvent, SharedWorkerGlobalScope } from '../../../src/browlet/platform';
import { createManualEventLoop, createManualUserAgent } from '../../support/browlet-agent';
import { runInHostTask } from '../../support/tasks';

afterEach(() => vi.restoreAllMocks());

describe.each([false, true])('Worker runtime errors (HTML §10.2.5), shared: %s', (shared) => {
  it('reports a classic script exception locally with the five-argument, true-cancels handler', () => runInHostTask(() => {
    const { env, scope } = createWorker(shared);
    const errors: ErrorEvent[] = [];
    const calls: unknown[][] = [];
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    scope.addEventListener('error', (event) => { errors.push(event as ErrorEvent); });
    scope.onerror = function(this: unknown, ...args: unknown[]) {
      calls.push([this, ...args]);
      return true;
    };

    const script = new ClassicScript('throw new Error("worker failed")', env, env.apiBaseURL, new ScriptFetchOptions());
    const completion = script.run();

    expect(completion.type).toBe('throw');
    expect(errors).toHaveLength(1);
    const event = errors[0]!;
    expect(event).toBeInstanceOf(scope.ErrorEvent);
    expect(event).toMatchObject({
      type: 'error', target: scope, isTrusted: true, cancelable: true, bubbles: false, defaultPrevented: true,
    });
    expect(event.error).toBe(completion.value);
    expect(event.error).toBeInstanceOf(env.realm.Error);
    expect(event.message).toContain('worker failed');
    expect(calls).toEqual([[scope, event.message, event.filename, event.lineno, event.colno, event.error]]);
    expect(consoleError).not.toHaveBeenCalled();
    expect(env.globalImplementation.inErrorReportingMode).toBe(false);
    expect(env.responsibleEventLoop.executionContextStack).toEqual([]);
  }));

  it('reports parse failures and allows an event listener to cancel them', () => runInHostTask(() => {
    const { env, scope } = createWorker(shared);
    const errors: ErrorEvent[] = [];
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    scope.addEventListener('error', (event) => { event.preventDefault(); errors.push(event as ErrorEvent); });
    const script = new ClassicScript('const =', env, env.apiBaseURL, new ScriptFetchOptions());

    script.run();

    expect(script.record).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]!.error).toBe(script.parseError);
    expect(errors[0]!.error).toBeInstanceOf(env.realm.SyntaxError);
    expect(consoleError).not.toHaveBeenCalled();
    expect(env.globalImplementation.inErrorReportingMode).toBe(false);
  }));

  it('reports module evaluation failures through the same worker global', () => runInHostTask(() => {
    const { env, scope } = createWorker(shared, 'module');
    const errors: ErrorEvent[] = [];
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    scope.addEventListener('error', (event) => { event.preventDefault(); errors.push(event as ErrorEvent); });
    const script = new JavaScriptModuleScript('throw new Error("module failed")', env, env.apiBaseURL, new ScriptFetchOptions());
    assert(script.record !== null);
    script.record.link();

    void script.run();
    env.responsibleEventLoop.performMicrotaskCheckpoint();

    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('module failed');
    expect(errors[0]!.error).toBeInstanceOf(env.realm.Error);
    expect(consoleError).not.toHaveBeenCalled();
    expect(env.globalImplementation.inErrorReportingMode).toBe(false);
    expect(env.responsibleEventLoop.executionContextStack).toEqual([]);
  }));

  it('preserves classic-script muting when reporting a worker exception', () => runInHostTask(() => {
    const { env, scope } = createWorker(shared);
    const errors: ErrorEvent[] = [];
    scope.addEventListener('error', (event) => { event.preventDefault(); errors.push(event as ErrorEvent); });
    const script = new ClassicScript('throw new Error("private")', env, env.apiBaseURL, new ScriptFetchOptions(), true);

    script.run();

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ message: 'Script error.', filename: '', lineno: 0, colno: 0, error: null });
  }));
});

describe('Worker error reporting without a dedicated owner', () => {
  it('reports an unhandled shared-worker error to the console after dispatch', () => runInHostTask(() => {
    const { env, scope } = createWorker(true);
    const order: string[] = [];
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => { order.push('console'); });
    // Unlike AbstractWorker.onerror, returning false does not cancel a global error.
    scope.onerror = () => { order.push('event'); return false; };
    const script = new ClassicScript('throw new Error("unhandled")', env, env.apiBaseURL, new ScriptFetchOptions());

    const completion = script.run();

    expect(order).toEqual(['event', 'console']);
    expect(consoleError).toHaveBeenCalledExactlyOnceWith(completion.value);
  }));

  it('does not recursively dispatch errors thrown by an error handler, and resets its guard', () => runInHostTask(() => {
    const { env, scope } = createWorker(true);
    const errors: ErrorEvent[] = [];
    vi.spyOn(console, 'error').mockImplementation(() => {});
    scope.addEventListener('error', (event) => { errors.push(event as ErrorEvent); });
    scope.onerror = () => { throw new env.realm.Error('handler failed'); };
    const script = new ClassicScript('throw new Error("first")', env, env.apiBaseURL, new ScriptFetchOptions());

    script.run();

    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('first');
    expect(env.globalImplementation.inErrorReportingMode).toBe(false);
    scope.onerror = () => true;
    const second = new ClassicScript('throw "second"', env, env.apiBaseURL, new ScriptFetchOptions());
    second.run();
    expect(errors).toHaveLength(2);
    expect(errors[1]!.error).toBe('second');
  }));
});

/** Exercise real worker settings and script runners without inventing outside Worker associations. */
function createWorker(shared: boolean, type: 'classic' | 'module' = 'classic') {
  const userAgent = createManualUserAgent();
  const outsideEnv = TopLevelTraversable.create(userAgent, null, '').activeWindow!.env;
  const agent = shared ? new SharedWorkerAgent(createManualEventLoop()) : new DedicatedWorkerAgent(createManualEventLoop());
  (shared ? new AgentCluster() : outsideEnv.realm.agent.agentCluster!).add(agent);
  const env = createWorkerEnvironment({
    agent, outsideEnv, url: parseURL('https://worker.test/error.js').url!, unsafeWorkerCreationTime: 1234,
    type, name: 'error test', credentials: 'same-origin', extendedLifetime: false,
  });
  env.markExecutionReady();
  return { env, scope: env.global as unknown as DedicatedWorkerGlobalScope | SharedWorkerGlobalScope };
}
