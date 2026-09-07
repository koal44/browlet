import { describe, expect, it } from 'vitest';
import {
  createIteratorResultObject, getMethod, isAccessorDescriptor, isCallable,
  isConstructor, isDataDescriptor, isObject, NodeRealm,
  ordinarySetWithOwnDescriptor, toBigInt, toNumber, toPrimitive, toString,
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
    const realm = new NodeRealm();
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
    const realm = new NodeRealm();
    const hints: string[] = [];
    const value = {
      [Symbol.toPrimitive](hint: string) {
        hints.push(hint);
        return hint === 'number' ? 7 : 'seven';
      },
    };

    expect(toNumber(value, realm)).toBe(7);
    expect(toString(value, realm)).toBe('seven');
    expect(hints).toEqual(['number', 'string']);
  });

  it('uses the ordinary primitive-conversion method order', () => {
    const realm = new NodeRealm();
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

    expect(toPrimitive(value, realm, 'number')).toBe(1);
    expect(toPrimitive(value, realm, 'string')).toBe('string');
    expect(calls).toEqual(['valueOf', 'toString']);
  });

  it('uses the default hint and number ordering when no type is preferred', () => {
    const realm = new NodeRealm();
    const hints: string[] = [];
    const exotic = {
      [Symbol.toPrimitive](hint: string) {
        hints.push(hint);
        return 'value';
      },
    };
    expect(toPrimitive(exotic, realm)).toBe('value');
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
    }, realm)).toBe(1);
    expect(calls).toEqual(['valueOf']);
  });

  it('performs BigInt conversion and realizes failures in the supplied realm', () => {
    const realm = new NodeRealm();
    expect(toBigInt('42', realm)).toBe(42n);
    expect(toBigInt(true, realm)).toBe(1n);
    expect(() => toBigInt(1, realm)).toThrow(realm.intrinsics.typeError);
    expect(() => toNumber(1n, realm)).toThrow(realm.intrinsics.typeError);
    expect(() => toString(Symbol(), realm)).toThrow(realm.intrinsics.typeError);
    expect(() => toPrimitive({
      [Symbol.toPrimitive]: () => ({}),
    }, realm, 'number')).toThrow(realm.intrinsics.typeError);
  });

  it('creates realm-owned ordinary and iterator-result objects', () => {
    const realm = new NodeRealm();
    const prototype = realm.createOrdinaryObject(null);
    const object = realm.createOrdinaryObject(prototype);
    expect(Reflect.getPrototypeOf(object)).toBe(prototype);
    expect(realm.runtime.getAssociatedRealm(object)).toBe(realm);

    const result = createIteratorResultObject(realm, 'value', false);
    expect(result).toEqual({ value: 'value', done: false });
    expect(Reflect.getPrototypeOf(result))
      .toBe(realm.intrinsics.objectPrototype);
  });
});
