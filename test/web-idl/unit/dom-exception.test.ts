import { describe, expect, it } from 'vitest';

import { Realm } from '../../../src/browlet/realm';
import { Domlet } from '../../../src/domlet/domlet';

describe('Web IDL DOMException binding', () => {
  it('creates Error-like platform objects in their binding realm', () => {
    const realm = new Realm();
    const domlet = new Domlet(realm);
    const DOMException_ = domlet.bindings.DOMException;
    const exception = new DOMException_('failed', 'SyntaxError');

    expect(exception).toBeInstanceOf(DOMException_);
    expect(exception).toBeInstanceOf(realm.intrinsics.error);
    expect(exception).not.toBeInstanceOf(DOMException);
    expect(exception.name).toBe('SyntaxError');
    expect(exception.message).toBe('failed');
    expect(exception.code).toBe(12);
    expect(typeof exception.stack).toBe('string');
    expect(Object.prototype.toString.call(exception)).toBe(
      '[object DOMException]',
    );
    expect(Error.prototype.toString.call(exception)).toBe(
      'SyntaxError: failed',
    );
    expect(Reflect.getPrototypeOf(DOMException_.prototype)).toBe(
      realm.intrinsics.errorPrototype,
    );
  });

  it('uses constructor defaults, legacy codes, and realm-specific identity', () => {
    const first = new Domlet(new Realm());
    const second = new Domlet(new Realm());
    const FirstDOMException = first.bindings.DOMException;
    const SecondDOMException = second.bindings.DOMException;
    const defaults = new FirstDOMException();
    const quota = new FirstDOMException('', 'QuotaExceededError');
    const custom = new FirstDOMException('', 'CustomError');

    expect(defaults.name).toBe('Error');
    expect(defaults.message).toBe('');
    expect(defaults.code).toBe(0);
    expect(quota.code).toBe(22);
    expect(custom.code).toBe(0);
    expect(defaults).not.toBeInstanceOf(SecondDOMException);
    expect(FirstDOMException).not.toBe(SecondDOMException);
  });

  it('defines every legacy constant on the constructor and prototype', () => {
    const { DOMException: DOMException_ } = new Domlet().bindings;

    expect(DOMException_.INDEX_SIZE_ERR).toBe(1);
    expect(DOMException_.DOMSTRING_SIZE_ERR).toBe(2);
    expect(DOMException_.DATA_CLONE_ERR).toBe(25);
    expect(DOMException_.prototype.SYNTAX_ERR).toBe(12);
    expect(Reflect.getOwnPropertyDescriptor(
      DOMException_,
      'SYNTAX_ERR',
    )).toEqual({
      configurable: false,
      enumerable: true,
      value: 12,
      writable: false,
    });
  });

  it('implements the predefined QuotaExceededError derived interface', () => {
    const realm = new Realm();
    const domlet = new Domlet(realm);
    const QuotaExceededError_ = getQuotaExceededError(domlet);
    const defaults = new QuotaExceededError_();
    const exception = new QuotaExceededError_('full', {
      quota: 10,
      requested: 12,
    });

    expect(defaults.name).toBe('QuotaExceededError');
    expect(defaults.message).toBe('');
    expect(defaults.code).toBe(22);
    expect(defaults.quota).toBeNull();
    expect(defaults.requested).toBeNull();
    expect(exception).toBeInstanceOf(QuotaExceededError_);
    expect(exception).toBeInstanceOf(domlet.bindings.DOMException);
    expect(exception).toBeInstanceOf(realm.intrinsics.error);
    expect(exception.name).toBe('QuotaExceededError');
    expect(exception.message).toBe('full');
    expect(exception.code).toBe(22);
    expect(exception.quota).toBe(10);
    expect(exception.requested).toBe(12);
    expect(Object.prototype.toString.call(exception)).toBe(
      '[object QuotaExceededError]',
    );

    expect(() => new QuotaExceededError_('', { quota: -1 })).toThrow(
      realm.intrinsics.rangeError,
    );
    expect(() => new QuotaExceededError_('', {
      quota: 10,
      requested: 9,
    })).toThrow(realm.intrinsics.rangeError);
  });

  it('realizes implementation DOMExceptions in the invoking realm', () => {
    const realm = new Realm();
    const domlet = new Domlet(realm);
    const document = domlet.parse('<html></html>');
    let exception: unknown;

    try {
      document.documentElement.insertBefore(
        document.createElement('div'),
        document.createElement('span'),
      );
    } catch (error) {
      exception = error;
    }

    expect(exception).toBeInstanceOf(domlet.bindings.DOMException);
    expect(exception).toBeInstanceOf(realm.intrinsics.error);
    expect(exception).not.toBeInstanceOf(DOMException);
    expect((exception as DOMException).name).toBe('NotFoundError');
  });
});

type BoundQuotaExceededError = DOMException & {
  readonly quota: number | null;
  readonly requested: number | null;
};

type BoundQuotaExceededErrorConstructor = {
  new(message?: string, options?: {
    quota?: number;
    requested?: number;
  }): BoundQuotaExceededError;
  readonly prototype: BoundQuotaExceededError;
};

function getQuotaExceededError(
  domlet: Domlet,
): BoundQuotaExceededErrorConstructor {
  const constructor = domlet.bindings.exposed.get('QuotaExceededError');
  if (typeof constructor !== 'function') {
    throw new Error('QuotaExceededError was not exposed');
  }
  return constructor as unknown as BoundQuotaExceededErrorConstructor;
}
