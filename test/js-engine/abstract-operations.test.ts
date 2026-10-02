import { describe, expect, it } from 'vitest';
import {
  defineDataProperty, defineMethod, getMethod, getV, isAccessorDescriptor,
  isCallable, isConstructor, isDataDescriptor, isObject, JSRealm,
  ordinarySetWithOwnDescriptor, toBigInt, toNumber, toPrimitive, toString,
} from '../../src/js-engine/index';
import { SyntaxError as InternalSyntaxError, TypeError as InternalTypeError } from '../../src/infra/exceptions';

describe('ECMAScript abstract operations', () => {
  it('recognizes ECMAScript Object values', () => {
    expect(isObject({})).toBe(true);
    expect(isObject(() => undefined)).toBe(true);
    expect(isObject(null)).toBe(false);
    expect(isObject('object')).toBe(false);
  });

  it('distinguishes callable and constructible objects', () => {
    expect(isCallable(() => undefined)).toBe(true);
    expect(isConstructor(() => undefined)).toBe(false);
    expect(isConstructor(class {})).toBe(true);
  });

  it('gets methods and realizes errors in the supplied realm', () => {
    const realm = new JSRealm();
    const method = () => undefined;
    expect(getMethod({ method }, 'method', realm)).toBe(method);
    expect(getMethod({ method: null }, 'method', realm)).toBeUndefined();
    expect(getMethod('value', 'toString', realm)).toBeTypeOf('function');
    expect(() => getMethod({ method: 1 }, 'method', realm))
      .toThrow(realm.intrinsics.typeError);
    expect(() => getMethod(null, 'method', realm))
      .toThrow(realm.intrinsics.typeError);
  });

  it('preserves GetV receivers for proxies and primitives boxed in another realm', () => {
    const realm = new JSRealm();
    const receivers: unknown[] = [];
    const object = new Proxy({ get value() { receivers.push(this); return 3; } }, {
      get(target, key, receiver) {
        receivers.push(receiver);
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    expect(getV(object, 'value', realm)).toBe(3);
    expect(receivers).toEqual([object, object]);

    const prototype = Object.getPrototypeOf(realm.intrinsics.object('text')) as object;
    Object.defineProperty(prototype, 'receiver', { get() { return this as unknown; } });
    expect(getV('text', 'receiver', realm)).toBe('text');
  });

  it('classifies property descriptors', () => {
    expect(isDataDescriptor({ value: undefined })).toBe(true);
    expect(isDataDescriptor({ writable: false })).toBe(true);
    expect(isDataDescriptor({ get: undefined })).toBe(false);
    expect(isAccessorDescriptor({ get: undefined })).toBe(true);
    expect(isAccessorDescriptor({ set: undefined })).toBe(true);
    expect(isAccessorDescriptor({ value: undefined })).toBe(false);
  });

  it('creates own data properties without calling inherited setters', () => {
    const prototype = { set value(_value: unknown) { throw new Error('Inherited setter invoked'); } };
    const target = Object.create(prototype) as object;

    expect(defineDataProperty(target, 'value', 7)).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(target, 'value')).toEqual({
      configurable: true, enumerable: true, value: 7, writable: true,
    });
    defineDataProperty(target, '__proto__', 'ordinary data');
    expect(Object.getPrototypeOf(target)).toBe(prototype);
    expect(Object.getOwnPropertyDescriptor(target, '__proto__')?.value).toBe('ordinary data');
  });

  it('defines non-enumerable methods', () => {
    const target = {};
    const method = () => undefined;

    expect(defineMethod(target, Symbol.iterator, method)).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(target, Symbol.iterator)).toEqual({
      configurable: true, enumerable: false, value: method, writable: true,
    });
  });

  it.each([defineDataProperty, defineMethod])('%s throws when property creation is refused', (define) => {
    const method = () => undefined;
    expect(() => define(Object.preventExtensions({}), 'method', method)).toThrow(TypeError);

    const keys: PropertyKey[] = [];
    const proxy = new Proxy({}, {
      defineProperty(_target, key) {
        keys.push(key);
        return false;
      },
    });
    expect(() => define(proxy, 'method', method)).toThrow(TypeError);
    expect(keys).toEqual(['method']);
  });

  it('performs an ordinary set with the supplied own descriptor', () => {
    const target = Object.defineProperty({}, 'value', {
      configurable: true,
      value: 'target',
      writable: true,
    });
    const receiver = {};

    expect(ordinarySetWithOwnDescriptor(
      target,
      'value',
      'receiver',
      receiver,
      Reflect.getOwnPropertyDescriptor(target, 'value'),
    )).toBe(true);
    expect(Reflect.get(target, 'value')).toBe('target');
    expect(Reflect.get(receiver, 'value')).toBe('receiver');

    expect(ordinarySetWithOwnDescriptor(
      target,
      'value',
      'blocked',
      Object.freeze(receiver),
      Reflect.getOwnPropertyDescriptor(target, 'value'),
    )).toBe(false);
  });

  it('uses the requested primitive-conversion hint', () => {
    const hints: string[] = [];
    const value = {
      [Symbol.toPrimitive](hint: string) {
        hints.push(hint);
        return hint === 'number' ? 7 : 'seven';
      },
    };

    expect(toNumber(value)).toBe(7);
    expect(toString(value)).toBe('seven');
    expect(hints).toEqual(['number', 'string']);
  });

  it('uses the ordinary primitive-conversion method order', () => {
    const calls: string[] = [];
    const value = {
      toString() {
        calls.push('toString');
        return 'string';
      },
      valueOf() {
        calls.push('valueOf');
        return 1;
      },
    };

    expect(toPrimitive(value, 'number')).toBe(1);
    expect(toPrimitive(value, 'string')).toBe('string');
    expect(calls).toEqual(['valueOf', 'toString']);
  });

  it('uses the default hint and number ordering when no type is preferred', () => {
    const hints: string[] = [];
    const exotic = {
      [Symbol.toPrimitive](hint: string) {
        hints.push(hint);
        return 'value';
      },
    };
    expect(toPrimitive(exotic)).toBe('value');
    expect(hints).toEqual(['default']);

    const calls: string[] = [];
    expect(toPrimitive({
      toString() {
        calls.push('toString');
        return 'string';
      },
      valueOf() {
        calls.push('valueOf');
        return 1;
      },
    })).toBe(1);
    expect(calls).toEqual(['valueOf']);
  });

  it('performs BigInt conversion', () => {
    expect(toBigInt('42')).toBe(42n);
    expect(toBigInt(true)).toBe(1n);
  });

  it('requests errors for invalid primitive conversions', () => {
    for (const [convert, Exception] of [
      [() => toPrimitive({ [Symbol.toPrimitive]: () => ({}) }), InternalTypeError],
      [() => toNumber(1n), InternalTypeError],
      [() => toNumber(Symbol()), InternalTypeError],
      [() => toString(Symbol()), InternalTypeError],
      [() => toBigInt(1), InternalTypeError],
      [() => toBigInt('not an integer'), InternalSyntaxError],
    ] as const) {
      let caught: unknown;
      try {
        convert();
      } catch (error) {
        caught = error;
      }
      expect(Exception.is(caught)).toBe(true);
    }
  });
});
