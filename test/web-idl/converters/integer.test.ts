import { describe, expect, it } from 'vitest';

import { annotated, idlType, xattr } from '../../../src/web-idl/core/index';

import { createConversionSteps, createBinding, expectRealmTypeError } from '../../support/web-idl-conversion';

describe.each(['direct', 'prepared'] as const)('Web IDL %s integer conversion', (mode) => {
  const { jsToIDL } = createConversionSteps(mode);

  it('preserves integer bounds, non-finite handling, and rounding across prepared modes', () => {
    const { binding, realm } = createBinding();
    const cases = [
      [idlType.byte, -128, 127],
      [idlType.octet, 0, 255],
      [idlType.short, -32768, 32767],
      [idlType.unsignedShort, 0, 65535],
      [idlType.long, -2147483648, 2147483647],
      [idlType.unsignedLong, 0, 4294967295],
      [idlType.longLong, -9007199254740991, 9007199254740991],
      [idlType.unsignedLongLong, 0, 9007199254740991],
    ] as const;

    for (const [type, minimum, maximum] of cases) {
      const wrap = binding.getConverter(binding.assembly.getIDLType(type));
      const clamp = binding.getConverter(binding.assembly.getIDLType(annotated(type, xattr('Clamp'))));
      const enforce = binding.getConverter(binding.assembly.getIDLType(annotated(type, xattr('EnforceRange'))));
      for (const converter of [wrap, clamp, enforce]) {
        expect(jsToIDL(minimum, converter)).toBe(minimum);
        expect(jsToIDL(maximum, converter)).toBe(maximum);
        expect(jsToIDL(-0, converter)).toBe(0);
        expectRealmTypeError(() => jsToIDL(Symbol('number'), converter), realm);
        let coercions = 0;
        expect(jsToIDL({ valueOf() { coercions++; return 2.5; } }, converter)).toBe(2);
        expect(coercions).toBe(1);
      }
      for (const value of [NaN, Infinity, -Infinity]) {
        expect(jsToIDL(value, wrap)).toBe(0);
        expectRealmTypeError(() => jsToIDL(value, enforce), realm);
      }
      expect(jsToIDL(NaN, clamp)).toBe(0);
      expect(jsToIDL(-Infinity, clamp)).toBe(minimum);
      expect(jsToIDL(Infinity, clamp)).toBe(maximum);
      expect(jsToIDL(minimum - 1, clamp)).toBe(minimum);
      expect(jsToIDL(maximum + 1, clamp)).toBe(maximum);
      expect(jsToIDL(3.5, clamp)).toBe(4);
      expect(jsToIDL(-0.5, clamp)).toBe(0);
      expectRealmTypeError(() => jsToIDL(minimum - 1, enforce), realm);
      expectRealmTypeError(() => jsToIDL(maximum + 1, enforce), realm);
    }
  });
});
