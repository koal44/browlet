import { afterEach, describe, expect, vi } from 'vitest';

import { getPromiseResult, isPromiseHandled } from '../../../src/js-engine/index';
import { Browlet } from '../../../src/browlet/browlet';
import { BrowsingContext } from '../../../src/browlet/browsing/navigation/browsing-context';
import { DocumentState } from '../../../src/browlet/browsing/navigation/state/index';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/navigable';
import type { PromiseRejectionEvent } from '../../../src/browlet/platform';
import { domManipulationTaskSource } from '../../../src/browlet/scripting/tasks';
import { ClassicScript } from '../../../src/browlet/scripting/script';
import { ScriptFetchOptions } from '../../../src/browlet/scripting/script-fetch-options';
import { getRelevantRealm } from '../../support/browlet-binding';
import { mockEventLoopTurns } from '../../support/browlet-agent';
import { createSiblingWindow } from '../../support/windows';
import { runInHostTask } from '../../support/tasks';
import { itPassesWith } from '../../test-runtime';

// Stock-only failures approved: it has neither synchronous rejection tracking
// nor non-observing Promise slot reads. Native suites require these on every base.
const it = itPassesWith('promiseRejections');

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
});

describe('native HostPromiseRejectionTracker to HTML events', () => {
  it('tracks synchronously, then reports at a task after the checkpoint', () => {
    const f = fixture();
    const promise = f.reject('Promise.reject({ message: "reason" })');
    const reason = getPromiseResult(promise);
    expect(f.env.globalImplementation.aboutToBeNotifiedRejectedPromises).toEqual([promise]);
    expect(f.events).toEqual([]);
    expect(f.tasks.size).toBe(0);
    expect(isPromiseHandled(promise)).toBe(false);
    f.loop.performMicrotaskCheckpoint();
    expect(f.env.globalImplementation.aboutToBeNotifiedRejectedPromises).toEqual([]);
    expect(f.events).toEqual([]);
    expect(f.tasks.size).toBe(1);
    f.loop.runTaskTurn();
    expect(f.events).toHaveLength(1);
    expect(f.events[0]).toMatchObject({ type: 'unhandledrejection', promise, reason, isTrusted: true, cancelable: true });
    // WindowProxy equality is retained separately in window-event-target.test.ts.
    expect(getRelevantRealm(f.events[0]!.target!)).toBe(f.realm);
    expect(f.events[0]!.reason).toBe(reason);
    expect(f.env.globalImplementation.outstandingRejectedPromises.has(promise)).toBe(true);
    expect(f.output).not.toHaveBeenCalled();
  });

  it('reports a handler added after notification with the same promise and reason', () => {
    const f = fixture();
    const promise = f.reject('Promise.reject(42)');
    f.loop.performMicrotaskCheckpoint();
    f.loop.runTaskTurn();
    f.handle(promise);
    expect(f.events.map((event) => event.type)).toEqual(['unhandledrejection']);
    expect(f.tasks.size).toBe(1);
    f.loop.runTaskTurn();
    expect(f.events.map((event) => event.type)).toEqual(['unhandledrejection', 'rejectionhandled']);
    expect(f.events[1]).toMatchObject({ promise, reason: 42, isTrusted: true, cancelable: false });
    expect(f.env.globalImplementation.outstandingRejectedPromises.has(promise)).toBe(false);
  });

  it.each([false, true])('respects the retained classic script\'s muted-errors setting (%s)', (muted) => {
    const f = fixture();
    const script = new ClassicScript('Promise.reject(42)', f.env, f.env.apiBaseURL, new ScriptFetchOptions(), muted);
    const completion = script.run();
    expect(completion.type).toBe('normal');
    f.promises.push(completion.value as Promise<unknown>);
    f.loop.performMicrotaskCheckpoint();
    f.loop.runTaskTurn();
    expect(f.events.map((event) => event.reason as unknown)).toEqual(muted ? [] : [42]);
  });

  // SPEC_CLASH(promise-rejection-script-selection): Chromium/Firefox select the
  // defining script for this primitive reason; WebKit reports both cases. Target
  // Chromium/Firefox, using the code captured at the native rejection boundary.
  // This is a compatibility choice, not an unambiguous specification requirement.
  it.each([false, true])('matches Chromium/Firefox rejection muting through an ordinary call (%s)', (muted) => {
    const f = fixture();
    const definition = new ClassicScript(
      'function rejectFromDefinition() { return Promise.reject(42); }',
      f.env, f.env.apiBaseURL, new ScriptFetchOptions(), muted,
    );
    expect(definition.run().type).toBe('normal');
    const caller = new ClassicScript(
      'rejectFromDefinition()', f.env, f.env.apiBaseURL, new ScriptFetchOptions(), !muted,
    );
    const completion = caller.run();
    expect(completion.type).toBe('normal');
    f.promises.push(completion.value as Promise<unknown>);
    f.loop.performMicrotaskCheckpoint();
    f.loop.runTaskTurn();
    expect(f.events.map((event) => event.reason as unknown)).toEqual(muted ? [] : [42]);
  });

  it('does not retain a promise handled during its unhandledrejection event', () => {
    const f = fixture();
    f.window.addEventListener('unhandledrejection', (event) => f.handle((event as PromiseRejectionEvent).promise as Promise<unknown>));
    const promise = f.reject('Promise.reject(42)');
    f.loop.performMicrotaskCheckpoint();
    f.loop.runTaskTurn();
    expect(f.events.map((event) => event.type)).toEqual(['unhandledrejection']);
    expect(f.env.globalImplementation.outstandingRejectedPromises.has(promise)).toBe(false);
    expect(f.tasks.size).toBe(0);
  });

  it('suppresses a rejection handled by another microtask in the same checkpoint', async () => {
    await runInHostTask(() => {
      const f = fixture();
      void f.reject('const p = Promise.reject(42); queueMicrotask(() => p.catch(() => {})); p;');
      f.loop.performMicrotaskCheckpoint();
      expect(f.tasks.size).toBe(0);
      expect(f.events).toEqual([]);
    });
  });

  it('suppresses an event when the promise is handled after queuing notification', () => {
    const f = fixture();
    const promise = f.reject('Promise.reject(42)');
    f.loop.performMicrotaskCheckpoint();
    f.handle(promise);
    f.loop.runTaskTurn();
    expect(f.events).toEqual([]);
    expect(f.output).not.toHaveBeenCalled();
  });

  it('includes rejections originating in async functions and Promise reactions', async () => {
    await runInHostTask(() => {
      const f = fixture();
      void f.reject('(async () => { await 0; throw "async"; })()');
      void f.reject('Promise.resolve().then(() => { throw "reaction"; })');
      expect(f.tasks.size).toBe(0);
      f.loop.performMicrotaskCheckpoint();
      expect(f.tasks.size).toBe(1);
      f.loop.runTaskTurn();
      expect(f.events.map((event) => event.reason as unknown)).toEqual(['async', 'reaction']);
    });
  });

  it('keeps independent Window notifications on their responsible loops', () => {
    const first = fixture();
    const second = fixture();
    void first.reject('Promise.reject("first")');
    void second.reject('Promise.reject("second")');
    first.loop.performMicrotaskCheckpoint();
    first.loop.runTaskTurn();
    expect(first.events.map((event) => event.reason as unknown)).toEqual(['first']);
    expect(second.events).toEqual([]);
    expect(second.tasks.size).toBe(0);
    second.loop.performMicrotaskCheckpoint();
    second.loop.runTaskTurn();
    expect(second.events.map((event) => event.reason as unknown)).toEqual(['second']);
  });

  it('notifies each Window sharing one agent without mixing their pending lists', () => {
    const f = fixture();
    const otherWindow = createSiblingWindow(f.browser);
    const otherRealm = getRelevantRealm(otherWindow);
    // The binding-only sibling helper has no navigable. Attach its real Document
    // so HTML's fully-active task gate permits rejection-event delivery.
    const document = otherRealm.windowImplementation.document;
    document.browsingContext = new BrowsingContext();
    document.browsingContext.initializeWindowProxy(otherRealm.windowProxy);
    document.makeActive();
    new TopLevelTraversable(DocumentState.create(document));
    expect(document.isFullyActive()).toBe(true);
    expect(otherRealm.agent.eventLoop).toBe(f.loop);
    const otherEvents: PromiseRejectionEvent[] = [];
    otherWindow.addEventListener('unhandledrejection', (event) => {
      event.preventDefault();
      otherEvents.push(event as PromiseRejectionEvent);
    });
    const first = f.reject('Promise.reject("first")');
    // Calling the captured intrinsic supplies the other current realm, without
    // a modeled running script. The native hook must select that environment.
    const second = Reflect.apply(otherRealm.promiseReject, otherRealm.NativePromise, ['second']) as Promise<unknown>;
    f.promises.push(second);
    expect(f.env.globalImplementation.aboutToBeNotifiedRejectedPromises).toEqual([first]);
    expect(otherRealm.env.globalImplementation.aboutToBeNotifiedRejectedPromises).toEqual([second]);
    f.loop.performMicrotaskCheckpoint();
    expect(f.tasks.size).toBe(2);
    expect(f.loop.runTaskTurn()).toBe(true);
    expect(f.loop.runTaskTurn()).toBe(true);
    expect(f.events.map((event) => event.reason as unknown)).toEqual(['first']);
    expect(otherEvents.map((event) => event.reason as unknown)).toEqual(['second']);
    expect(f.env.globalImplementation.outstandingRejectedPromises.has(first)).toBe(true);
    expect(f.env.globalImplementation.outstandingRejectedPromises.has(second)).toBe(false);
    expect(otherRealm.env.globalImplementation.outstandingRejectedPromises.has(second)).toBe(true);
  });

  it('uses a borrowed then method\'s current settings rather than the promise creation realm', () => {
    const f = fixture();
    const otherWindow = createSiblingWindow(f.browser);
    const otherRealm = getRelevantRealm(otherWindow);
    const promise = f.reject('Promise.reject("handled elsewhere")');
    Reflect.apply(otherRealm.promiseThen, promise, [undefined, () => {}]);
    expect(isPromiseHandled(promise)).toBe(true);
    // HTML removes from the current global, not from every realm's collection.
    // Notification subsequently checks the engine's handled flag for this one.
    expect(f.env.globalImplementation.aboutToBeNotifiedRejectedPromises).toEqual([promise]);
    expect(otherRealm.env.globalImplementation.aboutToBeNotifiedRejectedPromises).toEqual([]);
    f.loop.performMicrotaskCheckpoint();
    f.loop.runTaskTurn();
    expect(f.events).toEqual([]);
    expect(f.env.globalImplementation.outstandingRejectedPromises.has(promise)).toBe(false);
  });

  it('queues listener-created rejections for a later notification task', () => {
    const f = fixture();
    f.window.addEventListener('unhandledrejection', (event) => {
      if ((event as PromiseRejectionEvent).reason === 'first') void f.reject('Promise.reject("next")');
    });
    void f.reject('Promise.reject("first")');
    f.loop.performMicrotaskCheckpoint();
    f.loop.runTaskTurn();
    expect(f.events.map((event) => event.reason as unknown)).toEqual(['first']);
    expect(f.tasks.size).toBe(1);
    f.loop.runTaskTurn();
    expect(f.events.map((event) => event.reason as unknown)).toEqual(['first', 'next']);
  });

  it('delivers author-created rejections through Browlet.evaluate and ordinary task cleanup', async () => {
    const f = fixture();
    const evaluated = f.browser.evaluate(() => {
      // The event listener intentionally leaves this rejected until notification.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- HTML reports arbitrary rejection reasons.
      void Promise.reject('evaluated');
    });
    f.loop.runTaskTurn();
    await evaluated;
    expect(f.events).toEqual([]);
    expect(f.tasks.size).toBe(1);
    f.loop.runTaskTurn();
    expect(f.events.map((event) => event.reason as unknown)).toEqual(['evaluated']);
  });
});

