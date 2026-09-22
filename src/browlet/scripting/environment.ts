import type { BrowsingContext } from '../browsing/browsing-context';
import type { TraversableNavigable } from '../browsing/navigable';
import type { UserAgent } from '../user-agent';
import { FetchGroup, type FetchEnvironmentSettingsObject, type FetchEnvironment } from '../../fetch/index';
import type { EventLoop } from './event-loop';
import type { JSExecutionContext } from './realm';
import type { ModuleMap } from '../dom/nodes/document';
import type { PolicyContainer } from '../browsing/policy/container';
import type { WindowImpl } from '../browsing/window/window';
import { areSameSite, type Origin, type URLRecord } from '../../url/index';
import { Moment, monotonicClock } from '../performance/clock';
import { EnvironmentTiming } from '../performance/high-resolution-time';
import { InternalError } from '../../infra/internal-error';

/*
 * An environment carries navigation/client state before a realm, global
 * object, or environment settings object necessarily exists.
 */
export class Environment implements FetchEnvironment {
  id: string = crypto.randomUUID();
  userAgent: UserAgent;
  creationURL: URLRecord;
  topLevelCreationURL: URLRecord | null;
  topLevelOrigin: Origin | null;
  targetBrowsingContext: BrowsingContext | null;
  activeServiceWorker: object | null;
  #isSecureContext: boolean;
  #executionReady = false;

  constructor(initialization: EnvironmentInitialization) {
    this.userAgent = initialization.userAgent;
    this.creationURL = initialization.creationURL;
    this.topLevelCreationURL = initialization.topLevelCreationURL;
    this.topLevelOrigin = initialization.topLevelOrigin;
    this.targetBrowsingContext = initialization.targetBrowsingContext;
    this.activeServiceWorker = initialization.activeServiceWorker ?? null;
    this.#isSecureContext = initialization.isSecureContext;
  }

  /** https://html.spec.whatwg.org/multipage/webappapis.html#secure-context */
  get isSecureContext(): boolean {
    return this.#isSecureContext;
  }

  get executionReady(): boolean {
    return this.#executionReady;
  }

  markExecutionReady(): void {
    this.#executionReady = true;
  }
}

export abstract class EnvironmentSettingsObject extends Environment implements FetchEnvironmentSettingsObject {
  fetchGroup = new FetchGroup();
  timing: EnvironmentTiming;
  realmExecutionContext: JSExecutionContext;

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

  /** Document or worker URL for reports, or null for other kinds of global. */
  // https://w3c.github.io/webappsec-subresource-integrity/#report-violations
  abstract getReportingSource(): URLRecord | null;

  get responsibleEventLoop(): EventLoop {
    return this.realmExecutionContext.realm.agent.eventLoop;
  }

  /** Source URL for requests using this client's referrer. */
  // https://w3c.github.io/webappsec-referrer-policy/#determine-requests-referrer
  getReferrerSource(): URLRecord | null {
    return this.creationURL;
  }

  /** Select a prompt destination; environments without a Window have none. */
  // https://fetch.spec.whatwg.org/#populate-request-from-client
  getTraversableForUserPrompts(): TraversableNavigable | null {
    return null;
  }

  /** Submit a report to this environment's actual global scope. */
  // https://w3c.github.io/reporting/#generate-report
  queueReport(type: string, endpoint: string, body: Record<string, string | boolean>): void {
    const window = this.realmExecutionContext.realm.windowImplementation;
    if (window === undefined) throw new InternalError('Reporting requires a Window or worker global');
    window.getWindowOrWorkerGlobalScopeMixin().queueReport(type, endpoint, body);
  }

  /** https://w3c.github.io/webdriver-bidi/#webdriver-bidi-network-is-offline */
  webDriverBiDiNetworkIsOffline(): boolean {
    // PROVISIONAL: no BiDi sessions; replace with the environment's scoped network-condition lookup.
    return false;
  }

  /** Identification override selected for this environment, or null when absent. */
  // https://w3c.github.io/webdriver-bidi/#webdriver-bidi-emulated-user-agent
  webDriverBiDiEmulatedUserAgent(): string | null {
    // PROVISIONAL: no BiDi sessions; replace with the environment's scoped emulation lookup.
    return null;
  }
}

