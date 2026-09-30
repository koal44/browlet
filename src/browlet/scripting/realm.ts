import {
  JSRealm, bindAsyncContext, getAssociatedRealm, type GlobalObject, type JSRealmOptions,
} from '../../js-engine/index';
import type { CallbackHooks, SecurityCheckType, WebIDLRealm } from '../../web-idl/index';
import type { DocumentImpl } from '../dom/nodes/document';
import type { EventImpl } from '../dom/events/event';
import type { EventRealm, WindowEventRealm } from '../dom/environment';
import { type Agent, WindowAgent } from './agents';
import type { EnvironmentRecord, BrowletEnvironment } from './environment';
import type { TaskSource } from './event-loop';
import type { QueuedTaskHandle } from './tasks';
import type { WindowImpl } from '../browsing/window/window';
import { coarsenedSharedCurrentTime } from '../performance/high-resolution-time';
import { InternalError } from '../../infra/internal-error';
import type { TaskCreationOptions } from '../../infra/execution';

/** Create an HTML realm and install the host-selected global and global-this identities. */
// https://html.spec.whatwg.org/multipage/webappapis.html#creating-a-new-javascript-realm
export function createRealm(
  agent: Agent,
  customizations: RealmCustomizations,
  options: RealmCreationOptions = {},
): Realm {
  const realm = new Realm({ ...options, agent });
  const globalObject = customizations.createGlobalObject(realm);
  const globalThis = customizations.createGlobalThisValue
    ? customizations.createGlobalThisValue(realm, globalObject)
    : globalObject;

  realm.setGlobalObjects(globalObject, globalThis);
  return realm;
}

/** Adds HTML ownership, callback lifecycle, and task routing to an engine realm. */
// https://html.spec.whatwg.org/multipage/webappapis.html#realms-settings-objects-global-objects
export class Realm extends JSRealm implements WebIDLRealm, EventRealm {
  /** Agent whose event loop serves this realm. */
  agent: Agent;
  /** Binding hooks for HTML script and callback entry and cleanup. */
  callbacks: CallbackHooks;
  /** Whether the realm was created with cross-origin isolation enabled. */
  crossOriginIsolated: boolean;
  /** Web IDL global names controlling interface exposure. */
  globalNames: ReadonlySet<string>;
  /** Whether this host permits changes to the global prototype chain. */
  isGlobalPrototypeChainMutable: boolean;
  #envRecord: EnvironmentRecord | undefined;
  #hostDefined: BrowletEnvironment | undefined;

