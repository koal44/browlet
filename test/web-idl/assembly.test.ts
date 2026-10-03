import { describe, expect, it } from 'vitest';

import { DefinitionAssembly } from '../../src/web-idl/assembly/index';
import {
  arg, defineCallbackFunction, defineCallbackInterface, defineDictionary, defineEnumeration, defineIncludes,
  defineInterface, defineInterfaceMixin, defineNamespace,
  definePartialDictionary, definePartialInterface,
  definePartialInterfaceMixin, definePartialNamespace, idlType, maplike, nullable, op, reference, roAttr, sequence, union,
} from '../../src/web-idl/core/index';

describe('Web IDL definition assembly', () => {
  it('identifies types that can pass directly from IDL to implementation code', () => {
    const assembly = new DefinitionAssembly([
      defineEnumeration({ name: 'Mode', values: ['fast', 'slow'] }),
      defineDictionary({ name: 'Options', members: [] }),
    ]);
    const primitive = nullable(union(idlType.long, reference('Mode')));
    const numbers = sequence(idlType.long);
    const nestedNumbers = sequence(numbers);
    const dictionaries = sequence(reference('Options'));

    expect(assembly.getIDLType(primitive).isPrimitive).toBe(true);
    expect(assembly.getIDLType(primitive).canPassToImpl).toBe(true);
    expect(assembly.getIDLType(numbers).isPrimitive).toBe(false);
    expect(assembly.getIDLType(numbers).canPassToImpl).toBe(true);
    expect(assembly.getIDLType(nestedNumbers).canPassToImpl).toBe(true);
    expect(assembly.getIDLType(dictionaries).canPassToImpl).toBe(false);
    expect(assembly.getIDLType(idlType.any).isPrimitive).toBe(false);
    expect(assembly.getIDLType(idlType.any).canPassToImpl).toBe(false);
    expect(assembly.getIDLType(idlType.symbol).isPrimitive).toBe(true);
  });

  it('resolves inheritance and partial interfaces independently of order', () => {
    const partial = definePartialInterface({
      name: 'Child',
      members: [{
        arguments: [], kind: 'operation', name: 'partialOperation',
        returns: idlType.undefined,
      }],
    });
    const child = defineInterface({
      name: 'Child',
      inherits: 'Parent',
      members: [],
    });
    const parent = defineInterface({ name: 'Parent', members: [] });

    const assembly = new DefinitionAssembly([partial, child, parent]);
    const assembled = assembly.interfaces.get('Child');

    expect(assembled?.primary).toBe(child);
    expect(assembled?.parentAssembled?.primary).toBe(parent);
    expect(assembled?.partials).toEqual([partial]);
    expect(assembled?.members).toMatchObject([{
      member: { ...partial.members[0], returns: assembly.builtinTypes.undefined },
      source: partial,
    }]);
  });

  it('assembles partial mixins in includes-statement order', () => {
    const host = defineInterface({ name: 'Host', members: [] });
    const first = defineInterfaceMixin({
      name: 'First',
      members: [{ arguments: [], kind: 'operation', name: 'first', returns: idlType.undefined }],
    });
    const second = defineInterfaceMixin({
      name: 'Second',
      members: [{ arguments: [], kind: 'operation', name: 'second', returns: idlType.undefined }],
    });
    const secondPartial = definePartialInterfaceMixin({
      name: 'Second',
      members: [{
        arguments: [], kind: 'operation', name: 'extended',
        returns: idlType.undefined,
      }],
    });
    const includeSecond = defineIncludes({ interface: 'Host', mixin: 'Second' });
    const includeFirst = defineIncludes({ interface: 'Host', mixin: 'First' });

    const assembly = new DefinitionAssembly([
      includeSecond,
      secondPartial,
      host,
      includeFirst,
      first,
      second,
    ]);
    const assembled = assembly.interfaces.get('Host');

    expect(assembled?.members).toMatchObject([
      { member: { ...second.members[0], returns: assembly.builtinTypes.undefined }, source: second },
      { member: { ...secondPartial.members[0], returns: assembly.builtinTypes.undefined }, source: secondPartial },
      { member: { ...first.members[0], returns: assembly.builtinTypes.undefined }, source: first },
    ]);
  });

  it('uses the compiled mixin operation itself in each includer and overload group', () => {
    const operation = op('run', idlType.undefined, [
      arg('first', idlType.long), arg('rest', idlType.DOMString, { variadic: true }),
    ]);
    const assembly = new DefinitionAssembly([
      defineInterface({ name: 'First', members: [] }),
      defineInterface({ name: 'Second', members: [] }),
      defineInterfaceMixin({ name: 'Runner', members: [operation] }),
      defineIncludes({ interface: 'First', mixin: 'Runner' }),
      defineIncludes({ interface: 'Second', mixin: 'Runner' }),
    ]);
    const first = assembly.interfaces.get('First')!;
    const second = assembly.interfaces.get('Second')!;
    const member = first.findMemberByKind('operation')!.member;

    expect(member).not.toBe(operation);
    expect(second.findMemberByKind('operation')!.member).toBe(member);
    for (const assembled of [first, second]) {
      const group = assembled.getOperationGroups('regular', () => true, assembly).get('regular:run')!;
      expect(group.callables[0]).toBe(member);
      expect(group.minimumArgumentCount).toBe(1);
      expect(group.maximumArgumentCount).toBe(Infinity);
    }
    expect(member.minimumArgumentCount).toBe(1);
    expect(member.getArgument(10)).toBe(member.variadicArgument);
    expect(member.variadicArgument).toBe(member.arguments[1]);
    expect(member.arguments[0]!.type).toBe(assembly.builtinTypes.long);
    expect(operation.arguments[0]!.type).toBe(idlType.long);
  });

  it('finishes callback arity and forward references before exposing its callable contract', () => {
    const callback = defineCallbackFunction({
      name: 'Read', returns: reference('Result'),
      arguments: [arg('index', idlType.long), arg('fallback', idlType.long, { optional: true })],
    });
    const assembly = new DefinitionAssembly([callback, defineDictionary({ name: 'Result', members: [] })]);
    const assembled = assembly.callbackFunctions.get('Read')!;

    expect(assembled.minimumArgumentCount).toBe(1);
    expect(assembled.variadicArgument).toBeUndefined();
    expect(assembled.getArgument(1)).toBe(assembled.arguments[1]);
    expect(assembled.getArgument(2)).toBeUndefined();
    expect(assembled.returns).toBe(assembly.getIDLType(callback.returns));
  });

  it('preserves ancestry, declaration identity, and nearest inherited attributes', () => {
    const baseValue = roAttr('value', idlType.long);
    const parentValue = roAttr('value', idlType.long);
    const inheritedValue = { ...roAttr('value', idlType.long), inherit: true };
    const base = defineInterface({ name: 'Base', members: [baseValue] });
    const parent = defineInterface({ name: 'Parent', inherits: 'Base', members: [parentValue] });
    const child = defineInterface({ name: 'Child', inherits: 'Parent', members: [inheritedValue] });
    const unrelated = defineInterface({ name: 'Unrelated', members: [] });
    const assembly = new DefinitionAssembly([child, unrelated, parent, base]);
    const assembled = assembly.interfaces.get('Child')!;
    const otherAssembly = new DefinitionAssembly([base]);
    const compiledBase = assembly.interfaces.get('Base')!.findMemberByKind('attribute')!.member;
    const compiledParent = assembly.interfaces.get('Parent')!.findMemberByKind('attribute')!.member;
    const compiledInherited = assembled.findMemberByKind('attribute')!.member;

    for (let attempt = 0; attempt < 2; attempt++) {
      expect(assembled.getInheritanceChain().map((ancestor) => ancestor.name))
        .toEqual(['Base', 'Parent', 'Child']);
      expect(assembled.implements(assembly.interfaces.get('Base')!)).toBe(true);
      expect(assembled.implements(assembly.interfaces.get('Child')!)).toBe(true);
      expect(assembled.implements(otherAssembly.interfaces.get('Base')!)).toBe(true);
      expect(assembled.implements(assembly.interfaces.get('Unrelated')!)).toBe(false);
      expect(assembled.getInheritedAttribute(compiledInherited)).toBe(compiledParent);
      expect(assembled.includesMember(compiledBase)).toBe(true);
      expect(assembled.includesMember(compiledInherited)).toBe(true);
      expect(assembled.includesMember({ ...compiledBase })).toBe(false);
    }
  });

  it('distinguishes own, inherited, and absent collection declarations', () => {
    const collection = maplike(idlType.DOMString, idlType.long);
    const assembly = new DefinitionAssembly([
      defineInterface({ name: 'Child', inherits: 'Parent', members: [] }),
      defineInterface({ name: 'Plain', members: [] }),
      defineInterface({ name: 'Parent', members: [collection] }),
    ]);
    const assembled = assembly.interfaces.get('Child')!;
    const compiledCollection = assembly.interfaces.get('Parent')!.getCollectionMember();

    for (let attempt = 0; attempt < 2; attempt++) {
      expect(assembled.getCollectionMember()).toBeUndefined();
      expect(assembled.getCollectionMember(true)).toBe(compiledCollection);
      expect(assembly.interfaces.get('Parent')!.getCollectionMember()).toBe(compiledCollection);
      expect(assembly.interfaces.get('Plain')!.getCollectionMember(true)).toBeUndefined();
    }
  });

  it('keeps callback interfaces distinct from interfaces', () => {
    const callback = defineCallbackInterface({
      name: 'EventListener',
      members: [{
        arguments: [], kind: 'operation', name: 'handleEvent',
        returns: idlType.undefined,
      }],
    });
    const assembly = new DefinitionAssembly([callback]);

    expect(assembly.callbackInterfaces.get('EventListener')?.primary).toBe(callback);
    expect(assembly.interfaces.get('EventListener')).toBeUndefined();
  });

  it('assembles primary and partial namespace members without reordering', () => {
    const primary = defineNamespace({
      name: 'Namespace',
      members: [{
        arguments: [], kind: 'operation', name: 'first',
        returns: idlType.undefined,
      }],
    });
    const partial = definePartialNamespace({
      name: 'Namespace',
      members: [{
        arguments: [], kind: 'operation', name: 'second',
        returns: idlType.undefined,
      }],
    });

    const assembly = new DefinitionAssembly([partial, primary]);
    const assembled = assembly.namespaces.get('Namespace');

    expect(assembled?.primary).toBe(primary);
    expect(assembled?.partials).toEqual([partial]);
    expect(assembled?.members.map(({ member }) => member.name)).toEqual([
      'first', 'second',
    ]);
    expect(assembled?.members.map(({ source }) => source)).toEqual([
      primary, partial,
    ]);
  });

  it('retains complete dictionary shapes after combining inheritance and partial members', () => {
    const assembly = new DefinitionAssembly([
      defineDictionary({
        name: 'Complete', inherits: 'Base', members: [{ name: 'required', type: idlType.long, required: true }],
      }),
      defineDictionary({ name: 'Base', members: [{ name: 'flag', type: idlType.boolean, default: false }] }),
      definePartialDictionary({ name: 'Complete', members: [{ name: 'text', type: idlType.DOMString, default: '' }] }),
      defineDictionary({ name: 'Sparse', inherits: 'Complete', members: [member('optional')] }),
      defineDictionary({ name: 'Empty', members: [] }),
    ]);
    expect(assembly.dictionaries.get('Base')!.hasCompleteShape).toBe(true);
    expect(assembly.dictionaries.get('Complete')!.hasCompleteShape).toBe(true);
    expect(assembly.dictionaries.get('Sparse')!.hasCompleteShape).toBe(false);
    expect(assembly.dictionaries.get('Empty')!.hasCompleteShape).toBe(true);
  });

  it('orders inherited and partial dictionary members per Web IDL', () => {
    const b = defineDictionary({
      name: 'B',
      inherits: 'A',
      members: [member('b'), member('a')],
    });
    const a = defineDictionary({
      name: 'A',
      members: [member('c'), member('g')],
    });
    const c = defineDictionary({
      name: 'C',
      inherits: 'B',
      members: [member('e'), member('f')],
    });
    const partialA = definePartialDictionary({
      name: 'A',
      members: [member('h'), member('d')],
    });

    const assembly = new DefinitionAssembly([b, a, c, partialA]);
    const assembled = assembly.dictionaries.get('C');

    expect(assembled?.parentAssembled?.primary).toBe(b);
    expect(assembled?.parentAssembled?.parentAssembled?.primary).toBe(a);
    expect(assembled?.parentAssembled?.parentAssembled?.partials).toEqual([partialA]);
    expect(assembled?.members.map(({ name }) => name)).toEqual([
      'c', 'd', 'g', 'h', 'a', 'b', 'e', 'f',
    ]);
  });
});

function member(name: string) {
  return { name, type: idlType.long };
}
