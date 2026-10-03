import { describe, expect, it } from 'vitest';

import { InternalError } from '../../src/infra/internal-error';
import {
  arg, defineCallbackFunction, defineCallbackInterface, defineDictionary, defineEnumeration,
  defineIncludes, defineInterface, defineInterfaceMixin, defineNamespace, definePartialDictionary,
  definePartialInterface, definePartialInterfaceMixin, definePartialNamespace, defineTypedef,
  idlType, nullable, observableArray, op, reference, roAttr, sequence, type Definition,
} from '../../src/web-idl/core/index';
import { DefinitionAssembly } from '../../src/web-idl/assembly/index';

describe('Web IDL declaration validation', () => {
  it.each<Definition>([
    defineInterface({ name: 'Example', members: [roAttr('value', reference('Missing'))] }),
    defineDictionary({ name: 'Example', members: [{ name: 'value', type: sequence(reference('Missing')) }] }),
    defineCallbackFunction({ name: 'Example', arguments: [arg('value', reference('Missing'))], returns: idlType.undefined }),
    defineCallbackInterface({ name: 'Example', members: [op('run', reference('Missing'))] }),
    defineNamespace({ name: 'Example', members: [op('run', reference('Missing'))] }),
    defineTypedef({ name: 'Example', type: sequence(reference('Missing')) }),
    defineInterfaceMixin({ name: 'Example', members: [roAttr('value', reference('Missing'))] }),
  ])('rejects unresolved types in a $kind during construction', (definition) => {
    expect(() => new DefinitionAssembly([definition])).toThrowError(new InternalError('Unknown Web IDL type Missing'));
  });

  it('rejects unresolved type inputs requested after construction', () => {
    const assembly = new DefinitionAssembly([]);
    expect(() => assembly.getNamedType('Missing')).toThrowError(InternalError);
    expect(() => assembly.getIDLType(sequence(reference('Missing')))).toThrowError(InternalError);
  });

  it.each<Definition>([
    defineNamespace({ name: 'NotAType', members: [] }),
    defineInterfaceMixin({ name: 'NotAType', members: [] }),
  ])('rejects a $kind used as a value type', (definition) => {
    expect(() => new DefinitionAssembly([
      defineInterface({ name: 'Example', members: [roAttr('value', reference('NotAType'))] }),
      definition,
    ])).toThrowError(InternalError);
  });

  it.each<Definition>([
    defineInterface({ name: 'Repeated', members: [] }),
    defineDictionary({ name: 'Repeated', members: [] }),
  ])('rejects duplicate primary names, including collisions with a $kind', (definition) => {
    expect(() => new DefinitionAssembly([
      defineInterface({ name: 'Repeated', members: [] }), definition,
    ])).toThrowError(new InternalError('Duplicate Web IDL definition Repeated'));
  });

  it.each<Definition>([
    definePartialInterface({ name: 'Missing', members: [] }),
    definePartialInterfaceMixin({ name: 'Missing', members: [] }),
    definePartialDictionary({ name: 'Missing', members: [] }),
    definePartialNamespace({ name: 'Missing', members: [] }),
  ])('rejects an orphan $kind even when its name belongs to another kind', (definition) => {
    expect(() => new DefinitionAssembly([definition])).toThrowError(InternalError);
    expect(() => new DefinitionAssembly([
      definition, defineEnumeration({ name: 'Missing', values: ['value'] }),
    ])).toThrowError(InternalError);
  });

  it.each([defineInterface, defineDictionary])('rejects missing or wrong-kind parents', (define) => {
    const child = define({ name: 'Child', inherits: 'Missing', members: [] });
    expect(() => new DefinitionAssembly([child])).toThrowError(InternalError);
    expect(() => new DefinitionAssembly([
      child, defineNamespace({ name: 'Missing', members: [] }),
    ])).toThrowError(InternalError);
  });

  it.each([defineInterface, defineDictionary])('rejects inheritance cycles during construction', (define) => {
    expect(() => new DefinitionAssembly([
      define({ name: 'Self', inherits: 'Self', members: [] }),
    ])).toThrowError(InternalError);
    expect(() => new DefinitionAssembly([
      define({ name: 'A', inherits: 'B', members: [] }),
      define({ name: 'B', inherits: 'C', members: [] }),
      define({ name: 'C', inherits: 'A', members: [] }),
    ])).toThrowError(InternalError);
  });

  it('rejects includes statements with a missing interface or mixin', () => {
    const include = defineIncludes({ interface: 'Example', mixin: 'Members' });
    expect(() => new DefinitionAssembly([
      include, defineInterfaceMixin({ name: 'Members', members: [] }),
    ])).toThrowError(InternalError);
    expect(() => new DefinitionAssembly([
      include, defineInterface({ name: 'Example', members: [] }),
    ])).toThrowError(InternalError);
    expect(() => new DefinitionAssembly([
      include, defineDictionary({ name: 'Example', members: [] }),
      defineInterface({ name: 'Members', members: [] }),
    ])).toThrowError(InternalError);
  });

  it('rejects repeated includes statements', () => {
    const include = defineIncludes({ interface: 'Example', mixin: 'Members' });
    expect(() => new DefinitionAssembly([
      defineInterface({ name: 'Example', members: [] }),
      defineInterfaceMixin({ name: 'Members', members: [] }), include, include,
    ])).toThrowError(InternalError);
  });

  it('rejects alias cycles, including aliases nested in containers', () => {
    expect(() => new DefinitionAssembly([
      defineTypedef({ name: 'Self', type: reference('Self') }),
    ])).toThrowError(InternalError);
    expect(() => new DefinitionAssembly([
      defineTypedef({ name: 'A', type: reference('B') }),
      defineTypedef({ name: 'B', type: sequence(nullable(reference('A'))) }),
    ])).toThrowError(InternalError);
  });

  it('preserves forward aliases and recursive dictionaries', () => {
    const assembly = new DefinitionAssembly([
      defineTypedef({ name: 'Nodes', type: sequence(reference('Node')) }),
      defineDictionary({ name: 'Node', members: [{ name: 'children', type: reference('Nodes') }] }),
    ]);
    const children = assembly.dictionaries.get('Node')!.members[0]!.type;
    expect(children).toMatchObject({ kind: 'sequence', elementType: { kind: 'dictionary' } });
    expect(children).toEqual(assembly.getNamedType('Nodes'));
  });

  it('preserves recognized types whose general conversion is not implemented', () => {
    const assembly = new DefinitionAssembly([
      defineInterface({ name: 'Example', members: [roAttr('values', observableArray(idlType.long))] }),
    ]);
    expect(assembly.interfaces.get('Example')!.findMemberByKind('attribute')!.member.type.kind)
      .toBe('observable-array');
  });
});
