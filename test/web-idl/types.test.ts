import { describe, expect, it } from 'vitest';

import { DefinitionAssembly } from '../../src/web-idl/assembly';
import {
  annotated, defineTypedef, idlType, nullable, reference, sequence, union,
  xattr,
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
    }

    const stringKey = strings.getConversionTypeKey(type);
    expect(numbers.getConversionTypeKey(type)).not.toBe(stringKey);
    expect(strings.getConversionTypeKey(type)).toBe(stringKey);
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
