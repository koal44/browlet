import { describe, expect, it } from 'vitest';

import { InternalError } from '../../../src/infra/internal-error';
import { hasMapData } from '../../../src/js-engine/index';
import {
  arg, defineDictionary, defineInterface, defineNamespace, idlType, op, reference, sequence, union,
} from '../../../src/web-idl/core/index';
import { BindingWorld } from '../../../src/web-idl/binding/world';
import { createBinding, installTestBindings } from '../../support/web-idl-binding';
import { createConversionSteps, expectRealmTypeError } from '../../support/web-idl-conversion';
import { TestRealm } from '../../support/web-idl-realm';

// Engine-owned objects have one identity, with no implementation/platform pair.
const nativeMap = defineInterface({
  name: 'NativeMap', members: [],
  isInstance: hasMapData,
});

describe.each(['direct', 'prepared'] as const)('native interface conversion (%s)', (mode) => {
  it('preserves native identity across realms and prototype changes, rejecting lookalikes', () => {
    const { binding, realm } = createBinding([nativeMap]);
    const converter = binding.getConverter(binding.assembly.getIDLType(reference('NativeMap')));
    const { jsToIDL, idlToJS } = createConversionSteps(mode);
    const foreign = new TestRealm();
    const map = new foreign.Map();
    Object.setPrototypeOf(map, null);
    expect(jsToIDL(map, converter)).toBe(map);
    expect(idlToJS(map, converter)).toBe(map);
    for (const invalid of [null, 1, {}, Object.create(Map.prototype), new Proxy(map, {})]) {
      expectRealmTypeError(() => jsToIDL(invalid, converter), realm);
      expect(() => idlToJS(invalid, converter)).toThrow(InternalError);
    }
    expect(binding.installDefinitions().has('NativeMap')).toBe(false);
  });

  it('selects a native interface before an iterable union branch and preserves result identity', () => {
    const { binding } = createBinding([nativeMap]);
    const converter = binding.getConverter(binding.assembly.getIDLType(union(reference('NativeMap'), sequence(idlType.long))));
    const { jsToIDL, idlToJS } = createConversionSteps(mode);
    const map = new Map();
    Object.defineProperty(map, Symbol.iterator, { get() { throw new Error('must not read iterator'); } });
    expect(jsToIDL(map, converter)).toBe(map);
    expect(idlToJS(map, converter)).toBe(map);
    expect(jsToIDL([1, 2], converter)).toEqual([1, 2]);
  });
});

it('selects native overloads by brand and argument count without modifying native objects', () => {
  const world = new BindingWorld([
    nativeMap,
    defineDictionary({ name: 'Options', members: [] }),
    defineNamespace({
      name: 'Operations', exposed: '*', members: [
        op('pick', idlType.DOMString,
          [arg('value', reference('NativeMap')), arg('extra', idlType.object, { optional: true })],
          { overrideInvoke: () => 'native' },
        ),
        op('pick', idlType.DOMString,
          [arg('value', idlType.Uint8Array), arg('extra', idlType.object, { optional: true }),
            arg('options', reference('Options'), { optional: true })],
          { overrideInvoke: () => 'bytes' },
        ),
      ],
    }),
  ]);
  const { realm } = installTestBindings(world);
  const api = Reflect.get(realm.globalObject, 'Operations') as { pick(...args: unknown[]): string; };
  const foreign = new TestRealm();
  const map = new foreign.Map();
  expect(api.pick(map)).toBe('native');
  expect(api.pick(map, {})).toBe('native');
  expect(api.pick(new Uint8Array(), {}, {})).toBe('bytes');
  // Three arguments leave only the byte overload in the effective overload set.
  expect(() => api.pick(map, {}, {})).toThrow(realm.TypeError);
  expect(() => api.pick(Object.create(Map.prototype))).toThrow(realm.TypeError);
  expect(Object.getPrototypeOf(map)).toBe(foreign.Map.prototype);
});
