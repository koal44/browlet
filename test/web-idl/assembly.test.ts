import { describe, expect, it } from 'vitest';

import { DefinitionAssembly } from '../../src/web-idl/assembly';
import {
  defineCallbackInterface, defineDictionary, defineIncludes,
  defineInterface, defineInterfaceMixin, defineNamespace,
  definePartialDictionary, definePartialInterface,
  definePartialInterfaceMixin, definePartialNamespace, idlType,
} from '../../src/web-idl/core/index';

describe('Web IDL definition assembly', () => {
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
    expect(assembled?.members).toEqual([{
      member: partial.members[0],
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

    expect(assembled?.members).toEqual([
      { member: second.members[0], source: second },
      { member: secondPartial.members[0], source: secondPartial },
      { member: first.members[0], source: first },
    ]);
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
