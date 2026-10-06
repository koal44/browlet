import { describe, expect, it, vi } from 'vitest';

import {
  arg, atArg, onError, ctor, defineCallbackFunction, defineDictionary, defineInterface,
  defineTypedef, dictMember, idlType, impl, op, roAttr, record, reference, sequence, union,
  invokeWith,
} from '../../../../src/web-idl/core/index';
import { BindingWorld } from '../../../../src/web-idl/binding/world';
import {
  CallbackFunctionStamper, type StampedCallbackFunction,
} from '../../../../src/web-idl/binding/realm/callback';
import type { WebIDLRealm } from '../../../../src/web-idl/index';

import { TestRealm as Realm } from '../../../support/web-idl-realm';

describe('Web IDL implementation callback conversion', () => {
  it('projects implementation-provided callbacks without invoking their property traps', () => {
    const callback = new Proxy(() => 1, {
      get() { throw new Error('Unexpected callback property read'); },
      has() { throw new Error('Unexpected callback property check'); },
    });
    class CallbackOwnerImpl {
      callback = callback;
      callbackUnion = callback;
    }
    const result = defineCallbackFunction({ name: 'Result', returns: idlType.long, arguments: [] });
    const definition = defineInterface({
      name: 'CallbackOwner', exposed: ['Window'], implementation: impl(CallbackOwnerImpl),
      members: [
        ctor([]),
        roAttr('callback', reference(result.name)),
        roAttr('callbackUnion', union(idlType.DOMString, reference(result.name))),
      ],
    });
    const realm = new Realm();
    new BindingWorld([result, definition]).register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Constructor = Reflect.get(realm.global, 'CallbackOwner') as new() => {
      callback: unknown; callbackUnion: unknown;
    };
    const owner = new Constructor();
    expect(owner.callback).toBe(callback);
    expect(owner.callbackUnion).toBe(callback);
  });

  it('projects callbacks whose return type is the same callback type', () => {
    type Next = () => Next;
    class RecursiveCallbacksImpl {
      next(callback: Next): Next { return callback(); }
    }
    const callback = defineCallbackFunction({
      name: 'Next', returns: reference('Next'), arguments: [],
    });
    const definition = defineInterface({
      name: 'RecursiveCallbacks', exposed: '*', implementation: impl(RecursiveCallbacksImpl),
      members: [
        ctor(),
        op('next', reference(callback.name), [arg('callback', reference(callback.name), onError('rethrow'))]),
      ],
    });
    const realm = new Realm();
    new BindingWorld([callback, definition]).register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Constructor = Reflect.get(realm.global, definition.name) as new() => { next(callback: Next): Next; };
    const next: Next = () => next;
    expect(new Constructor().next(next)).toBe(next);
  });

  it('projects callback functions into ordinary implementation callables', () => {
    type Increment = (this: unknown, value: number) => number;
    type CallbackOptions = { callback: Increment; };

    class CallbackProjectionImpl {
      #callback: Increment | null = null;

      get nativeCallback(): Increment {
        return (value) => value + 2;
      }

      get nativeCallbackUnion(): Increment {
        return (value) => value + 3;
      }

      get callback(): Increment {
        if (!this.#callback) throw new Error('Callback has not been set');
        return this.#callback;
      }

      get callbackUnion(): string | Increment {
        return this.callback;
      }

      invoke(
        callback: Increment,
        value: number,
        thisArgument: object,
      ): number {
        this.#callback = callback;
        return Reflect.apply(callback, thisArgument, [value]);
      }

      invokeUnion(callback: string | Increment): number {
        return typeof callback === 'string'
          ? callback.length
          : callback(2);
      }

      invokeDictionary(options: CallbackOptions): number {
        return options.callback(3);
      }

      invokeSequence(callbacks: Increment[]): number {
        return callbacks.reduce((sum, callback) =>
          sum + callback(sum), 0);
      }

      invokeRecord(
        callbacks: Readonly<Record<string, Increment>>,
      ): number {
        return Object.values(callbacks).reduce((sum, callback) =>
          sum + callback(sum), 0);
      }

      preserveAny(value: unknown): unknown {
        return value;
      }

      report(callback: () => void): void {
        callback();
      }

      rethrow(callback: () => void): void {
        callback();
      }

      construct(callback: StampedCallbackFunction, realm: WebIDLRealm): unknown {
        return CallbackFunctionStamper.get(callback).construct([4], realm);
      }
    }

    const increment = defineCallbackFunction({
      name: 'Increment',
      returns: idlType.long,
      arguments: [arg('value', idlType.long)],
    });
    const voidCallback = defineCallbackFunction({
      name: 'VoidCallback',
      returns: idlType.undefined,
      arguments: [],
    });
    const factory = defineCallbackFunction({
      name: 'Factory',
      returns: idlType.any,
      arguments: [arg('value', idlType.long)],
    });
    const callbackOrString = defineTypedef({
      name: 'CallbackOrString',
      type: union(idlType.DOMString, reference(increment.name)),
    });
    const callbackOptions = defineDictionary({
      name: 'CallbackOptions',
      members: [dictMember('callback', reference(increment.name),
        { ...onError('rethrow'), required: true },
      )],
    });
    const interfaceIDL = defineInterface({
      name: 'CallbackProjection',
      exposed: ['Window'],
      implementation: impl(CallbackProjectionImpl),
      members: [
        ctor([], { invoke() {} }),
        roAttr('callback', reference(increment.name)),
        roAttr('callbackUnion', reference(callbackOrString.name)),
        roAttr('nativeCallback', reference(increment.name)),
        roAttr('nativeCallbackUnion', reference(callbackOrString.name)),
        op('invoke', idlType.long, [
          arg('callback', reference(increment.name),
            onError('rethrow'),
          ),
          arg('value', idlType.long),
          arg('thisArgument', idlType.object),
        ]),
        op('invokeUnion', idlType.long, [
          arg('callback', reference(callbackOrString.name),
            onError('rethrow'),
          ),
        ]),
        op('invokeDictionary', idlType.long, [
          arg('options', reference(callbackOptions.name)),
        ]),
        op('invokeSequence', idlType.long, [
          arg('callbacks', sequence(reference(increment.name)),
            onError('rethrow'),
          ),
        ]),
        op('invokeRecord', idlType.long, [
          arg('callbacks', record(idlType.DOMString, reference(increment.name)),
            onError('rethrow'),
          ),
        ]),
        op('preserveAny', idlType.any, [arg('value', idlType.any)]),
        op('report', idlType.undefined, [
          arg('callback', reference(voidCallback.name),
            onError('report'),
          ),
        ]),
        op('rethrow', idlType.undefined, [
          arg('callback', reference(voidCallback.name),
            onError('rethrow'),
          ),
        ]),
        op('construct', idlType.any,
          [arg('callback', reference(factory.name))],
          invokeWith(atArg(1, (_receiver, method) => method.realm)),
        ),
      ],
    });
    const realm = new Realm();
    const world = new BindingWorld([
      increment,
      voidCallback,
      factory,
      callbackOrString,
      callbackOptions,
      interfaceIDL,
    ]);
    world.register(realm, (ctx) => ({ realm: ctx.realm }));
    const binding = world.getRealmBinding(realm)!;
    binding.installDefinitions();
    const CallbackProjection = Reflect.get(
      realm.global,
      interfaceIDL.name,
    ) as new() => {
      callback: unknown;
      callbackUnion: unknown;
      construct(callback: unknown): unknown;
      invoke(callback: unknown, value: number, thisArgument: object): number;
      invokeDictionary(options: { callback: unknown; }): number;
      invokeRecord(callbacks: Record<string, unknown>): number;
      invokeSequence(callbacks: unknown[]): number;
      invokeUnion(callback: unknown): number;
      nativeCallback: (value: number) => number;
      nativeCallbackUnion: (value: number) => number;
      preserveAny(value: unknown): unknown;
      report(callback: unknown): void;
      rethrow(callback: unknown): void;
    };
    const instance = new CallbackProjection();
    const expectedThis = {};
    let receivedExpectedThis = false;
    const callback = function(this: unknown, value: number) {
      receivedExpectedThis = this === expectedThis;
      return value + 1;
    };

    expect(instance.invoke(callback, 4.8, expectedThis)).toBe(5);
    expect(receivedExpectedThis).toBe(true);
    expect(instance.callback).toBe(callback);
    expect(instance.callbackUnion).toBe(callback);
    expect(instance.nativeCallback(4)).toBe(6);
    expect(instance.nativeCallbackUnion(4)).toBe(7);
    expect(instance.invokeUnion(callback)).toBe(3);
    expect(instance.invokeUnion('word')).toBe(4);
    expect(instance.invokeDictionary({ callback })).toBe(4);
    expect(instance.invokeSequence([callback, callback])).toBe(3);
    expect(instance.invokeRecord({ first: callback, second: callback }))
      .toBe(3);
    const array = [callback];
    const map = new Map([['callback', callback]]);
    expect(instance.preserveAny(array)).toBe(array);
    expect(instance.preserveAny(map)).toBe(map);

    const exception = new Error('callback failure');
    expect(() => instance.invoke(
      () => { throw exception; },
      0,
      expectedThis,
    )).toThrow(exception);
    expect(() => instance.rethrow(() => { throw exception; }))
      .toThrow(exception);
    const reportException = vi.spyOn(realm, 'reportException')
      .mockImplementation(() => {});
    expect(() => instance.report(() => { throw exception; })).not.toThrow();
    expect(reportException).toHaveBeenCalledExactlyOnceWith(exception);

    function Constructed(this: { value?: number; }, value: number) {
      this.value = value;
    }
    expect(instance.construct(Constructed)).toMatchObject({ value: 4 });
  });

  it('constructs adapted callbacks whose converted result is a primitive', () => {
    class FactoryOwnerImpl {
      construct(callback: StampedCallbackFunction, realm: WebIDLRealm): unknown {
        return CallbackFunctionStamper.get(callback).construct([4], realm);
      }
    }
    const factory = defineCallbackFunction({
      name: 'NumberFactory', returns: idlType.double,
      arguments: [arg('value', idlType.long)],
    });
    const definition = defineInterface({
      name: 'FactoryOwner', exposed: '*', implementation: impl(FactoryOwnerImpl),
      members: [
        ctor(),
        op('construct', idlType.double,
          [arg('callback', reference(factory.name))],
          invokeWith(atArg(1, (_receiver, method) => method.realm)),
        ),
      ],
    });
    const realm = new Realm();
    new BindingWorld([factory, definition]).register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Constructor = Reflect.get(realm.global, definition.name) as new() => {
      construct(callback: (value: number) => object): number;
    };
    function Build(value: number) {
      expect(new.target).toBe(Build);
      return { valueOf: () => value + 2 };
    }

    expect(new Constructor().construct(Build)).toBe(6);
  });

  it('retains callback realms and captured contexts through explicit construction', () => {
    class FactoryOwnerImpl {
      construct(callback: StampedCallbackFunction, realm: WebIDLRealm): unknown {
        return CallbackFunctionStamper.get(callback).construct([4], realm);
      }
    }
    const factory = defineCallbackFunction({
      name: 'NumberFactory', returns: idlType.double,
      arguments: [arg('value', idlType.long)],
    });
    const definition = defineInterface({
      name: 'FactoryOwner', exposed: '*', implementation: impl(FactoryOwnerImpl),
      members: [
        ctor(),
        op('construct', idlType.double,
          [arg('callback', reference(factory.name))],
          invokeWith(atArg(1, (_receiver, method) => method.realm)),
        ),
      ],
    });
    const realm = new Realm();
    const callbackRealm = new Realm();
    new BindingWorld([factory, definition]).register(realm, (ctx) => ({ realm: ctx.realm })).install(realm.global);
    const Constructor = Reflect.get(realm.global, definition.name) as new() => { construct(callback: unknown): number; };
    const owner = new Constructor();
    const prototypeReads = { count: 0 };
    Reflect.set(callbackRealm.global, 'prototypeReads', prototypeReads);
    const callback = callbackRealm.evaluate(`new Proxy(function Build(value) {
      return { valueOf: () => globalThis.fail ? Infinity : value };
    }, {
      get(target, property, receiver) {
        if (property === 'prototype') prototypeReads.count++;
        return Reflect.get(target, property, receiver);
      }
    })`, 'adapted-constructor.js');
    const firstContext = {};
    const secondContext = {};
    vi.spyOn(realm.callbacks, 'captureContext').mockReturnValueOnce(firstContext).mockReturnValueOnce(secondContext);
    const prepareScript = vi.spyOn(callbackRealm.callbacks, 'prepareToRunScript');
    const cleanScript = vi.spyOn(callbackRealm.callbacks, 'cleanUpAfterRunningScript');
    const prepareCallback = vi.spyOn(callbackRealm.callbacks, 'prepareToRunCallback');
    const cleanCallback = vi.spyOn(callbackRealm.callbacks, 'cleanUpAfterRunningCallback');

    expect(owner.construct(callback)).toBe(4);
    expect(prototypeReads.count).toBe(1);
    Reflect.set(callbackRealm.global, 'fail', true);
    expect(() => owner.construct(callback)).toThrow(callbackRealm.intrinsics.typeError);
    expect(prototypeReads.count).toBe(2);
    expect(prepareCallback.mock.calls).toEqual([[firstContext], [secondContext]]);
    expect(cleanCallback.mock.calls).toEqual(prepareCallback.mock.calls);
    expect(prepareScript).toHaveBeenCalledTimes(2);
    expect(cleanScript).toHaveBeenCalledTimes(2);

    const arrow = callbackRealm.evaluate('() => ({})', 'adapted-non-constructor.js');
    expect(() => owner.construct(arrow)).toThrow(realm.intrinsics.typeError);
    expect(prepareScript).toHaveBeenCalledTimes(2);
  });

  it('uses the construction method realm when a retained callback is not a constructor', () => {
    class FactoryOwnerImpl {
      constructor(public callback: StampedCallbackFunction) {}

      construct(realm: WebIDLRealm): unknown {
        return CallbackFunctionStamper.get(this.callback).construct([], realm);
      }
    }
    const factory = defineCallbackFunction({ name: 'Factory', returns: idlType.any, arguments: [] });
    const definition = defineInterface({
      name: 'FactoryOwner', exposed: '*', implementation: impl(FactoryOwnerImpl),
      members: [
        ctor([arg('callback', reference(factory.name))]),
        op('construct', idlType.any, [], invokeWith(atArg(0, (_receiver, method) => method.realm))),
      ],
    });
    const conversionRealm = new Realm();
    const constructionRealm = new Realm();
    const callbackRealm = new Realm();
    const world = new BindingWorld([factory, definition]);
    world.register(conversionRealm, (ctx) => ({ realm: ctx.realm })).install(conversionRealm.global);
    world.register(constructionRealm, (ctx) => ({ realm: ctx.realm })).install(constructionRealm.global);
    type FactoryOwner = { construct(): unknown; };
    const Constructor = Reflect.get(conversionRealm.global, definition.name) as {
      new(callback: unknown): FactoryOwner;
      prototype: FactoryOwner;
    };
    const OtherConstructor = Reflect.get(constructionRealm.global, definition.name) as typeof Constructor;
    const arrow = callbackRealm.evaluate('() => ({})', 'retained-non-constructor.js');
    const owner = new Constructor(arrow);
    const prepareScript = vi.spyOn(callbackRealm.callbacks, 'prepareToRunScript');

    // The callback is not converted again when another realm's method constructs it.
    // https://webidl.spec.whatwg.org/#construct-a-callback-function
    expect(() => OtherConstructor.prototype.construct.call(owner)).toThrow(constructionRealm.intrinsics.typeError);
    expect(prepareScript).not.toHaveBeenCalled();
  });
});
