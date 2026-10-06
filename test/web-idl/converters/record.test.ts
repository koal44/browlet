import { describe, it } from 'vitest';

import { idlType, record } from '../../../src/web-idl/core/index';

import { TestRealm as Realm } from '../../support/web-idl-realm';
import { createConversionSteps, createBinding, expectRealmTypeError } from '../../support/web-idl-conversion';

describe.each(['direct', 'prepared'] as const)('Web IDL %s record conversion', (mode) => {
  const { jsToIDL } = createConversionSteps(mode);

  it('realizes record key and value failures in the conversion realm', () => {
    const { binding } = createBinding();
    const realm = new Realm();
    const converter = binding.getConverter(binding.assembly.getIDLType(record(idlType.DOMString, idlType.double)), realm);

    expectRealmTypeError(() => jsToIDL({ [Symbol('key')]: 1 }, converter), realm);
    expectRealmTypeError(() => jsToIDL({ value: Symbol('value') }, converter), realm);
  });
});
