import { describe, expect, it, vi } from 'vitest';

import { TestRealm as Realm } from './test-realm';
import { DefinitionAssembly } from '../../src/web-idl/assembly';
import { AssembledCallbackFunction } from '../../src/web-idl/assembled';
import { BindingWorld } from '../../src/web-idl/binding/world';
import { RealmBinding } from '../../src/web-idl/binding/realm';
import {
  missingArgument, CallbackFunctionCarrier, CallbackInterfaceCarrier, createLegacyCallbackConverter,
} from '../../src/web-idl/constructs/callback';
import { jsToIDL, idlToJS } from '../../src/web-idl/conversion';
import {
  defineCallbackFunction, defineCallbackInterface, defineInterface, defineTypedef, idlType,
  integer, nullable, promise as promiseType, reference, sequence, union,
} from '../../src/web-idl/core/index';
import { PromiseCarrier } from '../../src/web-idl/constructs/promise';

describe('Web IDL callbacks', () => {
  it('captures callback context and invokes functions in their associated realm', () => {
    const { binding, callbackRealm } = createCallbackBinding();
    const ctx = { binding: binding, realm: binding.realm };
    const order: string[] = [];
    Reflect.set(
      callbackRealm.global,
      'convertCallback',
      (callback: unknown) => jsToIDL(callback, ctx.binding.getConversionContext(reference('Increment'), ctx.realm)),
    );
    const [callback, value] = callbackRealm.evaluate(
      `(() => {
        const callback = (value) => value + 1;
        return [callback, convertCallback(callback)];
      })()`,
      'callback-function.js',
    ) as [object, unknown];
    if (!CallbackFunctionCarrier.is(value)) {
      throw new Error('Increment did not convert to a callback value');
    }
    recordLifecycle(callbackRealm, order);

    expect(idlToJS(value, ctx.binding.getConversionContext(reference('Increment'), ctx.realm))).toBe(callback);
    expect(value.invoke([4],
      'rethrow',
    )).toBe(5);
    expect(order).toEqual([
      'prepare script',
      'prepare callback',
      'clean callback',
      'clean script',
    ]);
  });

  it('reuses callback conversion without sharing allocation realms or captured contexts', () => {
    const targetRealm = new Realm();
    const definition = defineCallbackFunction({
      name: 'SampleValues', returns: idlType.double,
      arguments: [
        { name: 'values', type: sequence(idlType.long) },
        { name: 'extra', type: idlType.long, variadic: true },
      ],
    });
    const binding = new RealmBinding(
      new DefinitionAssembly([definition]), targetRealm, new BindingWorld([]), (ctx) => ({ realm: ctx.realm }),
    );
    const capture = vi.spyOn(targetRealm.callbacks, 'captureContext');
    for (const realm of [new Realm(), new Realm()]) {
      const callback = realm.evaluate(`(values, ...extra) => {
        if (!(values instanceof Array)) throw new Error('Wrong argument realm');
        return globalThis.fail ? Infinity : values[0] + extra.length;
      }`, 'prepared-callback.js');
      const firstContext = {};
      const secondContext = {};
      capture.mockReturnValueOnce(firstContext).mockReturnValueOnce(secondContext);
      const values = [0, 1].map(() => jsToIDL(callback, binding.getConversionContext(reference(definition.name))));
      const prepare = vi.spyOn(realm.callbacks, 'prepareToRunCallback');
      const clean = vi.spyOn(realm.callbacks, 'cleanUpAfterRunningCallback');
      for (const value of values) {
        if (!CallbackFunctionCarrier.is(value)) throw new Error('Expected a converted callback');
        expect(value.invoke([[4], 1, 2], 'rethrow')).toBe(6);
      }
      expect(prepare.mock.calls).toEqual([[firstContext], [secondContext]]);
      Reflect.set(realm.global, 'fail', true);
      const value = values[0]!;
      if (!CallbackFunctionCarrier.is(value)) throw new Error('Expected a converted callback');
      expect(() => value.invoke([[4]], 'rethrow')).toThrow(realm.intrinsics.typeError);
      expect(clean.mock.calls).toEqual([[firstContext], [secondContext], [firstContext]]);
    }
  });

  it('round-trips and invokes callback-interface objects in their associated realm', () => {
    const { binding, callbackRealm, targetRealm } = createCallbackBinding();
    const ctx = { binding: binding, realm: binding.realm };
    const callbackContext = {};
    vi.spyOn(targetRealm.callbacks, 'captureContext')
      .mockReturnValue(callbackContext);
    const prepareCallback = vi.spyOn(
      callbackRealm.callbacks,
      'prepareToRunCallback',
    ).mockImplementation(() => {});
    const cleanUpCallback = vi.spyOn(
      callbackRealm.callbacks,
      'cleanUpAfterRunningCallback',
    ).mockImplementation(() => {});
    const prepareTargetCallback = vi.spyOn(
      targetRealm.callbacks,
      'prepareToRunCallback',
    ).mockImplementation(() => {});
    const object = callbackRealm.evaluate(
      '({ handleEvent(value) { return value + 1; } })',
      'callback-interface.js',
    ) as object;

    const value = jsToIDL(object, ctx.binding.getConversionContext(reference('NumberHandler'), ctx.realm));
    if (!CallbackInterfaceCarrier.is(value)) {
      throw new Error('NumberHandler did not convert to a callback value');
    }

    expect(idlToJS(value, ctx.binding.getConversionContext(reference('NumberHandler'), ctx.realm))).toBe(object);
    expect(value.callUserObjectOperation('handleEvent', [2])).toBe(3);
    expect(prepareCallback).toHaveBeenCalledExactlyOnceWith(callbackContext);
    expect(cleanUpCallback).toHaveBeenCalledExactlyOnceWith(callbackContext);
    expect(prepareTargetCallback).not.toHaveBeenCalled();
    expect(() => jsToIDL(1, ctx.binding.getConversionContext(reference('NumberHandler'), ctx.realm))).toThrow(targetRealm.intrinsics.typeError);
  });

  it('retains each callback\'s identity and realm when reusing union candidates', () => {
    const { binding, targetRealm, callbackRealm } = createCallbackBinding();
    const ctx = { binding: binding, realm: binding.realm };
    const functionType = union(reference('Increment'), idlType.DOMString);
    const interfaceType = union(reference('NumberHandler'), idlType.DOMString);

    for (const realm of [targetRealm, callbackRealm]) {
      const callback = realm.evaluate('(value) => value + 1', 'union-callback.js');
      const object = realm.evaluate('({ handleEvent(value) { return value + 2; } })', 'union-callback-interface.js');
      const functionRecord = jsToIDL(callback, ctx.binding.getConversionContext(functionType, ctx.realm));
      const interfaceRecord = jsToIDL(object, ctx.binding.getConversionContext(interfaceType, ctx.realm));
      if (!CallbackFunctionCarrier.is(functionRecord) || !CallbackInterfaceCarrier.is(interfaceRecord)) {
        throw new Error('Union did not select its callback member');
      }

      expect(functionRecord.realm).toBe(realm);
      expect(interfaceRecord.realm).toBe(realm);
      expect(idlToJS(functionRecord, ctx.binding.getConversionContext(functionType, ctx.realm))).toBe(callback);
      expect(idlToJS(interfaceRecord, ctx.binding.getConversionContext(interfaceType, ctx.realm))).toBe(object);
      expect(functionRecord.invoke([4], 'rethrow')).toBe(5);
      expect(interfaceRecord.callUserObjectOperation('handleEvent', [4])).toBe(6);
    }
  });

  it('reads the current callback-interface method on every invocation', () => {
    const { binding } = createCallbackBinding();
    const object = {
      handleEvent(value: number) { return value + 1; },
    };
    const value = jsToIDL(object, binding.getConversionContext(reference('NumberHandler')));
    if (!CallbackInterfaceCarrier.is(value)) {
      throw new Error('NumberHandler did not convert to a callback value');
    }

    expect(value.callUserObjectOperation('handleEvent', [2])).toBe(3);
    object.handleEvent = (argument) => argument + 10;
    expect(value.callUserObjectOperation('handleEvent', [2])).toBe(12);
  });

  it('calls callback-interface objects and callable objects with distinct receivers', () => {
    const { binding } = createCallbackBinding();
    const ctx = { binding: binding, realm: binding.realm };
    const object = {
      receiver: undefined as unknown,
      handleEvent(this: { receiver: unknown; }, value: number) {
        this.receiver = this;
        return value + 1;
      },
    };
    const objectValue = jsToIDL(object, ctx.binding.getConversionContext(reference('NumberHandler'), ctx.realm));
    if (!CallbackInterfaceCarrier.is(objectValue)) {
      throw new Error('NumberHandler did not convert to a callback value');
    }

    expect(objectValue.callUserObjectOperation('handleEvent', [2], {})).toBe(3);
    expect(object.receiver).toBe(object);

    const thisArgument = {};
    let receivedExpectedThis = false;
    const callback = function(this: unknown, value: number) {
      receivedExpectedThis = this === thisArgument;
      return value + 2;
    };
    const cbCarrier = jsToIDL(callback, ctx.binding.getConversionContext(reference('NumberHandler'), ctx.realm));
    if (!CallbackInterfaceCarrier.is(cbCarrier)) {
      throw new Error('Callable NumberHandler did not convert');
    }
    expect(cbCarrier.callUserObjectOperation('handleEvent', [2], thisArgument)).toBe(4);
    expect(receivedExpectedThis).toBe(true);
  });

  it('truncates trailing missing callback arguments', () => {
    const { binding } = createCallbackBinding();
    const assembled = new AssembledCallbackFunction(defineCallbackFunction({
      name: 'MissingArguments', returns: idlType.undefined,
      arguments: [
        { name: 'first', type: idlType.long },
        { name: 'second', type: idlType.long },
        { name: 'third', type: idlType.long },
      ],
    }));

    const invoker = binding.getCallbackInvoker(assembled, binding.realm);
    expect(invoker.idlToJSArguments([missingArgument, 2, missingArgument])).toEqual([undefined, 2]);
    expect(invoker.idlToJSArguments([1, missingArgument, missingArgument])).toEqual([1]);
  });

  it('reports or rethrows callback-function exceptions after cleanup', () => {
    const { binding, callbackRealm } = createCallbackBinding();
    const ctx = { binding: binding, realm: binding.realm };
    const exception = new Error('callback failed');
    Reflect.set(callbackRealm.global, 'callbackFailure', exception);
    const callback = callbackRealm.evaluate(
      '() => { throw callbackFailure; }',
      'callback-exception.js',
    );
    const value = jsToIDL(callback, ctx.binding.getConversionContext(reference('Notification'), ctx.realm));
    if (!CallbackFunctionCarrier.is(value)) {
      throw new Error('Notification did not convert to a callback value');
    }
    const report = vi.spyOn(callbackRealm, 'reportException')
      .mockImplementation(() => {});

    expect(value.invoke([],
      'report',
    )).toBeUndefined();
    expect(report).toHaveBeenCalledWith(exception);
    expect(() => value.invoke([],
      'rethrow',
    )).toThrow(exception);
  });

  it('returns rejected promises for promise callback exceptions', async () => {
    const { binding, callbackRealm } = createCallbackBinding();
    const ctx = { binding: binding, realm: binding.realm };
    const exception = new Error('promise callback failed');
    Reflect.set(callbackRealm.global, 'promiseCallbackFailure', exception);
    Reflect.set(
      callbackRealm.global,
      'convertPromiseCallback',
      (callback: unknown, name: string) => jsToIDL(callback, ctx.binding.getConversionContext(reference(name), ctx.realm)),
    );
    const functionRecord = callbackRealm.evaluate(
      `convertPromiseCallback(
        () => { throw promiseCallbackFailure; },
        "PromiseIncrement"
      )`,
      'promise-callback-function.js',
    );
    if (!CallbackFunctionCarrier.is(functionRecord)) {
      throw new Error('PromiseIncrement did not convert to a callback value');
    }
    const interfaceRecord = callbackRealm.evaluate(
      `convertPromiseCallback({
        handleEvent() { throw promiseCallbackFailure; }
      }, "PromiseHandler")`,
      'promise-callback-interface.js',
    );
    if (!CallbackInterfaceCarrier.is(interfaceRecord)) {
      throw new Error('PromiseHandler did not convert to a callback value');
    }

    const functionResult = functionRecord.invoke([],
      undefined,
    );
    const interfaceResult = interfaceRecord.callUserObjectOperation('handleEvent', []);
    if (!PromiseCarrier.is(functionResult) || !PromiseCarrier.is(interfaceResult)) {
      throw new Error('Promise callback did not return an IDL promise');
    }
    const functionPromise = idlToJS(functionResult, ctx.binding.getConversionContext(promiseType(idlType.long), ctx.realm)) as Promise<unknown>;
    const interfacePromise = idlToJS(interfaceResult, ctx.binding.getConversionContext(promiseType(idlType.long), ctx.realm)) as Promise<unknown>;

    expect(functionPromise).toBeInstanceOf(
      callbackRealm.intrinsics.promise.constructor,
    );
    expect(interfacePromise).toBeInstanceOf(
      callbackRealm.intrinsics.promise.constructor,
    );
    const order: string[] = [];
    void functionPromise.catch(() => { order.push('rejected'); });
    callbackRealm.queueMicrotask(() => { order.push('queued'); });
    await expect(functionPromise).rejects.toBe(exception);
    await expect(interfacePromise).rejects.toBe(exception);
    expect(order).toEqual(['queued', 'rejected']);
  });

  it('constructs constructor callbacks without observing the constructor check', () => {
    const { binding, callbackRealm } = createCallbackBinding();
    const ctx = { binding: binding, realm: binding.realm };
    const prototypeReads = { count: 0 };
    Reflect.set(callbackRealm.global, 'prototypeReads', prototypeReads);
    const constructor = callbackRealm.evaluate(
      `new Proxy(
        function Build(value) { this.value = value; },
        {
          get(target, property, receiver) {
            if (property === "prototype") prototypeReads.count++;
            return Reflect.get(target, property, receiver);
          }
        }
      )`,
      'callback-constructor.js',
    ) as object;
    const constructorCarrier = jsToIDL(constructor, ctx.binding.getConversionContext(reference('Builder'), ctx.realm));
    if (!CallbackFunctionCarrier.is(constructorCarrier)) {
      throw new Error('Builder did not convert to a callback value');
    }

    expect(constructorCarrier.construct([7],
      ctx.realm,
    )).toMatchObject({ value: 7 });
    expect(prototypeReads.count).toBe(1);
  });

  it('rejects non-constructor callbacks in the current realm', () => {
    const { binding, callbackRealm, targetRealm } = createCallbackBinding();
    const ctx = { binding: binding, realm: binding.realm };
    const arrow = callbackRealm.evaluate(
      '() => ({})',
      'callback-arrow.js',
    ) as object;
    const arrowCarrier = jsToIDL(arrow, ctx.binding.getConversionContext(reference('Builder'), ctx.realm));
    if (!CallbackFunctionCarrier.is(arrowCarrier)) {
      throw new Error('Arrow Builder did not convert');
    }
    expect(() => arrowCarrier.construct([7],
      targetRealm,
    )).toThrow(targetRealm.intrinsics.typeError);
  });

  it('applies LegacyTreatNonObjectAsNull only during nullable attribute assignment', () => {
    const { binding, targetRealm } = createCallbackBinding();
    const ctx = { binding: binding, realm: binding.realm };
    const type = nullable(reference('LegacyHandler'));
    const context = ctx.binding.getConversionContext(type, ctx.realm);
    const convert = createLegacyCallbackConverter(context, context.legacyCallback!);

    expect(convert(1)).toBeNull();
    const object = {};
    const value = convert(object);
    expect(idlToJS(value, context)).toBe(object);
    expect(() => jsToIDL(object, context))
      .toThrow(targetRealm.intrinsics.typeError);
  });

  it.each(['direct', 'alias'] as const)('keeps legacy %s attribute conversion separate from a shared ordinary converter', (mode) => {
    class CallbackOwnerImpl {}
    const callback = defineCallbackFunction({
      name: 'LegacyAttributeHandler',
      extendedAttributes: [{
        kind: 'no-arguments',
        name: 'LegacyTreatNonObjectAsNull',
      }],
      returns: idlType.undefined,
      arguments: [],
    });
    const type = mode === 'direct' ? nullable(reference('LegacyAttributeHandler')) : reference('NullableHandler');
    const attribute = {
      kind: 'attribute' as const,
      name: 'handler',
      type,
    };
    const definition = defineInterface({
      name: 'CallbackOwner',
      members: [attribute],
    });
    const realm = new Realm();

    let stored: unknown = null;

    const binding = new RealmBinding(
      new DefinitionAssembly([
        callback, definition,
        defineTypedef({ name: 'HandlerAlias', type: reference('LegacyAttributeHandler') }),
        defineTypedef({ name: 'NullableHandler', type: nullable(reference('HandlerAlias')) }),
      ]),
      realm,
      new BindingWorld([]),
      (ctx) => ({ realm: ctx.realm }),
    );
    binding.getImplementationBinding(binding.resolveInterface(definition.name)).createImplementation = () => new CallbackOwnerImpl();
    binding.getImplementationBinding(binding.resolveInterface(definition.name)).getOrCreateMemberBinding(attribute).attributeSteps = {
      get: () => stored,
      set: (_receiver, value) => { stored = value; },
    };
    const context = binding.getConversionContext(type);
    const convert = context.getJSToIDLConverter();
    const object = binding.createPlatformRecord(binding.resolveInterface('CallbackOwner')).platformObject!;

    Reflect.set(object, 'handler', 1);
    expect(Reflect.get(object, 'handler')).toBeNull();
    expect(() => convert(1)).toThrow(realm.intrinsics.typeError);

    const handler = {};
    Reflect.set(object, 'handler', handler);
    expect(Reflect.get(object, 'handler')).toBe(handler);
    expect(() => convert(handler)).toThrow(realm.intrinsics.typeError);
    expect(() => jsToIDL(handler, context)).toThrow(realm.intrinsics.typeError);
    expect(binding.getConversionContext(type)).toBe(context);
    expect(context.getJSToIDLConverter()).toBe(convert);
  });

  it('installs callback-interface constants on a legacy initial object', () => {
    const { binding, targetRealm } = createCallbackBinding();
    const installed = binding.install();
    const Handler = installed.get('ConstantHandler');
    if (!Handler) throw new Error('ConstantHandler was not installed');

    expect(typeof Handler).toBe('function');
    expect(Handler).toBeInstanceOf(targetRealm.intrinsics.function);
    expect(Reflect.getPrototypeOf(Handler))
      .toBe(targetRealm.intrinsics.functionPrototype);
    expect(Reflect.get(targetRealm.global, 'ConstantHandler')).toBe(Handler);
    expect(Reflect.getOwnPropertyDescriptor(
      targetRealm.global,
      'ConstantHandler',
    )).toEqual({
      configurable: true,
      enumerable: false,
      value: Handler,
      writable: true,
    });
    expect(Reflect.get(Handler, 'READY')).toBe(7);
    expect(Reflect.getOwnPropertyDescriptor(Handler, 'READY')).toEqual({
      configurable: false,
      enumerable: true,
      value: 7,
      writable: false,
    });
    expect(Reflect.getOwnPropertyDescriptor(Handler, 'name')).toEqual({
      configurable: true,
      enumerable: false,
      value: 'ConstantHandler',
      writable: false,
    });
    expect(Reflect.getOwnPropertyDescriptor(Handler, 'length')).toEqual({
      configurable: true,
      enumerable: false,
      value: 0,
      writable: false,
    });
    expect(Object.hasOwn(Handler, 'prototype')).toBe(false);
    expect(() => {
      Reflect.apply(Handler as CallableFunction, undefined, []);
    })
      .toThrow(targetRealm.intrinsics.typeError);
    expect(() => targetRealm.evaluate(
      'new ConstantHandler()',
      'legacy-callback-interface-object.js',
    )).toThrow(targetRealm.intrinsics.typeError);
    expect(targetRealm.evaluate(
      '5 instanceof ConstantHandler',
      'legacy-callback-interface-instanceof-primitive.js',
    )).toBe(false);
    expect(() => targetRealm.evaluate(
      '({}) instanceof ConstantHandler',
      'legacy-callback-interface-instanceof-object.js',
    )).toThrow(targetRealm.intrinsics.typeError);
  });
});

