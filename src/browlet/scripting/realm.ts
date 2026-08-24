import {
  constants, createContext, runInContext, type Context,
} from 'node:vm';
import type { WebIDLRealmHost } from '../../web-idl/index';
import type { DocumentImpl } from '../dom/nodes/document';
import { type Agent, WindowAgent } from './agents';
import type { EnvironmentSettingsObject } from './environment';
import { WindowImpl } from '../window/window';

/*
 * HTML owns the Realm's agent, global-object, global-this, and host-defined
 * associations. This concrete Realm also supplies Browlet's narrow Web IDL
 * host capabilities; the private Node VM context is only its execution backend.
 */
export function createRealm(
  agent: Agent,
  customizations: RealmCustomizations,
  options: RealmCreationOptions = {},
): JavaScriptExecutionContext {
  const realm = new Realm({ ...options, agent });
  const globalObject = customizations.createGlobalObject(realm);
  const globalThis = customizations.createGlobalThisValue
    ? customizations.createGlobalThisValue(realm, globalObject)
    : globalObject;

  Realm.setGlobalObjects(realm, globalObject, globalThis);
  if (agent.agentCluster?.crossOriginIsolationMode === 'none') {
    const status = Reflect.deleteProperty(globalObject, 'SharedArrayBuffer');
    if (!status) throw new Error('Could not remove SharedArrayBuffer');
  }
  if (agent instanceof WindowAgent) {
    agent.windowObjects.add(globalObject as Window);
  }
  return { realm };
}

export class Realm implements WebIDLRealmHost {
  readonly agent: Agent;
  readonly callbacks: WebIDLRealmHost['callbacks'];
  readonly crossOriginIsolated: boolean;
  readonly globalNames: ReadonlySet<string>;
  readonly isGlobalPrototypeChainMutable: boolean;
  readonly intrinsics: WebIDLRealmHost['intrinsics'];
  readonly secureContext: boolean;
  readonly #callableFunctionFactory: RealmFunctionFactory;
  readonly #context: Context;
  readonly #constructibleFunctionFactory: RealmFunctionFactory;
  #globalObject: object;
  #globalThis: object;
  #hostDefined: EnvironmentSettingsObject | null = null;
  readonly #hostGlobal: RealmGlobal;
  static #callbackContexts: unknown[] = [];
  static #evaluatingRealm: Realm | undefined;
  // Provisional userland substitute for ECMAScript's inaccessible [[Realm]].
  // Every Realm shares this weak association for callback lookup; it should
  // move or narrow when HTML section 8.1 owns the full realm environment.
  static #objectRealms = new WeakMap<object, Realm>();

