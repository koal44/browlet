import { describe, expect, it } from 'vitest';
import { createBindingWorld } from '../../../src/web-idl/index';
import {
  RangeError as RangeErrorRequest, SyntaxError as SyntaxErrorRequest,
  TypeError as TypeErrorRequest,
} from '../../../src/js-engine/simple-exception';
import { TestRealm } from '../test-realm';

describe('Web IDL simple exceptions', () => {
  it.each([
    { name: 'RangeError', Exception: RangeErrorRequest },
    { name: 'SyntaxError', Exception: SyntaxErrorRequest },
    { name: 'TypeError', Exception: TypeErrorRequest },
  ])('realizes a requested $name once, preserving its message', ({ name, Exception }) => {
    const bindings = createBindingWorld([]);
    const realm = new TestRealm();
    const context = bindings.register(realm);
    const foreignContext = bindings.register(new TestRealm());
    const request = new Exception('invalid input');
    const error = context.realizeException(request);

    expect(error).toBeInstanceOf(Reflect.get(realm.global, name));
    expect(error).toHaveProperty('message', 'invalid input');
    expect(error).not.toBe(request);
    expect(foreignContext.realizeException(error)).toBe(error);
  });

  it('preserves existing exceptions and does not inspect author objects', () => {
    const context = createBindingWorld([]).register(new TestRealm());
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    for (const value of [
      new RangeError('author error'), new SyntaxError('author error'),
      new TypeError('author error'), proxy,
      { name: 'TypeError', message: 'author value' }, null, undefined, 'reason',
    ]) {
      expect(context.realizeException(value)).toBe(value);
    }
  });
});
