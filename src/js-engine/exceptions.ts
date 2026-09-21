/*
 * Implementations can request an exception without selecting its realm. The
 * binding recognizes only these classes; existing JavaScript errors pass
 * through unchanged.
 */
// eslint-disable-next-line no-restricted-properties -- Branded exception requests must inherit the corresponding native error.
export class RangeError extends globalThis.RangeError {
  #brand: undefined;

  static is(value: unknown): value is RangeError {
    return typeof value === 'object' && value !== null && #brand in value;
  }
}

// eslint-disable-next-line no-restricted-properties -- Branded exception requests must inherit the corresponding native error.
export class SyntaxError extends globalThis.SyntaxError {
  #brand: undefined;

  static is(value: unknown): value is SyntaxError {
    return typeof value === 'object' && value !== null && #brand in value;
  }
}

// eslint-disable-next-line no-restricted-properties -- Branded exception requests must inherit the corresponding native error.
export class TypeError extends globalThis.TypeError {
  #brand: undefined;

  static is(value: unknown): value is TypeError {
    return typeof value === 'object' && value !== null && #brand in value;
  }
}
