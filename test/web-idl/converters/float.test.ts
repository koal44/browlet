import { describe, expect, it } from 'vitest';

import type { IDLFloatType } from '../../../src/web-idl/assembly/index';
import type { Converter } from '../../../src/web-idl/converters/converter';

import { createConversionSteps, createBinding, expectRealmTypeError } from '../../support/web-idl-conversion';

describe.each(['direct', 'prepared'] as const)('Web IDL %s floating-point conversion', (mode) => {
  const { jsToIDL } = createConversionSteps(mode);

  it('preserves floating-point restrictions, rounding, and negative zero', () => {
    const { binding, realm } = createBinding();
    const float = binding.getConverter(binding.assembly.builtinTypes.float);
    const unrestrictedFloat = binding.getConverter(binding.assembly.builtinTypes.unrestrictedFloat);
    const double = binding.getConverter(binding.assembly.builtinTypes.double);
    const unrestrictedDouble = binding.getConverter(binding.assembly.builtinTypes.unrestrictedDouble);

    const converters: Converter<IDLFloatType>[] = [float, unrestrictedFloat, double, unrestrictedDouble];
    for (const converter of converters) {
      expect(jsToIDL(-0, converter)).toBe(-0);
      expectRealmTypeError(() => jsToIDL(1n, converter), realm);
    }
    for (const value of [NaN, Infinity, -Infinity]) {
      expectRealmTypeError(() => jsToIDL(value, float), realm);
      expectRealmTypeError(() => jsToIDL(value, double), realm);
      expect(jsToIDL(value, unrestrictedFloat)).toBe(value);
      expect(jsToIDL(value, unrestrictedDouble)).toBe(value);
    }
    expectRealmTypeError(() => jsToIDL(Number.MAX_VALUE, float), realm);
    expect(jsToIDL(Number.MAX_VALUE, unrestrictedFloat)).toBe(Infinity);
    expect(jsToIDL(Number.MAX_VALUE, double)).toBe(Number.MAX_VALUE);
    expect(jsToIDL(1.337, unrestrictedFloat)).toBe(Math.fround(1.337));
    expect(jsToIDL(1.337, unrestrictedDouble)).toBe(1.337);
  });
});
