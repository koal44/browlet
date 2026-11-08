import * as vm from 'node:vm';
import { createRequire } from 'node:module';
import { isAbsolute } from 'node:path';

import { InternalError } from '../infra/internal-error';

import type {
  CollectionIteratorKind, EngineCode, EngineScript, ExoticObjectHandlers, FunctionCompilationOptions,
  GlobalAccessHandlers, GlobalIndexedProperties, GlobalObject, GlobalPrototypeKind, GlobalProxy,
  JSFunction, JSFunctionWithPrototype, JSIteratorResult,
} from './realm';
import type { JSWasmInstance, JSWasmModule } from './built-in-primitives';
import type { JSJobCallback, VMContext } from './runtime';
import type {
  ImportModuleDynamically, ModuleOptions, EngineSourceTextModule, SourceTextModuleOptions, EngineSyntheticModule,
  EngineWasmModule, WasmModuleOptions,
} from './modules';

/** Typed calls to the selected backend's optional engine extensions. */
export class NodeAPI {
  /** Whether this backend supports native document.all allocation and property handling. */
  supportsHTMLDDA: boolean;
  /** Whether addon modules can install Node-shaped import.meta initializers. */
  supportsImportMeta: boolean;
  /** Whether addon contexts and compiled code can install Node-shaped import callbacks. */
  supportsDynamicImport: boolean;

  /** Allocate an outside-owned suspension control before native thread creation. */
  createThreadControl?: () => number;
  /** Associate the starting child isolate; false if its owner already stopped it. */
  attachThreadControl?: (token: number) => boolean;
  /** Permanently disable suspension from inside the controlled isolate before its cleanup phase. */
  preventThreadSuspension?: (token: number) => void;
  /** Inside-only monotonic milliseconds since control creation, excluding accepted suspension periods. */
  getThreadElapsedTime?: (token: number) => number;
  /** Request interruption without unwinding the target's JavaScript stack. */
  suspendThread?: (token: number) => void;
  /** Wake a suspended isolate without using its blocked host message queue. */
  resumeThread?: (token: number) => void;
  /** Terminate and wake this isolate and its controlled descendants before Node teardown. */
  stopThread?: (token: number) => void;
  /** Whether the native interrupt has reached its suspension wait. */
  isThreadSuspended?: (token: number) => boolean;
  /** Release outside ownership after native exit or failed thread construction. */
  releaseThreadControl?: (token: number) => void;

