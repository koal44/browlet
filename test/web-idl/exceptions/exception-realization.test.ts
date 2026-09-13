import { describe, expect, it } from 'vitest';
import {
  RangeError as InternalRangeError, SyntaxError as InternalSyntaxError,
  TypeError as InternalTypeError,
} from '../../../src/js-engine/simple-exception';
import {
  createDOMException, DOMException as InternalDOMException,
} from '../../../src/web-idl/core/dom-exception-core';
import { createBindingWorld } from '../../../src/web-idl/index';
import { TestRealm } from '../test-realm';

const cases = [
  {
    name: 'RangeError',
    create: () => new InternalRangeError('original message'),
    Exception: InternalRangeError,
    native: RangeError,
  },
  {
    name: 'SyntaxError',
    create: () => new InternalSyntaxError('original message'),
    Exception: InternalSyntaxError,
    native: SyntaxError,
  },
  {
    name: 'TypeError',
    create: () => new InternalTypeError('original message'),
    Exception: InternalTypeError,
    native: TypeError,
  },
  {
    name: 'DOMException',
    create: () => createDOMException('InvalidStateError', 'original message'),
    Exception: InternalDOMException,
    native: DOMException,
  },
];

describe.each(cases)('$name realization', ({ name, create, Exception, native }) => {
  it('retains native inheritance and recognizes only our class', () => {
    const exception = create();

    expect(exception).toBeInstanceOf(native);
    expect(Reflect.ownKeys(exception)).toEqual(Reflect.ownKeys(new native('original message')));
    expect(Exception.is(exception)).toBe(true);
    expect(Exception.is(new native('author exception'))).toBe(false);
  });

  it('realizes a frozen internal exception once and preserves later author changes', () => {
    const exception = create();
    Object.freeze(exception);

    const world = createBindingWorld([]);
    const binding = world.register(new TestRealm());
    binding.install(binding.realm.global);
    const error = binding.realizeException(exception);
    const constructor: unknown = Reflect.get(binding.realm.global, name);

    expect(error).toBeInstanceOf(constructor);
    expect(error).toHaveProperty('name', name === 'DOMException' ? 'InvalidStateError' : name);
    expect(error).toHaveProperty('message', 'original message');
    expect(error === exception).toBe(false);

    Object.defineProperty(error, 'message', { value: 'changed by author' });
    expect(binding.realizeException(exception)).toBe(error);
    expect(world.register(new TestRealm()).realizeException(error)).toBe(error);
    expect(error).toHaveProperty('message', 'changed by author');
  });

  it('does not recognize forged prototypes or inspect proxies', () => {
    const exception = create();
    const calls: string[] = [];
    const proxy = new Proxy(exception, {
      get() { calls.push('get'); throw new Error('get'); },
      has() { calls.push('has'); throw new Error('has'); },
      getPrototypeOf() { calls.push('getPrototypeOf'); throw new Error('getPrototypeOf'); },
      getOwnPropertyDescriptor() {
        calls.push('getOwnPropertyDescriptor');
        throw new Error('getOwnPropertyDescriptor');
      },
      ownKeys() { calls.push('ownKeys'); throw new Error('ownKeys'); },
    });
    const revoked = Proxy.revocable(exception, {});
    revoked.revoke();
    const context = createBindingWorld([]).register(new TestRealm());

    for (const value of [
      Object.create(Reflect.getPrototypeOf(exception)),
      proxy, revoked.proxy, null, undefined, 0, 'reason', () => undefined,
    ]) {
      expect(Exception.is(value)).toBe(false);
      expect(context.realizeException(value)).toBe(value);
    }
    expect(calls).toEqual([]);
  });
});
