import { describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import {
  AbortSignalImpl, type AbortAlgorithmHandle,
} from '../../../src/browlet/dom/abort/abort-signal';

/*
 * DOM section 3 and the corresponding Web Platform Tests define these public
 * contracts. Keep the coverage at the projected interface boundary so it also
 * exercises Web IDL conversion, realm ownership, and EventTarget integration.
 *
 * https://dom.spec.whatwg.org/#aborting-ongoing-activities
 * https://github.com/web-platform-tests/wpt/tree/master/dom/abort
 */
describe('AbortController and AbortSignal', () => {
  it('projects constructible controllers and nonconstructible signals', () => {
    const { window } = createBrowlet();
    const AbortController_ = requireInterface<typeof AbortController>(
      window,
      'AbortController',
    );
    const AbortSignal_ = requireInterface<typeof AbortSignal>(
      window,
      'AbortSignal',
    );
    const EventTarget_ = requireInterface<typeof EventTarget>(
      window,
      'EventTarget',
    );
    const TypeError_ = requireInterface<typeof TypeError>(window, 'TypeError');
    const controller = new AbortController_();

    expect(controller.signal).toBe(controller.signal);
    expect(controller.signal).toBeInstanceOf(AbortSignal_);
    expect(controller.signal).toBeInstanceOf(EventTarget_);
    expect(() => Reflect.construct(AbortSignal_, [])).toThrow(TypeError_);
    expect(typeof AbortSignal_.abort).toBe('function');
    expect(typeof AbortSignal_.any).toBe('function');
  });

  it('aborts synchronously with a trusted event exactly once', () => {
    const { window } = createBrowlet();
    const AbortController_ = requireInterface<typeof AbortController>(
      window,
      'AbortController',
    );
    const controller = new AbortController_();
    const observations: unknown[] = [];

    controller.signal.addEventListener('abort', (event) => {
      observations.push(
        event.type,
        event.target,
        event.bubbles,
        event.cancelable,
        event.isTrusted,
      );
    });
    controller.abort();
    controller.abort('ignored');

    expect(observations).toEqual([
      'abort',
      controller.signal,
      false,
      false,
      true,
    ]);
    expect(controller.signal.aborted).toBe(true);
  });

  it('preserves custom reasons and defaults undefined to AbortError', () => {
    const { window } = createBrowlet();
    const AbortController_ = requireInterface<typeof AbortController>(
      window,
      'AbortController',
    );
    const DOMException_ = requireInterface<typeof DOMException>(
      window,
      'DOMException',
    );
    const customReason = { message: 'stop' };
    const custom = new AbortController_();
    const omitted = new AbortController_();
    const explicitUndefined = new AbortController_();
    const nullReason = new AbortController_();

    custom.abort(customReason);
    omitted.abort();
    explicitUndefined.abort(undefined);
    nullReason.abort(null);

    expect(custom.signal.reason).toBe(customReason);
    expect(omitted.signal.reason).toBeInstanceOf(DOMException_);
    expect((omitted.signal.reason as DOMException).name).toBe('AbortError');
    expect(omitted.signal.reason).toBe(omitted.signal.reason);
    expect(explicitUndefined.signal.reason).toBeInstanceOf(DOMException_);
    expect(
      (explicitUndefined.signal.reason as DOMException).name,
    ).toBe('AbortError');
    expect(nullReason.signal.reason).toBeNull();
  });

  it('throws the exact stored reason only after aborting', () => {
    const { window } = createBrowlet();
    const AbortController_ = requireInterface<typeof AbortController>(
      window,
      'AbortController',
    );
    const controller = new AbortController_();
    const reason = new Error('stop');

    expect(() => controller.signal.throwIfAborted()).not.toThrow();
    controller.abort(reason);

    expect(catchException(() => controller.signal.throwIfAborted())).toBe(
      reason,
    );
  });

  it('creates a fresh statically aborted signal', () => {
    const { window } = createBrowlet();
    const AbortSignal_ = requireInterface<typeof AbortSignal>(
      window,
      'AbortSignal',
    );
    const DOMException_ = requireInterface<typeof DOMException>(
      window,
      'DOMException',
    );
    const first = AbortSignal_.abort();
    const second = AbortSignal_.abort('reason');

    expect(first).not.toBe(second);
    expect(first.aborted).toBe(true);
    expect(first.reason).toBeInstanceOf(DOMException_);
    expect((first.reason as DOMException).name).toBe('AbortError');
    expect(second.reason).toBe('reason');
  });

  it('composes empty, duplicate, already-aborted, and nested signals', () => {
    const { window } = createBrowlet();
    const AbortController_ = requireInterface<typeof AbortController>(
      window,
      'AbortController',
    );
    const AbortSignal_ = requireInterface<typeof AbortSignal>(
      window,
      'AbortSignal',
    );
    const empty = AbortSignal_.any([]);
    const duplicateController = new AbortController_();
    const duplicate = AbortSignal_.any([
      duplicateController.signal,
      duplicateController.signal,
    ]);
    const first = new AbortController_();
    const second = new AbortController_();
    second.abort('second');
    first.abort('first');
    const alreadyAborted = AbortSignal_.any([
      second.signal,
      first.signal,
    ]);
    const nestedController = new AbortController_();
    const nested = AbortSignal_.any([
      AbortSignal_.any([AbortSignal_.any([nestedController.signal])]),
    ]);

    duplicateController.abort('duplicate');
    nestedController.abort('nested');

    expect(empty.aborted).toBe(false);
    expect(duplicate.reason).toBe('duplicate');
    expect(alreadyAborted.reason).toBe('second');
    expect(nested.reason).toBe('nested');
  });

  it('sets every dependent reason before running author callbacks', () => {
    const { window } = createBrowlet();
    const AbortController_ = requireInterface<typeof AbortController>(
      window,
      'AbortController',
    );
    const AbortSignal_ = requireInterface<typeof AbortSignal>(
      window,
      'AbortSignal',
    );
    const controller = new AbortController_();
    const first = AbortSignal_.any([controller.signal]);
    const second = AbortSignal_.any([controller.signal]);
    const order: string[] = [];

    controller.signal.addEventListener('abort', () => {
      order.push('source');
      expect(first.aborted).toBe(true);
      expect(second.aborted).toBe(true);
    });
    first.addEventListener('abort', () => {
      order.push('first');
      expect(second.aborted).toBe(true);
    });
    second.addEventListener('abort', () => { order.push('second'); });

    controller.abort('reason');

    expect(order).toEqual(['source', 'first', 'second']);
    expect(first.reason).toBe('reason');
    expect(second.reason).toBe('reason');
  });

  it('removes signal-bound listeners before public abort listeners run', () => {
    const { window } = createBrowlet();
    const AbortController_ = requireInterface<typeof AbortController>(
      window,
      'AbortController',
    );
    const EventTarget_ = requireInterface<typeof EventTarget>(
      window,
      'EventTarget',
    );
    const Event_ = requireInterface<typeof Event>(window, 'Event');
    const controller = new AbortController_();
    const target = new EventTarget_();
    const callback = vi.fn();

    target.addEventListener('ready', callback, {
      signal: controller.signal,
    });
    controller.signal.addEventListener('abort', () => {
      target.dispatchEvent(new Event_('ready'));
    });
    controller.abort();

    expect(callback).not.toHaveBeenCalled();
  });

  it('rejects non-AbortSignal dictionary and sequence values', () => {
    const { window } = createBrowlet();
    const AbortSignal_ = requireInterface<typeof AbortSignal>(
      window,
      'AbortSignal',
    );
    const EventTarget_ = requireInterface<typeof EventTarget>(
      window,
      'EventTarget',
    );
    const TypeError_ = requireInterface<typeof TypeError>(window, 'TypeError');
    const target = new EventTarget_();

    expect(() => AbortSignal_.any([{} as AbortSignal])).toThrow(TypeError_);
    expect(() => target.addEventListener('ready', () => {}, {
      signal: {} as AbortSignal,
    })).toThrow(TypeError_);
  });

  it('creates default reasons in the signal binding realm', () => {
    const first = createBrowlet();
    const second = createBrowlet();
    const FirstAbortController = requireInterface<typeof AbortController>(
      first.window,
      'AbortController',
    );
    const FirstDOMException = requireInterface<typeof DOMException>(
      first.window,
      'DOMException',
    );
    const SecondDOMException = requireInterface<typeof DOMException>(
      second.window,
      'DOMException',
    );
    const controller = new FirstAbortController();

    controller.abort();

    expect(controller.signal.reason).toBeInstanceOf(FirstDOMException);
    expect(controller.signal.reason).not.toBeInstanceOf(SecondDOMException);
    expect(controller.signal.reason).not.toBeInstanceOf(DOMException);
  });

  it('keeps a nested signal in its controller realm when borrowed', () => {
    const first = createBrowlet();
    const second = createBrowlet();
    const FirstAbortController = requireInterface<typeof AbortController>(
      first.window,
      'AbortController',
    );
    const FirstAbortSignal = requireInterface<typeof AbortSignal>(
      first.window,
      'AbortSignal',
    );
    const SecondAbortController = requireInterface<typeof AbortController>(
      second.window,
      'AbortController',
    );
    const SecondAbortSignal = requireInterface<typeof AbortSignal>(
      second.window,
      'AbortSignal',
    );
    const controller = new FirstAbortController();
    const getter = Reflect.getOwnPropertyDescriptor(
      SecondAbortController.prototype,
      'signal',
    )?.get;
    if (!getter) throw new Error('AbortController.signal has no getter');

    const signal = Reflect.apply(getter, controller, []);

    expect(signal).toBe(controller.signal);
    expect(signal).toBeInstanceOf(FirstAbortSignal);
    expect(signal).not.toBeInstanceOf(SecondAbortSignal);
  });

  it('creates dependent signals in both old and new globals after navigation', async () => {
    const browlet = createBrowlet();
    const FirstAbortController = requireInterface<typeof AbortController>(
      browlet.window, 'AbortController',
    );
    const FirstAbortSignal = requireInterface<typeof AbortSignal>(
      browlet.window, 'AbortSignal',
    );
    const firstController = new FirstAbortController();
    const first = FirstAbortSignal.any([firstController.signal]);

    await browlet.navigate('https://example.test/');

    const SecondAbortController = requireInterface<typeof AbortController>(
      browlet.window, 'AbortController',
    );
    const SecondAbortSignal = requireInterface<typeof AbortSignal>(
      browlet.window, 'AbortSignal',
    );
    const secondController = new SecondAbortController();
    const second = SecondAbortSignal.any([secondController.signal]);
    const laterFirst = FirstAbortSignal.any([firstController.signal]);
    const calls: string[] = [];
    first.addEventListener('abort', () => { calls.push('first'); });
    laterFirst.addEventListener('abort', () => { calls.push('later first'); });
    second.addEventListener('abort', () => { calls.push('second'); });

    firstController.abort('old global');
    expect(calls).toEqual(['first', 'later first']);
    expect(second.aborted).toBe(false);
    secondController.abort('new global');
    expect(calls).toEqual(['first', 'later first', 'second']);
    expect(first.reason).toBe('old global');
    expect(laterFirst.reason).toBe('old global');
    expect(second.reason).toBe('new global');
    expect(laterFirst).toBeInstanceOf(FirstAbortSignal);
    expect(second).toBeInstanceOf(SecondAbortSignal);
  });

  it('supports replacement and ordering for the onabort IDL handler', () => {
    const { window } = createBrowlet();
    const AbortController_ = requireInterface<typeof AbortController>(
      window,
      'AbortController',
    );
    const controller = new AbortController_();
    const order: string[] = [];
    const first = vi.fn();
    const replacement = vi.fn(function(this: AbortSignal, event: Event) {
      order.push('handler');
      expect(this).toBe(controller.signal);
      expect(event.currentTarget).toBe(controller.signal);
    });

    controller.signal.addEventListener('abort', () => { order.push('before'); });
    controller.signal.onabort = first;
    controller.signal.addEventListener('abort', () => { order.push('after'); });
    controller.signal.onabort = replacement;

    expect(controller.signal.onabort).toBe(replacement);
    controller.abort();

    expect(first).not.toHaveBeenCalled();
    expect(replacement).toHaveBeenCalledOnce();
    expect(order).toEqual(['before', 'handler', 'after']);
  });

  it('deactivates and reactivates the onabort IDL handler', () => {
    const { window } = createBrowlet();
    const AbortController_ = requireInterface<typeof AbortController>(
      window,
      'AbortController',
    );
    const controller = new AbortController_();
    const order: string[] = [];

    controller.signal.addEventListener('abort', () => { order.push('one'); });
    controller.signal.onabort = () => { order.push('removed'); };
    controller.signal.addEventListener('abort', () => { order.push('two'); });
    controller.signal.onabort = null;
    controller.signal.addEventListener('abort', () => { order.push('three'); });
    controller.signal.onabort = () => { order.push('handler'); };
    controller.signal.addEventListener('abort', () => { order.push('four'); });

    expect(Reflect.set(controller.signal, 'onabort', 1)).toBe(true);
    expect(controller.signal.onabort).toBeNull();
    controller.signal.onabort = () => { order.push('replacement'); };
    controller.abort();

    expect(order).toEqual(['one', 'two', 'three', 'four', 'replacement']);
  });

  it('cancels a cancelable abort event when onabort returns false', () => {
    const { window } = createBrowlet();
    const AbortController_ = requireInterface<typeof AbortController>(
      window,
      'AbortController',
    );
    const Event_ = requireInterface<typeof Event>(window, 'Event');
    const controller = new AbortController_();
    const event = new Event_('abort', { cancelable: true });

    controller.signal.onabort = () => false;

    expect(controller.signal.dispatchEvent(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it('aborts after its active-time timeout reaches the timer task source', async () => {
    const { window } = createBrowlet();
    const AbortSignal_ = requireInterface<typeof AbortSignal>(
      window,
      'AbortSignal',
    );
    const DOMException_ = requireInterface<typeof DOMException>(
      window,
      'DOMException',
    );

    const signal = AbortSignal_.timeout(0);
    if (!signal.aborted) {
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => { resolve(); }, { once: true });
      });
    }

    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBeInstanceOf(DOMException_);
    expect((signal.reason as DOMException).name).toBe('TimeoutError');
  });

  it('keeps retained AbortSignal constructors on their inactive Window after navigation', async () => {
    const browlet = createBrowlet();
    const FirstAbortSignal = requireInterface<typeof AbortSignal>(browlet.window, 'AbortSignal');
    await browlet.navigate('https://example.test/');
    const SecondAbortSignal = requireInterface<typeof AbortSignal>(browlet.window, 'AbortSignal');
    const DOMException_ = requireInterface<typeof DOMException>(browlet.window, 'DOMException');

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const first = FirstAbortSignal.timeout(0);
      const second = SecondAbortSignal.timeout(0);
      const aborted = new Promise<void>((resolve) => {
        second.addEventListener('abort', () => { resolve(); }, { once: true });
      });
      expect(vi.getTimerCount()).toBe(1);
      vi.advanceTimersByTime(0);
      expect(second.aborted).toBe(false);
      await aborted;

      expect(first.aborted).toBe(false);
      expect(second.aborted).toBe(true);
      expect(second.reason).toBeInstanceOf(DOMException_);
      expect((second.reason as DOMException).name).toBe('TimeoutError');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('AbortSignal internal algorithms', () => {
  it('supports repeated construction on a frozen global without exposing retention state', () => {
    const global = Object.freeze({});
    const prototype: unknown = Object.getPrototypeOf(global);
    const source = new AbortSignalImpl(global);
    const first = AbortSignalImpl.any(new AbortSignalImpl(global), [source]);
    const second = AbortSignalImpl.any(new AbortSignalImpl(global), [source]);
    const calls: string[] = [];
    first.addAlgorithm(() => { calls.push('first'); });
    second.addAlgorithm(() => { calls.push('second'); });

    source.signalAbort('reason');

    expect(calls).toEqual(['first', 'second']);
    expect(first.reason).toBe('reason');
    expect(second.reason).toBe('reason');
    expect(Reflect.ownKeys(global)).toEqual([]);
    expect(Object.getPrototypeOf(global)).toBe(prototype);
  });

  it('removes a settled dependent without removing other dependents of the shared source', () => {
    const firstSource = new AbortSignalImpl(globalThis);
    const sharedSource = new AbortSignalImpl(globalThis);
    const first = AbortSignalImpl.any(new AbortSignalImpl(globalThis), [
      firstSource, sharedSource,
    ]);
    const second = AbortSignalImpl.any(new AbortSignalImpl(globalThis), [
      sharedSource, sharedSource,
    ]);
    const nested = AbortSignalImpl.any(new AbortSignalImpl(globalThis), [
      second, sharedSource,
    ]);
    const calls: string[] = [];
    first.addAlgorithm(() => { calls.push('first'); });
    second.addAlgorithm(() => { calls.push('second'); });
    nested.addAlgorithm(() => { calls.push('nested'); });

    firstSource.signalAbort('first');
    expect(calls).toEqual(['first']);
    expect(second.aborted).toBe(false);
    expect(nested.aborted).toBe(false);

    sharedSource.signalAbort('shared');
    expect(calls).toEqual(['first', 'second', 'nested']);
    expect(first.reason).toBe('first');
    expect(second.reason).toBe('shared');
    expect(nested.reason).toBe('shared');
  });

  it('runs in order and permits an earlier algorithm to remove a later one', () => {
    const signal = new AbortSignalImpl(globalThis);
    const order: string[] = [];
    let later: AbortAlgorithmHandle | null = null;

    signal.addAlgorithm(() => {
      order.push('first');
      later?.remove();
    });
    later = signal.addAlgorithm(() => { order.push('later'); });
    signal.addEventListener('abort', () => { order.push('event'); });

    signal.signalAbort('reason');

    expect(order).toEqual(['first', 'event']);
  });
});

function createBrowlet(): Browlet {
  return new Browlet({ route: () => '' });
}

function requireInterface<T extends object>(
  window: WindowProxy,
  name: string,
): T {
  const constructor = Reflect.get(window, name) as unknown;

  expect(typeof constructor).toBe('function');
  return constructor as T;
}

function catchException(action: () => void): unknown {
  try {
    action();
  } catch (exception) {
    return exception;
  }
  throw new Error('Expected action to throw');
}