// Exercise the engine notification entry directly while keeping HTML task turns
// under test control. Public events and Promise slots use the real bindings/backend.
function fixture() {
  mockEventLoopTurns();
  const browser = new Browlet({ route: () => '', reporting: false });
  const window = browser.window;
  const realm = getRelevantRealm(window);
  const env = realm.env;
  const loop = env.responsibleEventLoop;
  // Fail unsupported backends before deliberately emitting fixture rejections
  // into Node's process-level reporting. The behavioral assertions below still run
  // on every backend with the required engine facilities.
  expect(isPromiseHandled(new realm.NativePromise(() => {}))).toBe(false);
  const events: PromiseRejectionEvent[] = [];
  const promises: Promise<unknown>[] = [];
  const output = vi.spyOn(console, 'error').mockImplementation(() => {});
  window.addEventListener('unhandledrejection', (event) => {
    event.preventDefault();
    events.push(event as PromiseRejectionEvent);
  });
  window.addEventListener('rejectionhandled', (event) => events.push(event as PromiseRejectionEvent));
  cleanups.push(() => {
    // Handle retained fixture promises even when an assertion fails.
    for (const promise of promises) Reflect.apply(realm.promiseThen, promise, [undefined, () => {}]);
    loop.performMicrotaskCheckpoint();
  });
  return {
    browser, window, realm, env, loop, events, output, promises,
    tasks: loop.getTaskQueue(domManipulationTaskSource),
    reject(source: string) {
      const code = realm.parseScript(source, 'rejection.js');
      if (Array.isArray(code)) throw code[0] as Error;
      const promise = realm.runScript(code) as Promise<unknown>;
      promises.push(promise);
      return promise;
    },
    handle(promise: Promise<unknown>) {
      Reflect.set(realm.globalObject, 'testPromise', promise);
      const code = realm.parseScript('testPromise.catch(() => {})', 'handle.js');
      if (Array.isArray(code)) throw code[0] as Error;
      realm.runScript(code);
    },
  };
}
