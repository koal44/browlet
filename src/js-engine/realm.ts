export type JavaScriptRealm = {
  readonly global: object;
  readonly globalObject: object;
  readonly globalThis: object;
  readonly intrinsics: JavaScriptIntrinsics;
  readonly runtime: JavaScriptRuntime;

  createFunction(
    steps: RealmFunctionSteps,
    options: RealmFunctionOptions,
  ): JavaScriptFunction;

  createOrdinaryObject(prototype: object | null): object;

  evaluate(source: string, filename: string, lineOffset?: number): unknown;
};

export type JavaScriptRuntime = {
  readonly createMicrotaskQueue: () => JavaScriptMicrotaskQueue;
  readonly hasExplicitMicrotaskQueues: boolean;
  getAssociatedRealm(value: object): JavaScriptRealm | undefined;
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
