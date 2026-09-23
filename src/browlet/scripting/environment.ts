import type { BrowsingContext } from '../browsing/browsing-context';
import type { TraversableNavigable } from '../browsing/navigable';
import type { UserAgent } from '../user-agent';
import {
  FetchGroup, getEnvironmentDefaultUserAgent, type FetchEnvironment, type IntegrityViolationReportBody,
} from '../../fetch/index';
import type { EventLoop } from './event-loop';
import type { Realm, WindowRealm } from './realm';
import type { ModuleMap } from '../dom/nodes/document';
import type { PolicyContainer } from '../browsing/policy/container';
import type { WindowImpl } from '../browsing/window/window';
import { areSameSite, obtainURLOrigin, stripURLForReporting, type Origin, type URLRecord } from '../../url/index';
import { Moment, monotonicClock } from '../performance/clock';
import { EnvironmentTiming } from '../performance/high-resolution-time';
import { InternalError } from '../../infra/internal-error';
import type { RealmExecution } from '../../js-engine/index';
import type { WindowOrWorkerGlobalScopeMixin } from './global-scope';
import { ReportImpl } from '../reporting/report';
import { TestReportBodyImpl } from '../reporting/test-report';
import { IntegrityViolationReportBodyImpl } from '../browsing/policy/integrity-policy';
import { COEPViolationReportBodyImpl, type COEPViolationReportBody } from '../browsing/policy/coep';

/** Browser state and operations associated with one realm and global. */
// HTML's environment settings object. The engine owns execution-context stacks;
// its realm component is retained directly here.
export abstract class Environment implements EnvironmentRecord, FetchEnvironment {
  /** Identity retained from the early environment record. */
  id: string;
  /** Browser owner shared by navigation and networking. */
  userAgent: UserAgent;
  /** URL associated with this environment's creation. */
  creationURL: URLRecord;
  /** Top-level creation URL, or null when the environment has none. */
  topLevelCreationURL: URLRecord | null;
  /** Top-level origin, or null until it can be determined. */
  topLevelOrigin: Origin | null;
  /** Navigation's target browsing context, when present. */
  targetBrowsingContext: BrowsingContext | null;
  /** Service worker controlling this environment, when present. */
  activeServiceWorker: object | null;
  /** Requests tracked for this environment's lifetime. */
  fetchGroup = new FetchGroup();
  /** Browser timing relative to this environment's time origin. */
  timing: EnvironmentTiming;
  /** JavaScript realm associated with this browser environment. */
  realm: Realm;
  /** Allocation, execution, and owner task delivery for this realm. */
  exec: RealmExecution;
  #isSecureContext: boolean;
  #executionReady = false;

  constructor(realm: Realm, record: EnvironmentRecord, exec: RealmExecution) {
    this.exec = exec;
    this.id = record.id;
    this.userAgent = record.userAgent;
    this.creationURL = record.creationURL;
    this.topLevelCreationURL = record.topLevelCreationURL;
    this.topLevelOrigin = record.topLevelOrigin;
    this.targetBrowsingContext = record.targetBrowsingContext;
    this.activeServiceWorker = record.activeServiceWorker;
    this.#isSecureContext = record.isSecureContext;
    this.timing = new EnvironmentTiming(this);
    this.realm = realm;
    realm.setHostDefined(this);
  }

  /** The platform global installed in this environment's realm. */
  get global(): RealmExecution['global'] {
    return this.realm.global;
  }

  /** Security classification fixed when the environment was created. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#secure-context
  get isSecureContext(): boolean {
    return this.#isSecureContext;
  }

  /** Whether HTML has completed setup for script execution. */
  get executionReady(): boolean {
    return this.#executionReady;
  }

  /** Mark HTML setup complete. */
  markExecutionReady(): void {
    this.#executionReady = true;
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
    return this.realm.agent.eventLoop;
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

  /** Existing state shared by all consumers of this environment's global scope. */
  abstract getWindowOrWorkerGlobalScopeMixin(): WindowOrWorkerGlobalScopeMixin;

  /** Create a report and its observer body, capturing this environment's current identification value. */
  // https://w3c.github.io/reporting/#queue-report
  generateReport(data: unknown, type: string, destination: string): ReportImpl {
    // HTML's NavigatorID.userAgent uses this same environment-default algorithm.
    const report = new ReportImpl(
      data, type, destination, stripURLForReporting(this.creationURL),
      obtainURLOrigin(this.creationURL), getEnvironmentDefaultUserAgent(this),
    );
    if (data !== null) {
      switch (type) {
        case 'test':
          report.body = new TestReportBodyImpl((data as { message: string; }).message);
          break;
        case 'integrity-violation':
          report.body = new IntegrityViolationReportBodyImpl(data as IntegrityViolationReportBody);
          break;
        case 'coep':
          report.body = new COEPViolationReportBodyImpl(data as COEPViolationReportBody);
          break;
      }
    }
    return report;
  }

  /** Submit a report to this environment's actual global scope. */
  // https://w3c.github.io/reporting/#generate-report
  queueReport(type: string, endpoint: string, body: Record<string, string | boolean>): void {
    this.getWindowOrWorkerGlobalScopeMixin().queueReport(type, endpoint, body);
  }
}

export class WindowEnvironment extends Environment {
  declare realm: WindowRealm;

