import { describe, expect, it } from 'vitest';

import {
  annotated, arg, defineCallbackFunction, defineCallbackInterface, defineDictionary, defineEnumeration,
  defineInterface, defineNamespace, defineTypedef, frozenArray, idlType,
  nullable, op, record, reference, roAttr, sequence, union, xattr,
} from '../../../src/web-idl/core/index';
import { DefinitionAssembly } from '../../../src/web-idl/assembly/index';

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
      assembly.getIDLType(type).candidates.types.map((member) => member.overloadKey),
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
      expect(assembly.getIDLType(type).candidates.types).toMatchObject([
        { kind: name === 'long' ? 'integer' : 'string', name },
        { kind: 'sequence', elementType: { kind: 'boolean' } },
      ]);
      expect(assembly.getIDLType(type).overloadKey).toBe(`(${name} or sequence<boolean>)`);
      expect(!!assembly.getIDLType(type).candidates.string).toBe(name === 'DOMString');
      expect(!!assembly.getIDLType(type).candidates.numeric).toBe(name === 'long');
      expect(!!assembly.getIDLType(type).candidates.array).toBe(true);
      expect(assembly.getIDLType(type).candidates.hasBoolean).toBe(false);
      expect(assembly.getIDLType(type).candidates.soleNumeric)
        .toBe(name === 'long' ? assembly.getIDLType(type).memberTypes[0] : undefined);
      expect(assembly.getIDLType(type).candidates.sequence?.elementType).toBe(assembly.builtinTypes.boolean);
      expect(assembly.getIDLType(type).candidates.record?.valueType).toBeUndefined();
    }

    const stringKey = strings.getIDLType(type).conversionKey;
    expect(numbers.getIDLType(type).conversionKey).not.toBe(stringKey);
    expect(strings.getIDLType(type).conversionKey).toBe(stringKey);
  });

  it('classifies candidates without including their container contents', () => {
    const assembly = new DefinitionAssembly([
      defineEnumeration({ name: 'Choice', values: ['one', 'two'] }),
    ]);
    const array = frozenArray(idlType.undefined);
    const type = union(nullable(idlType.ArrayBuffer), array, reference('Choice'));

    for (let attempt = 0; attempt < 2; attempt++) {
      expect(!!assembly.getIDLType(type).candidates.string).toBe(true);
      expect(!!assembly.getIDLType(type).candidates.numeric).toBe(false);
      expect(assembly.getIDLType(type).candidates.hasArrayBuffer).toBe(true);
      expect(assembly.getIDLType(idlType.SharedArrayBuffer).candidates.hasArrayBuffer).toBe(true);
      expect(assembly.getIDLType(sequence(idlType.ArrayBuffer)).candidates.hasArrayBuffer).toBe(false);
      expect(!!assembly.getIDLType(type).candidates.array).toBe(true);
      expect(!!assembly.getIDLType(type).candidates.frozenArray).toBe(true);
      expect(!!assembly.getIDLType(type).candidates.sequence).toBe(false);
      expect(assembly.getIDLType(type).candidates.hasNullable).toBe(true);
      expect(assembly.getIDLType(type).candidates.hasUndefined).toBe(false);
      expect(assembly.getIDLType(array).candidates.sequence?.elementType).toBeUndefined();
      expect(assembly.getIDLType(sequence(idlType.long)).candidates.soleNumeric).toBeUndefined();
      expect(assembly.getIDLType(idlType.bigint).candidates.soleNumeric).toBe(assembly.builtinTypes.bigint);
      expect(!!assembly.getIDLType(idlType.bigint).candidates.numeric).toBe(false);
    }
  });

  it('selects container branches through aliases within the owning assembly', () => {
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
      expect(sequences.getIDLType(type).candidates.sequence?.elementType).toBe(sequences.builtinTypes.long);
      expect(sequences.getIDLType(type).candidates.record?.valueType).toBeUndefined();
      expect(records.getIDLType(type).candidates.sequence?.elementType).toBeUndefined();
      expect(records.getIDLType(type).candidates.record?.valueType).toBe(records.builtinTypes.long);
      expect(dictionaries.getIDLType(type).candidates.sequence?.elementType).toBeUndefined();
      expect(dictionaries.getIDLType(type).candidates.record?.valueType).toBeUndefined();
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

    expect(strings.getIDLType(type).isJSON).toBe(true);
    expect(symbols.getIDLType(type).isJSON).toBe(false);
    expect(strings.getIDLType(type).isJSON).toBe(true);
    expect(symbols.getIDLType(type).isJSON).toBe(false);
  });

  it('keeps recursive JSON checks separate from completed dictionary answers', () => {
    const assembly = new DefinitionAssembly([
      defineDictionary({
        name: 'First', members: [
          { name: 'leaf', type: reference('Leaf') },
          { name: 'next', type: nullable(reference('Second')) },
        ],
      }),
      defineDictionary({ name: 'Second', members: [{ name: 'first', type: reference('First') }] }),
      defineDictionary({ name: 'Leaf', members: [{ name: 'value', type: idlType.DOMString }] }),
    ]);
    const first = assembly.getNamedType('First');
    const second = assembly.getNamedType('Second');
    const leaf = assembly.getNamedType('Leaf');

    expect(first.isJSON).toBe(false);
    expect(leaf.isJSON).toBe(true);
    expect(second.isJSON).toBe(false);
    expect(first.isJSON).toBe(false);
    expect(leaf.isJSON).toBe(true);
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
      expect(assembly.getIDLType(use).candidates.types.map((candidate) =>
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
    expect(assembly.getIDLType(clamped).overloadKey).toBe(assembly.getIDLType(idlType.byte).overloadKey);
    expect(assembly.getIDLType(clamped).conversionKey)
      .not.toBe(assembly.getIDLType(idlType.byte).conversionKey);

    const first = union(idlType.byte, idlType.DOMString);
    const reversed = union(idlType.DOMString, idlType.byte);
    expect(assembly.getIDLType(first).overloadKey).not.toBe(assembly.getIDLType(reversed).overloadKey);
    expect(assembly.getIDLType(first).conversionKey).toBe(assembly.getIDLType(reversed).conversionKey);
  });

  it('retains exact candidate branches and distinguishes numeric defaults from numeric conversion', () => {
    const assembly = new DefinitionAssembly([]);
    const type = assembly.getIDLType(union(annotated(idlType.byte, xattr('Clamp')), idlType.bigint));
    const candidates = type.candidates;
    expect(type.candidates).toBe(candidates);
    expect(candidates.numeric).toBe(type.memberTypes[0]);
    expect(candidates.numeric).toMatchObject({ name: 'byte', integerMode: 'clamp' });
    expect(candidates.hasBigInt).toBe(true);
    expect(candidates.soleNumeric).toBeUndefined();
    expect(assembly.getIDLType(nullable(idlType.bigint)).candidates.soleNumeric).toBe(assembly.builtinTypes.bigint);
  });

  it('keeps primitive representation distinct from containers that can pass directly to implementation', () => {
    const assembly = new DefinitionAssembly([]);
    const type = assembly.getIDLType(sequence(nullable(union(idlType.long, idlType.DOMString))));
    expect(type.isPrimitive).toBe(false);
    expect(type.canPassToImpl).toBe(true);
    expect(type.elementType.isPrimitive).toBe(true);
    expect(type.elementType.canPassToImpl).toBe(true);
    expect(assembly.getIDLType(record(idlType.DOMString, idlType.long)).canPassToImpl).toBe(false);
    expect(assembly.getIDLType(frozenArray(idlType.long)).canPassToImpl).toBe(true);
    expect(assembly.builtinTypes.any.canPassToImpl).toBe(true);
  });

  it('shares integer formats across uses while retaining their conversion modes', () => {
    const assembly = new DefinitionAssembly([]);
    const clamp = assembly.getIDLType(annotated(idlType.byte, xattr('Clamp')));
    const range = assembly.getIDLType(annotated(idlType.byte, xattr('EnforceRange')));
    expect(clamp.format).toBe(range.format);
    expect(clamp.integerMode).toBe('clamp');
    expect(range.integerMode).toBe('enforce-range');
    expect(clamp.format).toEqual({ bitLength: 8, signed: true, lowerBound: -128, upperBound: 127 });
    expect(assembly.builtinTypes.longLong.format.lowerBound).toBe(-Number.MAX_SAFE_INTEGER);
    expect(assembly.builtinTypes.unsignedLongLong.format.upperBound).toBe(Number.MAX_SAFE_INTEGER);
    expect(assembly.builtinTypes.ArrayBuffer.isView).toBe(false);
    expect(assembly.builtinTypes.SharedArrayBuffer.isView).toBe(false);
    expect(assembly.builtinTypes.DataView.isView).toBe(true);
    expect(assembly.builtinTypes.Uint8Array.isView).toBe(true);
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

    expect(assembly.getIDLType(type).candidates.nullableMemberCount).toBe(1);
    expect(assembly.getIDLType(type).candidates.hasNullable).toBe(true);
    expect(assembly.getIDLType(reference('MaybeEvent')).candidates.hasNullable).toBe(true);
    expect(assembly.getIDLType(idlType.DOMString).candidates.hasNullable).toBe(false);
  });

  it('detects undefined through annotations, nullable types, unions, and typedefs', () => {
    const assembly = new DefinitionAssembly([
      defineTypedef({ name: 'Nothing', type: idlType.undefined }),
    ]);
    const type = annotated(
      nullable(union(idlType.DOMString, reference('Nothing'))),
      xattr('XAttr'),
    );

    expect(assembly.getIDLType(type).candidates.hasUndefined).toBe(true);
    expect(assembly.getIDLType(nullable(idlType.long)).candidates.hasUndefined).toBe(false);
  });
});
