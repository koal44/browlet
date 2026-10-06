import { describe, expect, it } from 'vitest';

import {
  defineCallbackFunction, defineTypedef, idlType, nullable, record, reference, sequence, xattr,
} from '../../../src/web-idl/core/index';

import { createConversionSteps, createBinding, expectRealmTypeError } from '../../support/web-idl-conversion';

describe.each(['direct', 'prepared'] as const)('Web IDL %s callback conversion', (mode) => {
  const { jsToIDL } = createConversionSteps(mode);

  it('requires callable legacy callbacks through nullable aliases outside assignment', () => {
    const { binding, realm } = createBinding([
      defineCallbackFunction({
        name: 'Handler', returns: idlType.undefined, arguments: [],
        ...xattr('LegacyTreatNonObjectAsNull'),
      }),
      defineTypedef({ name: 'HandlerAlias', type: reference('Handler') }),
      defineTypedef({ name: 'OptionalHandler', type: nullable(reference('HandlerAlias')) }),
    ]);
    const object = {};
    for (const type of [nullable(reference('Handler')), reference('OptionalHandler')]) {
      const converter = binding.getConverter(binding.assembly.getIDLType(type));
      expectRealmTypeError(() => jsToIDL(1, converter), realm);
      expectRealmTypeError(() => jsToIDL(object, converter), realm);
      expect(jsToIDL(null, converter)).toBeNull();
    }

    const nonnullable = binding.getConverter(binding.assembly.getIDLType(reference('HandlerAlias')));
    expectRealmTypeError(() => jsToIDL(object, nonnullable), realm);
  });

  it('rejects non-callable legacy callbacks inside collections', () => {
    const { binding, realm } = createBinding([defineCallbackFunction({
      name: 'Handler', returns: idlType.undefined, arguments: [],
      ...xattr('LegacyTreatNonObjectAsNull'),
    })]);
    const callback = nullable(reference('Handler'));
    const cases = [
      { type: sequence(callback), value: [{}] },
      { type: record(idlType.DOMString, callback), value: { handler: {} } },
    ];
    for (const { type, value } of cases) {
      const converter = binding.getConverter(binding.assembly.getIDLType(type));
      expectRealmTypeError(() => jsToIDL(value, converter), realm);
    }
  });
});
