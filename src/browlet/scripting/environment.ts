import type { BrowsingContext } from '../browsing/browsing-context';
import type { EventLoop } from './event-loop';
import { Realm, type JavaScriptExecutionContext } from './realm';
import { DocumentImpl, type ModuleMap } from '../dom/nodes/document';
import type { PolicyContainer } from '../browsing/policy/container';
import { WindowImpl } from '../browsing/window/window';
import type { Origin } from '../../url/origin';
import { parseURL, type URLRecord } from '../../url/url';
import { Moment, monotonicClock } from '../performance/clock';
import { EnvironmentTiming } from '../performance/high-resolution-time';
import { WindowOrWorkerGlobalScopeMixin } from './global-scope';

/*
 * An environment carries navigation/client state before a realm, global
 * object, or environment settings object necessarily exists.
 */
export class Environment {
  id: string = crypto.randomUUID();
  creationURL: URLRecord;
  topLevelCreationURL: URLRecord | null;
  topLevelOrigin: Origin | null;
  targetBrowsingContext: BrowsingContext | null;
  activeServiceWorker: object | null;
  #executionReady = false;

  constructor(initialization: EnvironmentInitialization) {
    this.creationURL = initialization.creationURL;
    this.topLevelCreationURL = initialization.topLevelCreationURL;
    this.topLevelOrigin = initialization.topLevelOrigin;
    this.targetBrowsingContext = initialization.targetBrowsingContext;
    this.activeServiceWorker = initialization.activeServiceWorker ?? null;
  }

  get executionReady(): boolean {
    return this.#executionReady;
  }

  markExecutionReady(): void {
    this.#executionReady = true;
  }
}

export abstract class EnvironmentSettingsObject extends Environment {
  readonly timing: EnvironmentTiming;
  readonly realmExecutionContext: JavaScriptExecutionContext;

  constructor(initialization: EnvironmentSettingsInitialization) {
    super(initialization);
    this.timing = new EnvironmentTiming(this);
    this.realmExecutionContext = initialization.realmExecutionContext;
  }

  abstract get apiBaseURL(): URLRecord;
  abstract get moduleMap(): ModuleMap;
  abstract get origin(): Origin;
  abstract get hasCrossSiteAncestor(): boolean;
  abstract get policyContainer(): PolicyContainer;
  abstract get crossOriginIsolatedCapability(): boolean;
  abstract get timeOrigin(): Moment;

  get responsibleEventLoop(): EventLoop {
    return this.realmExecutionContext.realm.agent.eventLoop;
  }
}

export class WindowEnvironmentSettingsObject
  extends EnvironmentSettingsObject
{
  readonly #window: WindowImpl;

  constructor(
    window: WindowImpl,
    initialization: EnvironmentSettingsInitialization,
  ) {
    super(initialization);
    this.#window = window;
  }

  get apiBaseURL(): URLRecord {
    const url = parseURL(
      WindowImpl.getAssociatedDocument(this.#window).baseURI,
    ).url;
    if (url === null) throw new Error('Window Document has an invalid base URL');
    return url;
  }

  get moduleMap(): ModuleMap {
    return DocumentImpl.getModuleMap(
      WindowImpl.getAssociatedDocument(this.#window),
    );
  }

  get origin(): Origin {
    return DocumentImpl.getOrigin(
      WindowImpl.getAssociatedDocument(this.#window),
    );
  }

  get hasCrossSiteAncestor(): boolean {
    throw new Error(
      'Window navigable ancestry is not implemented',
    );
  }

  get policyContainer(): PolicyContainer {
    return DocumentImpl.getPolicyContainer(
      WindowImpl.getAssociatedDocument(this.#window),
    );
  }

  get crossOriginIsolatedCapability(): boolean {
    const mode = this.realmExecutionContext.realm.agent.agentCluster
      ?.crossOriginIsolationMode;
    if (mode !== 'concrete') return false;

    void DocumentImpl.getPermissionsPolicy(
      WindowImpl.getAssociatedDocument(this.#window),
    );
    throw new Error(
      'The cross-origin-isolated permissions-policy check is not implemented',
    );
  }

  get timeOrigin(): Moment {
    return new Moment(
      monotonicClock,
      DocumentImpl.getLoadTimingInfo(
        WindowImpl.getAssociatedDocument(this.#window),
      ).navigationStartTime,
    );
  }
}

export function setupWindowEnvironmentSettingsObject(
  creationURL: URLRecord,
  executionContext: JavaScriptExecutionContext,
  reservedEnvironment: Environment | null,
  topLevelCreationURL: URLRecord,
  topLevelOrigin: Origin,
): WindowEnvironmentSettingsObject {
  const realm = executionContext.realm;
  const window = realm.globalObject;
  if (!WindowImpl.is(window)) {
    throw new Error('Window settings require a Window global object');
  }
  const settings = new WindowEnvironmentSettingsObject(
    window,
    {
      activeServiceWorker: reservedEnvironment?.activeServiceWorker ?? null,
      creationURL,
      realmExecutionContext: executionContext,
      targetBrowsingContext:
        reservedEnvironment?.targetBrowsingContext ?? null,
      topLevelCreationURL,
      topLevelOrigin,
    },
  );

  if (reservedEnvironment) {
    settings.id = reservedEnvironment.id;
    reservedEnvironment.id = '';
  }
  WindowImpl.setWindowOrWorkerGlobalScopeMixin(
    window,
    new WindowOrWorkerGlobalScopeMixin({
      eventLoop: realm.agent.eventLoop,
      global: realm.global,
      timerThisValue: realm.globalThis,
      timing: settings.timing,
    }),
  );
  Realm.setHostDefined(realm, settings);
  return settings;
}

export type EnvironmentInitialization = {
  creationURL: URLRecord;
  topLevelCreationURL: URLRecord | null;
  topLevelOrigin: Origin | null;
  targetBrowsingContext: BrowsingContext | null;
  activeServiceWorker?: object | null;
};

export type EnvironmentSettingsInitialization = EnvironmentInitialization & {
  realmExecutionContext: JavaScriptExecutionContext;
};
