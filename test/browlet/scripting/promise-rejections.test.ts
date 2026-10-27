import { afterEach, describe, expect, it, vi } from 'vitest';

import * as JSEngine from '../../../src/js-engine/index';
import { Browlet } from '../../../src/browlet/browlet';
import type { PromiseRejectionEvent, PromiseRejectionEventConstructor } from '../../../src/browlet/platform';
import { ClassicScript } from '../../../src/browlet/scripting/script';
import { ScriptFetchOptions } from '../../../src/browlet/scripting/script-fetch-options';
import { JSExecutionContext } from '../../../src/browlet/scripting/execution-context';
import { domManipulationTaskSource } from '../../../src/browlet/scripting/tasks';
import { getRelevantRealm } from '../../support/browlet-binding';
import { mockEventLoopTurns } from '../../support/browlet-agent';

afterEach(() => vi.restoreAllMocks());

describe('PromiseRejectionEvent', () => {
  it('preserves the original Promise and reason through the projected constructor', async () => {
    const result = await browser().evaluate(() => {
      const promise = Promise.resolve(42);
      const reason = { message: 'failed' };
      const event = new PromiseRejectionEvent('unhandledrejection', { promise, reason, cancelable: true });
      return {
        inheritsEvent: event instanceof Event,
        promise: event.promise === promise, reason: event.reason === reason,
        cancelable: event.cancelable, bubbles: event.bubbles, isTrusted: event.isTrusted,
        writable: Reflect.set(event, 'promise', {}),
      };
    });
    expect(result).toEqual({
      inheritsEvent: true, promise: true, reason: true, cancelable: true,
      bubbles: false, isTrusted: false, writable: false,
    });
  });

  it('accepts any object without Promise conversion and defaults reason to undefined', async () => {
    const result = await browser().evaluate(() => {
      let reads = 0;
      const promise = { get then() { reads++; throw new Error('must not read then'); } };
      // lib.dom still types this member as Promise; HTML and our generated IDL use object.
      const EventConstructor = PromiseRejectionEvent as unknown as PromiseRejectionEventConstructor;
      const event = new EventConstructor('rejectionhandled', { promise });
      return { same: event.promise === promise, reason: event.reason as unknown, reads, cancelable: event.cancelable };
    });
    expect(result).toEqual({ same: true, reason: undefined, reads: 0, cancelable: false });
  });

  it('requires an object-valued promise member through Web IDL', async () => {
    const result = await browser().evaluate(() =>
      [undefined, null, {}, { promise: undefined }, { promise: null }, { promise: 1 }].map((init) => {
        try { Reflect.construct(PromiseRejectionEvent, ['unhandledrejection', init]); }
        catch (error) { return error instanceof TypeError; }
        return false;
      }),
    );
    expect(result).toEqual([true, true, true, true, true, true]);
  });
});

