// Web IDL: https://webidl.spec.whatwg.org/#js-creating-throwing-exceptions

/*
 * Implementations can request an exception without selecting its realm. The
 * binding recognizes only these requests; existing JavaScript errors pass
 * through unchanged.
 */
export class RangeError extends globalThis.RangeError {
  constructor(message = '') {
    super(message);
    simpleExceptionRequests.set(this, { type: 'rangeError', message });
  }
}

export class TypeError extends globalThis.TypeError {
  constructor(message = '') {
    super(message);
    simpleExceptionRequests.set(this, { type: 'typeError', message });
  }
}

export function getSimpleExceptionRequest(
  value: unknown,
): SimpleExceptionRequest | undefined {
  return typeof value === 'object' && value !== null
    ? simpleExceptionRequests.get(value)
    : undefined;
}

type SimpleExceptionRequest = {
  type: 'rangeError' | 'typeError';
  message: string;
};

const simpleExceptionRequests = new WeakMap<object, SimpleExceptionRequest>();
