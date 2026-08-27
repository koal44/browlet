import { describe, expect, it } from 'vitest';

import { assembleDefinitions } from '../../../src/web-idl/assembly';
import {
  defineCallbackInterface, defineDictionary, defineIncludes,
  defineInterface, defineInterfaceMixin, defineNamespace,
  definePartialDictionary, definePartialInterface,
  definePartialInterfaceMixin, definePartialNamespace, idlType,
} from '../../../src/web-idl/declaration/index';

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

    const definitions = assembleDefinitions([partial, child, parent]);
    const assembled = definitions.getInterface('Child');

    expect(assembled?.definition).toBe(child);
    expect(assembled?.parent?.definition).toBe(parent);
    expect(assembled?.partials).toEqual([partial]);
    expect(assembled?.members).toEqual([{
      member: partial.members[0],
      source: partial,
    }]);
  });

  it('assembles partial mixins in includes-statement order', () => {
    const host = defineInterface({ name: 'Host', members: [] });
    const first = defineInterfaceMixin({ name: 'First', members: [] });
    const second = defineInterfaceMixin({ name: 'Second', members: [] });
    const secondPartial = definePartialInterfaceMixin({
      name: 'Second',
      members: [{
        arguments: [], kind: 'operation', name: 'extended',
        returns: idlType.undefined,
      }],
    });
    const includeSecond = defineIncludes({ interface: 'Host', mixin: 'Second' });
    const includeFirst = defineIncludes({ interface: 'Host', mixin: 'First' });

    const definitions = assembleDefinitions([
      includeSecond,
      secondPartial,
      host,
      includeFirst,
      first,
      second,
    ]);
    const assembled = definitions.getInterface('Host');

    expect(assembled?.includes.map(({ mixin }) => mixin?.definition)).toEqual([
      second,
      first,
    ]);
    expect(assembled?.includes[0]?.mixin?.partials).toEqual([secondPartial]);
    expect(assembled?.members).toEqual([{
      member: secondPartial.members[0],
      source: secondPartial,
    }]);
  });

  it('keeps callback interfaces distinct from interfaces', () => {
    const callback = defineCallbackInterface({
      name: 'EventListener',
      members: [{
        arguments: [], kind: 'operation', name: 'handleEvent',
        returns: idlType.undefined,
      }],
    });
    const definitions = assembleDefinitions([callback]);

    expect(definitions.getDefinition('EventListener')).toBe(callback);
    expect(definitions.getCallbackInterface('EventListener')).toBe(callback);
    expect(definitions.getInterface('EventListener')).toBeUndefined();
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

    const definitions = assembleDefinitions([partial, primary]);
    const assembled = definitions.getNamespace('Namespace');

    expect(assembled?.definition).toBe(primary);
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

    const definitions = assembleDefinitions([b, a, c, partialA]);
    const assembled = definitions.getDictionary('C');

    expect(assembled?.parent?.definition).toBe(b);
    expect(assembled?.parent?.parent?.definition).toBe(a);
    expect(assembled?.parent?.parent?.partials).toEqual([partialA]);
    expect(assembled?.members.map(({ name }) => name)).toEqual([
      'c', 'd', 'g', 'h', 'a', 'b', 'e', 'f',
    ]);
  });
});

function member(name: string) {
  return { name, type: idlType.long };
}
