import {
  constants, createContext, runInContext, type Context,
} from 'node:vm';
import { isObject } from './abstract-operations';
import { nodeRuntime } from './node-runtime';
import type {
  JavaScriptBufferViewName, JavaScriptFunction, JavaScriptIntrinsics,
  JavaScriptRealm, JavaScriptRuntime, RealmFunctionOptions, RealmFunctionSteps,
} from './realm';

/*
 * Node's concrete JavaScript Realm backend. Higher layers add Web IDL and HTML
 * policy by subclassing this one runtime identity rather than wrapping it.
 */
export class NodeRealm implements JavaScriptRealm {
  readonly intrinsics: JavaScriptIntrinsics;
  readonly runtime: JavaScriptRuntime = nodeRuntime;
  readonly #callableFunctionFactory: RealmFunctionFactory;
  readonly #context: Context;
  readonly #constructibleFunctionFactory: RealmFunctionFactory;
  #globalObject: object;
  #globalThis: object;
  readonly #hostGlobal: RealmGlobal;

  constructor() {
    this.#context = createContext(constants.DONT_CONTEXTIFY);
    this.#hostGlobal = runInContext('this', this.#context) as RealmGlobal;
    this.#globalObject = this.#hostGlobal;
    this.#globalThis = this.#hostGlobal;

    const Function_ = Reflect.get(
      this.#hostGlobal,
      'Function',
    ) as FunctionConstructor;
    const ArrayBuffer_ = Reflect.get(
      this.#hostGlobal,
      'ArrayBuffer',
    ) as ArrayBufferConstructor;
    const Boolean_ = Reflect.get(
      this.#hostGlobal,
      'Boolean',
    ) as BooleanConstructor;
    const Date_ = Reflect.get(this.#hostGlobal, 'Date') as DateConstructor;
    const Error_ = Reflect.get(this.#hostGlobal, 'Error') as ErrorConstructor;
    const errorStack = Reflect.getOwnPropertyDescriptor(
      Reflect.construct(Error_, []),
      'stack',
    )?.get;
    const EvalError_ = Reflect.get(
      this.#hostGlobal,
      'EvalError',
    ) as EvalErrorConstructor;
    const Array_ = Reflect.get(this.#hostGlobal, 'Array') as ArrayConstructor;
    const Object_ = Reflect.get(this.#hostGlobal, 'Object') as ObjectConstructor;
    const Promise_ = Reflect.get(
      this.#hostGlobal,
      'Promise',
    ) as PromiseConstructor;
    const ReferenceError_ = Reflect.get(
      this.#hostGlobal,
      'ReferenceError',
    ) as ReferenceErrorConstructor;
    const RegExp_ = Reflect.get(
      this.#hostGlobal,
      'RegExp',
    ) as RegExpConstructor;
    const Map_ = Reflect.get(this.#hostGlobal, 'Map') as MapConstructor;
    const Set_ = Reflect.get(this.#hostGlobal, 'Set') as SetConstructor;
    const SyntaxError_ = Reflect.get(
      this.#hostGlobal,
      'SyntaxError',
    ) as SyntaxErrorConstructor;
    const URIError_ = Reflect.get(
      this.#hostGlobal,
      'URIError',
    ) as URIErrorConstructor;
    const arrayPrototype = Array_.prototype;
    const arrayValues = Reflect.get(
      arrayPrototype,
      'values',
    ) as JavaScriptIntrinsics['iteration']['arrayValues'];
    const arrayIterator = Reflect.apply(
      arrayValues,
      Reflect.construct(Array_, []),
      [],
    ) as object;
    const arrayIteratorPrototype = Reflect.getPrototypeOf(arrayIterator);
    const iteratorPrototype = arrayIteratorPrototype &&
      Reflect.getPrototypeOf(arrayIteratorPrototype);
    if (!iteratorPrototype) {
      throw new Error('Could not obtain the realm Iterator prototype');
    }
    const asyncIterator = runInContext(
      '(async function* () {})()',
      this.#context,
    ) as object;
    const asyncGeneratorFunctionPrototype = Reflect.getPrototypeOf(
      asyncIterator,
    );
    const asyncGeneratorPrototype = asyncGeneratorFunctionPrototype &&
      Reflect.getPrototypeOf(asyncGeneratorFunctionPrototype);
    const asyncIteratorPrototype = asyncGeneratorPrototype &&
      Reflect.getPrototypeOf(asyncGeneratorPrototype);
    if (!asyncIteratorPrototype) {
      throw new Error('Could not obtain the realm AsyncIterator prototype');
    }
    const mapIteratorPrototype = Reflect.getPrototypeOf(Reflect.apply(
      Reflect.get(Map_.prototype, 'entries') as CallableFunction,
      Reflect.construct(Map_, []),
      [],
    ) as object);
    const setIteratorPrototype = Reflect.getPrototypeOf(Reflect.apply(
      Reflect.get(Set_.prototype, 'values') as CallableFunction,
      Reflect.construct(Set_, []),
      [],
    ) as object);
    if (!mapIteratorPrototype || !setIteratorPrototype) {
      throw new Error('Could not obtain the realm collection iterator prototypes');
    }

    this.intrinsics = {
      array: Array_,
      bigInt: Reflect.get(this.#hostGlobal, 'BigInt') as BigIntConstructor,
      boolean: Boolean_,
      bufferSource: {
        arrayBuffer: ArrayBuffer_,
        arrayBufferTransfer: Reflect.get(
          ArrayBuffer_.prototype,
          'transfer',
        ) as JavaScriptIntrinsics['bufferSource']['arrayBufferTransfer'],
        cloneSharedArrayBuffer: (buffer) => structuredClone(buffer),
        sharedArrayBuffer: Reflect.get(
          this.#hostGlobal,
          'SharedArrayBuffer',
        ) as SharedArrayBufferConstructor | undefined,
        views: Object.fromEntries(bufferViewNames.flatMap((name) => {
          const constructor: unknown = Reflect.get(this.#hostGlobal, name);
          return typeof constructor === 'function'
            ? [[name, constructor]]
            : [];
        })),
      },
      date: Date_,
      error: Error_,
      errorPrototype: Error_.prototype,
      errorStack,
      evalError: EvalError_,
      function: Function_,
      functionPrototype: Function_.prototype,
      iteration: {
        arrayEntries: Reflect.get(
          arrayPrototype,
          'entries',
        ) as JavaScriptIntrinsics['iteration']['arrayEntries'],
        arrayForEach: Reflect.get(
          arrayPrototype,
          'forEach',
        ) as JavaScriptIntrinsics['iteration']['arrayForEach'],
        arrayKeys: Reflect.get(
          arrayPrototype,
          'keys',
        ),
        arrayValues,
        asyncIteratorPrototype,
        iteratorPrototype,
        mapIteratorPrototype,
        setIteratorPrototype,
      },
      map: Map_,
      number: Reflect.get(this.#hostGlobal, 'Number') as NumberConstructor,
      object: Object_,
      objectPrototype: Object_.prototype,
      promise: {
        constructor: Promise_,
        reject: Reflect.get(
          Promise_,
          'reject',
        ) as JavaScriptIntrinsics['promise']['reject'],
        then: Reflect.get(
          Promise_.prototype,
          'then',
        ) as JavaScriptIntrinsics['promise']['then'],
      },
      rangeError: Reflect.get(
        this.#hostGlobal,
        'RangeError',
      ) as typeof RangeError,
      referenceError: ReferenceError_,
      regExp: RegExp_,
      set: Set_,
      string: Reflect.get(this.#hostGlobal, 'String') as StringConstructor,
      syntaxError: SyntaxError_,
      typeError: Reflect.get(
        this.#hostGlobal,
        'TypeError',
      ) as typeof TypeError,
      uriError: URIError_,
    };
    this.#callableFunctionFactory = runInContext(
      callableFunctionFactorySource,
      this.#context,
    ) as RealmFunctionFactory;
    this.#constructibleFunctionFactory = runInContext(
      constructibleFunctionFactorySource,
      this.#context,
    ) as RealmFunctionFactory;

    nodeRuntime.associateRealm(this.#hostGlobal, this);
    nodeRuntime.associateRealm(this.intrinsics.functionPrototype, this);
    nodeRuntime.associateRealm(this.intrinsics.objectPrototype, this);
    nodeRuntime.associateRealm(
      this.intrinsics.iteration.asyncIteratorPrototype,
      this,
    );
  }

  get global(): object {
    return this.#globalObject;
  }

  get globalObject(): object {
    return this.#globalObject;
  }

  get globalThis(): object {
    return this.#globalThis;
  }

  protected get hostGlobal(): object {
    return this.#hostGlobal;
  }

  createFunction(
    steps: RealmFunctionSteps,
    options: RealmFunctionOptions,
  ): JavaScriptFunction {
    const factory = options.constructible
      ? this.#constructibleFunctionFactory
      : this.#callableFunctionFactory;
    const function_ = factory(steps);

    Object.defineProperties(function_, {
      length: {
        configurable: true,
        value: options.length,
      },
      name: {
        configurable: true,
        value: options.name,
      },
    });
    nodeRuntime.associateRealm(function_, this);
    return function_;
  }

  createOrdinaryObject(prototype: object | null): object {
    const object = Reflect.construct(this.intrinsics.object, []);
    if (!Reflect.setPrototypeOf(object, prototype)) {
      throw new Error('Could not set an ordinary object prototype');
    }
    nodeRuntime.associateRealm(object, this);
    return object;
  }

  evaluate(source: string, filename: string, lineOffset = 0): unknown {
    return nodeRuntime.runWithActiveRealm(this, () => {
      const result = runInContext(source, this.#context, {
        displayErrors: false,
        filename,
        lineOffset,
      }) as unknown;
      if (isObject(result)) nodeRuntime.associateRealm(result, this);
      return result;
    });
  }

  protected initializeGlobalObjects(
    globalObject: object,
    globalThis: object,
  ): void {
    if (this.#globalObject !== this.#hostGlobal) {
      throw new Error('Realm global objects are already initialized');
    }
    this.#globalObject = globalObject;
    this.#globalThis = globalThis;
    this.#installDefaultGlobalBindings();

    /*
     * ACCOMMODATION(node-vm-global-proxy): Node cannot make an existing host
     * object the VM context's actual global-this. Inherit through the supplied
     * global-this so free global names still reach the modeled global graph;
     * top-level `this` remains a documented limitation.
     */
    Reflect.setPrototypeOf(this.#hostGlobal, globalThis);
    Object.defineProperty(this.#hostGlobal, 'globalThis', {
      configurable: true,
      value: globalThis,
      writable: true,
    });
    nodeRuntime.associateRealm(globalObject, this);
    nodeRuntime.associateRealm(globalThis, this);
  }

  #installDefaultGlobalBindings(): void {
    for (const property of Reflect.ownKeys(this.#hostGlobal)) {
      if (
        property === 'globalThis' ||
        Object.hasOwn(this.#globalObject, property)
      ) continue;

      const descriptor = Reflect.getOwnPropertyDescriptor(
        this.#hostGlobal,
        property,
      );
      if (
        descriptor &&
        !Reflect.defineProperty(this.#globalObject, property, descriptor)
      ) {
        throw new Error(`Could not install global binding ${String(property)}`);
      }
    }
    Object.defineProperty(this.#globalObject, 'globalThis', {
      configurable: true,
      value: this.#globalThis,
      writable: true,
    });
  }
}

type RealmGlobal = Record<PropertyKey, unknown>;

type RealmFunctionFactory = (
  steps: RealmFunctionSteps,
) => JavaScriptFunction;

const callableFunctionFactorySource = `
  (steps) => ({
    call() {
      "use strict";
      return steps(this, [...arguments], undefined);
    },
  }).call
`;

const constructibleFunctionFactorySource = `
  (steps) => function() {
    "use strict";
    return steps(this, [...arguments], new.target);
  }
`;

const bufferViewNames: readonly JavaScriptBufferViewName[] = [
  'Int8Array', 'Int16Array', 'Int32Array', 'Uint8Array', 'Uint16Array',
  'Uint32Array', 'Uint8ClampedArray', 'BigInt64Array', 'BigUint64Array',
  'Float16Array', 'Float32Array', 'Float64Array', 'DataView',
];
