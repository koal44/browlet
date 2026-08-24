import { describe, expect, it } from 'vitest';

import { assembleDefinitions } from '../../../src/web-idl/adapter/assembly';
import {
  annotated, defineTypedef, idlType, nullable, reference, sequence, union,
  xattr,
} from '../../../src/web-idl/adapter/definition';
import { serializeType } from '../../../src/web-idl/adapter/serialize';
import {
  getFlattenedMemberTypes, getNumberOfNullableMemberTypes,
  includesNullableType, includesUndefined,
} from '../../../src/web-idl/types';

describe('Web IDL types', () => {
  it('gets flattened member types from nested unions', () => {
    const definitions = assembleDefinitions([]);
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
      getFlattenedMemberTypes(type, definitions).map(serializeType),
    ).toEqual([
      'Node',
      'sequence<long>',
      'Event',
      'XMLHttpRequest',
      'DOMString',
      'sequence<(sequence<double> or NodeList)>',
    ]);
  });

  it('counts nullable members through annotations, unions, and typedefs', () => {
    const definitions = assembleDefinitions([
      defineTypedef({
        name: 'MaybeEvent',
        type: annotated(nullable(reference('Event')), xattr('XAttr')),
      }),
    ]);
    const type = union(
      idlType.long,
      union(reference('MaybeEvent'), idlType.DOMString),
    );

    expect(getNumberOfNullableMemberTypes(type, definitions)).toBe(1);
    expect(includesNullableType(type, definitions)).toBe(true);
    expect(includesNullableType(reference('MaybeEvent'), definitions)).toBe(true);
    expect(includesNullableType(idlType.DOMString, definitions)).toBe(false);
  });

  it('detects undefined through annotations, nullable types, unions, and typedefs', () => {
    const definitions = assembleDefinitions([
      defineTypedef({ name: 'Nothing', type: idlType.undefined }),
    ]);
    const type = annotated(
      nullable(union(idlType.DOMString, reference('Nothing'))),
      xattr('XAttr'),
    );

    expect(includesUndefined(type, definitions)).toBe(true);
    expect(includesUndefined(nullable(idlType.long), definitions)).toBe(false);
  });
});