  constructor(realm: WindowRealm, record: EnvironmentRecord, exec: RealmExecution) {
    super(realm, record, exec);
  }

  /** Window implementation whose current Document supplies browser state. */
  get window(): WindowImpl {
    return this.realm.windowImplementation;
  }

  get apiBaseURL(): URLRecord {
    return this.window.getAssociatedDocument().getBaseURL();
  }

  get moduleMap(): ModuleMap {
    return this.window.getAssociatedDocument().moduleMap;
  }

  get origin(): Origin {
    return this.window.getAssociatedDocument().origin;
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#set-up-a-window-environment-settings-object
  get hasCrossSiteAncestor(): boolean {
    let document = this.window.getAssociatedDocument();
    const navigable = document.getNodeNavigable();
    // A detached/inactive Document has no current ancestor chain to establish a cookie site.
    if (navigable === null) return true;
    for (let parent = navigable.parent; parent !== null; parent = parent.parent) {
      const parentDocument = parent.activeDocument;
      if (parentDocument === null || !areSameSite(parentDocument.origin, document.origin)) return true;
      document = parentDocument;
    }
    return false;
  }

  get policyContainer(): PolicyContainer {
    return this.window.getAssociatedDocument().policyContainer;
  }

  get crossOriginIsolatedCapability(): boolean {
    const mode = this.realm.agent.agentCluster?.crossOriginIsolationMode;
    if (mode !== 'concrete') return false;

    void this.window.getAssociatedDocument().permissionsPolicy;
    throw new InternalError(
      'The cross-origin-isolated permissions-policy check is not implemented',
    );
  }

  get timeOrigin(): Moment {
    return new Moment(
      monotonicClock,
      this.window.getAssociatedDocument().loadTimingInfo.navigationStartTime,
    );
  }

  override getWindowOrWorkerGlobalScopeMixin(): WindowOrWorkerGlobalScopeMixin {
    return this.window.getWindowOrWorkerGlobalScopeMixin();
  }

  // https://w3c.github.io/webappsec-referrer-policy/#determine-requests-referrer
  override getReferrerSource(): URLRecord | null {
    let document = this.window.getAssociatedDocument();
    if (document.origin.kind === 'opaque') return null;
    while (document.isIframeSrcdocDocument) {
      const container = document.browsingContext?.navigable?.container ?? null;
      if (container === null) throw new InternalError('A srcdoc document needs a navigable container');
      document = container.getNodeDocument()!;
    }
    return document.url;
  }

  // https://w3c.github.io/webappsec-subresource-integrity/#report-violations
  override getReportingSource(): URLRecord {
    return this.window.getAssociatedDocument().url;
  }

  // https://fetch.spec.whatwg.org/#populate-request-from-client
  override getTraversableForUserPrompts(): TraversableNavigable | null {
    return this.window.getAssociatedDocument().getNodeNavigable()?.traversableNavigable ?? null;
  }
}

/** State that can identify an environment before a realm or global exists. */
// HTML's environment, including reserved environments and reserved Fetch clients.
export type EnvironmentRecord = {
  /** Identity transferred to the full environment when a reservation is consumed. */
  id: string;
  /** Browser owner shared by navigation and networking. */
  userAgent: UserAgent;
  /** URL associated with the environment's creation. */
  creationURL: URLRecord;
  /** Top-level creation URL, or null when the environment has none. */
  topLevelCreationURL: URLRecord | null;
  /** Top-level origin, or null until it can be determined. */
  topLevelOrigin: Origin | null;
  /** Navigation's target browsing context, when present. */
  targetBrowsingContext: BrowsingContext | null;
  /** Service worker controlling this environment, when present. */
  activeServiceWorker: object | null;
  /** Security classification established before Web IDL exposure. */
  isSecureContext: boolean;
  /** Whether HTML has completed setup for script execution. */
  executionReady: boolean;
};

/** Create the state needed before allocating a realm. */
export function createEnvironmentRecord(initialization: EnvironmentInit): EnvironmentRecord {
  return {
    ...initialization,
    id: crypto.randomUUID(),
    activeServiceWorker: initialization.activeServiceWorker ?? null,
    executionReady: false,
  };
}

export type EnvironmentInit = Omit<EnvironmentRecord, 'id' | 'executionReady' | 'activeServiceWorker'> & {
  activeServiceWorker?: object | null;
};
