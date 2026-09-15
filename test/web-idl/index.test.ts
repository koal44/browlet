import { describe, expect, it } from 'vitest';

import * as core from '../../src/web-idl/core/index';
import * as webIDL from '../../src/web-idl/index';

describe('Web IDL package surface', () => {
  it('exposes declarations, binding entry points, exceptions, and async-sequence values', () => {
    expect(Object.keys(webIDL).sort()).toEqual([
      ...Object.keys(core),
      'BindingWorld',
      'DOMExceptionImpl',
      'QuotaExceededErrorImpl',
      'defineCapability',
      'domExceptionIDL',
      'endOfIteration',
      'isStampedImplInstance',
      'isStampedPlatformObject',
      'quotaExceededErrorIDL',
      'quotaExceededErrorOptionsIDL',
    ].sort());
  });
});
