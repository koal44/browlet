import type { BufferViewTypeName } from './declaration/index';

export type WebIDLRealmHost = {
  callbacks: {
    captureContext(): unknown;
    cleanUpAfterRunningCallback(context: unknown): void;
    cleanUpAfterRunningScript(): void;
    getAssociatedRealm(value: object): WebIDLRealmHost;
    prepareToRunCallback(context: unknown): void;
    prepareToRunScript(): void;
    reportException(exception: unknown): void;
  };
  readonly crossOriginIsolated: boolean;
  global: object;
  readonly globalNames: ReadonlySet<string>;
  readonly isGlobalPrototypeChainMutable: boolean;
  intrinsics: {
    array: ArrayConstructor;
    bigInt: BigIntConstructor;
    boolean: BooleanConstructor;
    bufferSource: {
      arrayBuffer: ArrayBufferConstructor;
      arrayBufferTransfer: JavaScriptMethod;
      cloneSharedArrayBuffer(buffer: object): object;
      sharedArrayBuffer?: SharedArrayBufferConstructor;
      views: Partial<Record<BufferViewTypeName, BufferViewConstructor>>;
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
  readonly secureContext: boolean;
  createFunction(
    steps: (
      thisArgument: unknown,
      argumentsList: unknown[],
      newTarget: JavaScriptFunction | undefined,
    ) => unknown,
    options: {
      name: string;
      length: number;
      constructible?: boolean;
    },
  ): JavaScriptFunction;
  performSecurityCheck(
    platformObject: object,
    identifier: string,
    type: SecurityCheckType,
  ): void;
  queueMicrotask(steps: () => void): void;
};

export type SecurityCheckType = 'getter' | 'method' | 'setter';

type JavaScriptFunction = (
  ...argumentsList: unknown[]
) => unknown;

type JavaScriptMethod = (
  this: unknown,
  ...argumentsList: unknown[]
) => unknown;

type BufferViewConstructor = new (
  buffer: ArrayBufferLike,
) => object;
