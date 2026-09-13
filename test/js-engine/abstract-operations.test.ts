import { describe, expect, it } from 'vitest';
import {
  getMethod, isAccessorDescriptor, isCallable, isConstructor,
  isDataDescriptor, isObject, JSRealm, ordinarySetWithOwnDescriptor,
  toBigInt, toNumber,
  toPrimitive, toString, SyntaxError as InternalSyntaxError, TypeError as InternalTypeError,
} from '../../src/js-engine/index';

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

  it('classifies property descriptors', () => {
    expect(isDataDescriptor({ value: undefined })).toBe(true);
    expect(isDataDescriptor({ writable: false })).toBe(true);
    expect(isDataDescriptor({ get: undefined })).toBe(false);
    expect(isAccessorDescriptor({ get: undefined })).toBe(true);
    expect(isAccessorDescriptor({ set: undefined })).toBe(true);
    expect(isAccessorDescriptor({ value: undefined })).toBe(false);
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
