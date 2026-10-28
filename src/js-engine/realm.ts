import { Stamper } from '../infra/stamper';
import { InternalPromise } from '../infra/promises';
import { InternalError } from '../infra/internal-error';
import { convertJSONDerivedValueToInfra, type JSONValue, type InfraValue } from '../infra/json';

import {
  getArrayBufferViewElementSize,
  isDetachedArrayBuffer, writeArrayBuffer,
  type ByteSequence, type JSBufferView, type JSBufferViewName,
} from './buffers';
import { isObject } from './abstract-operations';
import { addon } from './node-addons';
import {
  compileModule, createDefaultExportModule, moduleRequests, linkModule, evaluateModule, moduleNamespace,
  type CompiledModule, type ModuleRequest,
} from './modules';
import {
  associateContext, associateGlobalRealm, associateObjectRealm, cloneSharedArrayBuffer, compileScript,
  createCollectionIterator, createContext, createMicrotaskQueue, detachContext,
  getContextGlobalAllocation, getContextGlobalProxy,
  makePrototypeImmutable, observePromise, runInContext, runScript, runWithActiveRealm,
  setGlobalObject, setPropertyDelegate, type JSMicrotaskQueue, type VMContext,
} from './runtime';

/**
 * Owns a VM context, its captured intrinsics, and realm-specific allocation.
 * Hosts subclass this identity to supply Web IDL and HTML policy, and install
 * their global object and global-this through initializeGlobalObjects().
 */
export class JSRealm {
  // -- Constructors ------------------------------------------------------

  /** Original Array constructor in this realm. */
  Array;
  /** Original ArrayBuffer constructor in this realm. */
  ArrayBuffer;
  /** Original BigInt constructor in this realm. */
  BigInt;
  /** Original BigInt64Array constructor in this realm. */
  BigInt64Array;
  /** Original BigUint64Array constructor in this realm. */
  BigUint64Array;
  /** Original Boolean constructor in this realm. */
  Boolean;
  /** Original DataView constructor in this realm. */
  DataView;
  /** Original Date constructor in this realm. */
  Date;
  /** Original Error constructor in this realm. */
  Error;
  /** Original EvalError constructor in this realm. */
  EvalError;
  /** Original Float16Array constructor in this realm. */
  Float16Array;
  /** Original Float32Array constructor in this realm. */
  Float32Array;
  /** Original Float64Array constructor in this realm. */
  Float64Array;
  /** Original Function constructor in this realm. */
  Function;
  /** Original Int8Array constructor in this realm. */
  Int8Array;
  /** Original Int16Array constructor in this realm. */
  Int16Array;
  /** Original Int32Array constructor in this realm. */
  Int32Array;
  /** Original Map constructor in this realm. */
  Map;
  /** Original JavaScript Promise constructor in this realm. */
  NativePromise;
  /** Implementation Promise constructor whose reactions are observed through this realm. */
  InternalPromise: typeof InternalPromise;
  /** Original Number constructor in this realm. */
  Number;
  /** Original Object constructor in this realm. */
  Object;
  /** Original RangeError constructor in this realm. */
  RangeError;
  /** Original ReferenceError constructor in this realm. */
  ReferenceError;
  /** Original RegExp constructor in this realm. */
  RegExp;
  /** Original Set constructor in this realm. */
  Set;
  /** Original SharedArrayBuffer constructor in this realm. */
  SharedArrayBuffer;
  /** Original String constructor in this realm. */
  String;
  /** Original SyntaxError constructor in this realm. */
  SyntaxError;
  /** Original TypeError constructor in this realm. */
  TypeError;
  /** Original Uint8Array constructor in this realm. */
  Uint8Array;
  /** Original Uint8ClampedArray constructor in this realm. */
  Uint8ClampedArray;
  /** Original Uint16Array constructor in this realm. */
  Uint16Array;
  /** Original Uint32Array constructor in this realm. */
  Uint32Array;
  /** Original URIError constructor in this realm. */
  URIError;

  // -- Captured methods --------------------------------------------------

  /** Captured ArrayBuffer.prototype.transfer method. */
  arrayBufferTransfer;
  /** Captured Array.prototype.entries method. */
  arrayEntries;
  /** Captured Array.prototype.forEach method. */
  arrayForEach;
  /** Captured Array.prototype.keys method. */
  arrayKeys;
  /** Captured Array.prototype.values method. */
  arrayValues;
  /** Native Error stack getter, when supplied by the engine. */
  errorStack;
  /** Captured JSON.parse function. */
  jsonParse;
  /** Captured JSON.stringify function. */
  jsonStringify;
  /** Captured Map iterator next method. */
  mapIteratorNext;
  /** Captured Promise.reject method. */
  promiseReject;
  /** Captured Promise.prototype.then method. */
  promiseThen;
  /** Captured Reflect.get function. */
  reflectGet;
  /** Captured Set iterator next method. */
  setIteratorNext;

