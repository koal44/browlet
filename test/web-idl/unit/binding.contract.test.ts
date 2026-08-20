import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';

describe('Web IDL JavaScript binding contract', () => {
  it('creates initial objects from the target realm', () => {
    const browlet = createBrowlet();
    const EventConstructor = getGlobal<typeof Event>(browlet, 'Event');
    const RealmFunction = getGlobal<FunctionConstructor>(browlet, 'Function');
    const RealmObject = getGlobal<ObjectConstructor>(browlet, 'Object');

    expect(EventConstructor).toBeInstanceOf(RealmFunction);
    expect(EventConstructor).not.toBeInstanceOf(Function);
    expect(EventConstructor.prototype).toBeInstanceOf(RealmObject);
    expect(EventConstructor.prototype).not.toBeInstanceOf(Object);
  });

  it('implementation-checks receivers without imposing a realm boundary', () => {
    const first = createBrowlet();
    const second = createBrowlet();
    const FirstEventTarget = getGlobal<typeof EventTarget>(
      first,
      'EventTarget',
    );
    const SecondEventTarget = getGlobal<typeof EventTarget>(
      second,
      'EventTarget',
    );
    const FirstTypeError = getGlobal<typeof TypeError>(first, 'TypeError');
    const foreignTarget = new SecondEventTarget();

    expect(() => {
      FirstEventTarget.prototype.addEventListener.call(
        foreignTarget,
        'ready',
        null,
      );
    }).not.toThrow();
    expect(() => {
      FirstEventTarget.prototype.addEventListener.call({}, 'ready', null);
    }).toThrow(FirstTypeError);
  });

  it('derives built-in function metadata from the IDL callables', () => {
    const browlet = createBrowlet();
    const EventConstructor = getGlobal<typeof Event>(browlet, 'Event');
    const EventTargetConstructor = getGlobal<typeof EventTarget>(
      browlet,
      'EventTarget',
    );

    expect(EventConstructor.name).toBe('Event');
    expect(EventConstructor.length).toBe(1);
    expect(EventTargetConstructor.prototype.addEventListener.name)
      .toBe('addEventListener');
    expect(EventTargetConstructor.prototype.addEventListener.length).toBe(2);
    expect(Object.getOwnPropertyDescriptor(EventConstructor, 'prototype'))
      .toEqual({
        configurable: false,
        enumerable: false,
        value: EventConstructor.prototype,
        writable: false,
      });
  });

  it('converts constructor arguments at the binding boundary', () => {
    const browlet = createBrowlet();
    const EventConstructor = getGlobal<typeof Event>(browlet, 'Event');
    const RealmTypeError = getGlobal<typeof TypeError>(browlet, 'TypeError');
    const reads: string[] = [];
    const init = Object.defineProperties({}, {
      composed: { get: () => { reads.push('composed'); return 1; } },
      cancelable: { get: () => { reads.push('cancelable'); return 1; } },
      bubbles: { get: () => { reads.push('bubbles'); return 1; } },
    }) as EventInit;

    const event = new EventConstructor('ready', init);

    expect(reads).toEqual(['bubbles', 'cancelable', 'composed']);
    expect([event.bubbles, event.cancelable, event.composed])
      .toEqual([true, true, true]);
    expect(() => {
      new EventConstructor(
        'ready',
        1 as unknown as EventInit,
      );
    }).toThrow(RealmTypeError);
  });

  it('installs unforgeable members on each platform object', () => {
    const browlet = createBrowlet();
    const EventConstructor = getGlobal<typeof Event>(browlet, 'Event');
    const event = new EventConstructor('ready');
    const descriptor = Object.getOwnPropertyDescriptor(event, 'isTrusted');

    expect(descriptor).toMatchObject({
      configurable: false,
      enumerable: true,
    });
    expect(typeof descriptor?.get).toBe('function');
    expect(descriptor?.set === undefined).toBe(true);
    expect(Object.hasOwn(EventConstructor.prototype, 'isTrusted')).toBe(false);
  });
});

function createBrowlet(): Browlet {
  return new Browlet({ route: () => '' });
}

function getGlobal<T>(browlet: Browlet, name: string): T {
  return Reflect.get(browlet.window, name) as T;
}
