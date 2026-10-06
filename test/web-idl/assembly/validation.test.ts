import { describe, expect, it } from 'vitest';

import { InternalError } from '../../../src/infra/internal-error';
import {
  arg, cbDict, defineCallbackFunction, defineCallbackInterface, defineDictionary, defineEnumeration,
  defineIncludes, defineInterface, defineInterfaceMixin, defineNamespace, definePartialDictionary,
  definePartialInterface, definePartialInterfaceMixin, definePartialNamespace, defineTypedef,
  idlType, nullable, observableArray, op, reference, roAttr, sequence, type Definition,
} from '../../../src/web-idl/core/index';
import { DefinitionAssembly, validateDefinitions } from '../../../src/web-idl/assembly/index';

describe('Web IDL declaration validation', () => {
  it('leaves unused aliases and mixins unchecked until validation is requested', () => {
    for (const definition of [
      defineTypedef({ name: 'Unused', type: reference('Missing') }),
      defineInterfaceMixin({ name: 'Unused', members: [roAttr('value', reference('Missing'))] }),
    ]) {
      expect(() => new DefinitionAssembly([definition])).not.toThrow();
      expect(() => validateDefinitions([definition])).toThrowError(new InternalError('Unknown Web IDL type Missing'));
    }
  });

  it('keeps structural validation separate from trusted assembly', () => {
    const definitions = [definePartialInterface({ name: 'Missing', members: [] })];
    expect(() => new DefinitionAssembly(definitions)).not.toThrow();
    expect(() => validateDefinitions(definitions)).toThrowError(InternalError);
  });

  it.each<Definition>([
    defineInterface({ name: 'Example', members: [roAttr('value', reference('Missing'))] }),
    defineDictionary({ name: 'Example', members: [{ name: 'value', type: sequence(reference('Missing')) }] }),
    defineCallbackFunction({ name: 'Example', arguments: [arg('value', reference('Missing'))], returns: idlType.undefined }),
    defineCallbackInterface({ name: 'Example', members: [op('run', reference('Missing'))] }),
    defineNamespace({ name: 'Example', members: [op('run', reference('Missing'))] }),
    defineTypedef({ name: 'Example', type: sequence(reference('Missing')) }),
    defineInterfaceMixin({ name: 'Example', members: [roAttr('value', reference('Missing'))] }),
  ])('rejects unresolved types in a $kind during validation', (definition) => {
    expect(() => validateDefinitions([definition])).toThrowError(new InternalError('Unknown Web IDL type Missing'));
  });

  it('rejects unresolved type inputs requested after construction', () => {
    const assembly = new DefinitionAssembly([]);
    expect(() => assembly.getNamedType('Missing')).toThrowError(InternalError);
    expect(() => assembly.getIDLType(sequence(reference('Missing')))).toThrowError(InternalError);
  });

  it('rejects a callback-dictionary adapter naming a non-dictionary', () => {
    expect(() => validateDefinitions([
      defineInterface({ name: 'NotADictionary', members: [] }),
      defineInterface({
        name: 'Example', members: [
          op('run', idlType.undefined, [arg('options', idlType.object, cbDict('NotADictionary'))]),
        ],
      }),
    ])).toThrowError(new InternalError('Callback dictionary for options must be a dictionary'));
  });

  it.each<Definition>([
    defineNamespace({ name: 'NotAType', members: [] }),
    defineInterfaceMixin({ name: 'NotAType', members: [] }),
  ])('rejects a $kind used as a value type', (definition) => {
    expect(() => validateDefinitions([
      defineInterface({ name: 'Example', members: [roAttr('value', reference('NotAType'))] }),
      definition,
    ])).toThrowError(InternalError);
  });

  it.each<Definition>([
    defineInterface({ name: 'Repeated', members: [] }),
    defineDictionary({ name: 'Repeated', members: [] }),
  ])('rejects duplicate primary names, including collisions with a $kind', (definition) => {
    expect(() => validateDefinitions([
      defineInterface({ name: 'Repeated', members: [] }), definition,
    ])).toThrowError(new InternalError('Duplicate Web IDL definition Repeated'));
  });

  it.each<Definition>([
    definePartialInterface({ name: 'Missing', members: [] }),
    definePartialInterfaceMixin({ name: 'Missing', members: [] }),
    definePartialDictionary({ name: 'Missing', members: [] }),
    definePartialNamespace({ name: 'Missing', members: [] }),
  ])('rejects an orphan $kind even when its name belongs to another kind', (definition) => {
    expect(() => validateDefinitions([definition])).toThrowError(InternalError);
    expect(() => validateDefinitions([
      definition, defineEnumeration({ name: 'Missing', values: ['value'] }),
    ])).toThrowError(InternalError);
  });

  it.each([defineInterface, defineDictionary])('rejects missing or wrong-kind parents', (define) => {
    const child = define({ name: 'Child', inherits: 'Missing', members: [] });
    expect(() => validateDefinitions([child])).toThrowError(InternalError);
    expect(() => validateDefinitions([
      child, defineNamespace({ name: 'Missing', members: [] }),
    ])).toThrowError(InternalError);
  });

  it.each([defineInterface, defineDictionary])('rejects inheritance cycles during validation', (define) => {
    expect(() => validateDefinitions([
      define({ name: 'Self', inherits: 'Self', members: [] }),
    ])).toThrowError(InternalError);
    expect(() => validateDefinitions([
      define({ name: 'A', inherits: 'B', members: [] }),
      define({ name: 'B', inherits: 'C', members: [] }),
      define({ name: 'C', inherits: 'A', members: [] }),
    ])).toThrowError(InternalError);
  });

  it('rejects includes statements with a missing interface or mixin', () => {
    const include = defineIncludes({ interface: 'Example', mixin: 'Members' });
    expect(() => validateDefinitions([
      include, defineInterfaceMixin({ name: 'Members', members: [] }),
    ])).toThrowError(InternalError);
    expect(() => validateDefinitions([
      include, defineInterface({ name: 'Example', members: [] }),
    ])).toThrowError(InternalError);
    expect(() => validateDefinitions([
      include, defineDictionary({ name: 'Example', members: [] }),
      defineInterface({ name: 'Members', members: [] }),
    ])).toThrowError(InternalError);
  });

  it('rejects repeated includes statements', () => {
    const include = defineIncludes({ interface: 'Example', mixin: 'Members' });
    expect(() => validateDefinitions([
      defineInterface({ name: 'Example', members: [] }),
      defineInterfaceMixin({ name: 'Members', members: [] }), include, include,
    ])).toThrowError(InternalError);
  });

  it('rejects alias cycles, including aliases nested in containers', () => {
    expect(() => validateDefinitions([
      defineTypedef({ name: 'Self', type: reference('Self') }),
    ])).toThrowError(InternalError);
    expect(() => validateDefinitions([
      defineTypedef({ name: 'A', type: reference('B') }),
      defineTypedef({ name: 'B', type: sequence(nullable(reference('A'))) }),
    ])).toThrowError(InternalError);
  });

  it('preserves forward aliases and recursive dictionaries', () => {
    const definitions = [
      defineTypedef({ name: 'Nodes', type: sequence(reference('Node')) }),
      defineDictionary({ name: 'Node', members: [{ name: 'children', type: reference('Nodes') }] }),
    ];
    expect(() => validateDefinitions(definitions)).not.toThrow();
    const assembly = new DefinitionAssembly(definitions);
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
