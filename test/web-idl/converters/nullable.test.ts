import { describe, expect, it } from 'vitest';

import {
  annotated, defineTypedef, idlType, nullable, reference, union, xattr,
} from '../../../src/web-idl/core/index';

import { createConversionSteps, createBinding, expectRealmTypeError } from '../../support/web-idl-conversion';

describe.each(['direct', 'prepared'] as const)('Web IDL %s nullable conversion', (mode) => {
  const { jsToIDL } = createConversionSteps(mode);

  it('keeps annotation rules scoped to each use of a nullable alias', () => {
    const type = reference('Value');
    const member = nullable(union(idlType.byte, idlType.boolean));
    const clamped = createBinding([
      defineTypedef({ name: 'Value', type: annotated(member, xattr('Clamp')) }),
    ]);
    const enforced = createBinding([
      defineTypedef({ name: 'Value', type: annotated(member, xattr('EnforceRange')) }),
    ]);

    for (let attempt = 0; attempt < 2; attempt++) {
      expect(jsToIDL(300, clamped.binding.getConverter(clamped.binding.assembly.getIDLType(type), clamped.realm))).toBe(127);
      expectRealmTypeError(() => jsToIDL(300, enforced.binding.getConverter(enforced.binding.assembly.getIDLType(type), enforced.realm)), enforced.realm);
      expect(jsToIDL(300, clamped.binding.getConverter(clamped.binding.assembly.getIDLType(member), clamped.realm))).toBe(44);
      expect(jsToIDL(null, clamped.binding.getConverter(clamped.binding.assembly.getIDLType(type), clamped.realm))).toBeNull();
      expect(jsToIDL(true, clamped.binding.getConverter(clamped.binding.assembly.getIDLType(type), clamped.realm))).toBe(true);
    }
  });
});
