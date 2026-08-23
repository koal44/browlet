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
    expect(Object.hasOwn(DOMException_.prototype, 'stack')).toBe(false);
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
    const shadowed = new FirstDOMException('', 'InvalidCharacterError');

    Object.defineProperty(shadowed, 'name', {
      value: 'WrongDocumentError',
    });

    expect(defaults.name).toBe('Error');
    expect(defaults.message).toBe('');
    expect(defaults.code).toBe(0);
    expect(quota.code).toBe(22);
    expect(custom.code).toBe(0);
    expect(shadowed.code).toBe(5);
    expect(defaults).not.toBeInstanceOf(SecondDOMException);
    expect(FirstDOMException).not.toBe(SecondDOMException);
  });

  it.fails('uses the standardized inherited Error stack accessor', () => {
    const browlet = createBrowlet();
    const DOMException_ = getConstructor<typeof DOMException>(
      browlet,
      'DOMException',
    );
    const Error_ = getConstructor<ErrorConstructor>(browlet, 'Error');
    const exception = new DOMException_('failed', 'SyntaxError');
    const descriptor = Reflect.getOwnPropertyDescriptor(
      Error_.prototype,
      'stack',
    );

    expect(Object.hasOwn(exception, 'stack')).toBe(false);
    expect(descriptor?.get).toBeTypeOf('function');
    expect(descriptor?.set).toBeTypeOf('function');
    expect(Reflect.apply(descriptor!.get!, exception, []))
      .toBe(exception.stack);
  });

  it.fails('is recognized by the realm Error.isError operation', () => {
    const browlet = createBrowlet();
    const DOMException_ = getConstructor<typeof DOMException>(
      browlet,
      'DOMException',
    );
    const Error_ = getConstructor<ErrorConstructor>(browlet, 'Error');
    const isError: unknown = Reflect.get(Error_, 'isError');

    expect(isError).toBeTypeOf('function');
    expect(Reflect.apply(isError as CallableFunction, Error_, [
      new DOMException_(),
    ])).toBe(true);
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

  it('realizes implementation DOMExceptions in the operation realm', () => {
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
    const SecondError = getConstructor<ErrorConstructor>(second, 'Error');
    const SecondNode = getConstructor<typeof Node>(second, 'Node');
    const insertBefore = Reflect.get(
      SecondNode.prototype,
      'insertBefore',
    ) as CallableFunction;
    const document = first.document;
    let exception: unknown;

    try {
      Reflect.apply(insertBefore, document.documentElement, [
        document.createElement('div'),
        document.createElement('span'),
      ]);
    } catch (error) {
      exception = error;
    }

    expect(exception).toBeInstanceOf(SecondDOMException);
    expect(exception).toBeInstanceOf(SecondError);
    expect(exception).not.toBeInstanceOf(FirstDOMException);
    expect(exception).not.toBeInstanceOf(DOMException);
    expect((exception as DOMException).name).toBe('NotFoundError');
  });

  it.fails('serializes and deserializes DOMException through structuredClone', () => {
    const browlet = createBrowlet();
    const DOMException_ = getConstructor<typeof DOMException>(
      browlet,
      'DOMException',
    );
    const structuredClone_: unknown = Reflect.get(
      browlet.window,
      'structuredClone',
    );
    const exception = new DOMException_('some message', 'IndexSizeError');

    Reflect.set(exception, 'custom', 'not serialized');
    expect(structuredClone_).toBeTypeOf('function');
    const clone = Reflect.apply(
      structuredClone_ as CallableFunction,
      browlet.window,
      [exception],
    ) as DOMException;

    expect(clone).toBeInstanceOf(DOMException_);
    expect(clone.name).toBe('IndexSizeError');
    expect(clone.message).toBe('some message');
    expect(clone.code).toBe(DOMException_.INDEX_SIZE_ERR);
    expect(Reflect.get(clone, 'custom')).toBeUndefined();
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
