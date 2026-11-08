import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseURL } from '../../../src/url/index';
import { monotonicClock, UnsafeMoment } from '../../../src/timing/index';
import { Browlet } from '../../../src/browlet/browlet';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/top-level-traversable';
import { DocumentState } from '../../../src/browlet/browsing/navigation/state/index';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/index';
import type { BrowletEnvironment } from '../../../src/browlet/environment/index';
import { createWorkerEnvironment } from '../../../src/browlet/integration/web-idl/index';
import type { DedicatedWorkerGlobalScope, SharedWorkerGlobalScope } from '../../../src/browlet/platform';
import {
  AnimationFrameController, DedicatedWorkerAgent, SharedWorkerAgent, WindowAgent, WindowRenderingController,
  renderingTaskSource, type RenderingOpportunityHost, type RenderingUpdateHooks,
} from '../../../src/browlet/scripting/index';
import { DedicatedWorkerGlobalImpl } from '../../../src/browlet/workers/index';
import { createManualEventLoop, createManualUserAgent } from '../../support/browlet-agent';
import { unwrap } from '../../support/browlet-binding';
import { useFixture } from '../../support/fixture';
import { runInHostTask } from '../../support/tasks';

afterEach(() => { vi.restoreAllMocks(); });

describe('HTML §8.12 Window animation-frame bindings', () => {
  const prepared = useFixture(() => {
    const browser = new Browlet({ route: () => '', reporting: false });
    const document = unwrap<DocumentImpl>(browser.document);
    return { browser, document, controller: document.animationFrameController };
  });

  it('exposes the mixin methods and performs Web IDL conversion', async () => {
    const { browser, controller } = prepared();
    expect(await browser.evaluate(() => {
      const errors = [];
      for (const value of [null, undefined, 1, {}, { handleEvent() {} }]) {
        try { Reflect.apply(requestAnimationFrame, window, [value]); errors.push(false); }
        catch (error) { errors.push(error instanceof TypeError); }
      }
      try { Reflect.apply(requestAnimationFrame, {}, [() => {}]); errors.push(false); }
      catch (error) { errors.push(error instanceof TypeError); }
      const handle = requestAnimationFrame(() => {});
      // Cancellation uses ordinary unsigned-long conversion.
      cancelAnimationFrame(handle + 2 ** 32);
      return {
        errors, handle, requestLength: requestAnimationFrame.length, cancelLength: cancelAnimationFrame.length,
        interfaceExposed: 'AnimationFrameProvider' in window, hiddenState: 'animationFrameController' in document,
      };
    })).toEqual({
      errors: Array(6).fill(true), handle: 1, requestLength: 1, cancelLength: 1,
      interfaceExposed: false, hiddenState: false,
    });
    expect(controller.hasPending).toBe(false);
  });

  it('snapshots each batch, checkpoints between callbacks, and reports errors without stopping delivery', async () => {
    const { browser, document, controller } = prepared();
    await browser.evaluate(() => {
      const state = { order: [] as string[], times: [] as number[], receiver: false, argumentCount: 0 };
      Object.assign(globalThis, { frameState: state });
      addEventListener('error', (event) => { state.order.push((event.error as Error).message); event.preventDefault(); }, { once: true });
      const canceled = requestAnimationFrame(() => { state.order.push('canceled before'); });
      cancelAnimationFrame(canceled);
      requestAnimationFrame(function(this: void, time) {
        'use strict';
        state.receiver = this === undefined;
        state.argumentCount = arguments.length;
        state.order.push('first'); state.times.push(time);
        queueMicrotask(() => { state.order.push('microtask'); cancelAnimationFrame(second); });
        requestAnimationFrame((next) => { state.order.push('next'); state.times.push(next); });
      });
      const second = requestAnimationFrame(() => { state.order.push('canceled during'); });
      requestAnimationFrame((time) => { state.order.push('throw'); state.times.push(time); throw new Error('reported'); });
      requestAnimationFrame(() => { state.order.push('last'); });
    });
    await deliverFrame(document, 12.5);
    expect(await browser.evaluate(() => (globalThis as unknown as { frameState: unknown; }).frameState)).toEqual({
      order: ['first', 'microtask', 'throw', 'reported', 'last'], times: [12.5, 12.5], receiver: true, argumentCount: 1,
    });
    expect(controller.hasPending).toBe(true);
    await deliverFrame(document, 25);
    expect(await browser.evaluate(() => (globalThis as unknown as { frameState: { order: string[]; }; }).frameState.order))
      .toEqual(['first', 'microtask', 'throw', 'reported', 'last', 'next']);
    expect(controller.hasPending).toBe(false);
  });

  it('registers repeated functions independently and removes a request before invocation', async () => {
    const { browser, document, controller } = prepared();
    const called = vi.fn();
    const first = browser.window.requestAnimationFrame(called);
    const second = browser.window.requestAnimationFrame(called);
    browser.window.cancelAnimationFrame(first);
    browser.window.cancelAnimationFrame(999);
    expect(second).toBe(first + 1);
    expect(called).not.toHaveBeenCalled();
    await deliverFrame(document, 3);
    expect(called).toHaveBeenCalledExactlyOnceWith(3);
    let pendingDuringCallback: boolean | undefined;
    browser.window.requestAnimationFrame(() => { pendingDuringCallback = controller.hasPending; });
    await deliverFrame(document, 4);
    expect(pendingDuringCallback).toBe(false);
  });

  it('uses the receiver Document while reporting in the callback realm', async () => {
    const { browser, document, controller } = prepared();
    const other = new Browlet({ route: () => '', reporting: false });
    const otherDocument = unwrap<DocumentImpl>(other.document);
    otherDocument.origin = document.origin;
    await browser.evaluate(() => {
      Object.assign(globalThis, { frameErrors: [] as string[], frameCallback: () => { throw new Error('callback realm'); } });
      addEventListener('error', (event) => {
        (globalThis as unknown as { frameErrors: string[]; }).frameErrors.push((event.error as Error).message);
        event.preventDefault();
      }, { once: true });
    });
    const callback = (browser.window as unknown as { frameCallback: (time: number) => void; }).frameCallback;
    // Deliberately borrow the projected operation to test receiver selection.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    Reflect.apply(browser.window.requestAnimationFrame, other.window, [callback]);
    expect(controller.hasPending).toBe(false);
    expect(otherDocument.animationFrameController.hasPending).toBe(true);
    await deliverFrame(otherDocument, 6);
    expect(await browser.evaluate(() => (globalThis as unknown as { frameErrors: string[]; }).frameErrors)).toEqual(['callback realm']);
  });
});

