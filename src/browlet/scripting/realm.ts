import { InternalError, type TaskRecord } from '../../infra/index';
import {
  JSRealm, bindAsyncContext, getAssociatedRealm, isObject,
  type GlobalAccessSelector, type GlobalObject, type GlobalPrototypeKind, type GlobalThis,
  type ImportModuleDynamically, type RealmFunctionSteps,
} from '../../js-engine/index';
import { unsafeSharedCurrentTime, type DOMHighResTimeStamp, type UnsafeMoment } from '../../timing/index';
import type { CallbackHooks, StampedPlatformObject, WebIDLEnvironment, WebIDLRealm } from '../../web-idl/index';
import { serializeURL } from '../../url/index';

import type { EventImpl } from '../dom/events/index';
import type { DocumentImpl } from '../dom/nodes/index';
import type { DOMRealm, WindowDOMRealm } from '../dom/index';
import type { WindowImpl, WindowProxyHandle } from '../browsing/window/index';
import type { BrowletEnvironment, BrowletEnvironmentBase, WindowEnvironment } from '../environment/index';
import type { Window, WindowProxy } from '../platform';

import { SandboxAgent, type Agent, type WindowAgent } from './agents';
import { JSExecutionContext } from './execution-context';
import type { TaskSource } from './event-loop';
import type { QueuedTaskHandle } from './tasks';
import { DynamicImport } from './import-handler';
import {
  CompiledScript, CompiledSourceTextModule, CompiledWasmModule,
  type ClassicScript, type JSModuleScript, type CompiledModule, type WasmModuleScript,
} from './script';
import { ModuleRequest } from './module-request';

/** Create an HTML realm and install the host-selected global and global-this identities. */
// https://html.spec.whatwg.org/multipage/webappapis.html#creating-a-new-javascript-realm
export function createBrowletRealm(
  agent: Agent,
  customizations: BrowletRealmCustomizations = {},
  options: BrowletRealmCreationOptions = {},
): JSExecutionContext {
  return new BrowletRealm({ ...options, agent }).initialize(customizations);
}

/** Adds HTML ownership, callback lifecycle, and task routing to an engine realm. */
// https://html.spec.whatwg.org/multipage/webappapis.html#realms-settings-objects-global-objects
// The attached environment owns binding-aware promises, allocations, and task delivery.
export class BrowletRealm extends JSRealm implements WebIDLRealm, DOMRealm {
  /** Browlet agent whose event loop serves this realm. */
  agent: Agent;
  /** Shared realm context pushed below each script's own execution context. */
  executionContext: JSExecutionContext;
  /** Binding hooks for HTML script and callback entry and cleanup. */
  callbacks: CallbackHooks;
  /** Whether the realm was created with cross-origin isolation enabled. */
  crossOriginIsolated: boolean;
  /** Web IDL global names controlling interface exposure. */
  globalNames: Set<string>;
  /** Whether this host permits changes to the global prototype chain. */
  isGlobalPrototypeChainMutable: boolean;
  /** Imports from code with no Script/Module record, retained with this realm's lifetime. */
  loadedModules = new Map<ModuleRequest, CompiledModule>();
  /** Security state retained during realm creation and replaced by the attached full environment. */
  #baseEnv: BrowletEnvironmentBase | undefined;
  /** HTML settings object stored in this realm's modeled HostDefined slot. */
  #env: BrowletEnvironment | undefined;
  #defaultDynamicImport: DynamicImport | undefined;