// These tests drive HTML's tracker and notification task explicitly. Only the
// missing engine slot reads are substituted; native rejection delivery is not
// connected yet. Pending real Promises preserve object identity without causing
// unrelated unhandled rejections in Node or installing a handler to suppress them.
describe('HTML rejected-promise notification', () => {
  it('does not queue a task for an empty pending list', () => {
    const { env, loop } = fixture();
    env.notifyAboutRejectedPromises();
    expect(loop.getTaskQueue(domManipulationTaskSource).size).toBe(0);
  });

  it('clears the pending list and later fires a trusted cancelable event at its owning global', () => {
    const { env, loop, window, reject, output } = fixture();
    const reason = { failed: true };
    const { promise } = reject(reason);
    const events: PromiseRejectionEvent[] = [];
    window.addEventListener('unhandledrejection', (event) => {
      events.push(event as PromiseRejectionEvent);
      event.preventDefault();
      expect(loop.currentlyRunningTask?.source).toBe(domManipulationTaskSource);
    });

    env.notifyAboutRejectedPromises();
    expect(env.globalImplementation.aboutToBeNotifiedRejectedPromises).toEqual([]);
    expect(events).toEqual([]);
    expect(loop.getTaskQueue(domManipulationTaskSource).size).toBe(1);
    expect(loop.runTaskTurn()).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ promise, reason, isTrusted: true, cancelable: true, bubbles: false });
    expect(getRelevantRealm(events[0]!)).toBe(env.realm);
    expect(env.globalImplementation.outstandingRejectedPromises.has(promise)).toBe(true);
    expect(output).not.toHaveBeenCalled();
  });

  it('logs an uncanceled rejection after dispatch without firing a runtime error event', () => {
    const { env, loop, window, reject, output } = fixture();
    const order: string[] = [];
    output.mockImplementation(() => { order.push('console'); });
    window.addEventListener('unhandledrejection', () => { order.push('event'); });
    const error = vi.fn();
    window.addEventListener('error', error);
    reject('failure');
    env.notifyAboutRejectedPromises();
    loop.runTaskTurn();
    expect(order).toEqual(['event', 'console']);
    expect(output).toHaveBeenCalledExactlyOnceWith('failure');
    expect(error).not.toHaveBeenCalled();
  });

  it('removes a rejection handled before notification from the pending list', () => {
    const { env, loop, reject } = fixture();
    const rejected = reject(42);
    rejected.handle();
    env.notifyAboutRejectedPromises();
    expect(env.globalImplementation.aboutToBeNotifiedRejectedPromises).toEqual([]);
    expect(loop.getTaskQueue(domManipulationTaskSource).size).toBe(0);
  });

  it('rechecks handled state after notification is queued', () => {
    const { env, loop, window, reject, output } = fixture();
    const listener = vi.fn();
    window.addEventListener('unhandledrejection', listener);
    window.addEventListener('rejectionhandled', listener);
    const rejected = reject(42);
    env.notifyAboutRejectedPromises();
    rejected.handle();
    loop.runTaskTurn();
    expect(listener).not.toHaveBeenCalled();
    expect(output).not.toHaveBeenCalled();
    expect(env.globalImplementation.outstandingRejectedPromises.has(rejected.promise)).toBe(false);
  });

  it('does not retain a promise handled by its unhandledrejection listener', () => {
    const { env, loop, window, reject } = fixture();
    const rejected = reject(42);
    const handled = vi.fn();
    window.addEventListener('rejectionhandled', handled);
    window.addEventListener('unhandledrejection', (event) => {
      event.preventDefault();
      rejected.handle();
    });
    env.notifyAboutRejectedPromises();
    loop.runTaskTurn();
    expect(env.globalImplementation.outstandingRejectedPromises.has(rejected.promise)).toBe(false);
    expect(loop.getTaskQueue(domManipulationTaskSource).size).toBe(0);
    expect(handled).not.toHaveBeenCalled();
  });

  it('queues one noncancelable rejectionhandled event for a previously reported promise', () => {
    const { env, loop, window, reject } = fixture();
    window.addEventListener('unhandledrejection', (event) => { event.preventDefault(); });
    const events: PromiseRejectionEvent[] = [];
    window.addEventListener('rejectionhandled', (event) => { events.push(event as PromiseRejectionEvent); });
    const rejected = reject({ late: true });
    env.notifyAboutRejectedPromises();
    loop.runTaskTurn();
    rejected.handle();
    env.trackPromiseRejection(rejected.promise, 'handle');
    expect(events).toEqual([]);
    expect(env.globalImplementation.outstandingRejectedPromises.has(rejected.promise)).toBe(false);
    expect(loop.getTaskQueue(domManipulationTaskSource).size).toBe(1);
    loop.runTaskTurn();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ promise: rejected.promise, reason: { late: true }, isTrusted: true, cancelable: false });
  });

  it('leaves rejections added during dispatch for a later notification', () => {
    const { env, loop, window, reject } = fixture();
    const reasons: unknown[] = [];
    window.addEventListener('unhandledrejection', (event) => {
      event.preventDefault();
      const reason = (event as PromiseRejectionEvent).reason as unknown;
      reasons.push(reason);
      if (reason === 'first') reject('next');
    });
    reject('first');
    env.notifyAboutRejectedPromises();
    loop.runTaskTurn();
    expect(reasons).toEqual(['first']);
    expect(env.globalImplementation.aboutToBeNotifiedRejectedPromises).toHaveLength(1);
    env.notifyAboutRejectedPromises();
    loop.runTaskTurn();
    expect(reasons).toEqual(['first', 'next']);
  });

  it('uses the running script\'s environment when it differs from current settings', () => {
    const { env, reject } = fixture();
    const { promise } = reject(42);
    env.globalImplementation.aboutToBeNotifiedRejectedPromises.length = 0;
    const otherEnv = getRelevantRealm(browser().window).env;
    const context = new JSExecutionContext(otherEnv.realm);
    const script = new ClassicScript('', env, env.apiBaseURL, new ScriptFetchOptions());
    context.scriptOrModule = script.record;
    otherEnv.responsibleEventLoop.executionContextStack.push(context);
    try { otherEnv.trackPromiseRejection(promise, 'reject'); }
    finally { otherEnv.responsibleEventLoop.executionContextStack.pop(); }
    expect(env.globalImplementation.aboutToBeNotifiedRejectedPromises).toEqual([promise]);
    expect(otherEnv.globalImplementation.aboutToBeNotifiedRejectedPromises).toEqual([]);
  });

  it.each(['reject', 'handle'] as const)('suppresses %s tracking for a muted running classic script', (operation) => {
    const { env, loop, reject } = fixture();
    const { promise } = reject(42);
    const pending = [...env.globalImplementation.aboutToBeNotifiedRejectedPromises];
    const script = new ClassicScript('', env, env.apiBaseURL, new ScriptFetchOptions(), true);
    const context = new JSExecutionContext(env.realm);
    context.scriptOrModule = script.record;
    loop.executionContextStack.push(context);
    try { env.trackPromiseRejection(promise, operation); }
    finally { loop.executionContextStack.pop(); }
    expect(env.globalImplementation.aboutToBeNotifiedRejectedPromises).toEqual(pending);
  });
});

function browser() {
  return new Browlet({ route: () => '', reporting: false });
}

function fixture() {
  mockEventLoopTurns();
  const { window } = browser();
  const env = getRelevantRealm(window).env;
  const loop = env.responsibleEventLoop;
  const states = new WeakMap<Promise<unknown>, { handled: boolean; reason: unknown; }>();
  vi.spyOn(JSEngine, 'isPromiseHandled').mockImplementation((promise) => states.get(promise)!.handled);
  vi.spyOn(JSEngine, 'getPromiseResult').mockImplementation((promise) => states.get(promise)!.reason);
  const output = vi.spyOn(console, 'error').mockImplementation(() => {});
  function reject(reason: unknown) {
    const promise = new env.realm.NativePromise<unknown>(() => {});
    const state = { handled: false, reason };
    states.set(promise, state);
    env.trackPromiseRejection(promise, 'reject');
    return {
      promise,
      handle() {
        state.handled = true;
        env.trackPromiseRejection(promise, 'handle');
      },
    };
  }
  return { window, env, loop, reject, output };
}