  // Requires the V8 iterator-factory patch.
  createCollectionIterator?: <Value>(
    context: VMContext, kind: CollectionIteratorKind, next: () => JSIteratorResult<Value>,
  ) => MapIterator<Value> | SetIterator<Value>;
  createContextHandle?: (options?: AddonContextOptions) => AddonContextHandle;
  /** Allocate an exotic object whose trap lookup captures the actual accessing realm. */
  createExoticObject?: (
    realmAnchor: object, select: (realm: object) => ExoticObjectHandlers,
  ) => object;
  /** Allocate a nonconstructible native function that captures incumbent identity before calling host steps. */
  createFunctionWithIncumbent?: <Result>(
    context: VMContext,
    steps: (incumbent: object | null, receiver: unknown, argumentsList: unknown[]) => Result,
  ) => JSFunction<Result>;
  /** Allocate the callable, undetectable object used for document.all; attach properties with setPropertyHandlers. */
  createHTMLDDA?: <Result>(context: VMContext, call: JSFunction<Result>) => JSFunction<Result>;
  createMicrotaskQueue?: (requestCheckpoint?: () => void) => AddonMicrotaskQueueHandle;
  /** Node-shaped retained scripts; HTML selects the realm when running them. */
  Script?: new (source: string, options?: ContextEvaluationOptions) => EngineScript;
  /** Node-shaped FunctionBody compilation, with a retained-source name extension. */
  compileFunction?: (source: string, parameters: string[], options: FunctionCompilationOptions & {
    parsingContext: VMContext;
  }) => JSFunction;
  /** Node-shaped source-text modules bound to an existing context. */
  SourceTextModule?: new (source: string, options: SourceTextModuleOptions) => EngineSourceTextModule;
  /** Node-shaped synthetic modules with named, mutable exports. */
  SyntheticModule?: new (
    exports: string[], evaluate: (this: EngineSyntheticModule) => void, options: ModuleOptions,
  ) => EngineSyntheticModule;
  /** Retained Wasm source and VM graph record; stock Node has no public counterpart. */
  WebAssemblyModule?: new (bytes: Uint8Array, options: WasmModuleOptions) => EngineWasmModule;
  getFunctionRealm?: (value: JSFunction) => object;
  getRealm?: (value: object) => object;
  // Require the V8 iterator-brand predicates.
  isArrayIterator?: (value: unknown) => boolean;
  isStringIterator?: (value: unknown) => boolean;
  isRegExpStringIterator?: (value: unknown) => boolean;
  /** Allocate in the destination context while retaining the source's shared backing store. */
  cloneSharedArrayBuffer?: (buffer: SharedArrayBuffer, context: VMContext) => SharedArrayBuffer;
  /** Allocate a new Module in the destination context, reusing its compiled code and options. */
  cloneWebAssemblyModule?: (module: JSWasmModule, context: VMContext) => JSWasmModule;
  /** null for an unrecognized namespace; undefined for a Wasm record without an Instance yet. */
  getWebAssemblyNamespaceInstance?: (namespace: object) => JSWasmInstance | null | undefined;
  // Requires the V8 length-tracking patch.
  isLengthTrackingArrayBufferView?: (view: ArrayBufferView) => boolean;
  /** Recognize a native WebAssembly.Module without enumerating its exports. */
  isWebAssemblyModule?: (value: unknown) => boolean;
  /** Recognize a native Global by its internal type without reading or converting its value. */
  isWebAssemblyGlobal?: (value: unknown) => boolean;
  /** Invoke an imported callback with its native result conversion inside the call. */
  createWebAssemblyImportCall?: (
    module: JSWasmModule, importIndex: number, callback: JSFunction, instanceConstructor: JSFunctionWithPrototype,
  ) => JSFunction;
  /** Recognize a genuine WeakRef without dereferencing its target. */
  isWeakRef?: (value: unknown) => boolean;
  // Requires the V8 FinalizationRegistry predicate patch.
  isFinalizationRegistry?: (value: unknown) => boolean;
  // Legacy Node patch for making an existing object's prototype immutable.
  makePrototypeImmutable?: (object: object) => void;
  observePromise?: (
    promise: Promise<unknown>, realmAnchor: JSFunction | PromiseConstructor,
    onFulfilled?: JSFunction, onRejected?: JSFunction,
  ) => Promise<unknown>;
  /** Read engine slots without reactions, species lookup, or author property access. */
  isPromiseHandled?: (promise: Promise<unknown>) => boolean;
  getPromiseResult?: (promise: Promise<unknown>) => unknown;
  /** Receive synchronous notifications with retained code; undefined means no metadata, null means foreign code. */
  setPromiseRejectionTracker?: (
    context: VMContext,
    tracker: ((promise: Promise<unknown>, operation: 'reject' | 'handle', compiledCode: EngineCode | null | undefined) => void) | undefined,
  ) => void;
  /** Route uncaught engine errors to the owning context, including native registry cleanup failures. */
  setExceptionReporter?: (context: VMContext, reporter: ((exception: unknown) => void) | undefined) => void;
  /** Hand native Wasm resolution to the owning host as a one-shot completion. */
  setWasmAsyncCompletionCallback?: (
    context: VMContext, callback: ((complete: () => void, promise: Promise<unknown>) => void) | undefined,
  ) => void;
  /** Intercept native eval/Function compilation; an object created in the target context identifies its realm. */
  setModifyCodeGenerationFromStringsCallback?: (
    realmReference: object,
    callback: ((source: unknown, isCodeLike: boolean) => string | false | undefined) | undefined,
  ) => void;
  /** Internal, nonthrowing Wasm policy decision. Node's own compilation checks still apply. */
  setAllowWasmCodeGenerationCallback?: (
    realmReference: object, callback: (() => boolean) | undefined,
  ) => void;
  /** Install an internal nonthrowing clock returning signed-64-bit Unix-epoch nanoseconds. */
  setTemporalHostSystemUTCEpochNanosecondsCallback?: (
    realmReference: object, callback: (() => bigint) | undefined,
  ) => void;
  runInContext?: (
    source: string, context: VMContext, options?: ContextEvaluationOptions,
  ) => unknown;
  setGlobalObject?: (context: VMContext, object: object, indexedProperties?: GlobalIndexedProperties) => void;
  /** Supply caller-selected access policy for an opt-in native global. */
  setGlobalAccess?: (target: GlobalProxy, select: (realm: object) => GlobalAccessHandlers) => void;
  /** Preserve an original global's IDL attribute receiver after proxy reuse. */
  registerGlobalGetter?: (context: VMContext, getter: JSFunction) => void;
  // Requires the V8 host-hook patches.
  setHostHooks?: <HostDefined>(hooks: AddonHostHooks<HostDefined>) => void;
  setPropertyDelegate?: (object: object, delegate: object) => void;
  setPropertyHandlers?: (object: object, handlers: AddonPropertyHandlers) => void;