  constructor(options: RealmOptions = {}) {
    this.agent = options.agent ?? new WindowAgent();
    this.crossOriginIsolated = options.crossOriginIsolated ?? false;
    this.globalNames = new Set(options.globalNames ?? ['Window']);
    this.isGlobalPrototypeChainMutable =
      options.isGlobalPrototypeChainMutable ?? false;
    this.secureContext = options.secureContext ?? false;
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
    const Error_ = Reflect.get(this.#hostGlobal, 'Error') as ErrorConstructor;
    const Array_ = Reflect.get(this.#hostGlobal, 'Array') as ArrayConstructor;
    const Object_ = Reflect.get(this.#hostGlobal, 'Object') as ObjectConstructor;
    const Promise_ = Reflect.get(this.#hostGlobal, 'Promise') as PromiseConstructor;
    const Map_ = Reflect.get(this.#hostGlobal, 'Map') as MapConstructor;
    const Set_ = Reflect.get(this.#hostGlobal, 'Set') as SetConstructor;
    const arrayPrototype = Array_.prototype;
    const arrayValues = Reflect.get(
      arrayPrototype,
      'values',
    ) as WebIDLRealmHost['intrinsics']['iteration']['arrayValues'];
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
      bufferSource: {
        arrayBuffer: ArrayBuffer_,
        arrayBufferTransfer: Reflect.get(
          ArrayBuffer_.prototype,
          'transfer',
        ) as WebIDLRealmHost['intrinsics']['bufferSource']['arrayBufferTransfer'],
        sharedArrayBuffer: Reflect.get(
          this.#hostGlobal,
          'SharedArrayBuffer',
        ) as SharedArrayBufferConstructor | undefined,
        views: Object.fromEntries(bufferViewTypeNames.flatMap((name) => {
          const constructor: unknown = Reflect.get(this.#hostGlobal, name);
          return typeof constructor === 'function'
            ? [[name, constructor]]
            : [];
        })),
      },
      error: Error_,
      errorPrototype: Error_.prototype,
      function: Function_,
      functionPrototype: Function_.prototype,
      iteration: {
        arrayEntries: Reflect.get(
          arrayPrototype,
          'entries',
        ) as WebIDLRealmHost['intrinsics']['iteration']['arrayEntries'],
        arrayForEach: Reflect.get(
          arrayPrototype,
          'forEach',
        ) as WebIDLRealmHost['intrinsics']['iteration']['arrayForEach'],
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
      number: Reflect.get(this.#hostGlobal, 'Number') as NumberConstructor,
      object: Object_,
      objectPrototype: Object_.prototype,
      promise: {
        constructor: Promise_,
        reject: Reflect.get(Promise_, 'reject') as WebIDLRealmHost[
          'intrinsics'
        ]['promise']['reject'],
        then: Reflect.get(Promise_.prototype, 'then') as WebIDLRealmHost[
          'intrinsics'
        ]['promise']['then'],
      },
      rangeError: Reflect.get(this.#hostGlobal, 'RangeError') as typeof RangeError,
      string: Reflect.get(this.#hostGlobal, 'String') as StringConstructor,
      typeError: Reflect.get(this.#hostGlobal, 'TypeError') as typeof TypeError,
    };
    // TODO(HTML sections 8.1.4 and 8.1.5): Replace the synchronous
    // callback-context model and script no-ops with environment-settings and
    // execution-context machinery when Browlet implements those sections.
    this.callbacks = {
      captureContext: () => Realm.#callbackContexts.at(-1) ??
        Realm.#evaluatingRealm ?? this,
      cleanUpAfterRunningCallback: (context) => {
        if (Realm.#callbackContexts.at(-1) !== context) {
          throw new Error('Web IDL callback contexts were cleaned up out of order');
        }
        Realm.#callbackContexts.pop();
      },
      cleanUpAfterRunningScript: () => {},
      getAssociatedRealm: (value) =>
        Realm.#getAssociatedRealm(value) ?? this,
      prepareToRunCallback: (context) => {
        Realm.#callbackContexts.push(context);
      },
      prepareToRunScript: () => {},
      reportException: (exception) => {
        // TODO(HTML section 8.1.5): Report through the realm's error-reporting
        // machinery once Browlet implements it.
        console.error(exception);
      },
    };
    this.#callableFunctionFactory = runInContext(
      callableFunctionFactorySource,
      this.#context,
    ) as RealmFunctionFactory;
    this.#constructibleFunctionFactory = runInContext(
      constructibleFunctionFactorySource,
      this.#context,
    ) as RealmFunctionFactory;
    Realm.#objectRealms.set(this.#hostGlobal, this);
    Realm.#objectRealms.set(this.intrinsics.functionPrototype, this);
    Realm.#objectRealms.set(this.intrinsics.objectPrototype, this);
    Realm.#objectRealms.set(
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

  get hostDefined(): EnvironmentSettingsObject | null {
    return this.#hostDefined;
  }

  evaluate(source: string, filename: string, lineOffset = 0): unknown {
    const previous = Realm.#evaluatingRealm;
    Realm.#evaluatingRealm = this;
    try {
      const result = runInContext(source, this.#context, {
        displayErrors: false,
        filename,
        lineOffset,
      }) as unknown;
      if (isObject(result)) Realm.#objectRealms.set(result, this);
      return result;
    } finally {
      Realm.#evaluatingRealm = previous;
    }
  }

  eventTimeStamp(): DOMHighResTimeStamp {
    // TODO(High Resolution Time): Apply the realm's time origin and coarse
    // resolution rather than borrowing the surrounding Node.js realm.
    return performance.now();
  }

  getAssociatedDocument(): DocumentImpl {
    const window = this.#windowImplementation;
    if (!window) throw new Error('Realm global object has no associated Document');
    return WindowImpl.getAssociatedDocument(window);
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
    Realm.#objectRealms.set(function_, this);
    return function_;
  }

  performSecurityCheck(
    _platformObject: object,
    _identifier: string,
    _type: SecurityCheckType,
  ): void {
    // TODO(HTML cross-origin objects): Supply HTML's cross-origin access
    // checks once Browlet has WindowProxy and Location security machinery.
  }

  queueMicrotask(steps: () => void): void {
    this.agent.eventLoop.queueMicrotask(steps);
  }

  getCurrentEvent(_global: object): Event | undefined {
    const window = this.#windowImplementation;
    return window
      ? WindowImpl.getCurrentEvent(window)
      : undefined;
  }

  setCurrentEvent(_global: object, event: Event | undefined): void {
    const window = this.#windowImplementation;
    if (window) WindowImpl.setCurrentEvent(window, event);
  }

  recordTimingInfo(
    _global: object,
    _event: Event,
    _callback: EventListenerOrEventListenerObject,
  ): void {
    // TODO(Long Animation Frames section 3.2.2): Record event-listener timing
    // once Browlet has the HTML performance timeline machinery.
  }

  // -- Friends ----------------------------------------------------------

  static setGlobalObjects(
    realm: Realm,
    globalObject: object,
    globalThis: object,
  ): void {
    if (realm.#globalObject !== realm.#hostGlobal) {
      throw new Error('Realm global objects are already initialized');
    }
    realm.#globalObject = globalObject;
    realm.#globalThis = globalThis;
    Realm.#installDefaultGlobalBindings(realm);
    // Node cannot make an existing WindowProxy the VM context's actual
    // global-this. Inherit through the specified global-this so free global
    // names still reach the modeled Window graph; top-level `this` remains
    // the documented host limitation.
    Reflect.setPrototypeOf(realm.#hostGlobal, globalThis);
    Object.defineProperty(realm.#hostGlobal, 'globalThis', {
      configurable: true,
      value: globalThis,
      writable: true,
    });
    Realm.#objectRealms.set(globalObject, realm);
    Realm.#objectRealms.set(globalThis, realm);
  }

  static setHostDefined(
    realm: Realm,
    settings: EnvironmentSettingsObject,
  ): void {
    realm.#hostDefined = settings;
  }

  static getAssociatedRealm(value: object): Realm | undefined {
    return Realm.#getAssociatedRealm(value);
  }

  // -- Private ----------------------------------------------------------

  get #windowImplementation(): WindowImpl | undefined {
    return WindowImpl.is(this.#globalObject)
      ? this.#globalObject
      : undefined;
  }

  static #installDefaultGlobalBindings(realm: Realm): void {
    for (const property of Reflect.ownKeys(realm.#hostGlobal)) {
      if (
        property === 'globalThis' ||
        Object.hasOwn(realm.#globalObject, property)
      ) continue;

      const descriptor = Reflect.getOwnPropertyDescriptor(
        realm.#hostGlobal,
        property,
      );
      if (
        descriptor &&
        !Reflect.defineProperty(realm.#globalObject, property, descriptor)
      ) {
        throw new Error(`Could not install global binding ${String(property)}`);
      }
    }
    Object.defineProperty(realm.#globalObject, 'globalThis', {
      configurable: true,
      value: realm.#globalThis,
      writable: true,
    });
  }

  static #getAssociatedRealm(value: object): Realm | undefined {
    try {
      let current: object | null = value;
      while (current !== null) {
        const associated = Realm.#objectRealms.get(current);
        if (associated) {
          Realm.#objectRealms.set(value, associated);
          return associated;
        }
        current = Reflect.getPrototypeOf(current);
      }
    } catch {
      // Proxies can prevent prototype inspection. The converting realm is
      // the only useful fallback until HTML owns object/realm association.
    }
    return Realm.#evaluatingRealm;
  }
}

/*
 * The host-visible component of an ECMAScript execution context. Node/V8 owns
 * its evaluation state and execution-context stack; HTML currently needs us
 * to retain only the Realm component returned by "create a new realm".
 */
export type JavaScriptExecutionContext = {
  realm: Realm;
};

export type RealmCustomizations = {
  createGlobalObject(realm: Realm): object;
  createGlobalThisValue?(realm: Realm, globalObject: object): object;
};

export type RealmCreationOptions = Omit<RealmOptions, 'agent'>;

export type RealmGlobal = Record<PropertyKey, unknown>;

export type RealmOptions = {
  agent?: Agent;
  crossOriginIsolated?: boolean;
  globalNames?: readonly string[];
  isGlobalPrototypeChainMutable?: boolean;
  secureContext?: boolean;
};

type CreateFunction = WebIDLRealmHost['createFunction'];
type JavaScriptFunction = ReturnType<CreateFunction>;
type RealmFunctionOptions = Parameters<CreateFunction>[1];
type RealmFunctionSteps = Parameters<CreateFunction>[0];
type RealmFunctionFactory = (
  steps: RealmFunctionSteps,
) => JavaScriptFunction;

type SecurityCheckType = Parameters<
  WebIDLRealmHost['performSecurityCheck']
>[2];

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

const bufferViewTypeNames = [
  'Int8Array', 'Int16Array', 'Int32Array', 'Uint8Array', 'Uint16Array',
  'Uint32Array', 'Uint8ClampedArray', 'BigInt64Array', 'BigUint64Array',
  'Float16Array', 'Float32Array', 'Float64Array', 'DataView',
] as const;

function isObject(value: unknown): value is object {
  return value !== null && (
    typeof value === 'object' || typeof value === 'function'
  );
}