  // -- Captured prototypes -----------------------------------------------

  /** Shared prototype of async iterators in this realm. */
  asyncIteratorPrototype;
  /** Original Error prototype in this realm. */
  errorPrototype;
  /** Original Function prototype in this realm. */
  functionPrototype;
  /** Shared prototype of synchronous iterators in this realm. */
  iteratorPrototype;
  /** Original Map iterator prototype in this realm. */
  mapIteratorPrototype;
  /** Original Object prototype in this realm. */
  objectPrototype;
  /** Original Set iterator prototype in this realm. */
  setIteratorPrototype;

  // -- Engine state ------------------------------------------------------

  #vmContext: VMContext;
  #microtaskQueue: JSMicrotaskQueue;
  #globalAllocation: GlobalAllocation | undefined;
  #globalObject: GlobalObject;
  #globalProxy: GlobalProxy;
  #globalThis: GlobalThis;

  #callableFunctionFactory: RealmFunctionFactory;
  #constructibleFunctionFactory: RealmFunctionFactory;
  #fallbackIteratorNext: Partial<Record<CollectionIteratorKind, JSFunction>> = {};

  /**
   * Create a context on the supplied microtask queue and capture its built-ins.
   * The host controls queue checkpoints and may share the queue across realms.
   * Native options can reuse a detached proxy and preallocate global prototypes;
   * host-selected globals are installed separately through initializeGlobalObjects().
   */
  constructor(
    microtaskQueue: JSMicrotaskQueue = createMicrotaskQueue(),
    options: JSRealmOptions = {},
  ) {
    this.#microtaskQueue = microtaskQueue;
    const reuseGlobalProxyFrom = options.reuseGlobalProxyFrom === undefined
      ? undefined
      : options.reuseGlobalProxyFrom.#vmContext;
    this.#vmContext = createContext(
      microtaskQueue,
      reuseGlobalProxyFrom,
      options.globalPrototypeChain,
    );
    this.#globalAllocation = getContextGlobalAllocation(this.#vmContext);
    if (options.globalPrototypeChain && !this.#globalAllocation) {
      throw new InternalError('The Node backend did not allocate the requested global prototypes');
    }
    this.#globalProxy = getContextGlobalProxy(this.#vmContext);
    this.#globalObject = this.#globalProxy;
    this.#globalThis = this.#globalProxy;

