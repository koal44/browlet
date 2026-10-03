import { describe, expect, it } from 'vitest';

import { DefinitionAssembly } from '../../src/web-idl/assembly/index';
import {
  annotated, arg, defineCallbackFunction, defineCallbackInterface, defineDictionary, defineEnumeration,
  defineInterface, defineNamespace, defineTypedef, frozenArray, idlType,
  nullable, op, record, reference, roAttr, sequence, union, xattr,
} from '../../src/web-idl/core/index';

describe('Web IDL types', () => {
  it('links named targets and container elements without retaining unresolved runtime types', () => {
    const assembly = new DefinitionAssembly([
      defineDictionary({ name: 'Options', members: [{ name: 'next', type: nullable(reference('Options')) }] }),
      defineTypedef({ name: 'OptionsAlias', type: reference('Options') }),
    ]);
    const element = reference('OptionsAlias');
    const declared = sequence(element);
    const type = assembly.getIDLType(declared);
    expect(type.kind).toBe('sequence');
    expect(type.elementType.kind).toBe('dictionary');
    if (type.elementType.kind !== 'dictionary') throw new Error('Expected an assembled dictionary');
    expect(type.elementType.assembled).toBe(assembly.dictionaries.get('Options'));
    const next = type.elementType.assembled.members[0]!.type;
    expect(next.kind).toBe('nullable');
    if (next.kind !== 'nullable' || next.innerType.kind !== 'dictionary') throw new Error('Expected a recursive dictionary');
    expect(next.innerType.assembled).toBe(type.elementType.assembled);
    expect(type.elementType).toBe(assembly.getIDLType(element));
    expect(assembly.getIDLType(declared)).toBe(type);
    expect(type).not.toHaveProperty('declaredType');
    expect(declared.type).toBe(element);
    expect(element).toEqual({ kind: 'reference', name: 'OptionsAlias' });
  });

  it('compiles member and callback contracts after registering forward references', () => {
    const attribute = roAttr('options', reference('Options'));
    const operation = op('apply', reference('Step'), [arg('count', idlType.byte, xattr('Clamp'))]);
    const callbackOperation = op('accept', reference('Options'), [arg('step', reference('Step'))]);
    const assembly = new DefinitionAssembly([
      defineInterface({ name: 'Consumer', members: [attribute, operation] }),
      defineNamespace({ name: 'Tools', members: [operation] }),
      defineCallbackInterface({ name: 'Listener', members: [callbackOperation] }),
      defineCallbackFunction({ name: 'Step', arguments: [arg('options', reference('Options'))], returns: reference('Step') }),
      defineTypedef({ name: 'Options', type: reference('OptionsRecord') }),
      defineDictionary({ name: 'OptionsRecord', members: [] }),
    ]);
    const assembled = assembly.interfaces.get('Consumer')!;
    const compiledAttribute = assembled.findMemberByKind('attribute')!.member;
    const compiledOperation = assembled.findMemberByKind('operation')!.member;
    const step = assembly.callbackFunctions.get('Step')!;
    const options = assembly.dictionaries.get('OptionsRecord')!;

    expect(compiledAttribute.type).toMatchObject({ kind: 'dictionary', assembled: options });
    expect(compiledOperation.returns).toMatchObject({ kind: 'callback-function', assembled: step });
    expect(compiledOperation.arguments[0]!.type).toMatchObject({ kind: 'integer', integerMode: 'clamp' });
    expect(assembly.namespaces.get('Tools')!.members[0]!.member)
      .toMatchObject({ returns: compiledOperation.returns, arguments: compiledOperation.arguments });
    const callback = assembly.callbackInterfaces.get('Listener')!.getOperation('accept');
    expect(callback.returns).toMatchObject({ kind: 'dictionary', assembled: options });
    expect(callback.arguments[0]!.type).toMatchObject({ kind: 'callback-function', assembled: step });
    expect(step.returns).toMatchObject({ kind: 'callback-function', assembled: step });
    expect(step.arguments[0]!.type).toMatchObject({ kind: 'dictionary', assembled: options });

    expect(attribute.type).toEqual(reference('Options'));
    expect(operation.returns).toEqual(reference('Step'));
    expect(operation.arguments[0]!.type).toBe(idlType.byte);
  });

  it('applies annotations to nullable and union branches while keeping container contents independent', () => {
    const assembly = new DefinitionAssembly([]);
    const byte = idlType.byte;
    const declared = annotated(nullable(union(byte, sequence(byte))), xattr('Clamp'));
    const type = assembly.getIDLType(declared);
    expect(type).toMatchObject({
      kind: 'nullable', innerType: {
        kind: 'union', memberTypes: [
          { kind: 'integer', name: 'byte', integerMode: 'clamp' },
          { kind: 'sequence', elementType: { kind: 'integer', name: 'byte', integerMode: 'wrap' } },
        ],
      },
    });
    expect(assembly.getIDLType(byte)).toMatchObject({ kind: 'integer', integerMode: 'wrap' });
    expect(assembly.getIDLType(declared)).toBe(type);
  });

  it('gets flattened member types from nested unions', () => {
    const assembly = new DefinitionAssembly(
      ['Node', 'Event', 'XMLHttpRequest', 'NodeList'].map((name) => defineInterface({ name, members: [] })),
    );
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
      assembly.getFlattenedMemberTypes(assembly.getIDLType(type)).map((member) => assembly.getOverloadTypeKey(member)),
    ).toEqual([
      'reference:Node',
      'sequence<long>',
      'reference:Event',
      'reference:XMLHttpRequest',
      'DOMString',
      'sequence<(sequence<double> or reference:NodeList)>',
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
      expect(assembly.getCandidateTypes(assembly.getIDLType(type))).toMatchObject([
        { kind: name === 'long' ? 'integer' : 'string', name },
        { kind: 'sequence', elementType: { kind: 'boolean' } },
      ]);
      expect(assembly.getOverloadTypeKey(assembly.getIDLType(type))).toBe(`(${name} or sequence<boolean>)`);
      expect(assembly.hasStringCandidate(assembly.getIDLType(type))).toBe(name === 'DOMString');
      expect(assembly.hasNumericCandidate(assembly.getIDLType(type))).toBe(name === 'long');
      expect(assembly.hasSequenceCandidate(assembly.getIDLType(type))).toBe(true);
      expect(assembly.hasCandidateKind(assembly.getIDLType(type), 'boolean')).toBe(false);
      expect(assembly.getSoleNumericTypeName(assembly.getIDLType(type))).toBe(name === 'long' ? 'long' : undefined);
      expect(assembly.findSequenceElementType(assembly.getIDLType(type))).toBe(assembly.builtinTypes.boolean);
      expect(assembly.findRecordValueType(assembly.getIDLType(type))).toBeUndefined();
    }

    const stringKey = strings.getConversionTypeKey(strings.getIDLType(type));
    expect(numbers.getConversionTypeKey(numbers.getIDLType(type))).not.toBe(stringKey);
    expect(strings.getConversionTypeKey(strings.getIDLType(type))).toBe(stringKey);
  });

  it('classifies candidates without including their container contents', () => {
    const assembly = new DefinitionAssembly([
      defineEnumeration({ name: 'Choice', values: ['one', 'two'] }),
    ]);
    const array = frozenArray(idlType.undefined);
    const type = union(nullable(idlType.ArrayBuffer), array, reference('Choice'));

    for (let attempt = 0; attempt < 2; attempt++) {
      expect(assembly.hasStringCandidate(assembly.getIDLType(type))).toBe(true);
      expect(assembly.hasNumericCandidate(assembly.getIDLType(type))).toBe(false);
      expect(assembly.hasArrayBufferCandidate(assembly.getIDLType(type))).toBe(true);
      expect(assembly.hasArrayBufferCandidate(assembly.getIDLType(idlType.SharedArrayBuffer))).toBe(true);
      expect(assembly.hasArrayBufferCandidate(assembly.getIDLType(sequence(idlType.ArrayBuffer)))).toBe(false);
      expect(assembly.hasSequenceCandidate(assembly.getIDLType(type))).toBe(true);
      expect(assembly.hasCandidateKind(assembly.getIDLType(type), 'frozen-array')).toBe(true);
      expect(assembly.hasCandidateKind(assembly.getIDLType(type), 'sequence')).toBe(false);
      expect(assembly.includesNullableType(assembly.getIDLType(type))).toBe(true);
      expect(assembly.includesUndefined(assembly.getIDLType(type))).toBe(false);
      expect(assembly.findSequenceElementType(assembly.getIDLType(array))).toBeUndefined();
      expect(assembly.getSoleNumericTypeName(assembly.getIDLType(sequence(idlType.long)))).toBeUndefined();
      expect(assembly.getSoleNumericTypeName(assembly.getIDLType(idlType.bigint))).toBe('bigint');
      expect(assembly.hasNumericCandidate(assembly.getIDLType(idlType.bigint))).toBe(false);
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
      expect(sequences.findSequenceElementType(sequences.getIDLType(type))).toBe(sequences.builtinTypes.long);
      expect(sequences.findRecordValueType(sequences.getIDLType(type))).toBeUndefined();
      expect(records.findSequenceElementType(records.getIDLType(type))).toBeUndefined();
      expect(records.findRecordValueType(records.getIDLType(type))).toBe(records.builtinTypes.long);
      expect(dictionaries.findSequenceElementType(dictionaries.getIDLType(type))).toBeUndefined();
      expect(dictionaries.findRecordValueType(dictionaries.getIDLType(type))).toBeUndefined();
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

    expect(strings.isJSONType(strings.getIDLType(type))).toBe(true);
    expect(symbols.isJSONType(symbols.getIDLType(type))).toBe(false);
    expect(strings.isJSONType(strings.getIDLType(type))).toBe(true);
    expect(symbols.isJSONType(symbols.getIDLType(type))).toBe(false);
  });

  it('preserves attribute order without leaking annotations between uses of a descriptor', () => {
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
      const use = name ? annotated(type, xattr(name)) : type;
      const prefix = name ? [name] : [];
      expect(assembly.getIDLType(use).attributes)
        .toEqual(xattr(...prefix, 'Outer', 'Alias').extendedAttributes);
      expect(assembly.getCandidateTypes(assembly.getIDLType(use)).map((candidate) =>
        candidate.attributes))
        .toEqual([
          xattr(...prefix, 'Outer', 'Alias', 'Member').extendedAttributes,
          xattr(...prefix, 'Outer', 'Alias').extendedAttributes,
        ]);
    }
  });

  it('distinguishes overload type keys from conversion type keys', () => {
    const assembly = new DefinitionAssembly([]);
    const clamped = annotated(idlType.byte, xattr('Clamp'));
    expect(assembly.getOverloadTypeKey(assembly.getIDLType(clamped))).toBe(assembly.getOverloadTypeKey(assembly.getIDLType(idlType.byte)));
    expect(assembly.getConversionTypeKey(assembly.getIDLType(clamped)))
      .not.toBe(assembly.getConversionTypeKey(assembly.getIDLType(idlType.byte)));

    const first = union(idlType.byte, idlType.DOMString);
    const reversed = union(idlType.DOMString, idlType.byte);
    expect(assembly.getOverloadTypeKey(assembly.getIDLType(first))).not.toBe(assembly.getOverloadTypeKey(assembly.getIDLType(reversed)));
    expect(assembly.getConversionTypeKey(assembly.getIDLType(first))).toBe(assembly.getConversionTypeKey(assembly.getIDLType(reversed)));
  });

  it('counts nullable members through annotations, unions, and typedefs', () => {
    const assembly = new DefinitionAssembly([
      defineInterface({ name: 'Event', members: [] }),
      defineTypedef({
        name: 'MaybeEvent',
        type: annotated(nullable(reference('Event')), xattr('XAttr')),
      }),
    ]);
    const type = union(
      idlType.long,
      union(reference('MaybeEvent'), idlType.DOMString),
    );

    expect(assembly.getNumberOfNullableMemberTypes(assembly.getIDLType(type))).toBe(1);
    expect(assembly.includesNullableType(assembly.getIDLType(type))).toBe(true);
    expect(assembly.includesNullableType(assembly.getIDLType(reference('MaybeEvent')))).toBe(true);
    expect(assembly.includesNullableType(assembly.getIDLType(idlType.DOMString))).toBe(false);
  });

  it('detects undefined through annotations, nullable types, unions, and typedefs', () => {
    const assembly = new DefinitionAssembly([
      defineTypedef({ name: 'Nothing', type: idlType.undefined }),
    ]);
    const type = annotated(
      nullable(union(idlType.DOMString, reference('Nothing'))),
      xattr('XAttr'),
    );

    expect(assembly.includesUndefined(assembly.getIDLType(type))).toBe(true);
    expect(assembly.includesUndefined(assembly.getIDLType(nullable(idlType.long)))).toBe(false);
  });
});
