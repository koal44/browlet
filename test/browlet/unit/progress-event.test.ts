import { describe, expect, it, vi } from 'vitest';

import { browletBindings, getRelevantRealm } from '../../../src/browlet/bindings';
import { Browlet } from '../../../src/browlet/browlet';
import { EventTargetImpl } from '../../../src/browlet/dom/events/event-target';
import {
  fireProgressEvent,
} from '../../../src/browlet/dom/events/progress-event';

describe('XMLHttpRequest ProgressEvent projection', () => {
  it('constructs ProgressEvent with inherited and progress initialization', () => {
    const window = createWindow();
    const ProgressEvent_ = requireFunction(window, 'ProgressEvent');
    const Event_ = requireFunction(window, 'Event');
    const defaults = Reflect.construct(ProgressEvent_, ['load']) as object;
    const initialized = Reflect.construct(ProgressEvent_, ['progress', {
      bubbles: true,
      cancelable: true,
      composed: true,
      lengthComputable: true,
      loaded: 4,
      total: 10,
    }]) as object;

    expect(defaults).toBeInstanceOf(ProgressEvent_);
    expect(defaults).toBeInstanceOf(Event_);
    expect(Reflect.get(defaults, 'type')).toBe('load');
    expect(Reflect.get(defaults, 'lengthComputable')).toBe(false);
    expect(Reflect.get(defaults, 'loaded')).toBe(0);
    expect(Reflect.get(defaults, 'total')).toBe(0);
    expect(Reflect.get(initialized, 'bubbles')).toBe(true);
    expect(Reflect.get(initialized, 'cancelable')).toBe(true);
    expect(Reflect.get(initialized, 'composed')).toBe(true);
    expect(Reflect.get(initialized, 'lengthComputable')).toBe(true);
    expect(Reflect.get(initialized, 'loaded')).toBe(4);
    expect(Reflect.get(initialized, 'total')).toBe(10);
  });

  it('applies Web IDL conversion to constructor arguments', () => {
    const window = createWindow();
    const ProgressEvent_ = requireFunction(window, 'ProgressEvent');
    const event = Reflect.construct(ProgressEvent_, [{
      toString: () => 'progress',
    }, {
      lengthComputable: 1,
      loaded: '2.5',
      total: 4,
    }]) as object;

    expect(Reflect.get(event, 'type')).toBe('progress');
    expect(Reflect.get(event, 'lengthComputable')).toBe(true);
    expect(Reflect.get(event, 'loaded')).toBe(2.5);
    expect(Reflect.get(event, 'total')).toBe(4);
  });

  it('fires trusted progress events in the target realm', () => {
    const first = createWindow();
    const second = createWindow();
    const target = Reflect.construct(
      requireFunction(second, 'EventTarget'),
      [],
    ) as object;
    const listener = vi.fn();
    call(target, 'addEventListener', ['progress', listener]);

    expect(fireProgressEvent(
      'progress',
      requireEventTargetImplementation(second, target),
      4,
      10,
    )).toBe(true);

    expect(listener).toHaveBeenCalledOnce();
    const event = listener.mock.calls[0]![0] as object;
    expect(event).toBeInstanceOf(requireFunction(second, 'ProgressEvent'));
    expect(event).not.toBeInstanceOf(requireFunction(first, 'ProgressEvent'));
    expect(Reflect.get(event, 'isTrusted')).toBe(true);
    expect(Reflect.get(event, 'lengthComputable')).toBe(true);
    expect(Reflect.get(event, 'loaded')).toBe(4);
    expect(Reflect.get(event, 'total')).toBe(10);
  });

  it('does not expose a total when the supplied length is zero', () => {
    const window = createWindow();
    const target = Reflect.construct(
      requireFunction(window, 'EventTarget'),
      [],
    ) as object;
    const listener = vi.fn();
    call(target, 'addEventListener', ['progress', listener]);

    fireProgressEvent(
      'progress',
      requireEventTargetImplementation(window, target),
      4,
      0,
    );

    const event = listener.mock.calls[0]![0] as object;
    expect(Reflect.get(event, 'lengthComputable')).toBe(false);
    expect(Reflect.get(event, 'loaded')).toBe(4);
    expect(Reflect.get(event, 'total')).toBe(0);
  });
});

function createWindow(): Window & typeof globalThis {
  return new Browlet({ route: () => '' }).window as
    Window & typeof globalThis;
}

function requireEventTargetImplementation(
  window: object,
  target: object,
): EventTargetImpl {
  const context = browletBindings.forRealm(getRelevantRealm(window)).context;
  const implementation = context.getImplementation(target, EventTargetImpl);
  if (!implementation) throw new Error('Value is not an EventTarget');
  return implementation;
}

function call(
  object: object,
  name: string,
  argumentsList: unknown[] = [],
): unknown {
  return Reflect.apply(requireFunction(object, name), object, argumentsList);
}

function requireFunction(object: object, name: string): CallableFunction {
  const value = Reflect.get(object, name) as unknown;
  if (typeof value !== 'function') throw new Error(`${name} is not a function`);
  return value;
}