  constructor(backend: object) {
    this.createThreadControl = this.#loadMethod(backend, 'createThreadControl');
    this.attachThreadControl = this.#loadMethod(backend, 'attachThreadControl');
    this.preventThreadSuspension = this.#loadMethod(backend, 'preventThreadSuspension');
    this.getThreadElapsedTime = this.#loadMethod(backend, 'getThreadElapsedTime');
    this.suspendThread = this.#loadMethod(backend, 'suspendThread');
    this.resumeThread = this.#loadMethod(backend, 'resumeThread');
    this.stopThread = this.#loadMethod(backend, 'stopThread');
    this.isThreadSuspended = this.#loadMethod(backend, 'isThreadSuspended');
    this.releaseThreadControl = this.#loadMethod(backend, 'releaseThreadControl');
    this.createCollectionIterator = this.#loadMethod(backend, 'createCollectionIterator');
    this.createContextHandle = this.#loadMethod(backend, 'createContextHandle');
    this.createExoticObject = this.#loadMethod(backend, 'createExoticObject');
    this.createFunctionWithIncumbent = this.#loadMethod(backend, 'createFunctionWithIncumbent');
    this.createHTMLDDA = this.#loadMethod(backend, 'createHTMLDDA');
    this.createMicrotaskQueue = this.#loadMethod(backend, 'createMicrotaskQueue');
    this.Script = this.#loadMethod(backend, 'Script');
    this.compileFunction = this.#loadMethod(backend, 'compileFunction');
    this.SourceTextModule = this.#loadMethod(backend, 'SourceTextModule');
    this.SyntheticModule = this.#loadMethod(backend, 'SyntheticModule');
    this.WebAssemblyModule = this.#loadMethod(backend, 'WebAssemblyModule');
    this.getFunctionRealm = this.#loadMethod(backend, 'getFunctionRealm');
    this.getRealm = this.#loadMethod(backend, 'getRealm');
    this.isArrayIterator = this.#loadMethod(backend, 'isArrayIterator');
    this.isStringIterator = this.#loadMethod(backend, 'isStringIterator');
    this.isRegExpStringIterator = this.#loadMethod(backend, 'isRegExpStringIterator');
    this.cloneSharedArrayBuffer = this.#loadMethod(backend, 'cloneSharedArrayBuffer');
    this.cloneWebAssemblyModule = this.#loadMethod(backend, 'cloneWebAssemblyModule');
    this.getWebAssemblyNamespaceInstance = this.#loadMethod(backend, 'getWebAssemblyNamespaceInstance');
    this.isLengthTrackingArrayBufferView = this.#loadMethod(backend, 'isLengthTrackingArrayBufferView');
    this.isWebAssemblyModule = this.#loadMethod(backend, 'isWebAssemblyModule');
    this.isWebAssemblyGlobal = this.#loadMethod(backend, 'isWebAssemblyGlobal');
    this.createWebAssemblyImportCall = this.#loadMethod(backend, 'createWebAssemblyImportCall');
    this.isWeakRef = this.#loadMethod(backend, 'isWeakRef');
    this.isFinalizationRegistry = this.#loadMethod(backend, 'isFinalizationRegistry');
    this.makePrototypeImmutable = this.#loadMethod(backend, 'makePrototypeImmutable');
    this.observePromise = this.#loadMethod(backend, 'observePromise');
    this.isPromiseHandled = this.#loadMethod(backend, 'isPromiseHandled');
    this.getPromiseResult = this.#loadMethod(backend, 'getPromiseResult');
    this.setPromiseRejectionTracker = this.#loadMethod(backend, 'setPromiseRejectionTracker');
    this.setExceptionReporter = this.#loadMethod(backend, 'setExceptionReporter');
    this.setWasmAsyncCompletionCallback = this.#loadMethod(backend, 'setWasmAsyncCompletionCallback');
    this.setModifyCodeGenerationFromStringsCallback = this.#loadMethod(backend, 'setModifyCodeGenerationFromStringsCallback');
    this.setAllowWasmCodeGenerationCallback = this.#loadMethod(backend, 'setAllowWasmCodeGenerationCallback');
    this.setTemporalHostSystemUTCEpochNanosecondsCallback = this.#loadMethod(backend, 'setTemporalHostSystemUTCEpochNanosecondsCallback');
    this.runInContext = this.#loadMethod(backend, 'runInContext');
    this.setGlobalObject = this.#loadMethod(backend, 'setGlobalObject');
    this.setGlobalAccess = this.#loadMethod(backend, 'setGlobalAccess');
    this.registerGlobalGetter = this.#loadMethod(backend, 'registerGlobalGetter');
    this.setHostHooks = this.#loadMethod(backend, 'setHostHooks');
    this.setPropertyDelegate = this.#loadMethod(backend, 'setPropertyDelegate');
    this.setPropertyHandlers = this.#loadMethod(backend, 'setPropertyHandlers');
    this.supportsHTMLDDA = this.createHTMLDDA !== undefined && this.setPropertyHandlers !== undefined;
    this.supportsImportMeta = Reflect.get(backend, 'supportsImportMeta') === true;
    this.supportsDynamicImport = Reflect.get(backend, 'supportsDynamicImport') === true;
  }

