import type { BrowsingContext } from '../browsing/browsing-context';
import type { EventLoop } from './event-loop';
import type { JSExecutionContext } from './realm';
import type { ModuleMap } from '../dom/nodes/document';
import type { PolicyContainer } from '../browsing/policy/container';
import type { WindowImpl } from '../browsing/window/window';
import type { Origin } from '../../url/origin';
import { parseURL, type URLRecord } from '../../url/url';
import { Moment, monotonicClock } from '../performance/clock';
import { EnvironmentTiming } from '../performance/high-resolution-time';
import { WindowOrWorkerGlobalScopeMixin, type StructuredCloneSteps } from './global-scope';
import { timerTaskSource } from './timers';

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
  readonly realmExecutionContext: JSExecutionContext;

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
      this.#window.getAssociatedDocument().baseURI,
    ).url;
    if (url === null) throw new Error('Window Document has an invalid base URL');
    return url;
  }

  get moduleMap(): ModuleMap {
    return this.#window.getAssociatedDocument().getModuleMap();
  }

  get origin(): Origin {
    return this.#window.getAssociatedDocument().getOrigin();
  }

  get hasCrossSiteAncestor(): boolean {
    throw new Error(
      'Window navigable ancestry is not implemented',
    );
  }

  get policyContainer(): PolicyContainer {
    return this.#window.getAssociatedDocument().getPolicyContainer();
  }

  get crossOriginIsolatedCapability(): boolean {
    const mode = this.realmExecutionContext.realm.agent.agentCluster
      ?.crossOriginIsolationMode;
    if (mode !== 'concrete') return false;

    void this.#window.getAssociatedDocument().getPermissionsPolicy();
    throw new Error(
      'The cross-origin-isolated permissions-policy check is not implemented',
    );
  }

  get timeOrigin(): Moment {
    return new Moment(
      monotonicClock,
      this.#window.getAssociatedDocument().getLoadTimingInfo().navigationStartTime,
    );
  }
}

export function setupWindowEnvironmentSettingsObject(
  creationURL: URLRecord,
  executionContext: JSExecutionContext,
  reservedEnvironment: Environment | null,
  topLevelCreationURL: URLRecord,
  topLevelOrigin: Origin,
  structuredClone: StructuredCloneSteps,
): WindowEnvironmentSettingsObject {
  const realm = executionContext.realm;
  const window = realm.windowImplementation;
  if (window === undefined) {
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
  window.setWindowOrWorkerGlobalScopeMixin(
    new WindowOrWorkerGlobalScopeMixin({
      eventLoop: realm.agent.eventLoop,
      queueTimerTask: (steps, options) => realm.queueGlobalTask(timerTaskSource, steps, options),
      structuredClone,
      timing: settings.timing,
    }),
  );
  realm.setHostDefined(settings);
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
  realmExecutionContext: JSExecutionContext;
};
