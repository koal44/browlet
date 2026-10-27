import { InternalError, type TaskCreationOptions } from '../../infra/index';
import {
  JSRealm, bindAsyncContext, getAssociatedRealm,
  type GlobalObject, type GlobalThis, type JSRealmOptions,
} from '../../js-engine/index';
import type { CallbackHooks, SecurityCheckType, StampedPlatformObject, WebIDLRealm } from '../../web-idl/index';

import type { Window, WindowProxy } from '../platform';
import { coarsenedSharedCurrentTime, type DOMHighResTimeStamp } from '../timing/index';
import type { EventImpl } from '../dom/events/index';
import type { DocumentImpl } from '../dom/nodes/index';
import type { DOMRealm, WindowDOMRealm } from '../dom/index';
import type { BrowletEnvironment, BrowletEnvironmentBase, WindowEnvironment } from '../environment';
import type { WindowImpl, WindowProxyHandle } from '../browsing/window/index';

import type { Agent, WindowAgent } from './agents';
import { JSExecutionContext } from './execution-context';
import type { TaskSource } from './event-loop';
import type { QueuedTaskHandle } from './tasks';
import type {
  JavaScriptModuleScript, JSSourceTextModuleRecord, JSWebAssemblyModuleRecord, WebAssemblyModuleScript,
} from './script';

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
// The attached environment owns the composed execution, available as realm.env.exec.
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
  globalNames: ReadonlySet<string>;
  /** Whether this host permits changes to the global prototype chain. */
  isGlobalPrototypeChainMutable: boolean;
  /** Security state retained during realm creation and replaced by the attached full environment. */
  #baseEnv: BrowletEnvironmentBase | undefined;
  #hostDefined: BrowletEnvironment | undefined;

  constructor(options: BrowletRealmOptions) {
    const { agent } = options;
    super(agent.eventLoop.microtaskQueue, {
      globalPrototypeChain: options.globalPrototypeChain,
      reuseGlobalProxyFrom: options.reuseGlobalProxyFrom,
    });
    this.agent = agent;
    this.executionContext = new JSExecutionContext(this);
    this.crossOriginIsolated = options.crossOriginIsolated ?? false;
    this.globalNames = new Set(options.globalNames ?? []);
    this.isGlobalPrototypeChainMutable =
      options.isGlobalPrototypeChainMutable ?? false;
    this.#baseEnv = options.baseEnv;
    this.callbacks = {
      // Web IDL §§3.2.16 and 3.2.19; HTML §8.1.3.3.
      captureContext: () => {
        const env = this.#hostDefined;
        if (env === undefined) return this;
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
      cleanUpAfterRunningCallback: (context) => {
        const env = this.#getCallbackEnvironment(context);
        if (env !== undefined) {
          env.responsibleEventLoop.cleanUpAfterRunningCallback(env);
        }
      },
      cleanUpAfterRunningScript: () => {
        const env = this.#hostDefined;
        if (env !== undefined) {
          env.responsibleEventLoop.cleanUpAfterRunningScript(env);
        }
      },
      getAssociatedRealm: (value) =>
        BrowletRealm.getAssociatedRealm(value) ?? this,
      prepareToRunCallback: (context) => {
        const env = this.#getCallbackEnvironment(context);
        if (env !== undefined) {
          this.agent.eventLoop.prepareToRunCallback(env);
        }
      },
      prepareToRunScript: () => {
        const env = this.#hostDefined;
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

  /** Attached browser environment; internal sandbox realms have none. */
  get hostDefined(): BrowletEnvironment | undefined {
    return this.#hostDefined;
  }

  // TODO: Revisit merging env and hostDefined when additional realm
  // lifecycles clarify which callers still need an optional environment.
  /** Required browser environment; throws if none is attached. */
  get env(): BrowletEnvironment {
    if (this.#hostDefined === undefined) throw new InternalError('Realm has no environment');
    return this.#hostDefined;
  }

  /** Shared security state, available before and after full environment attachment. */
  get baseEnv(): BrowletEnvironmentBase | undefined {
    return this.#baseEnv;
  }

  get secureContext(): boolean {
    return this.#baseEnv?.isSecureContext ?? false;
  }

  /** Parse a source-text module in this realm without linking or evaluating it. */
  // https://tc39.es/ecma262/#sec-parsemodule
  parseModule(_source: string, _hostDefined: JavaScriptModuleScript): JSSourceTextModuleRecord | SyntaxError[] {
    // TODO: Connect ParseModule to our VMContext backend. Node's SourceTextModule
    // requires a Node context, whereas the native backend owns an addon context handle.
    throw new InternalError('Source-text module parsing is not implemented');
  }

  /** Parse a WebAssembly ESM record, including its imports, in this realm. */
  parseWebAssemblyModule(_bodyBytes: Uint8Array, _hostDefined: WebAssemblyModuleScript): JSWebAssemblyModuleRecord {
    // TODO: Supply WebAssembly's ESM integration. Compiling a WebAssembly.Module
    // alone does not provide its Module Record or JavaScript linking behavior.
    throw new InternalError('WebAssembly ESM parsing is not implemented');
  }

  override evaluate(source: string, filename: string, lineOffset = 0): unknown {
    const env = this.#hostDefined;
    if (env === undefined) return super.evaluate(source, filename, lineOffset);
    return env.responsibleEventLoop.runScriptEvaluation(
      env,
      () => super.evaluate(source, filename, lineOffset),
    );
  }

  eventTimeStamp(): DOMHighResTimeStamp {
    const env = this.#hostDefined;
    if (env === undefined) {
      return coarsenedSharedCurrentTime().milliseconds;
    }
    return env.timing.currentHighResolutionTime().toTimestamp();
  }

  /** Install this realm's globals while its retained creation context is running. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#creating-a-new-javascript-realm
  initialize(customizations: BrowletRealmCustomizations = {}): JSExecutionContext {
    const stack = this.agent.eventLoop.executionContextStack;
    stack.push(this.executionContext);
    try {
      const globalObject = customizations.createGlobalObject
        ? customizations.createGlobalObject(this)
        : this.createOrdinaryObject(this.intrinsics.objectPrototype);
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
  // https://html.spec.whatwg.org/multipage/webappapis.html#report-an-exception
  reportException(exception: unknown): void {
    // TODO: Implement HTML error reporting, including ErrorEvent dispatch.
    console.error(exception);
  }

  /** Document associated with a Window global; non-Window globals have none. */
  getAssociatedDocument(): DocumentImpl | null {
    return null;
  }

  performSecurityCheck(
    _platformObject: object,
    _identifier: string,
    _type: SecurityCheckType,
  ): void {
    // TODO(HTML cross-origin objects): Supply HTML's cross-origin access
    // checks once Browlet has WindowProxy and Location security machinery.
  }

  /** Queue a task for this realm's global and its associated document. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#queue-a-global-task
  queueGlobalTask(
    source: TaskSource,
    steps: () => void,
    options: TaskCreationOptions = {},
  ): QueuedTaskHandle {
    const eventLoop = this.agent.eventLoop;
    const document = this.getAssociatedDocument();
    const task = eventLoop.queueTask(source, document, bindAsyncContext(steps), options);
    return { remove: () => eventLoop.removeTask(task) };
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

  /** Attach this realm's HTML environment. */
  setHostDefined(env: BrowletEnvironment): void {
    this.#baseEnv = env;
    this.#hostDefined = env;
  }

  #getCallbackEnvironment(
    context: object,
  ): BrowletEnvironment | undefined {
    if (this.#hostDefined === undefined && context instanceof BrowletRealm) return undefined;
    const env = context as BrowletEnvironment;
    if (env.realm.hostDefined === env) {
      return env;
    }
    throw new InternalError('A callback context is not a browser environment');
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
  globalPrototypeChain?: JSRealmOptions['globalPrototypeChain'];
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