  #loadMethod<Name extends keyof AddonMethods>(backend: object, name: Name): AddonMethods[Name] {
    const method: unknown = Reflect.get(backend, name);
    if (method === undefined) return undefined;
    if (typeof method !== 'function') {
      throw new InternalError(`Node backend ${name} is not callable`);
    }
    return method.bind(backend) as AddonMethods[Name];
  }
}

export const addon = new NodeAPI(loadNodeApi());

// Derive the operation signatures from the public properties rather than listing them twice.
type AddonMethods = Omit<NodeAPI, 'supportsHTMLDDA' | 'supportsImportMeta' | 'supportsDynamicImport'>;

/**
 * Supply intercepted properties for a native object.
 * `hasOwn` reports an ordinary own property already stored on that object,
 * excluding properties supplied by these handlers.
 */
// Used for HTMLAllCollection (document.all), whose falsiness an outer Proxy would lose.
export type AddonPropertyHandlers = {
  /** Whether get handles this key; false continues ordinary lookup. */
  has(key: string | symbol, hasOwn: boolean): boolean;
  // For get/set, Node 24 supplies the receiver, Node 26+ supplies the holder,
  // and global callbacks supply undefined to use their bound target.
  /** Read an intercepted value after has returns true. */
  get(key: string | symbol, receiver: object | undefined): unknown;
  /** Assign a value: true succeeds, false rejects, and undefined leaves ordinary assignment to V8. */
  set(key: string | symbol, value: unknown, receiver: object | undefined, hasOwn: boolean): boolean | undefined;
  /** Describe an intercepted own property; undefined lets V8 inspect ordinary properties. */
  getOwnPropertyDescriptor(key: string | symbol, hasOwn: boolean): PropertyDescriptor | undefined;
  /** Supply lookup flags through a descriptor; defaults to getOwnPropertyDescriptor. */
  // V8 consults these flags during assignment, so they may differ from the public descriptor.
  getPropertyAttributes?(key: string | symbol, hasOwn: boolean): PropertyDescriptor | undefined;
  /** Define a property: true succeeds, false rejects, and undefined leaves ordinary definition to V8. */
  defineProperty(key: string | symbol, descriptor: PropertyDescriptor, hasOwn: boolean): boolean | undefined;
  /** Delete a property: true succeeds, false rejects, and undefined leaves ordinary deletion to V8. */
  deleteProperty(key: string | symbol, hasOwn: boolean): boolean | undefined;
  /** List intercepted own keys; V8 also includes ordinary own keys. */
  ownKeys(): (string | symbol)[];
};

