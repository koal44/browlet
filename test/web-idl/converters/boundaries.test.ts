import { describe, expect, it } from 'vitest';

import { annotated, idlType, tsType, union, xattr } from '../../../src/web-idl/core/index';

import { createConversionSteps, createBinding, expectRealmTypeError } from '../../support/web-idl-conversion';

describe.each(['direct', 'prepared'] as const)('Web IDL %s conversion boundaries', (mode) => {
  const { jsToIDL, idlToJS } = createConversionSteps(mode);

  it('keeps TypeScript refinements out of runtime conversion', () => {
    const { binding } = createBinding();
    const byte = tsType(idlType.byte, 'T');
    const ordinary = binding.getConverter(binding.assembly.getIDLType(idlType.byte));
    const refined = binding.getConverter(binding.assembly.getIDLType(byte));
    const clamped = binding.getConverter(binding.assembly.getIDLType(annotated(byte, xattr('Clamp'))));
    expect(jsToIDL('257', refined)).toBe(jsToIDL('257', ordinary));
    expect(jsToIDL('257', clamped)).toBe(127);
    expect(idlToJS(1, refined)).toBe(1);
  });

  it('preserves author exceptions while realizing primitive-conversion failures', () => {
    const { binding, realm } = createBinding();
    const authorError = new TypeError('author conversion');
    const value = { toString() { throw authorError; } };

    for (const type of [
      idlType.DOMString, idlType.USVString, idlType.ByteString,
      idlType.long, idlType.double, idlType.bigint,
      union(idlType.long, idlType.bigint),
    ]) {
      let caught: unknown;
      try {
        jsToIDL(value, binding.getConverter(binding.assembly.getIDLType(type)));
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(authorError);
      expectRealmTypeError(
        () => jsToIDL({ [Symbol.toPrimitive]: () => ({}) }, binding.getConverter(binding.assembly.getIDLType(type))),
        realm,
      );
    }
  });
});