describe('animation-frame Document ownership and rendering', () => {
  const prepared = useFixture(createWindowFixture);

  it('delivers in the animation-frame phase with the Document-relative timestamp', async () => {
    const f = prepared();
    const order: string[] = [];
    const times: number[] = [];
    f.window.requestAnimationFrame((time) => { order.push('callback'); times.push(time); });
    const render = rendering(f, {
      runCanvasContextLostSteps: () => { order.push('canvas'); },
      recalculateStylesUpdateLayoutAndResizeObservations: () => { order.push('layout'); },
      filters: { wouldRenderingHaveVisibleEffect: () => false },
    });
    try {
      render.signal();
      expect(order).toEqual([]);
      await runInHostTask(() => { expect(f.loop.runTaskTurn()).toBe(true); });
      expect(order).toEqual(['canvas', 'callback', 'layout']);
      expect(times).toEqual([f.env.relativeHighResolutionTime(render.time).toTimestamp()]);
      render.signal();
      await runInHostTask(() => { f.loop.runTaskTurn(); });
      expect(order).toEqual(['canvas', 'callback', 'layout']);
    } finally { render.controller.stop(); }
  });

  it('retains requests while the Document is inactive and delivers after reactivation', async () => {
    const f = prepared();
    const callback = vi.fn();
    f.window.requestAnimationFrame(callback);
    const state = f.top.activeSessionHistoryEntry.documentState;
    f.top.activeSessionHistoryEntry.documentState = DocumentState.create(f.env.createDocument());
    const render = rendering(f);
    try {
      render.signal();
      await runInHostTask(() => { f.loop.runTaskTurn(); });
      expect(callback).not.toHaveBeenCalled();
      expect(f.document.animationFrameController.hasPending).toBe(true);
      f.top.activeSessionHistoryEntry.documentState = state;
      render.signal();
      await runInHostTask(() => { f.loop.runTaskTurn(); });
      expect(callback).toHaveBeenCalledOnce();
    } finally { render.controller.stop(); }
  });

  it('uses a new Document controller when a Window is reused', () => {
    const f = prepared();
    const first = f.window.requestAnimationFrame(() => {});
    const replacement = f.env.createDocument();
    f.env.window.setAssociatedDocument(replacement);
    const second = f.window.requestAnimationFrame(() => {});
    expect(first).toBe(1); expect(second).toBe(1);
    f.window.cancelAnimationFrame(first);
    expect(replacement.animationFrameController.hasPending).toBe(false);
    expect(f.document.animationFrameController.hasPending).toBe(true);
  });

  it('keeps salvageable requests and clears a permanent teardown including the current batch', async () => {
    const f = prepared();
    const callback = vi.fn();
    f.window.requestAnimationFrame(() => {
      f.document.salvageable = false;
      f.document.runUnloadingCleanup();
    });
    f.window.requestAnimationFrame(callback);
    f.document.runUnloadingCleanup();
    expect(f.document.animationFrameController.hasPending).toBe(true);
    await runInHostTask(() => { f.document.animationFrameController.runCallbacks(10); });
    expect(callback).not.toHaveBeenCalled();
    expect(f.document.animationFrameController.hasPending).toBe(false);
    expect(f.window.requestAnimationFrame(callback)).toBe(3);
  });
});

