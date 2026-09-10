import {
  bufferViewNames, getArrayBufferViewElementSize, getBufferTypeName,
  isDetachedArrayBuffer, writeArrayBuffer,
  type ByteSequence, type JSBufferView, type JSBufferViewName,
  type RuntimeBuffers,
} from './buffers';
import { Promises } from './promises';
import {
  jsRuntime, type JSMicrotaskQueue,
  type JSRuntime, type NodeContext,
} from './runtime';

/*
 * One JavaScript realm, backed by a Node VM context. Higher layers subclass
 * this identity to add Web IDL and HTML policy.
 */
export class JSRealm {
  static readonly supportsGlobalPrototypeChain = jsRuntime.hasNativeGlobalObjects;

  readonly globalPrototypeChain: readonly object[] | undefined;
  readonly allocatedGlobalObject: GlobalObject | undefined;
  readonly intrinsics: JSIntrinsics;
  readonly runtime: JSRuntime = jsRuntime;
  readonly promises: Promises;
  readonly #callableFunctionFactory: RealmFunctionFactory;
  readonly #context: NodeContext;
  readonly #constructibleFunctionFactory: RealmFunctionFactory;
  #globalObject: GlobalObject;
  #globalThis: object;
  readonly #hostGlobal: RealmGlobal;
  readonly #microtaskQueue: JSMicrotaskQueue;

