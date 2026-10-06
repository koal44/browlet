import { describe, expect, it } from 'vitest';

import { annotated, defineEnumeration, idlType, reference, xattr } from '../../../src/web-idl/core/index';

import { createConversionSteps, createBinding, expectRealmTypeError } from '../../support/web-idl-conversion';

describe.each(['direct', 'prepared'] as const)('Web IDL %s string and enumeration conversion', (mode) => {
  const { jsToIDL } = createConversionSteps(mode);

  it('converts strings and enumerations with their distinct failure rules', () => {
    const choice = defineEnumeration({
      name: 'Choice',
      values: ['first', 'second'],
    });
    const { binding, realm } = createBinding([choice]);
    const legacyNull = {
      kind: 'no-arguments', name: 'LegacyNullToEmptyString',
    } as const;

    expect(jsToIDL(null, binding.getConverter(binding.assembly.getIDLType(idlType.DOMString)))).toBe('null');
    expect(jsToIDL(null, binding.getConverter(binding.assembly.getIDLType(annotated(idlType.DOMString, xattr(legacyNull)))))).toBe('');
    expect(jsToIDL(null, binding.getConverter(binding.assembly.getIDLType(annotated(idlType.USVString, xattr(legacyNull)))))).toBe('');
    expect(jsToIDL('\uD800', binding.getConverter(binding.assembly.getIDLType(idlType.USVString)))).toBe('\uFFFD');
    expect(jsToIDL('first', binding.getConverter(binding.assembly.getIDLType(reference('Choice'))))).toBe('first');
    expectRealmTypeError(
      () => jsToIDL(Symbol('value'), binding.getConverter(binding.assembly.getIDLType(idlType.DOMString))),
      realm,
    );
    expectRealmTypeError(
      () => jsToIDL('😞', binding.getConverter(binding.assembly.getIDLType(idlType.ByteString))),
      realm,
    );
    expectRealmTypeError(
      () => jsToIDL('third', binding.getConverter(binding.assembly.getIDLType(reference('Choice')))),
      realm,
    );
  });
});