describe('dedicated-worker animation-frame eligibility', () => {
  const prepared = useFixture((fixture) => {
    const outside = createWindowFixture();
    const worker = createWorker(outside.env);
    fixture.onCleanup(() => { worker.implementation.finishRunning(); });
    return { outside, ...worker };
  });

  it('exposes the API only on dedicated workers and retains its own callback state', async () => {
    const { outside, env, scope, implementation } = prepared();
    const shared = createSharedWorker(outside.env);
    expect(typeof scope.requestAnimationFrame).toBe('function');
    expect('requestAnimationFrame' in shared.scope).toBe(false);
    expect('cancelAnimationFrame' in shared.scope).toBe(false);
    expect('animationFrameController' in scope).toBe(false);
    const callback = vi.fn();
    const handle = scope.requestAnimationFrame(callback);
    expect(handle).toBe(1);
    expect(outside.document.animationFrameController.hasPending).toBe(false);
    await runInHostTask(() => { implementation.animationFrameController.runCallbacks(env.currentHighResolutionTime().toTimestamp()); });
    expect(callback).toHaveBeenCalledOnce();
    expect(implementation.animationFrameController.hasPending).toBe(false);
    shared.agent.globalScope!.finishRunning();
  });

  it('follows dedicated-worker owners but does not follow shared-worker owners', () => {
    const { outside, env, implementation } = prepared();
    const child = createWorker(env);
    expect(child.implementation.isAnimationFrameProviderSupported()).toBe(true);
    const shared = createSharedWorker(outside.env);
    implementation.ownerSet.clear();
    implementation.ownerSet.add(shared.agent.globalScope!);
    expect(child.implementation.isAnimationFrameProviderSupported()).toBe(false);
    expect(() => child.scope.requestAnimationFrame(() => {})).toThrow(expect.objectContaining({ name: 'NotSupportedError' }));
    child.implementation.finishRunning();
    shared.agent.globalScope!.finishRunning();
  });

  it('checks support on both calls, after callback conversion, using the method realm', () => {
    const { outside, scope, env, implementation } = prepared();
    implementation.ownerSet.clear();
    for (const method of [() => scope.requestAnimationFrame(() => {}), () => scope.cancelAnimationFrame(0)]) {
      let error: unknown;
      try { method(); } catch (value) { error = value; }
      expect(error).toBeInstanceOf(scope.DOMException);
      expect(error).toMatchObject({ name: 'NotSupportedError' });
    }
    expect(() => {
      // Deliberately pass an invalid author callback to the projected operation.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      Reflect.apply(scope.requestAnimationFrame, scope, [null]);
    }).toThrow(env.realm.TypeError);
    // An inactive Document still satisfies §8.12's owner-membership test.
    implementation.ownerSet.add(outside.env.createDocument());
    expect(scope.requestAnimationFrame(() => {})).toBe(1);
  });

  it('handles owner cycles and releases retained callbacks at worker completion', () => {
    const { env, implementation, scope } = prepared();
    scope.requestAnimationFrame(() => {});
    const child = createWorker(env);
    implementation.ownerSet.clear();
    implementation.ownerSet.add(child.implementation);
    expect(implementation.isAnimationFrameProviderSupported()).toBe(false);
    expect(() => scope.cancelAnimationFrame(1)).toThrow(expect.objectContaining({ name: 'NotSupportedError' }));
    expect(implementation.animationFrameController.hasPending).toBe(true);
    implementation.finishRunning();
    expect(implementation.animationFrameController.hasPending).toBe(false);
    child.implementation.finishRunning();
  });
});

