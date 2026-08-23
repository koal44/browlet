import type { BufferViewTypeName } from './definition';

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
    bufferSource: {
      arrayBuffer: ArrayBufferConstructor;
      arrayBufferTransfer: JavaScriptMethod;
      sharedArrayBuffer?: SharedArrayBufferConstructor;
      views: Partial<Record<BufferViewTypeName, BufferViewConstructor>>;
    };
    error: ErrorConstructor;
    errorPrototype: object;
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
    number: NumberConstructor;
    object: ObjectConstructor;
    objectPrototype: object;
    promise: {
      constructor: PromiseConstructor;
      reject: JavaScriptMethod;
      then: JavaScriptMethod;
    };
    rangeError: typeof RangeError;
    string: StringConstructor;
    typeError: typeof TypeError;
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