export type AddonMicrotaskQueueHandle = {
  enqueueMicrotask(steps: () => void): void;
  runMicrotasks(): void;
};

export type AddonContextHandle = {
  realm: object;
  globalProxy: GlobalProxy;
  globalObject?: GlobalObject;
  prototypeChain?: object[];
  detachGlobal(): GlobalProxy;
};

type AddonContextOptions = {
  microtaskQueue?: AddonMicrotaskQueueHandle;
  reuseGlobalProxyFrom?: VMContext;
  globalPrototypeChain?: GlobalPrototypeKind[];
  globalAccess?: boolean;
  importModuleDynamically?: ImportModuleDynamically<VMContext>;
};

/** Evaluation options shared by node:vm and the compatibility addon. */
export type ContextEvaluationOptions = {
  displayErrors?: boolean;
  filename?: string;
  lineOffset?: number;
  /** Callback attached to this compilation, independently of its diagnostic filename. */
  importModuleDynamically?: ImportModuleDynamically<EngineScript>;
};

type AddonHostHooks<HostDefined> = {
  makeJobCallback?(
    callback: JSFunction,
    registration: { incumbent: object | null; compiledCode: EngineCode | null | undefined; },
  ): JSJobCallback<HostDefined>;
  callJobCallback?(
    record: JSJobCallback<HostDefined>, receiver: unknown, argumentsList: unknown[],
  ): unknown;
  enqueuePromiseJob?(job: () => void, realm: object | null): false | void;
  enqueueGenericJob?(job: () => void, realm: object): false | void;
  enqueueTimeoutJob?(job: () => void, realm: object, milliseconds: number): false | void;
};

export function isAddonMicrotaskQueueHandle(value: unknown): value is AddonMicrotaskQueueHandle {
  return typeof value === 'object' && value !== null &&
    typeof Reflect.get(value, 'enqueueMicrotask') === 'function' &&
    typeof Reflect.get(value, 'runMicrotasks') === 'function';
}

export function isAddonContextHandle(value: unknown): value is AddonContextHandle {
  if (typeof value !== 'object' || value === null) return false;
  const globalProxy: unknown = Reflect.get(value, 'globalProxy');
  return (typeof globalProxy === 'object' && globalProxy !== null) &&
    typeof Reflect.get(value, 'detachGlobal') === 'function';
}

function loadNodeApi(): object {
  const addonPath = process.env.BROWLET_NODE_ADDON;
  if (addonPath === undefined) return vm;
  if (!isAbsolute(addonPath)) {
    throw new InternalError('BROWLET_NODE_ADDON must be an absolute module path');
  }
  const api: unknown = createRequire(process.execPath)(addonPath);
  if (typeof api !== 'object' || api === null) {
    throw new InternalError('BROWLET_NODE_ADDON must export a Node backend');
  }
  return api;
}
