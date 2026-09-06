import { NodeRealm, nodeRuntime, type NodeRealmOptions } from '../../js-engine/index';
import type { WebIDLRealmHost } from '../../web-idl/index';
import type { DocumentImpl } from '../dom/nodes/document';
import type { EventImpl } from '../dom/events/event';
import { type Agent, WindowAgent } from './agents';
import type { EnvironmentSettingsObject } from './environment';
import { associateGlobalTaskDestination } from './tasks';
import { WindowImpl } from '../browsing/window/window';
import { implicitlyConvertDurationToTimestamp } from '../performance/clock';
import {
  coarsenedSharedCurrentTime,
} from '../performance/high-resolution-time';

/*
 * HTML owns the Realm's Agent, settings object, callback lifecycle, and global
 * task associations. NodeRealm supplies the lower JS Engine backend.
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
  if (agent instanceof WindowAgent) {
    if (!WindowImpl.is(globalObject)) {
      throw new Error('A Window realm requires a Window implementation');
    }
  }
  return { realm };
}

export class Realm extends NodeRealm implements WebIDLRealmHost {
  readonly agent: Agent;
  readonly callbacks: WebIDLRealmHost['callbacks'];
  readonly crossOriginIsolated: boolean;
  readonly globalNames: ReadonlySet<string>;
  readonly isGlobalPrototypeChainMutable: boolean;
  readonly secureContext: boolean;
  #hostDefined: EnvironmentSettingsObject | null = null;
  #windowImplementation: WindowImpl | undefined;

  constructor(options: RealmOptions = {}) {
    const agent = options.agent ?? new WindowAgent();
    super(agent.eventLoop.microtaskQueue, {
      globalPrototypeChain: options.globalPrototypeChain,
      reuseGlobalProxyFrom: options.reuseGlobalProxyFrom,
    });
    this.agent = agent;
    this.crossOriginIsolated = options.crossOriginIsolated ?? false;
    this.globalNames = new Set(options.globalNames ?? ['Window']);
    this.isGlobalPrototypeChainMutable =
      options.isGlobalPrototypeChainMutable ?? false;
    this.secureContext = options.secureContext ?? false;
    this.callbacks = {
      /* Web IDL §§3.2.16 and 3.2.19; HTML §8.1.3.3. */
      captureContext: () => {
        const settings = this.#hostDefined;
        if (settings === null) return this;
        return settings.responsibleEventLoop
          .getIncumbentSettingsObject(settings);
      },
      cleanUpAfterRunningCallback: (context) => {
        const settings = this.#getCallbackSettings(context);
        if (settings !== null) {
          settings.responsibleEventLoop
            .cleanUpAfterRunningCallback(settings);
        }
      },
      cleanUpAfterRunningScript: () => {
        const settings = this.#hostDefined;
        if (settings !== null) {
          settings.responsibleEventLoop.cleanUpAfterRunningScript(settings);
        }
      },
      getAssociatedRealm: (value) =>
        Realm.getAssociatedRealm(value) ?? this,
      prepareToRunCallback: (context) => {
        const settings = this.#getCallbackSettings(context);
        if (settings !== null) {
          this.agent.eventLoop.prepareToRunCallback(settings);
        }
      },
      prepareToRunScript: () => {
        const settings = this.#hostDefined;
        if (settings !== null) {
          settings.responsibleEventLoop.prepareToRunScript(settings);
        }
      },
      reportException: (exception) => {
        // TODO(HTML section 8.1.5): Report through the realm's error-reporting
        // machinery once Browlet implements it.
        console.error(exception);
      },
    };
  }

  get windowImplementation(): WindowImpl | undefined {
    return this.#windowImplementation;
  }

  get hostDefined(): EnvironmentSettingsObject | null {
    return this.#hostDefined;
  }

  override evaluate(source: string, filename: string, lineOffset = 0): unknown {
    const settings = this.#hostDefined;
    if (settings === null) return super.evaluate(source, filename, lineOffset);
    return settings.responsibleEventLoop.runScriptEvaluation(
      settings,
      () => super.evaluate(source, filename, lineOffset),
    );
  }

  eventTimeStamp(): DOMHighResTimeStamp {
    const settings = this.#hostDefined;
    if (settings === null) {
      return coarsenedSharedCurrentTime().milliseconds;
    }
    return implicitlyConvertDurationToTimestamp(
      settings.timing.currentHighResolutionTime(),
    );
  }

  getAssociatedDocument(): DocumentImpl {
    const window = this.#windowImplementation;
    if (!window) throw new Error('Realm global object has no associated Document');
    return WindowImpl.getAssociatedDocument(window);
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
    const window = this.#windowImplementation;
    const document = window
      ? WindowImpl.getAssociatedDocument(window)
      : null;
    this.agent.eventLoop.queueMicrotask(steps, document);
  }

  getCurrentEvent(_global: object): EventImpl | undefined {
    const window = this.#windowImplementation;
    return window
      ? WindowImpl.getCurrentEvent(window)
      : undefined;
  }

  setCurrentEvent(_global: object, event: EventImpl | undefined): void {
    const window = this.#windowImplementation;
    if (window) WindowImpl.setCurrentEvent(window, event);
  }

  recordTimingInfo(
    _global: object,
    _event: EventImpl,
    _callback: object,
  ): void {
    // TODO(Long Animation Frames section 3.2.2): Record event-listener timing
    // once Browlet has the HTML performance timeline machinery.
  }

  // -- Friends ----------------------------------------------------------

  static setGlobalObjects(
    realm: Realm,
    globalObject: object,
    globalThis: object,
    windowImplementation = WindowImpl.is(globalObject) ? globalObject : undefined,
  ): void {
    realm.#windowImplementation = windowImplementation;
    realm.initializeGlobalObjects(globalObject, globalThis);
    if (realm.agent.agentCluster?.crossOriginIsolationMode === 'none') {
      const status = Reflect.deleteProperty(globalObject, 'SharedArrayBuffer');
      if (!status) throw new Error('Could not remove SharedArrayBuffer');
    }
    if (windowImplementation && realm.agent instanceof WindowAgent) {
      realm.agent.windowObjects.add(windowImplementation);
    }
    if (!realm.isGlobalPrototypeChainMutable) {
      realm.makeHostGlobalPrototypeImmutable();
    }
    const taskDestination = {
      eventLoop: realm.agent.eventLoop,
      getDocument: () => {
        const window = realm.#windowImplementation;
        return window
          ? WindowImpl.getAssociatedDocument(window)
          : null;
      },
    };
    associateGlobalTaskDestination(
      realm.hostGlobal,
      taskDestination,
    );
    associateGlobalTaskDestination(globalObject, taskDestination);
    associateGlobalTaskDestination(globalThis, taskDestination);
    if (windowImplementation) {
      associateGlobalTaskDestination(windowImplementation, taskDestination);
    }
  }

  static setHostDefined(
    realm: Realm,
    settings: EnvironmentSettingsObject,
  ): void {
    realm.#hostDefined = settings;
  }

  static getAssociatedRealm(value: object): Realm | undefined {
    const realm = nodeRuntime.getAssociatedRealm(value);
    return realm instanceof Realm ? realm : undefined;
  }

  // -- Private ----------------------------------------------------------

  #getCallbackSettings(
    context: object,
  ): EnvironmentSettingsObject | null {
    if (this.#hostDefined === null && context instanceof Realm) return null;
    const settings = context as EnvironmentSettingsObject;
    if (settings.realmExecutionContext.realm.hostDefined === settings) {
      return settings;
    }
    throw new Error('A JavaScript callback context is not a settings object');
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

export type RealmOptions = {
  globalPrototypeChain?: NodeRealmOptions['globalPrototypeChain'];
  reuseGlobalProxyFrom?: Realm;
  agent?: Agent;
  crossOriginIsolated?: boolean;
  globalNames?: readonly string[];
  isGlobalPrototypeChainMutable?: boolean;
  secureContext?: boolean;
};

type SecurityCheckType = Parameters<
  WebIDLRealmHost['performSecurityCheck']
>[2];
