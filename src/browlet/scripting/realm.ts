import {
  JSRealm, bindAsyncContext, getAssociatedRealm, type GlobalObject, type JSRealmOptions,
} from '../../js-engine/index';
import type { WebIDLRealmHost } from '../../web-idl/index';
import type { DocumentImpl } from '../dom/nodes/document';
import type { EventImpl } from '../dom/events/event';
import { type Agent, WindowAgent } from './agents';
import type { EnvironmentRecord, Environment } from './environment';
import type { TaskCreationOptions, TaskSource } from './event-loop';
import type { QueuedTaskHandle } from './tasks';
import type { WindowImpl } from '../browsing/window/window';
import { coarsenedSharedCurrentTime } from '../performance/high-resolution-time';
import { InternalError } from '../../infra/internal-error';

/*
 * HTML owns the Realm's Agent, settings object, callback lifecycle, and global
 * task routing. JSRealm supplies the lower JS Engine backend.
 */
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

export class Realm extends JSRealm implements WebIDLRealmHost {
  agent: Agent;
  callbacks: WebIDLRealmHost['callbacks'];
  crossOriginIsolated: boolean;
  globalNames: ReadonlySet<string>;
  isGlobalPrototypeChainMutable: boolean;
  #envRecord: EnvironmentRecord | undefined;
  #hostDefined: Environment | undefined;

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
      /* Web IDL §§3.2.16 and 3.2.19; HTML §8.1.3.3. */
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
      reportException: (exception) => {
        // TODO(HTML section 8.1.5): Report through the realm's error-reporting
        // machinery once Browlet implements it.
        console.error(exception);
      },
    };
  }

  static getAssociatedRealm(value: object): Realm | undefined {
    const realm = getAssociatedRealm(value);
    return realm instanceof Realm ? realm : undefined;
  }

  /** Attached HTML environment, or undefined before attachment. */
  get hostDefined(): Environment | undefined {
    return this.#hostDefined;
  }

  // TODO: Revisit merging env and hostDefined when additional realm
  // lifecycles clarify which callers still need an optional environment.
  /** Attached browser environment; throws before environment construction. */
  get env(): Environment {
    if (this.#hostDefined === undefined) throw new InternalError('Realm has no environment');
    return this.#hostDefined;
  }

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

  /** HTML §8.1.7.2, queue a global task, with this Realm supplying the global. */
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
  setHostDefined(env: Environment): void {
    this.#envRecord = env;
    this.#hostDefined = env;
  }

  // -- Private ----------------------------------------------------------

  #getCallbackSettings(
    context: object,
  ): Environment | undefined {
    if (this.#hostDefined === undefined && context instanceof Realm) return undefined;
    const env = context as Environment;
    if (env.realm.hostDefined === env) {
      return env;
    }
    throw new InternalError('A JavaScript callback context is not a settings object');
  }
}

/** HTML realm whose global is a Window, known before platform-object installation. */
export class WindowRealm extends Realm {
  declare agent: WindowAgent;
  /** Window implementation retained across global projection. */
  windowImplementation: WindowImpl;

  constructor(window: WindowImpl, options: WindowRealmOptions) {
    super({ ...options, globalNames: ['Window'], isGlobalPrototypeChainMutable: false });
    this.windowImplementation = window;
  }

  override getAssociatedDocument(): DocumentImpl {
    return this.windowImplementation.getAssociatedDocument();
  }

  getCurrentEvent(_global: object): EventImpl | undefined {
    return this.windowImplementation.getCurrentEvent();
  }

  setCurrentEvent(_global: object, event: EventImpl | undefined): void {
    this.windowImplementation.setCurrentEvent(event);
  }

  recordTimingInfo(
    _global: object,
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

type SecurityCheckType = Parameters<
  WebIDLRealmHost['performSecurityCheck']
>[2];
