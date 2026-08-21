import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';

describe('Browlet DOMException binding', () => {
  it('creates Error-like platform objects in their binding realm', () => {
    const browlet = createBrowlet();
    const DOMException_ = getConstructor<typeof DOMException>(
      browlet,
      'DOMException',
    );
    const Error_ = getConstructor<ErrorConstructor>(browlet, 'Error');
    const exception = new DOMException_('failed', 'SyntaxError');

    expect(exception).toBeInstanceOf(DOMException_);
    expect(exception).toBeInstanceOf(Error_);
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
      Error_.prototype,
    );
  });

  it('uses constructor defaults, legacy codes, and realm-specific identity', () => {
    const first = createBrowlet();
    const second = createBrowlet();
    const FirstDOMException = getConstructor<typeof DOMException>(
      first,
      'DOMException',
    );
    const SecondDOMException = getConstructor<typeof DOMException>(
      second,
      'DOMException',
    );
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
    const DOMException_ = getConstructor<typeof DOMException>(
      createBrowlet(),
      'DOMException',
    );

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
    const browlet = createBrowlet();
    const DOMException_ = getConstructor<typeof DOMException>(
      browlet,
      'DOMException',
    );
    const Error_ = getConstructor<ErrorConstructor>(browlet, 'Error');
    const RangeError_ = getConstructor<RangeErrorConstructor>(
      browlet,
      'RangeError',
    );
    const QuotaExceededError_ = getConstructor<
      BoundQuotaExceededErrorConstructor
    >(browlet, 'QuotaExceededError');
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
    expect(exception).toBeInstanceOf(DOMException_);
    expect(exception).toBeInstanceOf(Error_);
    expect(exception.name).toBe('QuotaExceededError');
    expect(exception.message).toBe('full');
    expect(exception.code).toBe(22);
    expect(exception.quota).toBe(10);
    expect(exception.requested).toBe(12);
    expect(Object.prototype.toString.call(exception)).toBe(
      '[object QuotaExceededError]',
    );

    expect(() => new QuotaExceededError_('', { quota: -1 }))
      .toThrow(RangeError_);
    expect(() => new QuotaExceededError_('', {
      quota: 10,
      requested: 9,
    })).toThrow(RangeError_);
  });

  it('realizes implementation DOMExceptions in the invoking realm', () => {
    const browlet = createBrowlet();
    const DOMException_ = getConstructor<typeof DOMException>(
      browlet,
      'DOMException',
    );
    const Error_ = getConstructor<ErrorConstructor>(browlet, 'Error');
    const document = browlet.document;
    let exception: unknown;

    try {
      document.documentElement.insertBefore(
        document.createElement('div'),
        document.createElement('span'),
      );
    } catch (error) {
      exception = error;
    }

    expect(exception).toBeInstanceOf(DOMException_);
    expect(exception).toBeInstanceOf(Error_);
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

function createBrowlet(): Browlet {
  return new Browlet({ route: () => '' });
}

function getConstructor<TConstructor>(
  browlet: Browlet,
  name: string,
): TConstructor {
  const constructor: unknown = Reflect.get(browlet.window, name);
  if (typeof constructor !== 'function') {
    throw new Error(`${name} was not exposed`);
  }
  return constructor as TConstructor;
}
