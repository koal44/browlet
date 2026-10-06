import { types } from 'node:util';
import { describe, expect, it } from 'vitest';

import {
  DOMExceptionImpl, DOMExceptionCodes, DOMExceptionNames, DOMExceptionStamper, isDOMException,
} from '../../../src/web-idl/core/dom-exception';
import { BindingWorld } from '../../../src/web-idl/index';

import { TestRealm } from '../../support/web-idl-realm';

describe('DOMException names', () => {
  it('follows the Web IDL names table and legacy code order', () => {
    expect(Object.entries(DOMExceptionNames)).toEqual([
      ['indexSize', 'IndexSizeError'],
      ['hierarchyRequest', 'HierarchyRequestError'],
      ['wrongDocument', 'WrongDocumentError'],
      ['invalidCharacter', 'InvalidCharacterError'],
      ['noModificationAllowed', 'NoModificationAllowedError'],
      ['notFound', 'NotFoundError'],
      ['notSupported', 'NotSupportedError'],
      ['inUseAttribute', 'InUseAttributeError'],
      ['invalidState', 'InvalidStateError'],
      ['syntax', 'SyntaxError'],
      ['invalidModification', 'InvalidModificationError'],
      ['namespace', 'NamespaceError'],
      ['invalidAccess', 'InvalidAccessError'],
      ['typeMismatch', 'TypeMismatchError'],
      ['security', 'SecurityError'],
      ['network', 'NetworkError'],
      ['abort', 'AbortError'],
      ['urlMismatch', 'URLMismatchError'],
      ['quotaExceeded', 'QuotaExceededError'],
      ['timeout', 'TimeoutError'],
      ['invalidNodeType', 'InvalidNodeTypeError'],
      ['dataClone', 'DataCloneError'],
      ['encoding', 'EncodingError'],
      ['notReadable', 'NotReadableError'],
      ['unknown', 'UnknownError'],
      ['constraint', 'ConstraintError'],
      ['data', 'DataError'],
      ['transactionInactive', 'TransactionInactiveError'],
      ['readOnly', 'ReadOnlyError'],
      ['version', 'VersionError'],
      ['operation', 'OperationError'],
      ['notAllowed', 'NotAllowedError'],
      ['optOut', 'OptOutError'],
    ]);

    expect(Object.values(DOMExceptionCodes)).toEqual([
      1, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20, 21,
      22, 23, 24, 25,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });
});

describe('DOMException recognition', () => {
  it('recognizes implementations and projected exceptions across realms', () => {
    const world = new BindingWorld([]);
    const first = world.register(new TestRealm(), (ctx) => ({ realm: ctx.realm }));
    const second = world.register(new TestRealm(), (ctx) => ({ realm: ctx.realm }));
    const implementation = new DOMExceptionImpl('internal', 'AbortError');

    expect(DOMExceptionImpl.is(implementation)).toBe(true);
    expect(isDOMException(implementation, 'AbortError')).toBe(true);
    expect(isDOMException(implementation, 'NetworkError')).toBe(false);
    expect(DOMExceptionStamper.is(implementation)).toBe(false);
    for (const ctx of [first, second]) {
      ctx.install(ctx.realm.global);
      const Constructor = Reflect.get(ctx.realm.global, 'DOMException') as typeof DOMException;
      const exception = new Constructor('projected', 'AbortError');

      expect(exception).toBeInstanceOf(ctx.realm.intrinsics.error);
      expect(types.isNativeError(exception)).toBe(true);
      expect(DOMExceptionStamper.is(exception)).toBe(true);
      expect(isDOMException(exception, 'AbortError')).toBe(true);
      expect(isDOMException(exception, 'NetworkError')).toBe(false);
      expect(DOMExceptionImpl.is(exception)).toBe(false);
      expect(first.realizeException(exception)).toBe(exception);
      expect(second.realizeException(exception)).toBe(exception);

      Object.defineProperty(exception, 'name', {
        get() { throw new Error('Recognition read the author name getter'); },
      });
      expect(isDOMException(exception, 'AbortError')).toBe(true);
    }
  });

  it('inherits recognition and Error backing for QuotaExceededError', () => {
    const ctx = new BindingWorld([]).register(new TestRealm(), (ctx) => ({ realm: ctx.realm }));
    ctx.install(ctx.realm.global);
    const Constructor = Reflect.get(ctx.realm.global, 'QuotaExceededError') as new (
      message: string, options: { quota: number; requested: number; }
    ) => DOMException;
    const exception = new Constructor('full', { quota: 10, requested: 12 });

    expect(exception).toBeInstanceOf(ctx.realm.intrinsics.error);
    expect(types.isNativeError(exception)).toBe(true);
    expect(DOMExceptionStamper.is(exception)).toBe(true);
    expect(isDOMException(exception, 'QuotaExceededError')).toBe(true);
    expect(exception).toHaveProperty('quota', 10);
    expect(exception).toHaveProperty('requested', 12);
  });

  it.each(['implementation', 'platform'])('rejects forged %s objects and proxies without invoking author code', (kind) => {
    const ctx = new BindingWorld([]).register(new TestRealm(), (ctx) => ({ realm: ctx.realm }));
    const implementation = new DOMExceptionImpl('', 'AbortError');
    const exception = kind === 'implementation'
      ? implementation
      : ctx.realizeException(implementation) as object;
    const calls: string[] = [];
    const proxy = new Proxy(exception, {
      get() { calls.push('get'); throw new Error('get'); },
      has() { calls.push('has'); throw new Error('has'); },
      getPrototypeOf() { calls.push('getPrototypeOf'); throw new Error('getPrototypeOf'); },
    });
    const revoked = Proxy.revocable(exception, {});
    revoked.revoke();

    for (const value of [
      { name: 'AbortError' }, Object.create(exception),
      new globalThis.DOMException('', 'AbortError'),
      proxy, revoked.proxy, null, undefined, 1, 'AbortError', () => undefined,
    ]) {
      expect(DOMExceptionImpl.is(value)).toBe(false);
      expect(DOMExceptionStamper.is(value)).toBe(false);
      expect(isDOMException(value, 'AbortError')).toBe(false);
      expect(ctx.realizeException(value)).toBe(value);
    }
    expect(calls).toEqual([]);
  });
});