  constructor(
    microtaskQueue: JSMicrotaskQueue =
      jsRuntime.createMicrotaskQueue(),
    options: JSRealmOptions = {},
  ) {
    this.#microtaskQueue = microtaskQueue;
    const reuseGlobalProxyFrom = options.reuseGlobalProxyFrom === undefined
      ? undefined
      : options.reuseGlobalProxyFrom.#context;
    this.#context = jsRuntime.createContext(
      microtaskQueue,
      reuseGlobalProxyFrom,
      options.globalPrototypeChain,
    );
    this.globalPrototypeChain = jsRuntime.getContextPrototypeChain(this.#context);
    this.allocatedGlobalObject = jsRuntime.getAllocatedGlobalObject(this.#context);
    if (options.globalPrototypeChain && !this.globalPrototypeChain) {
      throw new Error('The Node backend did not allocate the requested global prototypes');
    }
    this.#hostGlobal = jsRuntime.getContextGlobal(
      this.#context,
    ) as RealmGlobal;
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
    const Reflect_ = Reflect.get(this.#hostGlobal, 'Reflect') as typeof Reflect;
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
    ) as JSIntrinsics['iteration']['arrayValues'];
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
    const asyncIterator = jsRuntime.runInContext(
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
        ),
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
        ) as JSIntrinsics['iteration']['arrayEntries'],
        arrayForEach: Reflect.get(
          arrayPrototype,
          'forEach',
        ) as JSIntrinsics['iteration']['arrayForEach'],
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
        ) as JSIntrinsics['promise']['reject'],
        then: Reflect.get(
          Promise_.prototype,
          'then',
        ) as JSIntrinsics['promise']['then'],
      },
      rangeError: Reflect.get(
        this.#hostGlobal,
        'RangeError',
      ) as typeof RangeError,
      referenceError: ReferenceError_,
      reflectGet: Reflect_.get,
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
    this.promises = new Promises(this);
    this.#callableFunctionFactory = jsRuntime.runInContext(
      callableFunctionFactorySource,
      this.#context,
    ) as RealmFunctionFactory;
    this.#constructibleFunctionFactory = jsRuntime.runInContext(
      constructibleFunctionFactorySource,
      this.#context,
    ) as RealmFunctionFactory;

    jsRuntime.associateContext(this.#context, this);
    jsRuntime.associateRealm(this.#hostGlobal, this);
    jsRuntime.associateRealm(this.intrinsics.functionPrototype, this);
    jsRuntime.associateRealm(this.intrinsics.objectPrototype, this);
    jsRuntime.associateRealm(
      this.intrinsics.iteration.asyncIteratorPrototype,
      this,
    );
  }

  get global(): GlobalObject {
    return this.#globalObject;
  }

  get globalObject(): GlobalObject {
    return this.#globalObject;
  }

  get globalThis(): object {
    return this.#globalThis;
  }

  protected get hostGlobal(): object {
    return this.#hostGlobal;
  }

  detachGlobal(): object {
    return jsRuntime.detachContext(this.#context);
  }

  setPropertyDelegate(object: object, delegate: object): void {
    jsRuntime.setPropertyDelegate(object, delegate);
  }

  createFunction(
    steps: RealmFunctionSteps,
    options: RealmFunctionOptions,
  ): JSFunction {
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
    jsRuntime.associateRealm(function_, this);
    return function_;
  }

  createOrdinaryObject(prototype: object | null): object {
    const object = Reflect.construct(this.intrinsics.object, []);
    if (!Reflect.setPrototypeOf(object, prototype)) {
      throw new Error('Could not set an ordinary object prototype');
    }
    jsRuntime.associateRealm(object, this);
    return object;
  }

  /** ECMAScript CreateIterResultObject, using this realm's Object prototype. */
  createIteratorResultObject(value: unknown, done: boolean): object {
    const result = this.createOrdinaryObject(this.intrinsics.objectPrototype);
    return Object.defineProperties(result, {
      value: { configurable: true, enumerable: true, value, writable: true },
      done: { configurable: true, enumerable: true, value: done, writable: true },
    });
  }

  /** Supply realm-owned allocation to implementation producers. */
  createRuntimeBuffers(): RuntimeBuffers {
    return {
      allocateArrayBuffer: (byteLength) => this.allocateArrayBuffer(byteLength),
      createView: (name, buffer, byteOffset = 0, length) =>
        this.createView(name, buffer, byteOffset, length),
      copyArrayBuffer: (bytes) => this.createArrayBuffer(bytes),
      copyUint8Array: (bytes) => this.createArrayBufferView('Uint8Array', bytes),
      transferArrayBuffer: (buffer) => this.transferArrayBuffer(buffer),
    };
  }

  /** Allocate zero-initialized storage directly in this realm. */
  allocateArrayBuffer(byteLength: number, maxByteLength?: number): ArrayBuffer {
    return new this.intrinsics.bufferSource.arrayBuffer(
      byteLength,
      maxByteLength === undefined ? undefined : { maxByteLength },
    );
  }

  /** Copy bytes into independent storage in this realm. */
  createArrayBuffer(bytes: ByteSequence, maxByteLength?: number): ArrayBuffer {
    const buffer = this.allocateArrayBuffer(bytes.length, maxByteLength);
    writeArrayBuffer(buffer, bytes);
    return buffer;
  }

  createSharedArrayBuffer(bytes: ByteSequence, maxByteLength?: number): SharedArrayBuffer {
    const constructor = this.intrinsics.bufferSource.sharedArrayBuffer;
    if (!constructor) {
      throw new Error('The target realm has no SharedArrayBuffer intrinsic');
    }
    const buffer = new constructor(
      bytes.length,
      maxByteLength === undefined ? undefined : { maxByteLength },
    );
    writeArrayBuffer(buffer, bytes);
    return buffer;
  }

  createArrayBufferView<Name extends JSBufferViewName>(
    name: Name,
    bytes: ByteSequence,
  ): JSBufferView<Name> {
    const elementSize = getArrayBufferViewElementSize(name);
    if (name !== 'DataView' && bytes.length % elementSize !== 0) {
      throw new Error(`${name} byte length is not a multiple of ${elementSize}`);
    }
    return this.createView(
      name, this.createArrayBuffer(bytes), 0, bytes.length / elementSize,
    );
  }

  /** Share storage; omitted length uses the remaining range and tracks resizing. */
  createView<Name extends JSBufferViewName>(
    name: Name,
    buffer: ArrayBufferLike,
    byteOffset = 0,
    length?: number,
  ): JSBufferView<Name> {
    const constructor = this.intrinsics.bufferSource.views[name];
    if (!constructor) {
      throw new Error(`The target realm has no ${name} intrinsic`);
    }
    return Reflect.construct(
      constructor,
      length === undefined ? [buffer, byteOffset] : [buffer, byteOffset, length],
    ) as JSBufferView<Name>;
  }

  detachArrayBuffer(buffer: ArrayBuffer): void {
    if (getBufferTypeName(buffer) !== 'ArrayBuffer') {
      throw new Error('Only an ArrayBuffer can be detached');
    }
    if (isDetachedArrayBuffer(buffer)) return;
    Reflect.apply(this.intrinsics.bufferSource.arrayBufferTransfer, buffer, [0]);
  }

  /** Transfer storage into this realm, preserving resizability. */
  // TODO: expose a non-destructive engine query for [[ArrayBufferDetachKey]].
  // IsDetachable() does not answer that question; transfer remains authoritative.
  transferArrayBuffer(buffer: ArrayBuffer): ArrayBuffer {
    if (getBufferTypeName(buffer) !== 'ArrayBuffer') {
      throw new Error('Only an ArrayBuffer can be transferred');
    }
    if (isDetachedArrayBuffer(buffer)) {
      throw new this.intrinsics.typeError('ArrayBuffer is detached');
    }
    return Reflect.apply(this.intrinsics.bufferSource.arrayBufferTransfer, buffer, []);
  }

  observePromise(
    promise: Promise<unknown>,
    onFulfilled: JSFunction | undefined,
    onRejected: JSFunction | undefined,
  ): void {
    jsRuntime.observePromise(this, promise, onFulfilled, onRejected);
  }

  evaluate(source: string, filename: string, lineOffset = 0): unknown {
    return jsRuntime.runWithActiveRealm(this, () =>
      jsRuntime.runInContext(source, this.#context, {
        displayErrors: false,
        filename,
        lineOffset,
      }));
  }

  protected enqueueMicrotask(steps: () => void): void {
    this.#microtaskQueue.enqueueMicrotask(steps);
  }

  protected initializeGlobalObjects(
    globalObject: GlobalObject,
    globalThis: object,
  ): void {
    if (this.#globalObject !== this.#hostGlobal) {
      throw new Error('Realm global objects are already initialized');
    }
    this.#globalObject = globalObject;
    this.#globalThis = globalThis;
    this.#installDefaultGlobalBindings();

    if (this.globalPrototypeChain !== undefined) {
      if (globalObject !== this.allocatedGlobalObject || globalThis !== this.#hostGlobal) {
        throw new Error('Native global initialization requires its allocated object and proxy');
      }
      // Intrinsics have been copied to the per-realm target. Remove configurable
      // backing properties before installing delegation so deletion/ownKeys do
      // not reveal an obsolete second copy on V8's hidden global object.
      for (const key of Reflect.ownKeys(this.#hostGlobal)) {
        if (Reflect.getOwnPropertyDescriptor(this.#hostGlobal, key)?.configurable) {
          Reflect.deleteProperty(this.#hostGlobal, key);
        }
      }
      jsRuntime.setGlobalObject(this.#context, globalObject);
    } else {
      /*
       * ACCOMMODATION(node-vm-global-proxy): Node cannot make an existing host
       * object the VM context's actual global-this. Inherit through the supplied
       * global-this so free global names still reach the modeled global graph;
       * top-level `this` remains a documented limitation.
       */
      Reflect.setPrototypeOf(this.#hostGlobal, globalThis);
    }
    Object.defineProperty(this.#hostGlobal, 'globalThis', {
      configurable: true,
      value: globalThis,
      writable: true,
    });
    jsRuntime.associateRealm(globalObject, this);
    jsRuntime.associateRealm(globalThis, this);
  }

  protected makeHostGlobalPrototypeImmutable(): void {
    if (this.globalPrototypeChain !== undefined) return;
    jsRuntime.makePrototypeImmutable(this.#hostGlobal);
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

export type JSRealmOptions = {
  reuseGlobalProxyFrom?: JSRealm;
  globalPrototypeChain?: readonly GlobalPrototypeKind[];
};

export type GlobalPrototypeKind = 'mutable' | 'immutable' | 'delegated';

/** A realm's global object; no additional property shape is required. */
export type GlobalObject = object;

export type JSIntrinsics = {
  array: ArrayConstructor;
  bigInt: BigIntConstructor;
  boolean: BooleanConstructor;
  bufferSource: {
    arrayBuffer: ArrayBufferConstructor;
    arrayBufferTransfer: (this: ArrayBuffer, newLength?: number) => ArrayBuffer;
    cloneSharedArrayBuffer(buffer: object): object;
    sharedArrayBuffer?: SharedArrayBufferConstructor;
    views: Partial<Record<JSBufferViewName, BufferViewConstructor>>;
  };
  date: DateConstructor;
  error: ErrorConstructor;
  errorPrototype: object;
  errorStack?: (this: object) => unknown;
  evalError: EvalErrorConstructor;
  function: FunctionConstructor;
  functionPrototype: object;
  iteration: {
    arrayEntries: JSMethod;
    arrayForEach: JSMethod;
    arrayKeys: JSMethod;
    arrayValues: JSMethod;
    asyncIteratorPrototype: object;
    iteratorPrototype: object;
    mapIteratorPrototype: object;
    setIteratorPrototype: object;
  };
  map: MapConstructor;
  number: NumberConstructor;
  object: ObjectConstructor;
  objectPrototype: object;
  promise: {
    constructor: PromiseConstructor;
    reject: JSMethod;
    then: JSMethod;
  };
  rangeError: typeof RangeError;
  referenceError: ReferenceErrorConstructor;
  reflectGet: typeof Reflect.get;
  regExp: RegExpConstructor;
  set: SetConstructor;
  string: StringConstructor;
  syntaxError: SyntaxErrorConstructor;
  typeError: typeof TypeError;
  uriError: URIErrorConstructor;
};

export type JSFunction = (
  ...argumentsList: unknown[]
) => unknown;

export type RealmFunctionOptions = {
  name: string;
  length: number;
  constructible?: boolean;
};

export type RealmFunctionSteps = (
  thisArgument: unknown,
  argumentsList: unknown[],
  newTarget: JSFunction | undefined,
) => unknown;

export type JSMethod = (
  this: unknown,
  ...argumentsList: unknown[]
) => unknown;

type BufferViewConstructor = new (
  buffer: ArrayBufferLike,
) => object;

type RealmGlobal = Record<PropertyKey, unknown>;

type RealmFunctionFactory = (
  steps: RealmFunctionSteps,
) => JSFunction;

const callableFunctionFactorySource = `
  (steps) => ({
    call() {
      "use strict";
      return steps(this, [...arguments], undefined);
    },
  }).call
`;

// Binding owns construction and must return the object. An ordinary function's
// [[Construct]] would first allocate a discarded receiver and read
// newTarget.prototype before the binding's own prototype lookup.
const constructibleFunctionFactorySource = `
  ((Proxy) => (steps) => {
    const target = function() {
      "use strict";
      return steps(this, [...arguments], undefined);
    };
    const function_ = new Proxy(target, {
      construct(_target, argumentsList, newTarget) {
        return steps(undefined, argumentsList, newTarget);
      },
    });
    target.prototype.constructor = function_;
    return function_;
  })(Proxy)
`;
