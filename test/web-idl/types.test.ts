import { describe, expect, it } from 'vitest';

import { DefinitionAssembly } from '../../src/web-idl/assembly';
import {
  annotated, defineDictionary, defineEnumeration, defineTypedef, frozenArray, idlType,
  nullable, record, reference, sequence, union, xattr,
} from '../../src/web-idl/core/index';
import { serializeType } from '../../src/web-idl/core/index';

describe('Web IDL types', () => {
  it('gets flattened member types from nested unions', () => {
    const assembly = new DefinitionAssembly([]);
    const type = annotated(
      union(
        reference('Node'),
        union(sequence(idlType.long), reference('Event')),
        nullable(union(reference('XMLHttpRequest'), idlType.DOMString)),
        sequence(union(sequence(idlType.double), reference('NodeList'))),
      ),
      xattr('XAttr'),
    );

    expect(
      assembly.getFlattenedMemberTypes(type).map((member) => serializeType(member)),
    ).toEqual([
      'Node',
      'sequence<long>',
      'Event',
      'XMLHttpRequest',
      'DOMString',
      'sequence<(sequence<double> or NodeList)>',
    ]);
  });

  it('resolves shared type descriptors within each assembly', () => {
    const type = union(reference('Value'), sequence(idlType.boolean));
    const strings = new DefinitionAssembly([
      defineTypedef({ name: 'Value', type: idlType.DOMString }),
    ]);
    const numbers = new DefinitionAssembly([
      defineTypedef({ name: 'Value', type: idlType.long }),
    ]);

    for (const [assembly, name] of [
      [strings, 'DOMString'], [numbers, 'long'], [strings, 'DOMString'],
    ] as const) {
      expect(assembly.getCandidateTypes(type).map((candidate) => serializeType(candidate)))
        .toEqual([name, 'sequence<boolean>']);
      expect(assembly.getConversionCandidates(type).map((candidate) => serializeType(candidate.type)))
        .toEqual([name, 'sequence<boolean>']);
      expect(assembly.getOverloadTypeKey(type)).toBe(`(${name} or sequence<boolean>)`);
      expect(assembly.hasStringCandidate(type)).toBe(name === 'DOMString');
      expect(assembly.hasNumericCandidate(type)).toBe(name === 'long');
      expect(assembly.hasSequenceCandidate(type)).toBe(true);
      expect(assembly.hasSimpleCandidate(type, 'boolean')).toBe(false);
      expect(assembly.getSoleNumericTypeName(type)).toBe(name === 'long' ? 'long' : undefined);
      expect(assembly.findSequenceElementType(type)).toBe(idlType.boolean);
      expect(assembly.findDictionaryOrRecord(type)).toBeUndefined();
    }

    const stringKey = strings.getConversionTypeKey(type);
    expect(numbers.getConversionTypeKey(type)).not.toBe(stringKey);
    expect(strings.getConversionTypeKey(type)).toBe(stringKey);
  });

  it('classifies candidates without including their container contents', () => {
    const assembly = new DefinitionAssembly([
      defineEnumeration({ name: 'Choice', values: ['one', 'two'] }),
    ]);
    const array = frozenArray(idlType.undefined);
    const type = union(nullable(idlType.ArrayBuffer), array, reference('Choice'));

    for (let attempt = 0; attempt < 2; attempt++) {
      expect(assembly.hasStringCandidate(type)).toBe(true);
      expect(assembly.hasNumericCandidate(type)).toBe(false);
      expect(assembly.hasArrayBufferCandidate(type)).toBe(true);
      expect(assembly.hasArrayBufferCandidate(idlType.SharedArrayBuffer)).toBe(true);
      expect(assembly.hasArrayBufferCandidate(sequence(idlType.ArrayBuffer))).toBe(false);
      expect(assembly.hasSequenceCandidate(type)).toBe(true);
      expect(assembly.hasCandidateKind(type, 'frozen-array')).toBe(true);
      expect(assembly.hasCandidateKind(type, 'sequence')).toBe(false);
      expect(assembly.includesNullableType(type)).toBe(true);
      expect(assembly.includesUndefined(type)).toBe(false);
      expect(assembly.findSequenceElementType(array)).toBeUndefined();
      expect(assembly.getSoleNumericTypeName(sequence(idlType.long))).toBeUndefined();
      expect(assembly.getSoleNumericTypeName(idlType.bigint)).toBe('bigint');
      expect(assembly.hasNumericCandidate(idlType.bigint)).toBe(false);
    }
  });

  it('selects adaptation types through aliases within the owning assembly', () => {
    const type = nullable(reference('Value'));
    const recordType = record(idlType.DOMString, idlType.long);
    const sequences = new DefinitionAssembly([
      defineTypedef({ name: 'Value', type: sequence(idlType.long) }),
    ]);
    const records = new DefinitionAssembly([
      defineTypedef({ name: 'Value', type: recordType }),
    ]);
    const dictionaries = new DefinitionAssembly([
      defineDictionary({ name: 'Value', members: [{ name: 'count', type: idlType.long }] }),
    ]);

    for (let attempt = 0; attempt < 2; attempt++) {
      expect(sequences.findSequenceElementType(type)).toBe(idlType.long);
      expect(sequences.findDictionaryOrRecord(type)).toBeUndefined();
      expect(records.findSequenceElementType(type)).toBeUndefined();
      expect(records.findDictionaryOrRecord(type)).toBe(recordType);
      expect(dictionaries.findSequenceElementType(type)).toBeUndefined();
      expect(dictionaries.findDictionaryOrRecord(type)).toBe(dictionaries.dictionaries.get('Value'));
    }
  });

  it('classifies JSON dictionaries independently of repeated references and other assemblies', () => {
    const type = reference('Branch');
    const definitions = [
      defineDictionary({
        name: 'Branch',
        members: [
          { name: 'first', type: reference('Leaf') },
          { name: 'second', type: reference('Leaf') },
        ],
      }),
      defineDictionary({ name: 'Leaf', members: [{ name: 'value', type: reference('Value') }] }),
    ];
    const strings = new DefinitionAssembly([
      ...definitions, defineTypedef({ name: 'Value', type: idlType.DOMString }),
    ]);
    const symbols = new DefinitionAssembly([
      ...definitions, defineTypedef({ name: 'Value', type: idlType.symbol }),
    ]);

    expect(strings.isJSONType(type)).toBe(true);
    expect(symbols.isJSONType(type)).toBe(false);
    expect(strings.isJSONType(type)).toBe(true);
    expect(symbols.isJSONType(type)).toBe(false);
  });

  it('preserves attribute order without carrying invocation attributes into later queries', () => {
    const assembly = new DefinitionAssembly([
      defineTypedef({
        name: 'Value',
        type: annotated(
          nullable(union(annotated(idlType.long, xattr('Member')), idlType.DOMString)),
          xattr('Alias'),
        ),
      }),
    ]);
    const type = annotated(reference('Value'), xattr('Outer'));

    for (const name of ['FirstCall', 'SecondCall', undefined]) {
      const attributes = name ? xattr(name).extendedAttributes : undefined;
      const prefix = name ? [name] : [];
      expect(assembly.getConversionType(type, attributes).extendedAttributes)
        .toEqual(xattr(...prefix, 'Outer', 'Alias').extendedAttributes);
      expect(assembly.getConversionCandidates(type, attributes).map((candidate) =>
        candidate.extendedAttributes))
        .toEqual([
          xattr(...prefix, 'Outer', 'Alias', 'Member').extendedAttributes,
          xattr(...prefix, 'Outer', 'Alias').extendedAttributes,
        ]);
    }
  });

  it('distinguishes overload type keys from conversion type keys', () => {
    const assembly = new DefinitionAssembly([]);
    const clamped = annotated(idlType.byte, xattr('Clamp'));
    expect(assembly.getOverloadTypeKey(clamped)).toBe(assembly.getOverloadTypeKey(idlType.byte));
    expect(assembly.getConversionTypeKey(clamped))
      .not.toBe(assembly.getConversionTypeKey(idlType.byte));

    const first = union(idlType.byte, idlType.DOMString);
    const reversed = union(idlType.DOMString, idlType.byte);
    expect(assembly.getOverloadTypeKey(first)).not.toBe(assembly.getOverloadTypeKey(reversed));
    expect(assembly.getConversionTypeKey(first)).toBe(assembly.getConversionTypeKey(reversed));
  });

  it('counts nullable members through annotations, unions, and typedefs', () => {
    const assembly = new DefinitionAssembly([
      defineTypedef({
        name: 'MaybeEvent',
        type: annotated(nullable(reference('Event')), xattr('XAttr')),
      }),
    ]);
    const type = union(
      idlType.long,
      union(reference('MaybeEvent'), idlType.DOMString),
    );

    expect(assembly.getNumberOfNullableMemberTypes(type)).toBe(1);
    expect(assembly.includesNullableType(type)).toBe(true);
    expect(assembly.includesNullableType(reference('MaybeEvent'))).toBe(true);
    expect(assembly.includesNullableType(idlType.DOMString)).toBe(false);
  });

  it('detects undefined through annotations, nullable types, unions, and typedefs', () => {
    const assembly = new DefinitionAssembly([
      defineTypedef({ name: 'Nothing', type: idlType.undefined }),
    ]);
    const type = annotated(
      nullable(union(idlType.DOMString, reference('Nothing'))),
      xattr('XAttr'),
    );

    expect(assembly.includesUndefined(type)).toBe(true);
    expect(assembly.includesUndefined(nullable(idlType.long))).toBe(false);
  });
});