export class WindowEnvironmentSettingsObject
  extends EnvironmentSettingsObject
{
  #window: WindowImpl;

  constructor(
    window: WindowImpl,
    initialization: EnvironmentSettingsInitialization,
  ) {
    super(initialization);
    this.#window = window;
  }

  get apiBaseURL(): URLRecord {
    return this.#window.getAssociatedDocument().getBaseURL();
  }

  get moduleMap(): ModuleMap {
    return this.#window.getAssociatedDocument().getModuleMap();
  }

  get origin(): Origin {
    return this.#window.getAssociatedDocument().getOrigin();
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#set-up-a-window-environment-settings-object
  get hasCrossSiteAncestor(): boolean {
    let document = this.#window.getAssociatedDocument();
    const navigable = document.getNodeNavigable();
    // A detached/inactive Document has no current ancestor chain to establish a cookie site.
    if (navigable === null) return true;
    for (let parent = navigable.parent; parent !== null; parent = parent.parent) {
      const parentDocument = parent.activeDocument;
      if (parentDocument === null || !areSameSite(parentDocument.getOrigin(), document.getOrigin())) return true;
      document = parentDocument;
    }
    return false;
  }

  get policyContainer(): PolicyContainer {
    return this.#window.getAssociatedDocument().getPolicyContainer();
  }

  get crossOriginIsolatedCapability(): boolean {
    const mode = this.realmExecutionContext.realm.agent.agentCluster
      ?.crossOriginIsolationMode;
    if (mode !== 'concrete') return false;

    void this.#window.getAssociatedDocument().getPermissionsPolicy();
    throw new InternalError(
      'The cross-origin-isolated permissions-policy check is not implemented',
    );
  }

  get timeOrigin(): Moment {
    return new Moment(
      monotonicClock,
      this.#window.getAssociatedDocument().getLoadTimingInfo().navigationStartTime,
    );
  }

  // https://w3c.github.io/webappsec-referrer-policy/#determine-requests-referrer
  override getReferrerSource(): URLRecord | null {
    let document = this.#window.getAssociatedDocument();
    if (document.getOrigin().kind === 'opaque') return null;
    while (document.isIframeSrcdocDocument()) {
      const container = document.getBrowsingContext()?.navigable?.container ?? null;
      if (container === null) throw new InternalError('A srcdoc document needs a navigable container');
      document = container.getNodeDocument()!;
    }
    return document.getURL();
  }

  // https://w3c.github.io/webappsec-subresource-integrity/#report-violations
  override getReportingSource(): URLRecord {
    return this.#window.getAssociatedDocument().getURL();
  }

  // https://fetch.spec.whatwg.org/#populate-request-from-client
  override getTraversableForUserPrompts(): TraversableNavigable | null {
    return this.#window.getAssociatedDocument().getNodeNavigable()?.traversableNavigable ?? null;
  }
}

/**
 * https://html.spec.whatwg.org/multipage/nav-history-apis.html#set-up-a-window-environment-settings-object
 * Return the settings so Window initialization can use the newly established owner.
 */
export function setupWindowEnvironmentSettingsObject(
  creationURL: URLRecord,
  executionContext: JSExecutionContext,
  reservedEnvironment: Environment | null,
  topLevelCreationURL: URLRecord,
  topLevelOrigin: Origin,
): WindowEnvironmentSettingsObject {
  const realm = executionContext.realm;
  const window = realm.windowImplementation;
  if (window === undefined) {
    throw new InternalError('Window settings require a Window global object');
  }
  const environment = realm.environment;
  if (environment === null) {
    throw new InternalError('Window settings require an Environment');
  }
  const settings = new WindowEnvironmentSettingsObject(
    window,
    {
      userAgent: environment.userAgent,
      isSecureContext: environment.isSecureContext,
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
  realm.setHostDefined(settings);
  return settings;
}

export type EnvironmentInitialization = {
  userAgent: UserAgent;
  isSecureContext: boolean;
  creationURL: URLRecord;
  topLevelCreationURL: URLRecord | null;
  topLevelOrigin: Origin | null;
  targetBrowsingContext: BrowsingContext | null;
  activeServiceWorker?: object | null;
};

export type EnvironmentSettingsInitialization = EnvironmentInitialization & {
  realmExecutionContext: JSExecutionContext;
};