function createCallbackBinding(): {
  binding: RealmBinding;
  callbackRealm: Realm;
  targetRealm: Realm;
} {
  const callbackRealm = new Realm();
  const targetRealm = new Realm();
  const assembly = new DefinitionAssembly([
    defineCallbackFunction({
      name: 'Increment',
      returns: idlType.long,
      arguments: [{ name: 'value', type: idlType.long }],
    }),
    defineCallbackFunction({
      name: 'Notification',
      returns: idlType.undefined,
      arguments: [],
    }),
    defineCallbackFunction({
      name: 'PromiseIncrement',
      returns: promiseType(idlType.long),
      arguments: [],
    }),
    defineCallbackFunction({
      name: 'Builder',
      returns: idlType.object,
      arguments: [{ name: 'value', type: idlType.long }],
    }),
    defineCallbackFunction({
      name: 'LegacyHandler',
      extendedAttributes: [{
        kind: 'no-arguments',
        name: 'LegacyTreatNonObjectAsNull',
      }],
      returns: idlType.undefined,
      arguments: [],
    }),
    defineCallbackInterface({
      name: 'PromiseHandler',
      members: [{
        arguments: [],
        kind: 'operation',
        name: 'handleEvent',
        returns: promiseType(idlType.long),
      }],
    }),
    defineCallbackInterface({
      name: 'NumberHandler',
      members: [{
        arguments: [{ name: 'value', type: idlType.long }],
        kind: 'operation',
        name: 'handleEvent',
        returns: idlType.long,
      }],
    }),
    defineCallbackInterface({
      name: 'ConstantHandler',
      exposed: ['Window'],
      members: [
        {
          kind: 'constant',
          name: 'READY',
          type: idlType.long,
          value: integer(7),
        },
        {
          arguments: [],
          kind: 'operation',
          name: 'handleEvent',
          returns: idlType.undefined,
        },
      ],
    }),
  ]);
  return {
    binding: new RealmBinding(
      assembly,
      targetRealm,
      new BindingWorld([]),
      (ctx) => ({ realm: ctx.realm }),
    ),
    callbackRealm,
    targetRealm,
  };
}

function recordLifecycle(realm: Realm, order: string[]): void {
  vi.spyOn(realm.callbacks, 'prepareToRunScript')
    .mockImplementation(() => { order.push('prepare script'); });
  vi.spyOn(realm.callbacks, 'prepareToRunCallback')
    .mockImplementation(() => { order.push('prepare callback'); });
  vi.spyOn(realm.callbacks, 'cleanUpAfterRunningCallback')
    .mockImplementation(() => { order.push('clean callback'); });
  vi.spyOn(realm.callbacks, 'cleanUpAfterRunningScript')
    .mockImplementation(() => { order.push('clean script'); });
}
