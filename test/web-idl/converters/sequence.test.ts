import { describe, expect, it } from 'vitest';

import { frozenArray, idlType, union } from '../../../src/web-idl/core/index';

import { createConversionSteps, createBinding, expectRealmTypeError } from '../../support/web-idl-conversion';

describe.each(['direct', 'prepared'] as const)('Web IDL %s sequence conversion', (mode) => {
  const { jsToIDL, idlToJS } = createConversionSteps(mode);

  it('creates frozen arrays in the ctx realm and preserves their identity', () => {
    const { binding, realm } = createBinding();
    let iteratorGets = 0;
    const source = {
      get [Symbol.iterator]() {
        iteratorGets++;
        return function*() {
          yield '1';
          yield 2;
        };
      },
    };

    const value = jsToIDL(source, binding.getConverter(binding.assembly.getIDLType(frozenArray(idlType.long))));

    expect(value).toEqual([1, 2]);
    expect(value).toBeInstanceOf(realm.intrinsics.array);
    expect(Object.isFrozen(value)).toBe(true);
    expect(iteratorGets).toBe(1);
    expect(idlToJS(value, binding.getConverter(binding.assembly.getIDLType(frozenArray(idlType.long))))).toBe(value);
    expect(Reflect.set(value, '0', 3)).toBe(false);

    const frozenSource = Object.freeze(['3']);
    const copied = jsToIDL(frozenSource, binding.getConverter(binding.assembly.getIDLType(frozenArray(idlType.long))));
    expect(copied).toEqual([3]);
    expect(copied).not.toBe(frozenSource);

    const frozenType = frozenArray(idlType.long);
    const type = binding.assembly.getIDLType(frozenType);
    const converter = binding.getConverter(type);
    const created = converter.createFrozenArray([4]);
    expect(created).toEqual([4]);
    expect(created).toBeInstanceOf(realm.intrinsics.array);
    expect(Object.isFrozen(created)).toBe(true);

    const iterable = new Set(['5']);
    const method = iterable[Symbol.iterator];
    expect(converter.jsToIDLIterable(iterable, method)).toEqual([5]);

    expect(jsToIDL(['6'], binding.getConverter(binding.assembly.getIDLType(union(frozenArray(idlType.long), idlType.DOMString))))).toEqual([6]);
    expectRealmTypeError(
      () => jsToIDL(1, binding.getConverter(binding.assembly.getIDLType(frozenArray(idlType.long)))),
      realm,
    );
  });

  it('uses the iterator method already read when selecting a frozen-array union member', () => {
    const { binding, realm } = createBinding();
    let iteratorGets = 0;
    const source = {
      get [Symbol.iterator]() {
        iteratorGets++;
        return function*() { yield '7.9'; };
      },
    };
    const type = union(frozenArray(idlType.long), idlType.DOMString);

    const result = jsToIDL(source, binding.getConverter(binding.assembly.getIDLType(type)));

    expect(result).toEqual([7]);
    expect(result).toBeInstanceOf(realm.intrinsics.array);
    expect(Object.isFrozen(result)).toBe(true);
    expect(iteratorGets).toBe(1);
  });
});