it('clearing a controller preserves its identifier sequence', () => {
  const controller = new AnimationFrameController();
  expect(controller.request(() => {})).toBe(1);
  controller.clear();
  expect(controller.request(() => {})).toBe(2);
});

function createWindowFixture() {
  const top = TopLevelTraversable.create(createManualUserAgent(), null, '');
  const document = top.activeDocument!;
  const env = top.activeWindow!.env;
  return { top, document, env, window: env.realm.windowProxy.platform, loop: env.responsibleEventLoop };
}

/** Callback cleanup checkpoints run at an HTML task boundary, not a bare host call. */
function deliverFrame(document: DocumentImpl, timestamp: number): Promise<void> {
  return new Promise((resolve, reject) => {
    document.env.realm.queueGlobalTask(renderingTaskSource, {
      run: () => {
        try { document.animationFrameController.runCallbacks(timestamp); resolve(); }
        catch (error) {
        // Preserve the original failure, including exceptions from another realm.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
          reject(error);
        }
      },
    });
  });
}

function rendering(f: ReturnType<typeof createWindowFixture>, hooks: RenderingUpdateHooks = {}) {
  const agent = f.env.realm.agent;
  if (!(agent instanceof WindowAgent)) throw new Error('Expected Window agent');
  const time = new UnsafeMoment(monotonicClock, f.env.timeOrigin.milliseconds + 50);
  let notify: Parameters<RenderingOpportunityHost['observeRenderingOpportunities']>[0] | undefined;
  const controller = new WindowRenderingController(agent, {
    hasRenderingOpportunity: (navigable) => navigable === f.top,
    observeRenderingOpportunities: (callback) => { notify = callback; return () => { notify = undefined; }; },
    unsafeSharedCurrentTime: () => time,
  }, hooks);
  controller.start();
  return { controller, time, signal: () => { notify!([f.top]); } };
}

function createWorker(outsideEnv: BrowletEnvironment) {
  const agent = new DedicatedWorkerAgent(createManualEventLoop());
  const env = createWorkerEnvironment({
    agent, outsideEnv, url: parseURL('https://frames.test/worker.js').url!, unsafeWorkerCreationTime: 100,
    type: 'module', name: 'frames', credentials: 'same-origin', extendedLifetime: false,
  });
  const implementation = env.globalImplementation;
  if (!(implementation instanceof DedicatedWorkerGlobalImpl)) throw new Error('Expected dedicated worker');
  return { agent, env, implementation, scope: env.global as unknown as DedicatedWorkerGlobalScope };
}

function createSharedWorker(outsideEnv: BrowletEnvironment) {
  const agent = new SharedWorkerAgent(createManualEventLoop());
  const env = createWorkerEnvironment({
    agent, outsideEnv, url: parseURL('https://frames.test/shared.js').url!, unsafeWorkerCreationTime: 100,
    type: 'module', name: 'shared frames', credentials: 'same-origin', extendedLifetime: false,
  });
  return { agent, env, scope: env.global as unknown as SharedWorkerGlobalScope };
}
