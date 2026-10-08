import { describe, expect, it } from 'vitest';

import { InternalError } from '../../../src/infra/internal-error';
import { defineProxyObject, idlType, nullable, reference, sequence, union } from '../../../src/web-idl/core/index';

import { createBinding } from '../../support/web-idl-binding';
import { createConversionSteps, expectRealmTypeError } from '../../support/web-idl-conversion';

describe.each(['direct', 'prepared'] as const)('Web IDL %s interface conversion', (mode) => {
  const { jsToIDL, idlToJS } = createConversionSteps(mode);

  it('converts public proxies to handles and returns the original proxy identity', () => {
    const object = Object.freeze({});
    const handle = { platform: object };
    const definition = defineProxyObject({
      name: 'HostObject',
      getHandle: (value) => value === object ? handle : undefined,
      getProxy: (value) => value === handle ? object : undefined,
    });
    const { binding, realm } = createBinding([definition]);
    const type = reference('HostObject');
    const converter = binding.getConverter(binding.assembly.getIDLType(type));

    expect(jsToIDL(object, converter)).toBe(handle);
    expect(idlToJS(handle, converter)).toBe(object);
    for (const invalid of [{}, handle, new Proxy(object, {})]) {
      expectRealmTypeError(() => jsToIDL(invalid, converter), realm);
    }
    for (const invalid of [{}, object]) {
      expect(() => idlToJS(invalid, converter)).toThrow(InternalError);
    }

    const aggregate = binding.getConverter(binding.assembly.getIDLType(sequence(nullable(type))));
    expect(jsToIDL([object, null, object], aggregate)).toEqual([handle, null, handle]);
    const projected = idlToJS([handle, null, handle], aggregate) as (object | null)[];
    expect(projected[0]).toBe(object);
    expect(projected[1]).toBeNull();
    expect(projected[2]).toBe(object);

    for (const plainType of [idlType.any, idlType.object]) {
      const plain = binding.getConverter(binding.assembly.getIDLType(plainType));
      expect(jsToIDL(object, plain)).toBe(object);
      expect(idlToJS(object, plain)).toBe(object);
    }
  });

  it('selects union output branches from handles without coercing their public proxies', () => {
    const object = Object.freeze({
      [Symbol.toPrimitive]() { throw new Error('Proxy was coerced'); },
    });
    const handle = { platform: object };
    const unrelated = {};
    const unrelatedHandle = { platform: unrelated };
    const { binding } = createBinding([
      defineProxyObject({
        name: 'FirstProxy',
        getHandle: (value) => value === unrelated ? unrelatedHandle : undefined,
        getProxy: (value) => value === unrelatedHandle ? unrelated : undefined,
      }),
      defineProxyObject({
        name: 'SecondProxy',
        getHandle: (value) => value === object ? handle : undefined,
        getProxy: (value) => value === handle ? object : undefined,
      }),
    ]);
    const type = union(reference('FirstProxy'), reference('SecondProxy'), idlType.DOMString);
    const converter = binding.getConverter(binding.assembly.getIDLType(type));

    expect(jsToIDL(object, converter)).toBe(handle);
    expect(idlToJS(handle, converter)).toBe(object);
    expect(idlToJS(unrelatedHandle, converter)).toBe(unrelated);
    expect(jsToIDL('text', converter)).toBe('text');
    expect(idlToJS('text', converter)).toBe('text');
    expect(() => idlToJS(object, converter)).toThrow(InternalError);
  });
});
