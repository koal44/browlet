import { Stamper } from './stamper';

/*
 * Implementations can request an exception without selecting its realm. The
 * binding recognizes only these classes; existing JavaScript errors pass
 * through unchanged.
 */
// eslint-disable-next-line no-restricted-properties -- Branded exception requests must inherit the corresponding native error.
export class RangeError extends globalThis.RangeError {
  #brand = ExceptionRequestStamper.stamp(this, 'RangeError');

  static is(value: unknown): value is RangeError {
    return typeof value === 'object' && value !== null && #brand in value;
  }
}

// eslint-disable-next-line no-restricted-properties -- Branded exception requests must inherit the corresponding native error.
export class SyntaxError extends globalThis.SyntaxError {
  #brand = ExceptionRequestStamper.stamp(this, 'SyntaxError');

  static is(value: unknown): value is SyntaxError {
    return typeof value === 'object' && value !== null && #brand in value;
  }
}

// eslint-disable-next-line no-restricted-properties -- Branded exception requests must inherit the corresponding native error.
export class TypeError extends globalThis.TypeError {
  #brand = ExceptionRequestStamper.stamp(this, 'TypeError');

  static is(value: unknown): value is TypeError {
    return typeof value === 'object' && value !== null && #brand in value;
  }
}

/** Recognize a realm-neutral exception request without probing every exception class. */
export class ExceptionRequestStamper extends Stamper {
  #request: ExceptionRequest;

  private constructor(exception: ExceptionRequest['exception'], type: ExceptionRequest['type']) {
    super(exception);
    this.#request = { exception, type };
  }

  static stamp(exception: ExceptionRequest['exception'], type: ExceptionRequest['type']): void {
    new ExceptionRequestStamper(exception, type);
  }

  static get(value: object): ExceptionRequest | undefined {
    return #request in value ? value.#request : undefined;
  }
}

type ExceptionRequest = {
  exception: { message: string; name: string; };
  type: 'RangeError' | 'SyntaxError' | 'TypeError' | 'DOMException';
};