  constructor(options: BrowletRealmOptions) {
    const { agent } = options;
    super(agent.eventLoop.microtaskQueue, {
      globalPrototypeChain: options.globalPrototypeChain,
      globalAccess: options.globalAccess,
      reuseGlobalProxyFrom: options.reuseGlobalProxyFrom,
    });
    this.agent = agent;
    this.executionContext = new JSExecutionContext({ realm: this });
    this.crossOriginIsolated = options.crossOriginIsolated ?? false;
    this.globalNames = new Set(options.globalNames ?? []);
    this.isGlobalPrototypeChainMutable =
      options.isGlobalPrototypeChainMutable ?? false;
    this.#baseEnv = options.baseEnv;
    this.callbacks = {
      // Web IDL §§3.2.16 and 3.2.19; HTML §8.1.3.3.
      captureEnvironment: () => {
        const env = this.#env;
        if (env === undefined) return null;
        const loop = env.responsibleEventLoop;
        // ACCOMMODATION(node-v8-execution-contexts): A direct Node-host call
        // has no modeled entry. Capture its binding environment here rather
        // than weakening HTML's incumbent lookup inside an active entry.
        if (
          loop.executionContextStack.length === 0 &&
          loop.backupIncumbentEnvironmentStack.length === 0
        ) return env;
        return loop.getIncumbentEnvironment();
      },
      cleanUpAfterRunningCallback: (callbackEnv) => {
        const env = this.#getCallbackEnvironment(callbackEnv);
        if (env !== null) {
          env.responsibleEventLoop.cleanUpAfterRunningCallback(env);
        }
      },
      cleanUpAfterRunningScript: () => {
        const env = this.#env;
        if (env !== undefined) {
          env.responsibleEventLoop.cleanUpAfterRunningScript(env);
        }
      },
      getAssociatedRealm: (value) =>
        BrowletRealm.getAssociatedRealm(value) ?? this,
      prepareToRunCallback: (callbackEnv) => {
        const env = this.#getCallbackEnvironment(callbackEnv);
        if (env !== null) {
          this.agent.eventLoop.prepareToRunCallback(env);
        }
      },
      prepareToRunScript: () => {
        const env = this.#env;
        if (env !== undefined) {
          env.responsibleEventLoop.prepareToRunScript(env);
        }
      },
    };
  }

  static getAssociatedRealm(value: object): BrowletRealm | undefined {
    const realm = getAssociatedRealm(value);
    return realm instanceof BrowletRealm ? realm : undefined;
  }

  /** Whether an environment is attached to this realm; false during construction and for internal sandboxes. */
  get hasEnvironment(): boolean {
    return this.#env !== undefined;
  }

