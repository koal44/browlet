import { describe, expect, it, vi } from 'vitest';

import { Realm } from '../../../src/browlet/realm';
import { assembleDefinitions } from '../../../src/web-idl/adapter/assembly';
import { JavaScriptBinding } from '../../../src/web-idl/binding';
import {
  callUserObjectOperation, constructCallbackFunction,
  convertWebIDLArguments, invokeCallbackFunction, missingArgument,
} from '../../../src/web-idl/callback';
import {
  isCallbackFunctionValue, isCallbackInterfaceValue,
} from '../../../src/web-idl/callback-value';
import { convertToIDL, convertToJavaScript } from '../../../src/web-idl/conversion';
import {
  defineCallbackFunction, defineCallbackInterface, defineInterface, idlType,
  integer, nullable, promise as promiseType, reference,
} from '../../../src/web-idl/adapter/definition';
import { ImplementationRegistry } from '../../../src/web-idl/adapter/registry';
import { PlatformObjectRegistry } from '../../../src/web-idl/platform-object';
import { isPromiseValue } from '../../../src/web-idl/promise-value';

describe('Web IDL callbacks', () => {
  it('captures callback context and invokes functions in their associated realm', () => {
    const { binding, callbackRealm } = createCallbackBinding();
    const order: string[] = [];
    Reflect.set(
      callbackRealm.global,
      'convertCallback',
      (callback: unknown) => convertToIDL(
        callback,
        reference('Increment'),
        binding,
      ),
    );
    const [callback, value] = callbackRealm.evaluate(
      `(() => {
        const callback = (value) => value + 1;
        return [callback, convertCallback(callback)];
      })()`,
      'callback-function.js',
    ) as [object, unknown];
    if (!isCallbackFunctionValue(value)) {
      throw new Error('Increment did not convert to a callback value');
    }
    recordLifecycle(callbackRealm, order);

    expect(convertToJavaScript(
      value,
      reference('Increment'),
      binding,
    )).toBe(callback);
    expect(invokeCallbackFunction(
      value,
      [4],
      'rethrow',
    )).toBe(5);
    expect(order).toEqual([
      'prepare script',
      'prepare callback',
      'clean callback',
      'clean script',
    ]);
  });

  it('round-trips and invokes callback-interface objects in their associated realm', () => {
    const { binding, callbackRealm, targetRealm } = createCallbackBinding();
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

    const value = convertToIDL(
      object,
      reference('NumberHandler'),
      binding,
    );
    if (!isCallbackInterfaceValue(value)) {
      throw new Error('NumberHandler did not convert to a callback value');
    }

    expect(convertToJavaScript(
      value,
      reference('NumberHandler'),
      binding,
    )).toBe(object);
    expect(callUserObjectOperation(
      value,
      'handleEvent',
      [2],
    )).toBe(3);
    expect(prepareCallback).toHaveBeenCalledExactlyOnceWith(callbackContext);
    expect(cleanUpCallback).toHaveBeenCalledExactlyOnceWith(callbackContext);
    expect(prepareTargetCallback).not.toHaveBeenCalled();
    expect(() => convertToIDL(
      1,
      reference('NumberHandler'),
      binding,
    )).toThrow(targetRealm.intrinsics.typeError);
  });

  it('calls callback-interface objects and callable objects with distinct receivers', () => {
    const { binding } = createCallbackBinding();
    const object = {
      receiver: undefined as unknown,
      handleEvent(this: { receiver: unknown; }, value: number) {
        this.receiver = this;
        return value + 1;
      },
    };
    const objectValue = convertToIDL(
      object,
      reference('NumberHandler'),
      binding,
    );
    if (!isCallbackInterfaceValue(objectValue)) {
      throw new Error('NumberHandler did not convert to a callback value');
    }

    expect(callUserObjectOperation(
      objectValue,
      'handleEvent',
      [2],
      {},
    )).toBe(3);
    expect(object.receiver).toBe(object);

    const thisArgument = {};
    let receivedExpectedThis = false;
    const callback = function(this: unknown, value: number) {
      receivedExpectedThis = this === thisArgument;
      return value + 2;
    };
    const callbackValue = convertToIDL(
      callback,
      reference('NumberHandler'),
      binding,
    );
    if (!isCallbackInterfaceValue(callbackValue)) {
      throw new Error('Callable NumberHandler did not convert');
    }
    expect(callUserObjectOperation(
      callbackValue,
      'handleEvent',
      [2],
      thisArgument,
    )).toBe(4);
    expect(receivedExpectedThis).toBe(true);
  });

  it('truncates trailing missing callback arguments', () => {
    const { binding } = createCallbackBinding();
    const definitions = [
      { name: 'first', type: idlType.long },
      { name: 'second', type: idlType.long },
      { name: 'third', type: idlType.long },
    ];

    expect(convertWebIDLArguments(
      [missingArgument, 2, missingArgument],
      definitions,
      binding,
    )).toEqual([undefined, 2]);
    expect(convertWebIDLArguments(
      [1, missingArgument, missingArgument],
      definitions,
      binding,
    )).toEqual([1]);
  });

  it('reports or rethrows callback-function exceptions after cleanup', () => {
    const { binding, callbackRealm } = createCallbackBinding();
    const exception = new Error('callback failed');
    Reflect.set(callbackRealm.global, 'callbackFailure', exception);
    const callback = callbackRealm.evaluate(
      '() => { throw callbackFailure; }',
      'callback-exception.js',
    );
    const value = convertToIDL(
      callback,
      reference('Notification'),
      binding,
    );
    if (!isCallbackFunctionValue(value)) {
      throw new Error('Notification did not convert to a callback value');
    }
    const report = vi.spyOn(callbackRealm.callbacks, 'reportException')
      .mockImplementation(() => {});

    expect(invokeCallbackFunction(
      value,
      [],
      'report',
    )).toBeUndefined();
    expect(report).toHaveBeenCalledWith(exception);
    expect(() => invokeCallbackFunction(
      value,
      [],
      'rethrow',
    )).toThrow(exception);
  });

  it('returns rejected promises for promise callback exceptions', async () => {
    const { binding, callbackRealm } = createCallbackBinding();
    const exception = new Error('promise callback failed');
    Reflect.set(callbackRealm.global, 'promiseCallbackFailure', exception);
    Reflect.set(
      callbackRealm.global,
      'convertPromiseCallback',
      (callback: unknown, name: string) => convertToIDL(
        callback,
        reference(name),
        binding,
      ),
    );
    const functionValue = callbackRealm.evaluate(
      `convertPromiseCallback(
        () => { throw promiseCallbackFailure; },
        "PromiseIncrement"
      )`,
      'promise-callback-function.js',
    );
    if (!isCallbackFunctionValue(functionValue)) {
      throw new Error('PromiseIncrement did not convert to a callback value');
    }
    const interfaceValue = callbackRealm.evaluate(
      `convertPromiseCallback({
        handleEvent() { throw promiseCallbackFailure; }
      }, "PromiseHandler")`,
      'promise-callback-interface.js',
    );
    if (!isCallbackInterfaceValue(interfaceValue)) {
      throw new Error('PromiseHandler did not convert to a callback value');
    }

    const functionResult = invokeCallbackFunction(
      functionValue,
      [],
      undefined,
    );
    const interfaceResult = callUserObjectOperation(
      interfaceValue,
      'handleEvent',
      [],
    );
    if (!isPromiseValue(functionResult) || !isPromiseValue(interfaceResult)) {
      throw new Error('Promise callback did not return an IDL promise');
    }
    const functionPromise = convertToJavaScript(
      functionResult,
      promiseType(idlType.long),
      binding,
    ) as Promise<unknown>;
    const interfacePromise = convertToJavaScript(
      interfaceResult,
      promiseType(idlType.long),
      binding,
    ) as Promise<unknown>;

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
    const constructorValue = convertToIDL(
      constructor,
      reference('Builder'),
      binding,
    );
    if (!isCallbackFunctionValue(constructorValue)) {
      throw new Error('Builder did not convert to a callback value');
    }

    expect(constructCallbackFunction(
      constructorValue,
      [7],
    )).toMatchObject({ value: 7 });
    expect(prototypeReads.count).toBe(1);
  });

  it('rejects non-constructor callbacks in the current realm', () => {
    const { binding, callbackRealm, targetRealm } = createCallbackBinding();
    const arrow = callbackRealm.evaluate(
      '() => ({})',
      'callback-arrow.js',
    ) as object;
    const arrowValue = convertToIDL(
      arrow,
      reference('Builder'),
      binding,
    );
    if (!isCallbackFunctionValue(arrowValue)) {
      throw new Error('Arrow Builder did not convert');
    }
    expect(() => constructCallbackFunction(
      arrowValue,
      [7],
    )).toThrow(targetRealm.intrinsics.typeError);
  });

  it('applies LegacyTreatNonObjectAsNull only during nullable attribute assignment', () => {
    const { binding, targetRealm } = createCallbackBinding();
    const type = nullable(reference('LegacyHandler'));

    expect(convertToIDL(1, type, binding, {
      attributeAssignment: true,
    })).toBeNull();
    const object = {};
    const value = convertToIDL(object, type, binding, {
      attributeAssignment: true,
    });
    expect(convertToJavaScript(value, type, binding)).toBe(object);
    expect(() => convertToIDL(object, type, binding))
      .toThrow(targetRealm.intrinsics.typeError);
  });

  it('applies legacy callback conversion at the attribute binding boundary', () => {
    const callback = defineCallbackFunction({
      arguments: [],
      extendedAttributes: [{
        kind: 'no-arguments',
        name: 'LegacyTreatNonObjectAsNull',
      }],
      name: 'LegacyAttributeHandler',
      returns: idlType.undefined,
    });
    const attribute = {
      kind: 'attribute' as const,
      name: 'handler',
      type: nullable(reference('LegacyAttributeHandler')),
    };
    const interface_ = defineInterface({
      members: [attribute],
      name: 'CallbackOwner',
    });
    const realm = new Realm();
    const implementations = new ImplementationRegistry();
    let stored: unknown = null;
    implementations.setAttributeSteps(attribute, {
      get: () => stored,
      set: (value) => { stored = value; },
    });
    const binding = new JavaScriptBinding(
      assembleDefinitions([callback, interface_]),
      realm,
      new PlatformObjectRegistry(),
      implementations,
    );
    const object = binding.createPlatformObject('CallbackOwner');

    Reflect.set(object, 'handler', 1);
    expect(Reflect.get(object, 'handler')).toBeNull();

    const handler = {};
    Reflect.set(object, 'handler', handler);
    expect(Reflect.get(object, 'handler')).toBe(handler);
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
  binding: JavaScriptBinding;
  callbackRealm: Realm;
  targetRealm: Realm;
} {
  const callbackRealm = new Realm();
  const targetRealm = new Realm();
  const definitions = assembleDefinitions([
    defineCallbackFunction({
      arguments: [{ name: 'value', type: idlType.long }],
      name: 'Increment',
      returns: idlType.long,
    }),
    defineCallbackFunction({
      arguments: [],
      name: 'Notification',
      returns: idlType.undefined,
    }),
    defineCallbackFunction({
      arguments: [],
      name: 'PromiseIncrement',
      returns: promiseType(idlType.long),
    }),
    defineCallbackFunction({
      arguments: [{ name: 'value', type: idlType.long }],
      name: 'Builder',
      returns: idlType.object,
    }),
    defineCallbackFunction({
      arguments: [],
      extendedAttributes: [{
        kind: 'no-arguments',
        name: 'LegacyTreatNonObjectAsNull',
      }],
      name: 'LegacyHandler',
      returns: idlType.undefined,
    }),
    defineCallbackInterface({
      members: [{
        arguments: [],
        kind: 'operation',
        name: 'handleEvent',
        returns: promiseType(idlType.long),
      }],
      name: 'PromiseHandler',
    }),
    defineCallbackInterface({
      members: [{
        arguments: [{ name: 'value', type: idlType.long }],
        kind: 'operation',
        name: 'handleEvent',
        returns: idlType.long,
      }],
      name: 'NumberHandler',
    }),
    defineCallbackInterface({
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
      name: 'ConstantHandler',
    }),
  ]);
  return {
    binding: new JavaScriptBinding(
      definitions,
      targetRealm,
      new PlatformObjectRegistry(),
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
