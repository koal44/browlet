import { describe, expect, it } from 'vitest';

import { defineProxyObject, idlType, reference, union } from '../../../src/web-idl/core/index';

import { createConversionSteps, createBinding, expectRealmTypeError } from '../../support/web-idl-conversion';

describe.each(['direct', 'prepared'] as const)('Web IDL %s interface conversion', (mode) => {
  const { jsToIDL, idlToJS } = createConversionSteps(mode);

  it('preserves the identity of proxy object values', () => {
    const object = {};
    const definition = defineProxyObject({
      is: (value) => value === object,
      name: 'HostObject',
    });
    const { binding, realm } = createBinding([definition]);
    const type = reference('HostObject');

    expect(jsToIDL(object, binding.getConverter(binding.assembly.getIDLType(type)))).toBe(object);
    expect(idlToJS(object, binding.getConverter(binding.assembly.getIDLType(type)))).toBe(object);
    expect(jsToIDL(object, binding.getConverter(binding.assembly.getIDLType(union(type, idlType.DOMString))))).toBe(object);
    expectRealmTypeError(
      () => jsToIDL({}, binding.getConverter(binding.assembly.getIDLType(type))),
      realm,
    );
  });
});