  /** Required browser environment; throws if none is attached. */
  // HTML stores the realm's environment settings object in ECMAScript's [[HostDefined]] field.
  // https://html.spec.whatwg.org/multipage/webappapis.html#concept-realm-settings-object
  get env(): BrowletEnvironment {
    if (this.#env === undefined) throw new InternalError('Realm has no environment');
    return this.#env;
  }

  set env(env: BrowletEnvironment) {
    if (this.#env !== env) this.#defaultDynamicImport = undefined;
    this.#baseEnv = env;
    this.#env = env;
  }

  /** Import handler for code with no retained Script/Module association. */
  get defaultDynamicImport(): DynamicImport {
    return this.#defaultDynamicImport ??= new DynamicImport(null, this.env);
  }

  /** Shared security state, available before and after full environment attachment. */
  get baseEnv(): BrowletEnvironmentBase | undefined {
    return this.#baseEnv;
  }

  get secureContext(): boolean {
    return this.#baseEnv?.isSecureContext ?? false;
  }

  /** Parse retained classic code with its exact HTML referrer captured for later imports. */
  // https://tc39.es/ecma262/#sec-parse-script
  parseClassicScript(source: string, script: ClassicScript): CompiledScript | SyntaxError[] {
    // The script retains its execution owner even without attached realm settings.
    const code = this.parseScript(source, serializeURL(script.baseURL!), this.supportsDynamicImport
      ? new DynamicImport(script, script.env)
      : undefined);
    if (Array.isArray(code)) return code;
    return new CompiledScript(script, code);
  }

  /** Parse a source-text module in this realm without linking or evaluating it. */
  // https://tc39.es/ecma262/#sec-parsemodule
  parseModule(source: string, script: JSModuleScript): CompiledSourceTextModule | SyntaxError[] {
    let code;
    try {
      code = this.compileModule(source, serializeURL(script.baseURL!), {
        dynamicImport: this.supportsDynamicImport
          ? new DynamicImport(script, script.env)
          : undefined,
        // Node/V8 create and cache import.meta during execution, after compiled
        // assignment. The module association survives calls and await resumptions.
        // Official addon bases lack the forwarding export: retain ordinary
        // compilation and the approved empty-metadata limitation on those bases.
        initializeImportMeta: this.supportsImportMeta ? (meta) => {
          for (const { key, value } of compiled.getImportMetaProperties()) {
            // ECMAScript's ImportMeta evaluation creates ordinary data properties.
            Object.defineProperty(meta, key, {
              value, writable: true, enumerable: true, configurable: true,
            });
          }
        } : undefined,
      });
    }
    catch (error) {
      if (isObject(error) && Reflect.getPrototypeOf(error) === this.SyntaxError.prototype) {
        return [error as SyntaxError];
      }
      // eslint-disable-next-line no-restricted-properties -- Stock Node can allocate parser failures in its host realm.
      if (!(error instanceof globalThis.SyntaxError)) throw error;
      return [new this.SyntaxError(error.message)];
    }
    const requests = this.getModuleRequests(code).map((request) =>
      new ModuleRequest(request.specifier,
        Object.entries(request.attributes).map(([key, value]) => ({ key, value })), request.phase));
    const compiled = new CompiledSourceTextModule(script, code, requests);
    return compiled;
  }

  /** Add a loaded module, requiring equivalent requests to retain the same module identity. */
  // The successful-association step of FinishLoadingImportedModule; the caller continues loading.
  // https://tc39.es/ecma262/#sec-FinishLoadingImportedModule
  addLoadedModule(request: ModuleRequest, module: CompiledModule): void {
    for (const [loadedRequest, loaded] of this.loadedModules) {
      if (!loadedRequest.equals(request)) continue;
      if (loaded !== module) throw new InternalError('A module request resolved to different modules');
      return;
    }
    this.loadedModules.set(request, module);
  }

  /** Parse a WebAssembly ESM record, including its imports, in this realm. */
  // https://webassembly.github.io/esm-integration/js-api/#parse-a-webassembly-module
  parseWebAssemblyModule(bodyBytes: Uint8Array, script: WasmModuleScript): CompiledWasmModule {
    const code = this.compileWebAssemblyModule(bodyBytes, serializeURL(script.baseURL!),
      (_module, imports) => compiled.createInstance(imports), () => compiled.instance.exports,
      () => this.env.project(compiled.moduleSource)!);
    // Reuse HTML's ModuleRequest records, with empty attributes and evaluation phase.
    const requests = this.getModuleRequests(code).map((request) => new ModuleRequest(
      request.specifier, Object.entries(request.attributes).map(([key, value]) => ({ key, value })), request.phase,
    ));
    const compiled = new CompiledWasmModule(script, code, requests);
    return compiled;
  }

  override evaluate(source: string, filename: string, lineOffset = 0): unknown {
    const env = this.#env;
    if (env === undefined) return super.evaluate(source, filename, lineOffset);
    return env.responsibleEventLoop.runScriptEvaluation(
      env,
      () => super.evaluate(source, filename, lineOffset),
    );
  }

  /** Convert a shared input reading, or the current time, to this realm's event timestamp. */
  // https://dom.spec.whatwg.org/#concept-event-create
  // https://dom.spec.whatwg.org/#inner-event-creation-steps
  // https://w3c.github.io/hr-time/#dfn-relative-high-resolution-time
  // DOM uses the time of the signaled occurrence. Keep input's raw reading until
  // its owning realm coarsens it and subtracts its time origin. With no supplied
  // reading, this is HRT's current high resolution time calculation.
  eventTimeStamp(time: UnsafeMoment = unsafeSharedCurrentTime()): DOMHighResTimeStamp {
    const env = this.#env;
    if (env === undefined) {
      // An unbound realm has no environment time origin. Retain the shared,
      // default-precision clock; without supplied input this is coarsenedSharedCurrentTime().
      return time.coarsen().milliseconds;
    }
    return env.relativeHighResolutionTime(time).toTimestamp();
  }

  /** Install this realm's globals while its retained creation context is running. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#creating-a-new-javascript-realm
  initialize(customizations: BrowletRealmCustomizations = {}): JSExecutionContext {
    const stack = this.agent.eventLoop.executionContextStack;
    stack.push(this.executionContext);
    try {
      const globalObject = customizations.createGlobalObject
        ? customizations.createGlobalObject(this)
        : this.createOrdinaryObject(this.objectPrototype);
      const globalThis = customizations.createGlobalThisValue
        ? customizations.createGlobalThisValue(this, globalObject)
        : globalObject;

      this.setGlobalObjects(globalObject, globalThis);
    } finally {
      stack.pop();
    }

    if (this.agent.agentCluster?.crossOriginIsolationMode === 'none') {
      const status = Reflect.deleteProperty(this.globalObject, 'SharedArrayBuffer');
      if (!status) throw new InternalError('Could not remove SharedArrayBuffer');
    }
    return this.executionContext;
  }

  isWindow(): this is WindowRealm {
    return false;
  }

  /** Report an uncaught exception for this realm's global. */
  reportException(exception: unknown): void {
    // Internal sandboxes have no HTML settings or error-event target. A missing
    // environment on a browser realm is instead an initialization error.
    if (this.agent instanceof SandboxAgent) {
      console.error(exception);
      return;
    }
    this.env.reportException(exception);
  }

  /** Document associated with a Window global; non-Window globals have none. */
  getAssociatedDocument(): DocumentImpl | null {
    return null;
  }

  /** Queue a task for this realm's global and its associated document. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#queue-a-global-task
  queueGlobalTask(
    source: TaskSource,
    task: TaskRecord,
  ): QueuedTaskHandle {
    const eventLoop = this.agent.eventLoop;
    const document = this.getAssociatedDocument();
    if (document?.isDestroyed) {
      // SPEC_GAP(document-fetch-cancellation): Parallel production can finish after
      // Document destruction removed its tasks. Only internal discard cleanup may
      // run; retain this loop and task source without reviving page work.
      const discarded = eventLoop.queueTask(source, null, {
        run: () => task.discard?.(),
        discard: task.discard,
      });
      return { remove: () => eventLoop.removeTask(discarded) };
    }
    const queuedTask = eventLoop.queueTask(source, document, { ...task, run: bindAsyncContext(task.run) });
    return { remove: () => eventLoop.removeTask(queuedTask) };
  }

  queueMicrotask(steps: () => void): void {
    this.agent.eventLoop.queueMicrotask(steps, this.getAssociatedDocument());
  }

  setGlobalObjects(
    globalObject: GlobalObject,
    globalThis: GlobalThis,
  ): void {
    this.initializeGlobalObjects(globalObject, globalThis);
    if (!this.isGlobalPrototypeChainMutable) {
      this.makeHostGlobalPrototypeImmutable();
    }
  }

  protected override createDefaultDynamicImportCallback(): ImportModuleDynamically<object> {
    // JSRealm calls this during super(); only the later import may read host state.
    return (specifier, _referrer, attributes, phase) =>
      this.defaultDynamicImport.importModule(specifier, attributes, phase);
  }

  protected override callWithIncumbent<Result>(
    incumbent: JSRealm | undefined, steps: RealmFunctionSteps<Result>,
    receiver: unknown, argumentsList: unknown[],
  ): Result {
    // Unregistered Node callers have no author observation. Keep explicit HTML
    // script entries and callback backups authoritative for those host calls.
    if (this.#env === undefined || !(incumbent instanceof BrowletRealm) || !incumbent.hasEnvironment) {
      return steps(receiver, argumentsList, undefined);
    }
    return this.#env.responsibleEventLoop.runPlatformCall(this, incumbent.env,
      () => steps(receiver, argumentsList, undefined));
  }

  #getCallbackEnvironment(callbackEnv: WebIDLEnvironment | null): BrowletEnvironment | null {
    if (callbackEnv === null) {
      if (this.#env === undefined) return null;
    } else {
      const { realm } = callbackEnv;
      if (realm instanceof BrowletRealm && realm.#env === callbackEnv) return realm.#env;
    }
    throw new InternalError('A callback environment is not a browser environment');
  }
}

/** HTML realm whose Window is linked during composition, before global installation. */
export class WindowRealm extends BrowletRealm implements WindowDOMRealm {
  declare agent: WindowAgent;
  #windowImplementation: WindowImpl | undefined;
  #windowProxy: WindowProxyHandle | undefined;

  constructor(options: WindowRealmOptions) {
    super({ ...options, globalNames: ['Window'], isGlobalPrototypeChainMutable: false });
  }

  /** Window environment attached during composition. */
  override get env(): WindowEnvironment {
    return super.env as WindowEnvironment;
  }

  override set env(env: WindowEnvironment) {
    super.env = env;
  }

  /** This realm's projected Window, distinct from its reusable global proxy. */
  override get globalObject(): StampedPlatformObject<Window> {
    return super.globalObject as StampedPlatformObject<Window>;
  }

  /** This realm's own Window, retained even after navigation replaces the proxy's target. */
  get windowImplementation(): WindowImpl {
    return this.#windowImplementation!;
  }

  set windowImplementation(window: WindowImpl) {
    if (this.#windowImplementation !== undefined) {
      throw new InternalError('Realm Window implementation is already initialized');
    }
    this.#windowImplementation = window;
  }

  /** Shared handle whose current Window can belong to a later realm after navigation. */
  get windowProxy(): WindowProxyHandle {
    return this.#windowProxy!;
  }

  set windowProxy(proxy: WindowProxyHandle) {
    if (this.#windowProxy !== undefined) {
      throw new InternalError('Realm WindowProxy is already initialized');
    }
    this.#windowProxy = proxy;
  }

  override getAssociatedDocument(): DocumentImpl {
    return this.windowImplementation.getAssociatedDocument();
  }

  override isWindow(): this is WindowRealm {
    return true;
  }

  /** Read the legacy Window.event value used during listener dispatch. */
  getCurrentEvent(): EventImpl | undefined {
    return this.windowImplementation.event;
  }

  /** Set or restore the Window's current event around a listener invocation. */
  setCurrentEvent(event: EventImpl | undefined): void {
    this.windowImplementation.event = event;
  }

  /** Performance-reporting hook for a listener invoked in this Window. */
  recordEventListenerTiming(
    _event: EventImpl,
    _callback: object,
  ): void {
    // TODO(Long Animation Frames section 3.2.2): Record event-listener timing
    // once Browlet has the HTML performance timeline machinery.
  }

  override setGlobalObjects(globalObject: StampedPlatformObject<Window>, globalThis: WindowProxy): void {
    super.setGlobalObjects(globalObject, globalThis);
    this.agent.windowObjects.add(this.windowImplementation);
  }
}

export type BrowletRealmCustomizations = {
  createGlobalObject?(realm: BrowletRealm): GlobalObject;
  createGlobalThisValue?(realm: BrowletRealm, globalObject: GlobalObject): GlobalThis;
};

export type BrowletRealmCreationOptions = Omit<BrowletRealmOptions, 'agent'>;

export type BrowletRealmOptions = {
  globalPrototypeChain?: GlobalPrototypeKind[];
  globalAccess?: GlobalAccessSelector;
  reuseGlobalProxyFrom?: BrowletRealm;
  agent: Agent;
  crossOriginIsolated?: boolean;
  globalNames?: string[];
  isGlobalPrototypeChainMutable?: boolean;
  baseEnv?: BrowletEnvironmentBase;
};

export type WindowRealmOptions = Omit<BrowletRealmOptions, 'globalNames' | 'isGlobalPrototypeChainMutable'> & {
  agent: WindowAgent;
  baseEnv: BrowletEnvironmentBase;
};