    // Capture before host initialization or author code can replace globals and methods.
    this.Array = Reflect.get(this.#globalProxy, 'Array') as ArrayConstructor;
    this.ArrayBuffer = Reflect.get(this.#globalProxy, 'ArrayBuffer') as ArrayBufferConstructor;
    this.BigInt = Reflect.get(this.#globalProxy, 'BigInt') as BigIntConstructor;
    this.BigInt64Array = Reflect.get(this.#globalProxy, 'BigInt64Array') as BigInt64ArrayConstructor;
    this.BigUint64Array = Reflect.get(this.#globalProxy, 'BigUint64Array') as BigUint64ArrayConstructor;
    this.Boolean = Reflect.get(this.#globalProxy, 'Boolean') as BooleanConstructor;
    this.DataView = Reflect.get(this.#globalProxy, 'DataView') as DataViewConstructor;
    this.Date = Reflect.get(this.#globalProxy, 'Date') as DateConstructor;
    this.Error = Reflect.get(this.#globalProxy, 'Error') as ErrorConstructor;
    this.EvalError = Reflect.get(this.#globalProxy, 'EvalError') as EvalErrorConstructor;
    this.Float16Array = Reflect.get(this.#globalProxy, 'Float16Array') as Float16ArrayConstructor | undefined;
    this.Float32Array = Reflect.get(this.#globalProxy, 'Float32Array') as Float32ArrayConstructor;
    this.Float64Array = Reflect.get(this.#globalProxy, 'Float64Array') as Float64ArrayConstructor;
    this.Function = Reflect.get(this.#globalProxy, 'Function') as FunctionConstructor;
    this.Int8Array = Reflect.get(this.#globalProxy, 'Int8Array') as Int8ArrayConstructor;
    this.Int16Array = Reflect.get(this.#globalProxy, 'Int16Array') as Int16ArrayConstructor;
    this.Int32Array = Reflect.get(this.#globalProxy, 'Int32Array') as Int32ArrayConstructor;
    this.Map = Reflect.get(this.#globalProxy, 'Map') as MapConstructor;
    this.NativePromise = Reflect.get(this.#globalProxy, 'Promise') as PromiseConstructor;
    this.Number = Reflect.get(this.#globalProxy, 'Number') as NumberConstructor;
    this.Object = Reflect.get(this.#globalProxy, 'Object') as ObjectConstructor;
    this.RangeError = Reflect.get(this.#globalProxy, 'RangeError') as RangeErrorConstructor;
    this.ReferenceError = Reflect.get(this.#globalProxy, 'ReferenceError') as ReferenceErrorConstructor;
    this.RegExp = Reflect.get(this.#globalProxy, 'RegExp') as RegExpConstructor;
    this.Set = Reflect.get(this.#globalProxy, 'Set') as SetConstructor;
    this.SharedArrayBuffer = Reflect.get(this.#globalProxy, 'SharedArrayBuffer') as SharedArrayBufferConstructor | undefined;
    this.String = Reflect.get(this.#globalProxy, 'String') as StringConstructor;
    this.SyntaxError = Reflect.get(this.#globalProxy, 'SyntaxError') as SyntaxErrorConstructor;
    this.TypeError = Reflect.get(this.#globalProxy, 'TypeError') as TypeErrorConstructor;
    this.Uint8Array = Reflect.get(this.#globalProxy, 'Uint8Array') as Uint8ArrayConstructor;
    this.Uint8ClampedArray = Reflect.get(this.#globalProxy, 'Uint8ClampedArray') as Uint8ClampedArrayConstructor;
    this.Uint16Array = Reflect.get(this.#globalProxy, 'Uint16Array') as Uint16ArrayConstructor;
    this.Uint32Array = Reflect.get(this.#globalProxy, 'Uint32Array') as Uint32ArrayConstructor;
    this.URIError = Reflect.get(this.#globalProxy, 'URIError') as URIErrorConstructor;
    this.arrayBufferTransfer = Reflect.get(this.ArrayBuffer.prototype, 'transfer');
    this.arrayEntries = Reflect.get(this.Array.prototype, 'entries') as JSMethod;
    this.arrayForEach = Reflect.get(this.Array.prototype, 'forEach') as JSMethod;
    this.arrayKeys = Reflect.get(this.Array.prototype, 'keys') as JSMethod;
    this.arrayValues = Reflect.get(this.Array.prototype, 'values') as JSMethod;
    this.errorStack = Reflect.getOwnPropertyDescriptor(
      Reflect.construct(this.Error, []), 'stack',
    )?.get as ((this: object) => unknown) | undefined;
    const JSON_ = Reflect.get(this.#globalProxy, 'JSON') as JSON;
    this.jsonParse = JSON_.parse as (text: string) => JSONValue;
    this.jsonStringify = JSON_.stringify as (value: unknown) => string | undefined;
    this.promiseReject = Reflect.get(this.NativePromise, 'reject') as JSMethod;
    this.promiseThen = Reflect.get(this.NativePromise.prototype, 'then') as JSMethod;
    this.reflectGet = (Reflect.get(this.#globalProxy, 'Reflect') as typeof Reflect).get;
    this.errorPrototype = this.Error.prototype as object;
    this.functionPrototype = this.Function.prototype as object;
    this.objectPrototype = this.Object.prototype as object;

    // Realm-created iterators reveal the shared prototypes used by iteration algorithms.
    const arrayIterator = Reflect.apply(this.arrayValues, new this.Array(), []) as object;
    const arrayIteratorPrototype = Reflect.getPrototypeOf(arrayIterator);
    const iteratorPrototype = arrayIteratorPrototype && Reflect.getPrototypeOf(arrayIteratorPrototype);
    if (!iteratorPrototype) throw new InternalError('Could not obtain the realm Iterator prototype');
    this.iteratorPrototype = iteratorPrototype;
    const asyncIterator = runInContext('(async function* () {})()', this.#vmContext) as object;
    const asyncGeneratorFunctionPrototype = Reflect.getPrototypeOf(asyncIterator);
    const asyncGeneratorPrototype = asyncGeneratorFunctionPrototype &&
      Reflect.getPrototypeOf(asyncGeneratorFunctionPrototype);
    const asyncIteratorPrototype = asyncGeneratorPrototype && Reflect.getPrototypeOf(asyncGeneratorPrototype);
    if (!asyncIteratorPrototype) throw new InternalError('Could not obtain the realm AsyncIterator prototype');
    this.asyncIteratorPrototype = asyncIteratorPrototype;
    const mapIteratorPrototype = Reflect.getPrototypeOf(Reflect.apply(
      Reflect.get(this.Map.prototype, 'entries') as JSMethod, new this.Map(), [],
    ) as object);
    const setIteratorPrototype = Reflect.getPrototypeOf(Reflect.apply(
      Reflect.get(this.Set.prototype, 'values') as JSMethod, new this.Set(), [],
    ) as object);
    if (!mapIteratorPrototype || !setIteratorPrototype) {
      throw new InternalError('Could not obtain the realm collection iterator prototypes');
    }
    this.mapIteratorPrototype = mapIteratorPrototype;
    this.setIteratorPrototype = setIteratorPrototype;
    this.mapIteratorNext = Reflect.get(mapIteratorPrototype, 'next') as JSMethod;
    this.setIteratorNext = Reflect.get(setIteratorPrototype, 'next') as JSMethod;
    // Internal promises use this realm for observation; exposed functions must also originate here.
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- Capture the realm, not the subclass constructor.
    const realm = this;
    this.InternalPromise = class RealmPromise<T> extends InternalPromise<T> {
      protected override observeNative(fulfilled: (value: unknown) => void, rejected: (reason: unknown) => void): void {
        realm.observePromise(this.backing, fulfilled, rejected);
      }
    };
    this.#callableFunctionFactory = runInContext(
      callableFunctionFactorySource,
      this.#vmContext,
    ) as RealmFunctionFactory;
    this.#constructibleFunctionFactory = runInContext(
      constructibleFunctionFactorySource,
      this.#vmContext,
    ) as RealmFunctionFactory;

    // Native lookup uses the context identity; fallback lookup also needs these prototype anchors.
    associateContext(this.#vmContext, this);
    associateGlobalRealm(this.#globalProxy, this);
    associateObjectRealm(this.functionPrototype, this);
    associateObjectRealm(this.objectPrototype, this);
    associateObjectRealm(this.asyncIteratorPrototype, this);
  }

  /** Global target; initially the engine proxy, then the object installed by the host. */
  get globalObject(): GlobalObject {
    return this.#globalObject;
  }

  /** Global this value; initially the engine proxy, then the value selected by the host. */
  get globalThis(): GlobalThis {
    return this.#globalThis;
  }

  /** Engine-created proxy, retained when a host supplies its own global-this value. */
  get globalProxy(): GlobalProxy {
    return this.#globalProxy;
  }

  /**
   * Global target and prototypes allocated by the Node compatibility add-on.
   * Throws if globalPrototypeChain was omitted.
   */
  get globalAllocation(): GlobalAllocation {
    if (this.#globalAllocation === undefined) {
      throw new InternalError('Realm has no preallocated global object and prototypes');
    }
    return this.#globalAllocation;
  }

  /** Detach the native proxy for reuse; the host must finish pending work first. */
  detachGlobal(): GlobalProxy {
    return detachContext(this.#vmContext);
  }

  /** Install property forwarding on an object allocated with a delegated native template. */
  setPropertyDelegate(object: object, delegate: object): void {
    setPropertyDelegate(object, delegate);
  }

  /** Create a realm-owned function that forwards calls and optional construction to host steps. */
  createFunction<Result>(
    steps: RealmFunctionSteps<Result>,
    options: RealmFunctionOptions,
  ): JSFunction<Result> {
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
    associateObjectRealm(function_, this);
    return function_;
  }

  /** Allocate in this realm even when the supplied prototype belongs to another realm. */
  createOrdinaryObject(prototype: object | null): object {
    const object = Reflect.construct(this.Object, []);
    if (!Reflect.setPrototypeOf(object, prototype)) {
      throw new InternalError('Could not set an ordinary object prototype');
    }
    associateObjectRealm(object, this);
    return object;
  }

  /** Allocate a callable [[IsHTMLDDA]] object directly in this realm. */
  createHTMLDDA(call: JSFunction): object {
    if (!addon.createHTMLDDA) {
      throw new InternalError('Node backend does not provide createHTMLDDA');
    }
    return addon.createHTMLDDA(this.#vmContext, call);
  }

  /** Parse JSON with this realm's captured intrinsic and allocation prototypes. */
  // https://infra.spec.whatwg.org/#parse-a-json-string-to-a-javascript-value
  parseJSON(text: string): JSONValue {
    return this.jsonParse(text);
  }

  /** Serialize JSON with this realm's captured intrinsic and exception constructors. */
  stringifyJSON(value: unknown): string | undefined {
    return this.jsonStringify(value);
  }

  /** Serialize without a replacer or spacing; throw when the value has no JSON representation. */
  // https://infra.spec.whatwg.org/#serialize-a-javascript-value-to-a-json-string
  serializeJavaScriptValueToJSONString(value: unknown): string {
    const result = this.stringifyJSON(value);
    if (result === undefined) throw new this.TypeError('Value cannot be serialized as JSON');
    return result;
  }

  /** Parse JSON into realm-independent ordered maps, lists, and primitive values. */
  // https://infra.spec.whatwg.org/#parse-a-json-string-to-an-infra-value
  parseJSONStringToInfra(input: string): InfraValue {
    return convertJSONDerivedValueToInfra(this.parseJSON(input));
  }

  /** Serialize an Infra value through JSON-compatible objects allocated in this realm. */
  // https://infra.spec.whatwg.org/#serialize-an-infra-value-to-a-json-string
  serializeInfraValueToJSONString(value: InfraValue): string {
    return this.stringifyJSON(this.convertInfraValueToJavaScript(value))!;
  }

  /** Convert Infra lists and maps to realm-owned arrays and null-prototype objects. */
  // https://infra.spec.whatwg.org/#convert-an-infra-value-to-a-json-compatible-javascript-value
  convertInfraValueToJavaScript(value: InfraValue): JSONValue {
    if (value === null || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number') {
      return value;
    }
    if (Array.isArray(value)) {
      const result = new this.Array<JSONValue>();
      associateObjectRealm(result, this);
      for (let index = 0; index < value.length; ++index) {
        Object.defineProperty(result, index, {
          value: this.convertInfraValueToJavaScript(value[index]!),
          writable: true, enumerable: true, configurable: true,
        });
      }
      return result;
    }
    const result = this.createOrdinaryObject(null) as { [key: string]: JSONValue; };
    for (const [key, item] of value) {
      Object.defineProperty(result, key, {
        value: this.convertInfraValueToJavaScript(item),
        writable: true, enumerable: true, configurable: true,
      });
    }
    return result;
  }

  /** ECMAScript CreateIterResultObject, using this realm's Object prototype. */
  createIteratorResultObject<Value, Done extends boolean>(value: Value, done: Done): JSIteratorResult<Value, Done> {
    const result = this.createOrdinaryObject(this.objectPrototype);
    return Object.defineProperties(result, {
      value: { configurable: true, enumerable: true, value, writable: true },
      done: { configurable: true, enumerable: true, value: done, writable: true },
    }) as JSIteratorResult<Value, Done>;
  }

  /** Create a Map/Set-branded iterator whose steps supply each IteratorResult. */
  createCollectionIterator<Value>(
    kind: CollectionIteratorKind,
    next: () => JSIteratorResult<Value>,
  ): MapIterator<Value> | SetIterator<Value> {
    const native = createCollectionIterator(this.#vmContext, kind, next);
    if (native !== undefined) return native;

    /*
     * ACCOMMODATION(node-v8-collection-iterators): Unpatched engines cannot
     * allocate a native collection iterator from custom steps. Preserve the
     * prototype and ordinary iteration with a Proxy; borrowed native next()
     * still rejects it. Only this fallback needs JavaScript iterator records.
     */
    const prototype = kind === 'map'
      ? this.mapIteratorPrototype
      : this.setIteratorPrototype;
    const nativeNext = kind === 'map'
      ? this.mapIteratorNext
      : this.setIteratorNext;
    const fallbackNext = this.#fallbackIteratorNext[kind] ??=
      this.createFunction((receiver) => this.#nextCollectionIterator(receiver, kind),
        { length: 0, name: 'next' });
    const target = this.createOrdinaryObject(prototype);
    const iterator = new Proxy(target, {
      get(target_, property, receiver): unknown {
        const value: unknown = Reflect.get(target_, property, receiver);
        return property === 'next' && !Object.hasOwn(target_, property) && value === nativeNext
          ? fallbackNext : value;
      },
    });
    return IteratorStamper.stamp(iterator, { kind, next, running: false }) as
      StampedIterator<MapIterator<Value> | SetIterator<Value>>;
  }

  /** Copy bytes into independent storage in this realm. */
  copyArrayBuffer(bytes: ByteSequence, maxByteLength?: number): ArrayBuffer {
    const buffer = new this.ArrayBuffer(bytes.length, { maxByteLength });
    writeArrayBuffer(buffer, bytes);
    return buffer;
  }

  /** Copy bytes into fresh shared storage in this realm. */
  copySharedArrayBuffer(bytes: ByteSequence, maxByteLength?: number): SharedArrayBuffer {
    const constructor = this.SharedArrayBuffer;
    if (!constructor) {
      throw new InternalError('The target realm has no SharedArrayBuffer intrinsic');
    }
    const buffer = new constructor(
      bytes.length,
      maxByteLength === undefined ? undefined : { maxByteLength },
    );
    writeArrayBuffer(buffer, bytes);
    return buffer;
  }

  /** Allocate a new buffer object in this realm while sharing the source's storage and growth. */
  cloneSharedArrayBuffer(buffer: SharedArrayBuffer): SharedArrayBuffer {
    return cloneSharedArrayBuffer(buffer, this.#vmContext);
  }

  /** Copy bytes into a new realm-owned view and non-shared backing buffer. */
  copyArrayBufferView<Name extends JSBufferViewName>(
    name: Name,
    bytes: ByteSequence,
  ): JSBufferView<Name, ArrayBuffer> {
    const elementSize = getArrayBufferViewElementSize(name);
    if (name !== 'DataView' && bytes.length % elementSize !== 0) {
      throw new InternalError(`${name} byte length is not a multiple of ${elementSize}`);
    }
    return this.createView(
      name, this.copyArrayBuffer(bytes), 0, bytes.length / elementSize,
    );
  }

  /** Share storage; omitted length uses the remaining range and tracks resizing. */
  createView<Name extends JSBufferViewName, Buffer extends ArrayBufferLike>(
    name: Name,
    buffer: Buffer,
    byteOffset = 0,
    length?: number,
  ): JSBufferView<Name, Buffer> {
    const constructor = this[name];
    if (!constructor) {
      throw new InternalError(`The target realm has no ${name} intrinsic`);
    }
    return Reflect.construct(
      constructor,
      length === undefined ? [buffer, byteOffset] : [buffer, byteOffset, length],
    ) as JSBufferView<Name, Buffer>;
  }

  /** Discard the buffer's storage; already-detached buffers are unchanged. */
  detachArrayBuffer(buffer: ArrayBuffer): void {
    if (isDetachedArrayBuffer(buffer)) return;
    Reflect.apply(this.arrayBufferTransfer, buffer, [0]);
  }

  /** Transfer storage into this realm, preserving resizability. */
  // TODO: expose a non-destructive engine query for [[ArrayBufferDetachKey]].
  // IsDetachable() does not answer that question; transfer remains authoritative.
  transferArrayBuffer(buffer: ArrayBuffer): ArrayBuffer {
    if (isDetachedArrayBuffer(buffer)) {
      throw new this.TypeError('ArrayBuffer is detached');
    }
    return Reflect.apply(this.arrayBufferTransfer, buffer, []);
  }

  /** Register native Promise reactions through this realm's backend. */
  observePromise(
    promise: Promise<unknown>,
    onFulfilled: JSFunction | undefined,
    onRejected: JSFunction | undefined,
  ): void {
    observePromise(this, promise, onFulfilled, onRejected);
  }

  /**
   * Install HostPromiseRejectionTracker for code executing in this realm.
   * The callback must not throw. Stock Node leaves reporting with Node because
   * it cannot supply these synchronous notifications without the addon.
   */
  setPromiseRejectionTracker(
    tracker: ((promise: Promise<unknown>, operation: 'reject' | 'handle') => void) | undefined,
  ): void {
    addon.setPromiseRejectionTracker?.(this.#vmContext, tracker);
  }

  /** Compile without execution, allocating any syntax failure in this realm. */
  // https://tc39.es/ecma262/#sec-parse-script
  // SPEC_MISMATCH: ParseScript(sourceText, realm, hostDefined) -> Script Record or a List of SyntaxError objects
  // HTML supplies its Script Record and HostDefined around this unbound compiled code.
  parseScript(source: string, filename: string): CompiledScript | SyntaxError[] {
    try {
      return compileScript(source, this.#vmContext, filename);
    } catch (error) {
      // The compiler's fresh error has the intrinsic prototype; instanceof could
      // invoke an author-defined Symbol.hasInstance on the realm constructor.
      if (isObject(error) && Reflect.getPrototypeOf(error) === this.SyntaxError.prototype) {
        return [error as SyntaxError];
      }
      // eslint-disable-next-line no-restricted-properties -- Node's compiler allocates its syntax failure in the host realm.
      if (!(error instanceof globalThis.SyntaxError)) throw error;
      return [new this.SyntaxError(error.message)];
    }
  }

  /** Execute retained compiled code in this realm without an implicit checkpoint. */
  runScript(script: CompiledScript): unknown {
    return runWithActiveRealm(this, () => runScript(script, this.#vmContext));
  }

  /** Compile module source in this realm without linking or executing it. */
  compileModule(source: string, filename: string): CompiledModule {
    return compileModule(source, this.#vmContext, filename);
  }

  /** Retain a prepared author value as a synthetic module's default export. */
  createDefaultExportModule(value: unknown): CompiledModule {
    return createDefaultExportModule(value, this.#vmContext);
  }

  /** Read the engine's import requests before host resolution and loading. */
  getModuleRequests(module: CompiledModule): readonly ModuleRequest[] {
    return moduleRequests(module);
  }

  /** Link supplied dependencies in the order of each referrer's requests. */
  linkModule(root: CompiledModule, graph: Map<CompiledModule, CompiledModule[]>): void {
    linkModule(root, graph);
  }

  /** Evaluate a linked graph, returning its native completion Promise. */
  evaluateModule(module: CompiledModule): Promise<unknown> {
    return runWithActiveRealm(this, () => evaluateModule(module));
  }

  /** Return the linked module's namespace with live exported bindings. */
  getModuleNamespace(module: CompiledModule): object {
    return moduleNamespace(module);
  }

  /** Evaluate a script in this realm, using the supplied source location in diagnostics. */
  evaluate(source: string, filename: string, lineOffset = 0): unknown {
    return runWithActiveRealm(this, () =>
      runInContext(source, this.#vmContext, {
        displayErrors: false,
        filename,
        lineOffset,
      }));
  }

  /** Enqueue on the supplied queue without running a checkpoint. */
  protected enqueueMicrotask(steps: () => void): void {
    this.#microtaskQueue.enqueueMicrotask(steps);
  }

  /**
   * Install the host's global target and global-this, retaining captured intrinsics.
   * Native allocations require their exact target/proxy pair; stock Node bridges
   * global property access through the supplied global-this object.
   */
  protected initializeGlobalObjects(
    globalObject: GlobalObject,
    globalThis: GlobalThis,
  ): void {
    if (this.#globalObject !== this.#globalProxy) {
      throw new InternalError('Realm global objects are already initialized');
    }
    this.#globalObject = globalObject;
    this.#globalThis = globalThis;
    this.#installDefaultGlobalBindings();

    if (this.#globalAllocation !== undefined) {
      if (globalObject !== this.#globalAllocation.object || globalThis !== this.#globalProxy) {
        throw new InternalError('Native global initialization requires its allocated object and proxy');
      }
      // Intrinsics have been copied to the per-realm target. Remove configurable
      // backing properties before installing delegation so deletion/ownKeys do
      // not reveal an obsolete second copy on V8's hidden global object.
      for (const key of Reflect.ownKeys(this.#globalProxy)) {
        if (Reflect.getOwnPropertyDescriptor(this.#globalProxy, key)?.configurable) {
          Reflect.deleteProperty(this.#globalProxy, key);
        }
      }
      setGlobalObject(this.#vmContext, globalObject);
    } else {
      /*
       * ACCOMMODATION(node-vm-global-proxy): Node cannot make an existing host
       * object the VM context's actual global-this. Inherit through the supplied
       * global-this so free global names still reach the modeled global graph;
       * top-level `this` remains a documented limitation.
       */
      Reflect.setPrototypeOf(this.#globalProxy, globalThis);
    }
    Object.defineProperty(this.#globalProxy, 'globalThis', {
      configurable: true,
      value: globalThis,
      writable: true,
    });
    associateGlobalRealm(globalObject, this);
    associateGlobalRealm(globalThis, this);
  }

  /** Lock the engine proxy's prototype when supported; native allocations are already locked. */
  protected makeHostGlobalPrototypeImmutable(): void {
    if (this.#globalAllocation !== undefined) return;
    makePrototypeImmutable(this.#globalProxy);
  }

  #nextCollectionIterator(receiver: unknown, kind: CollectionIteratorKind): JSIteratorResult {
    const record = isObject(receiver) ? IteratorStamper.get(receiver) : undefined;
    if (!record || record.kind !== kind) {
      throw new this.TypeError('Illegal invocation');
    }
    if (record.running) throw new this.TypeError('Iterator is already running');
    if (record.next !== undefined) {
      record.running = true;
      try {
        const next = record.next;
        const result = next();
        if (!result.done) return result;
        record.next = undefined;
      } catch (error) {
        record.next = undefined;
        throw error;
      } finally {
        record.running = false;
      }
    }
    return this.createIteratorResultObject(undefined, true);
  }

  #installDefaultGlobalBindings(): void {
    for (const property of Reflect.ownKeys(this.#globalProxy)) {
      if (
        property === 'globalThis' ||
        Object.hasOwn(this.#globalObject, property)
      ) continue;

      const descriptor = Reflect.getOwnPropertyDescriptor(
        this.#globalProxy,
        property,
      );
      if (
        descriptor &&
        !Reflect.defineProperty(this.#globalObject, property, descriptor)
      ) {
        throw new InternalError(`Could not install global binding ${String(property)}`);
      }
    }
    Object.defineProperty(this.#globalObject, 'globalThis', {
      configurable: true,
      value: this.#globalThis,
      writable: true,
    });
  }
}

/**
 * Retained code from JSRealm.parseScript(): a Node.js vm.Script or the addon's
 * matching Script object. Both keep compilation separate from context selection.
 * HTML separately retains the associated realm and script.
 */
export interface CompiledScript {
  runInContext(context: VMContext, options?: { displayErrors?: boolean; }): unknown;
}

export type CollectionIteratorKind = 'map' | 'set';

/** Realm-created iterator result with both own data properties present. */
export type JSIteratorResult<Value = unknown, Done extends boolean = boolean> = {
  value: Value;
  done: Done;
};

type StampedIterator<T extends object = object> = T & IteratorStamper;

// Fallback state lives on the iterator, accessible to borrowed methods across realms.
class IteratorStamper extends Stamper {
  #state: FallbackIteratorRecord;

  private constructor(iterator: object, state: FallbackIteratorRecord) {
    super(iterator);
    this.#state = state;
  }

  static stamp<T extends object>(iterator: T, state: FallbackIteratorRecord): StampedIterator<T> {
    new IteratorStamper(iterator, state);
    return iterator as StampedIterator<T>;
  }

  static get(value: object): FallbackIteratorRecord | undefined {
    return #state in value ? value.#state : undefined;
  }
}

type FallbackIteratorRecord = {
  kind: CollectionIteratorKind;
  next: (() => JSIteratorResult) | undefined;
  running: boolean;
};

export type JSRealmOptions = {
  /** Realm whose proxy has already been detached for this context to reuse. */
  reuseGlobalProxyFrom?: JSRealm;
  /** Native prototype layers, ordered from the global's immediate prototype outward. */
  globalPrototypeChain?: GlobalPrototypeKind[];
};

export type GlobalPrototypeKind = 'mutable' | 'immutable' | 'delegated';

/** Global target and its prototype objects, allocated together for the host to populate. */
export type GlobalAllocation = {
  object: GlobalObject;
  /** Ordered from the target's immediate prototype outward, excluding Object.prototype. */
  prototypeChain: object[];
};

/** A realm's global object; no additional property shape is required. */
export type GlobalObject = object;

/** Host-selected value of the realm's global this binding. */
export type GlobalThis = object;

declare const globalProxyBrand: unique symbol;

/** An engine-created global proxy; its type-only brand adds no runtime property. */
export type GlobalProxy = {
  [globalProxyBrand]: true;
};

export type JSFunction<Result = unknown> = (
  ...argumentsList: unknown[]
) => Result;

export type RealmFunctionOptions = {
  name: string;
  length: number;
  constructible?: boolean;
};

export type RealmFunctionSteps<Result = unknown> = (
  thisArgument: unknown,
  argumentsList: unknown[],
  newTarget: JSFunction | undefined,
) => Result;

export type JSMethod = (
  this: unknown,
  ...argumentsList: unknown[]
) => unknown;

type RealmFunctionFactory = <Result>(
  steps: RealmFunctionSteps<Result>,
) => JSFunction<Result>;

const callableFunctionFactorySource = `
  (steps) => {
    "use strict";
    return {
      call(...argumentsList) {
        return steps(this, argumentsList, undefined);
      },
    }.call;
  }
`;

// Binding owns construction and must return the object. An ordinary function's
// [[Construct]] would first allocate a discarded receiver and read
// newTarget.prototype before the binding's own prototype lookup.
const constructibleFunctionFactorySource = `
  ((Proxy) => (steps) => {
    "use strict";
    const target = function(...argumentsList) {
      return steps(this, argumentsList, undefined);
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
