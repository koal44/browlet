import { describe, expect, it } from 'vitest';

import {
  defineDictionary, defineInterface, idlType, reference, sequence,
  type OperationMember,
} from '../../../src/web-idl/definition';
import { Realm } from '../../../src/browlet/realm';
import { assembleDefinitions } from '../../../src/web-idl/assembly';
import { JavaScriptBinding } from '../../../src/web-idl/binding';
import type { HostDefinedInterface } from '../../../src/web-idl/conversion';
import { ImplementationRegistry } from '../../../src/web-idl/implementation';
import {
  computeEffectiveOverloadSet, missingArgument, resolveOverload,
} from '../../../src/web-idl/overload';
import { PlatformObjectRegistry } from '../../../src/web-idl/platform-object';
import { serializeType } from '../../../src/web-idl/serialize';

describe('Web IDL effective overload sets', () => {
  it('expands optional and variadic operation arguments', () => {
    const f1 = operation([
      { name: 'a', type: idlType.DOMString },
    ]);
    const f2 = operation([
      { name: 'a', type: reference('Node') },
      { name: 'b', type: idlType.DOMString },
      { name: 'c', type: idlType.double, variadic: true },
    ]);
    const f3 = operation([]);
    const f4 = operation([
      { name: 'a', type: reference('Event') },
      { name: 'b', type: idlType.DOMString },
      { name: 'c', optional: true, type: idlType.DOMString },
      { name: 'd', type: idlType.double, variadic: true },
    ]);
    const names = new Map<OperationMember, string>([
      [f1, 'f1'], [f2, 'f2'], [f3, 'f3'], [f4, 'f4'],
    ]);

    const overloads = computeEffectiveOverloadSet([f1, f2, f3, f4], 4);

    expect(overloads.map(({ callable, optionality, types }) => [
      names.get(callable),
      types.map(serializeType),
      optionality,
    ])).toEqual([
      ['f1', ['DOMString'], ['required']],
      ['f2', ['Node', 'DOMString', 'double'], [
        'required', 'required', 'variadic',
      ]],
      ['f2', ['Node', 'DOMString', 'double', 'double'], [
        'required', 'required', 'variadic', 'variadic',
      ]],
      ['f2', ['Node', 'DOMString'], ['required', 'required']],
      ['f3', [], []],
      ['f4', ['Event', 'DOMString', 'DOMString', 'double'], [
        'required', 'required', 'optional', 'variadic',
      ]],
      ['f4', ['Event', 'DOMString', 'DOMString'], [
        'required', 'required', 'optional',
      ]],
      ['f4', ['Event', 'DOMString'], ['required', 'required']],
    ]);
  });

  it('selects by value category and converts the selected arguments', () => {
    const options = defineDictionary({ members: [], name: 'Options' });
    const binding = createBinding([options]);
    const string = namedOperation('string', idlType.DOMString);
    const boolean = namedOperation('boolean', idlType.boolean);
    const dictionary = namedOperation('dictionary', reference('Options'));
    const sequence_ = namedOperation('sequence', sequence(idlType.long));
    const callables = [string, boolean, dictionary, sequence_];

    expect(resolve(callables, ['value'], binding).callable).toBe(string);
    expect(resolve(callables, [false], binding)).toEqual({
      callable: boolean,
      values: [false],
    });
    expect(resolve(callables, [{}], binding)).toEqual({
      callable: dictionary,
      values: [new Map()],
    });

    let iteratorGets = 0;
    const iterable = {
      get [Symbol.iterator]() {
        iteratorGets++;
        return function*() {
          yield '1';
          yield 2;
        };
      },
    };
    expect(resolve(callables, [iterable], binding)).toEqual({
      callable: sequence_,
      values: [[1, 2]],
    });
    expect(iteratorGets).toBe(1);
  });

  it('selects optional and platform-object overloads', () => {
    const nodeIDL = defineInterface({ name: 'Node', members: [] });
    const binding = createBinding([nodeIDL]);
    const optional = {
      arguments: [{ name: 'value', optional: true, type: idlType.DOMString }],
      kind: 'operation',
      name: 'optional',
      returns: idlType.undefined,
    } satisfies OperationMember;
    const numeric = namedOperation('numeric', idlType.long);

    expect(resolve([optional, numeric], [undefined], binding)).toEqual({
      callable: optional,
      values: [missingArgument],
    });

    const interface_ = binding.definitions.getInterface('Node');
    const platformObject = {};
    if (!interface_) throw new Error('Missing Node interface');
    binding.associatePlatformObject(platformObject, interface_);

    const node = namedOperation('node', reference('Node'));
    const string = namedOperation('string', idlType.DOMString);
    expect(resolve([node, string], [platformObject], binding)).toEqual({
      callable: node,
      values: [platformObject],
    });

    const hostObject = {};
    const hostBinding = createBinding([], [{
      is: (value) => value === hostObject,
      name: 'HostObject',
    }]);
    const host = namedOperation('host', reference('HostObject'));
    expect(resolve([host, string], [hostObject], hostBinding)).toEqual({
      callable: host,
      values: [hostObject],
    });
  });

  it('fills omitted optional arguments after selecting the callable', () => {
    const binding = createBinding([]);
    const callable = {
      arguments: [
        { default: false, name: 'enabled', optional: true, type: idlType.boolean },
        { name: 'label', optional: true, type: idlType.DOMString },
      ],
      kind: 'operation',
      name: 'configure',
      returns: idlType.undefined,
    } satisfies OperationMember;

    expect(resolve([callable], [], binding)).toEqual({
      callable,
      values: [false, missingArgument],
    });
  });
});

function operation(
  argumentsList: OperationMember['arguments'],
): OperationMember {
  return {
    arguments: argumentsList,
    kind: 'operation',
    name: 'f',
    returns: idlType.undefined,
  };
}

function namedOperation(
  name: string,
  type: OperationMember['arguments'][number]['type'],
): OperationMember {
  return {
    arguments: [{ name: 'value', type }],
    kind: 'operation',
    name,
    returns: idlType.undefined,
  };
}

function createBinding(
  definitions: Parameters<typeof assembleDefinitions>[0],
  hostDefinedInterfaces: HostDefinedInterface[] = [],
): JavaScriptBinding {
  return new JavaScriptBinding(
    assembleDefinitions(definitions),
    new Realm(),
    new PlatformObjectRegistry(),
    new ImplementationRegistry(),
    hostDefinedInterfaces,
  );
}

function resolve(
  callables: OperationMember[],
  argumentsList: unknown[],
  binding: JavaScriptBinding,
) {
  return resolveOverload(
    computeEffectiveOverloadSet(callables, argumentsList.length),
    argumentsList,
    binding,
  );
}
