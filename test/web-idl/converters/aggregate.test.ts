import { describe, expect, it } from 'vitest';

import { annotated, idlType, nullable, record, sequence, union, xattr } from '../../../src/web-idl/core/index';

import { createConversionSteps, createBinding } from '../../support/web-idl-conversion';

describe.each(['direct', 'prepared'] as const)('Web IDL %s sequence and record conversion', (mode) => {
  const { jsToIDL, idlToJS } = createConversionSteps(mode);

  it('does not propagate container annotations to sequence elements or record values', () => {
    const { binding } = createBinding();
    const sequences = annotated(nullable(union(sequence(idlType.byte), idlType.boolean)), xattr('Clamp'));
    const records = annotated(record(idlType.DOMString, idlType.byte), xattr('Clamp'));

    expect(jsToIDL([300], binding.getConverter(binding.assembly.getIDLType(sequences)))).toEqual([44]);
    expect(jsToIDL({ value: 300 }, binding.getConverter(binding.assembly.getIDLType(records)))).toEqual(new Map([['value', 44]]));
    expect(jsToIDL([300], binding.getConverter(binding.assembly.getIDLType(sequence(annotated(idlType.byte, xattr('Clamp'))))))).toEqual([127]);
  });

  it('copies sequences and records without losing observable ordering', () => {
    const { binding, realm } = createBinding();
    let iteratorGets = 0;
    const iterable = {
      get [Symbol.iterator]() {
        iteratorGets++;
        return function*() {
          yield 1;
          yield '2';
        };
      },
    };

    const idlSequence = jsToIDL(iterable, binding.getConverter(binding.assembly.getIDLType(sequence(idlType.long))));
    expect(idlSequence).toEqual([1, 2]);
    expect(iteratorGets).toBe(1);

    const jsSequence = idlToJS(idlSequence, binding.getConverter(binding.assembly.getIDLType(sequence(idlType.long))));
    expect(jsSequence).toEqual([1, 2]);
    expect(jsSequence).toBeInstanceOf(realm.intrinsics.array);
    expect(jsSequence).not.toBe(idlSequence);

    const input = { d: '5', c: 6 };
    const idlRecord = jsToIDL(input, binding.getConverter(binding.assembly.getIDLType(record(idlType.DOMString, idlType.double))));
    expect([...idlRecord]).toEqual([['d', 5], ['c', 6]]);

    const jsRecord = idlToJS(idlRecord, binding.getConverter(binding.assembly.getIDLType(record(idlType.DOMString, idlType.double)))) as Record<string, unknown>;
    expect(Object.keys(jsRecord)).toEqual(['d', 'c']);
    expect(Object.getPrototypeOf(jsRecord)).toBe(realm.intrinsics.objectPrototype);
  });
});
