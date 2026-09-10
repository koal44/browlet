import type { Promises } from './promises';

export type JavaScriptRealm = {
  readonly global: GlobalObject;
  readonly globalObject: GlobalObject;
  readonly globalThis: object;
  readonly intrinsics: JavaScriptIntrinsics;
  readonly runtime: JavaScriptRuntime;
  readonly promises: Promises;

  createFunction(
    steps: RealmFunctionSteps,
    options: RealmFunctionOptions,
  ): JavaScriptFunction;

  createOrdinaryObject(prototype: object | null): object;

  evaluate(source: string, filename: string, lineOffset?: number): unknown;
};

/** A realm's global object; no additional property shape is required. */
export type GlobalObject = object;

export type JavaScriptRuntime = {
  readonly createMicrotaskQueue: () => JavaScriptMicrotaskQueue;
  readonly hasExplicitMicrotaskQueues: boolean;
  readonly supportsHostHooks: boolean;
  setHostHooks<HostDefined>(hooks: JavaScriptHostHooks<HostDefined>): void;
  getAssociatedRealm(value: object): JavaScriptRealm | undefined;
  /** Retain the registration's host async context for a later task handoff. */
  bindAsyncContext<T>(steps: () => T): () => T;
  observePromise(
    realm: JavaScriptRealm,
    promise: Promise<unknown>,
    onFulfilled: JavaScriptFunction | undefined,
    onRejected: JavaScriptFunction | undefined,
  ): void;
};

export type JavaScriptHostHooks<HostDefined> = {
  makeJobCallback(
    this: void,
    callback: JavaScriptFunction,
    registration: JavaScriptJobRegistration,
  ): JavaScriptJobCallback<HostDefined>;
  callJobCallback(
    this: void,
    record: JavaScriptJobCallback<HostDefined>,
    receiver: unknown,
    argumentsList: unknown[],
  ): unknown;
  enqueuePromiseJob(
    this: void,
    job: () => void,
    realm: JavaScriptRealm | null,
    queueRealm: JavaScriptRealm | null,
  ): false | void;
  enqueueGenericJob(
    this: void,
    job: () => void,
    realm: JavaScriptRealm | null,
  ): void;
  enqueueTimeoutJob(
    this: void,
    job: () => void,
    realm: JavaScriptRealm | null,
    milliseconds: number,
  ): void;
};

export type JavaScriptJobCallback<HostDefined> = {
  readonly callback: JavaScriptFunction;
  readonly hostDefined: HostDefined;
};

export type JavaScriptJobRegistration = {
  readonly incumbent: JavaScriptRealm | null;
  readonly hostDefinedOptions: readonly unknown[];
};

export type JavaScriptMicrotaskQueue = {
  readonly kind: 'ambient' | 'explicit';
  enqueueMicrotask(steps: () => void): void;
  performMicrotaskCheckpoint(): void;
};

export type JavaScriptIntrinsics = {
  array: ArrayConstructor;
  bigInt: BigIntConstructor;
  boolean: BooleanConstructor;
  bufferSource: {
    arrayBuffer: ArrayBufferConstructor;
    arrayBufferTransfer: JavaScriptMethod;
    cloneSharedArrayBuffer(buffer: object): object;
    sharedArrayBuffer?: SharedArrayBufferConstructor;
    views: Partial<Record<JavaScriptBufferViewName, BufferViewConstructor>>;
  };
  date: DateConstructor;
  error: ErrorConstructor;
  errorPrototype: object;
  errorStack?: (this: object) => unknown;
  evalError: EvalErrorConstructor;
  function: FunctionConstructor;
  functionPrototype: object;
  iteration: {
    arrayEntries: JavaScriptMethod;
    arrayForEach: JavaScriptMethod;
    arrayKeys: JavaScriptMethod;
    arrayValues: JavaScriptMethod;
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
    reject: JavaScriptMethod;
    then: JavaScriptMethod;
  };
  rangeError: typeof RangeError;
  referenceError: ReferenceErrorConstructor;
  regExp: RegExpConstructor;
  set: SetConstructor;
  string: StringConstructor;
  syntaxError: SyntaxErrorConstructor;
  typeError: typeof TypeError;
  uriError: URIErrorConstructor;
};

export type JavaScriptFunction = (
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
  newTarget: JavaScriptFunction | undefined,
) => unknown;

export type JavaScriptBufferViewName =
  | 'BigInt64Array'
  | 'BigUint64Array'
  | 'DataView'
  | 'Float16Array'
  | 'Float32Array'
  | 'Float64Array'
  | 'Int16Array'
  | 'Int32Array'
  | 'Int8Array'
  | 'Uint16Array'
  | 'Uint32Array'
  | 'Uint8Array'
  | 'Uint8ClampedArray';

export type JavaScriptMethod = (
  this: unknown,
  ...argumentsList: unknown[]
) => unknown;

type BufferViewConstructor = new (
  buffer: ArrayBufferLike,
) => object;
