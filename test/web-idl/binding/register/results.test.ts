import { describe, expect, it } from 'vitest';

import {
  arg, onError, ctor, defineCallbackFunction, defineDictionary, defineInterface, dictMember, idlType,
  impl, implementationType, nullable, op, promise as promiseType, roAttr, reference, sequence, union,
} from '../../../../src/web-idl/core/index';
import { getImplementationObject } from '../../../../src/web-idl/binding/platform';
import { BindingWorld } from '../../../../src/web-idl/binding/world';

import { TestRealm as Realm } from '../../../support/web-idl-realm';

describe('Web IDL implementation result conversion', () => {
  it('projects nested implementation results without exposing their identity', async () => {
    class NestedResultImpl {
      #label: string;

      constructor(label: string) {
        this.#label = label;
      }

      get label(): string {
        return this.#label;
      }
    }
    class NestedResultOwnerImpl {}

    const nestedResultIDL = defineInterface({
      name: 'NestedResult',
      exposed: 'Window',
      implementation: impl(NestedResultImpl),
      members: [roAttr('label', idlType.DOMString)],
    });
    const resultType = implementationType<unknown>(reference(nestedResultIDL.name));
    const nestedResultCallbackIDL = defineCallbackFunction({
      name: 'NestedResultCallback',
      returns: idlType.undefined,
      arguments: [
        arg('direct', resultType),
        arg('union', union(resultType, idlType.DOMString)),
      ],
    });
    const resultDictionaryIDL = defineDictionary({
      name: 'NestedResultDictionary',
      members: [
        dictMember('first', resultType),
        dictMember('second', resultType),
      ],
    });
    const implementations = new Map<string, NestedResultImpl>();
    const createResult = (label: string): NestedResultImpl => {
      const value = new NestedResultImpl(label);
      implementations.set(label, value);
      return value;
    };
    const ownerIDL = defineInterface({
      name: 'NestedResultOwner',
      exposed: 'Window',
      implementation: impl(NestedResultOwnerImpl),
      members: [
        ctor(),
        op('nullableResult', nullable(resultType),
          [],
          {
            invoke() { return createResult('nullable'); },
          },
        ),
        op('unionResult', union(resultType, idlType.DOMString),
          [],
          {
            invoke() { return createResult('union'); },
          },
        ),
        op('sequenceResult', sequence(resultType),
          [],
          {
            invoke() {
              const value = createResult('sequence');
              return [value, value];
            },
          },
        ),
        op('dictionaryResult', reference(resultDictionaryIDL.name),
          [],
          {
            invoke() {
              const value = createResult('dictionary');
              return { first: value, second: value };
            },
          },
        ),
        op('createdPromiseResult', promiseType(resultType),
          [],
          {
            invoke(context) {
              return context.Promise.resolve(createResult('created promise'), resultType);
            },
          },
        ),
        op('resolvedPromiseResult', promiseType(resultType),
          [],
          {
            invoke(context) {
              const result = context.Promise.withResolvers(resultType);
              result.resolve(createResult('resolved promise'));
              return result.promise;
            },
          },
        ),
        op('reactedPromiseResult', promiseType(resultType),
          [],
          {
            invoke(context) {
              return context.Promise.resolve(undefined, idlType.undefined).then(() => createResult('reacted promise'), undefined, resultType);
            },
          },
        ),
        op('callbackArguments', idlType.undefined,
          [
            arg('callback', reference(nestedResultCallbackIDL.name),
              onError('rethrow'),
            ),
          ],
          {
            invoke(_context, callback) {
              (callback as (
                direct: NestedResultImpl,
                union: NestedResultImpl,
              ) => void)(
                createResult('callback direct'),
                createResult('callback union'),
              );
            },
          },
        ),
      ],
    });
    const realm = new Realm();
    const world = new BindingWorld([
      nestedResultIDL,
      nestedResultCallbackIDL,
      resultDictionaryIDL,
      ownerIDL,
    ]);
    world.register(realm, (ctx) => ({ realm: ctx.realm }));
    const binding = world.getRealmBinding(realm)!;
    binding.installDefinitions();
    type NestedResult = { label: string; };
    const NestedResultOwner = Reflect.get(realm.global, ownerIDL.name) as {
      new(): {
        callbackArguments(
          callback: (
            direct: NestedResult,
            union: NestedResult | string,
          ) => void,
        ): void;
        createdPromiseResult(): Promise<NestedResult>;
        dictionaryResult(): { first: NestedResult; second: NestedResult; };
        nullableResult(): NestedResult | null;
        reactedPromiseResult(): Promise<NestedResult>;
        resolvedPromiseResult(): Promise<NestedResult>;
        sequenceResult(): NestedResult[];
        unionResult(): NestedResult | string;
      };
    };
    const owner = new NestedResultOwner();
    const expectProjection = (label: string, object: NestedResult): void => {
      const implementation = implementations.get(label);
      expect(implementation).toBeInstanceOf(NestedResultImpl);
      expect(object).not.toBe(implementation);
      expect(getImplementationObject(object))
        .toBe(implementation);
      expect(object.label).toBe(label);
    };

    const nullableResult = owner.nullableResult();
    if (!nullableResult) throw new Error('Missing nullable result');
    expectProjection('nullable', nullableResult);

    const unionResult = owner.unionResult();
    if (typeof unionResult === 'string') throw new Error('Wrong union result');
    expectProjection('union', unionResult);

    const sequenceResult = owner.sequenceResult();
    expect(sequenceResult[0]).toBe(sequenceResult[1]);
    expectProjection('sequence', sequenceResult[0]!);

    const dictionaryResult = owner.dictionaryResult();
    expect(dictionaryResult.first).toBe(dictionaryResult.second);
    expectProjection('dictionary', dictionaryResult.first);

    expectProjection(
      'created promise',
      await owner.createdPromiseResult(),
    );
    expectProjection(
      'resolved promise',
      await owner.resolvedPromiseResult(),
    );
    expectProjection(
      'reacted promise',
      await owner.reactedPromiseResult(),
    );

    owner.callbackArguments((direct, unionResult) => {
      expectProjection('callback direct', direct);
      if (typeof unionResult === 'string') {
        throw new Error('Wrong callback union value');
      }
      expectProjection('callback union', unionResult);
    });
  });
});