  constructor(options: RealmOptions = {}) {
    const agent = options.agent ?? new WindowAgent();
    super(agent.eventLoop.microtaskQueue, {
      globalPrototypeChain: options.globalPrototypeChain,
      reuseGlobalProxyFrom: options.reuseGlobalProxyFrom,
    });
    this.agent = agent;
    this.crossOriginIsolated = options.crossOriginIsolated ?? false;
    this.globalNames = new Set(options.globalNames ?? []);
    this.isGlobalPrototypeChainMutable =
      options.isGlobalPrototypeChainMutable ?? false;
    this.#envRecord = options.envRecord;
    this.callbacks = {
      // Web IDL §§3.2.16 and 3.2.19; HTML §8.1.3.3.
      captureContext: () => {
        const env = this.#hostDefined;
        if (env === undefined) return this;
        return env.responsibleEventLoop
          .getIncumbentSettingsObject(env);
      },
      cleanUpAfterRunningCallback: (context) => {
        const env = this.#getCallbackSettings(context);
        if (env !== undefined) {
          env.responsibleEventLoop
            .cleanUpAfterRunningCallback(env);
        }
      },
      cleanUpAfterRunningScript: () => {
        const env = this.#hostDefined;
        if (env !== undefined) {
          env.responsibleEventLoop.cleanUpAfterRunningScript(env);
        }
      },
      getAssociatedRealm: (value) =>
        Realm.getAssociatedRealm(value) ?? this,
      prepareToRunCallback: (context) => {
        const env = this.#getCallbackSettings(context);
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

  static getAssociatedRealm(value: object): Realm | undefined {
    const realm = getAssociatedRealm(value);
    return realm instanceof Realm ? realm : undefined;
  }

  /** Attached HTML settings object; internal sandbox realms have none. */
  get hostDefined(): BrowletEnvironment | undefined {
    return this.#hostDefined;
  }

  // TODO: Revisit merging env and hostDefined when additional realm
  // lifecycles clarify which callers still need an optional environment.
  /** Required browser environment; throws if no HTML settings object is attached. */
  get env(): BrowletEnvironment {
    if (this.#hostDefined === undefined) throw new InternalError('Realm has no environment');
    return this.#hostDefined;
  }

  /** Early security owner, replaced by full settings when the environment is attached. */
  get envRecord(): EnvironmentRecord | undefined {
    return this.#envRecord;
  }

  get secureContext(): boolean {
    return this.#envRecord?.isSecureContext ?? false;
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

  isWindow(): this is WindowRealm {
    return false;
  }

  /** Report an uncaught exception for this realm's global. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#report-an-exception
  reportException(exception: unknown): void {
    // TODO: Implement HTML error reporting, including ErrorEvent dispatch.
    console.error(exception);
  }

  /** Document used for HTML task activity checks; non-Window globals have none. */
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

  // -- Internal ---------------------------------------------------------

  setGlobalObjects(
    globalObject: GlobalObject,
    globalThis: object,
  ): void {
    this.initializeGlobalObjects(globalObject, globalThis);
    if (this.agent.agentCluster?.crossOriginIsolationMode === 'none') {
      const status = Reflect.deleteProperty(globalObject, 'SharedArrayBuffer');
      if (!status) throw new InternalError('Could not remove SharedArrayBuffer');
    }
    if (!this.isGlobalPrototypeChainMutable) {
      this.makeHostGlobalPrototypeImmutable();
    }
  }

  /** Attach this realm's HTML environment. */
  setHostDefined(env: BrowletEnvironment): void {
    this.#envRecord = env;
    this.#hostDefined = env;
  }

  // -- Private ----------------------------------------------------------

  #getCallbackSettings(
    context: object,
  ): BrowletEnvironment | undefined {
    if (this.#hostDefined === undefined && context instanceof Realm) return undefined;
    const env = context as BrowletEnvironment;
    if (env.realm.hostDefined === env) {
      return env;
    }
    throw new InternalError('A JavaScript callback context is not a settings object');
  }
}

/** HTML realm whose Window is linked during composition, before global installation. */
export class WindowRealm extends Realm implements WindowEventRealm {
  declare agent: WindowAgent;
  /** Window linked after its environment is composed and before global projection. */
  windowImplementation!: WindowImpl;

  constructor(options: WindowRealmOptions) {
    super({ ...options, globalNames: ['Window'], isGlobalPrototypeChainMutable: false });
  }

  override getAssociatedDocument(): DocumentImpl {
    return this.windowImplementation.getAssociatedDocument();
  }

  override isWindow(): this is WindowRealm {
    return true;
  }

  getCurrentEvent(): EventImpl | undefined {
    return this.windowImplementation.event;
  }

  setCurrentEvent(event: EventImpl | undefined): void {
    this.windowImplementation.event = event;
  }

  recordEventListenerTiming(
    _event: EventImpl,
    _callback: object,
  ): void {
    // TODO(Long Animation Frames section 3.2.2): Record event-listener timing
    // once Browlet has the HTML performance timeline machinery.
  }

  override setGlobalObjects(globalObject: GlobalObject, globalThis: object): void {
    super.setGlobalObjects(globalObject, globalThis);
    this.agent.windowObjects.add(this.windowImplementation);
  }
}

export type RealmCustomizations = {
  createGlobalObject(realm: Realm): GlobalObject;
  createGlobalThisValue?(realm: Realm, globalObject: GlobalObject): object;
};

export type RealmCreationOptions = Omit<RealmOptions, 'agent'>;

export type RealmOptions = {
  globalPrototypeChain?: JSRealmOptions['globalPrototypeChain'];
  reuseGlobalProxyFrom?: Realm;
  agent?: Agent;
  crossOriginIsolated?: boolean;
  globalNames?: string[];
  isGlobalPrototypeChainMutable?: boolean;
  envRecord?: EnvironmentRecord;
};

export type WindowRealmOptions = Omit<RealmOptions, 'globalNames' | 'isGlobalPrototypeChainMutable'> & {
  agent: WindowAgent;
  envRecord: EnvironmentRecord;
};
