import { InternalError } from '../infra/internal-error';
import { randomUUID, type JSEnvironment, type RealmExecution } from '../js-engine/index';
import type { WebIDLExecution } from '../web-idl/core/index';
import type { SelectletEnvironment } from '../selectlet/index';
import type { StyleletEnvironment, StyleletExecution } from '../stylelet/index';
import {
  obtainSite, obtainURLOrigin, serializeURL,
  type Origin, type URLParseResult, type URLRecord,
} from '../url/index';
import {
  FetchGroup, type FetchEnvironment, type FetchEnvironmentRecord, type FetchExecution,
  type CacheUsage, type Destination, type FetchMode, type FetchResponse, type FetchTimingInfo,
  type NetworkPartitionKey, type RequestCredentials, type ResponseBodyInfo,
} from '../fetch/index';

import { Moment, UnsafeMoment, monotonicClock, EnvironmentTiming } from './timing/index';
import type { EventLoop, BrowletRealm, WindowRealm, WindowAgent } from './scripting/index';
import type { ReportImpl } from './reporting/index';
import { InsecureRequestsPolicy, type PolicyContainer } from './browsing/policy/index';
import type { DocumentImpl, ModuleMap } from './dom/nodes/index';
import type { DOMEnvironment, DOMExecution } from './dom/index';
import { generateReport } from './reporting/generate';
import type { WindowOrWorkerGlobalScopeMixin } from './global-scope';
import type { WindowImpl } from './browsing/window/index';
import type { BrowsingContext, Traversable } from './browsing/navigation/index';
import type { UserAgent } from './user-agent';

/** Browser state shared by reserved records and full environments. */
// https://html.spec.whatwg.org/multipage/webappapis.html#environment
export class BrowletEnvironmentRecord implements FetchEnvironmentRecord {
  /** Identity transferred to the full environment when a reservation is consumed. */
  id: string;
  /** Top-level creation URL, or null when the environment has none. */
  topLevelCreationURL: URLRecord | null;
  /** Top-level origin, or null until it can be determined. */
  topLevelOrigin: Origin | null;
  /** Navigation's target browsing context, when present. */
  targetBrowsingContext: BrowsingContext | null;
  /** Service worker controlling this environment, when present. */
  activeServiceWorker: object | null;
  /** Browser owner; null only for an internal sandbox constructed without one. */
  #userAgent: UserAgent | null;
  /** Creation URL; null only for internal sandboxes. */
  #creationURL: URLRecord | null;
  #isSecureContext: boolean;
  #executionReady = false;

  /** Null leaves browser-specific state unavailable for an internal sandbox. */
  constructor(initialization: BrowletEnvironmentRecordInit | null) {
    this.id = initialization?.id ?? randomUUID();
    this.#userAgent = initialization?.userAgent ?? null;
    this.#creationURL = initialization?.creationURL ?? null;
    this.topLevelCreationURL = initialization?.topLevelCreationURL ?? null;
    this.topLevelOrigin = initialization?.topLevelOrigin ?? null;
    this.targetBrowsingContext = initialization?.targetBrowsingContext ?? null;
    this.activeServiceWorker = initialization?.activeServiceWorker ?? null;
    this.#isSecureContext = initialization?.isSecureContext ?? false;
  }

  /** Browser owner; unavailable in standalone sandboxes without a supplied owner. */
  get userAgent(): UserAgent {
    if (this.#userAgent === null) throw new InternalError('Environment has no UserAgent');
    return this.#userAgent;
  }

  set userAgent(value: UserAgent) {
    this.#userAgent = value;
  }

  /** Creation URL; internal sandboxes have none. */
  get creationURL(): URLRecord {
    if (this.#creationURL === null) throw new InternalError('Environment has no creation URL');
    return this.#creationURL;
  }

  set creationURL(value: URLRecord) {
    this.#creationURL = value;
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

  /** Determine this environment's partition before or after a realm exists. */
  // https://fetch.spec.whatwg.org/#determine-the-network-partition-key
  determineNetworkPartitionKey(): NetworkPartitionKey {
    let topLevelOrigin = this.topLevelOrigin;
    if (topLevelOrigin === null) {
      if (this.topLevelCreationURL === null) throw new InternalError('Fetch environment has no top-level origin or creation URL');
      topLevelOrigin = obtainURLOrigin(this.topLevelCreationURL);
    }
    return [obtainSite(topLevelOrigin), null];
  }
}

/** Engine, Fetch, Web IDL, DOM, and style facilities composed for one Browlet execution owner. */
export interface BrowletExecution extends RealmExecution, FetchExecution, WebIDLExecution, DOMExecution, StyleletExecution {
  /** Allocate a Document and its descendant-node factory in this environment's binding. */
  createDocument(): DocumentImpl;
}

/** Composed browser settings and execution for one realm and global. */
// HTML's environment settings object. The engine owns execution-context stacks;
// its realm component is retained directly here.
export abstract class BrowletEnvironment extends BrowletEnvironmentRecord implements
  JSEnvironment, DOMEnvironment, FetchEnvironment, StyleletEnvironment, SelectletEnvironment {
  /** Requests tracked for this environment's lifetime. */
  fetchGroup = new FetchGroup();
  /** Upgrade policy and navigation targets inherited or enabled for this environment. */
  insecureRequestsPolicy = new InsecureRequestsPolicy();
  /** Browser timing relative to this environment's time origin. */
  timing: EnvironmentTiming;
  /** JavaScript realm associated with this browser environment. */
  realm: BrowletRealm;
  /** Allocation, execution, and owner task delivery for this realm. */
  exec: BrowletExecution;

  constructor(realm: BrowletRealm, record: BrowletEnvironmentRecord | null, exec: BrowletExecution) {
    super(record);
    this.exec = exec;
    this.timing = new EnvironmentTiming(this);
    this.realm = realm;
    // Internal sandboxes participate in Binding without becoming HTML settings objects.
    if (record !== null) realm.setHostDefined(this);
  }

  /** The platform global installed in this environment's realm. */
  get global(): RealmExecution['global'] {
    return this.realm.globalObject;
  }

  /** Window environments can consume their Document's preload map. */
  get isWindow(): boolean {
    return false;
  }

  /** Service worker environments override this when that global is implemented. */
  get isServiceWorker(): boolean {
    return false;
  }

  /** Only a Window with a top-level navigable can fetch its own Blob URL across partitions. */
  get isTopLevelWindow(): boolean {
    return false;
  }

  /** Fetch supplies shared numeric timestamps; HRT owns coarsening and time-origin conversion. */
  relativeHighResolutionTime(time: number): number {
    return this.timing.relativeHighResolutionTime(new UnsafeMoment(monotonicClock, time)).milliseconds;
  }

  /** Create and queue a resource entry on this environment's Performance Timeline. */
  // https://w3c.github.io/resource-timing/#mark-resource-timing
  markResourceTiming(
    _timingInfo: FetchTimingInfo, _requestedURL: URLRecord, _initiatorType: string,
    _cacheUsage: CacheUsage | undefined, _bodyInfo: ResponseBodyInfo, _responseStatus: number,
  ): void {
    // PROVISIONAL: Resource Timing entries need the Performance Timeline buffer
    // and observer machinery. The performance roadmap owns that integration.
  }

  /** Select a Document preload; environments without a Document cannot consume one. */
  // https://html.spec.whatwg.org/multipage/links.html#consume-a-preloaded-resource
  consumePreloadedResource(
    _url: URLRecord, _destination: Destination, _mode: FetchMode, _credentialsMode: RequestCredentials,
    _integrityMetadata: string, _onResponseAvailable: (response: FetchResponse) => void,
  ): boolean {
    return false;
  }

  /** Parse with this browser's Blob URL store; the caller selects any base URL. */
  parseURL(input: string, base: URLRecord | null = null, encoding = 'UTF-8'): URLParseResult {
    return this.userAgent.parseURL(input, base, encoding);
  }

  /** Parse against this environment's API base URL using UTF-8; return null on failure. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#parse-a-url
  parseHTMLURL(input: string): URLRecord | null {
    return this.parseURL(input, this.apiBaseURL).url;
  }

  /** Parse against the API base using the current Window Document's encoding, or UTF-8 otherwise. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#encoding-parsing-a-url
  encodingParseURL(input: string): URLRecord | null {
    const encoding = this.realm.getAssociatedDocument()?.encoding ?? 'UTF-8';
    return this.parseURL(input, this.apiBaseURL, encoding).url;
  }

  /** Encoding-parse and serialize a URL, preserving parse failure as null. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#encoding-parsing-and-serializing-a-url
  encodingParseAndSerializeURL(input: string): string | null {
    const url = this.encodingParseURL(input);
    return url === null ? null : serializeURL(url);
  }

  /** Whether these settings currently permit scripting, including sandbox and automation policy. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#concept-environment-script
  isScriptingEnabled(): boolean {
    // Browlet supports JavaScript; this flag is the user's global disable preference.
    if (!this.userAgent.scriptingEnabled) return false;
    const document = this.realm.getAssociatedDocument();
    if (document?.activeSandboxingFlagSet.has('sandboxed-scripts')) return false;
    return this.userAgent.webDriverBiDiScriptingIsEnabled(this);
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

  /** Whether this environment's origin requires trustworthy subresources. */
  // https://w3c.github.io/webappsec-mixed-content/#categorize-settings-object
  prohibitsMixedSecurityContexts(): boolean {
    return this.userAgent.isOriginPotentiallyTrustworthy(this.origin);
  }

  /** Select a prompt destination; environments without a Window have none. */
  // https://fetch.spec.whatwg.org/#populate-request-from-client
  getTraversableForUserPrompts(): Traversable | null {
    return null;
  }

  /** Existing state shared by all consumers of this environment's global scope. */
  abstract getWindowOrWorkerGlobalScopeMixin(): WindowOrWorkerGlobalScopeMixin;

  /** Report an internal browser warning attributed to this document or worker. */
  // https://console.spec.whatwg.org/#report-a-warning-to-the-console
  reportConsoleWarning(_description: string): void {
    // PROVISIONAL: Console's internal Printer and developer-console output are
    // not implemented. Preserve this environment as the message's owner when
    // connecting that output; do not call the author's overridable console API.
  }

  /** Create a report and its observer body, capturing this environment's current identification value. */
  // https://w3c.github.io/reporting/#queue-report
  generateReport(data: unknown, type: string, destination: string): ReportImpl {
    return generateReport(data, type, destination, this);
  }

  /** Submit a report to this environment's actual global scope. */
  // https://w3c.github.io/reporting/#generate-report
  queueReport(type: string, endpoint: string, body: unknown): void {
    this.getWindowOrWorkerGlobalScopeMixin().queueReport(type, endpoint, body);
  }
}

/** Internal execution with explicit failures for unsupported browser client settings. */
export class SandboxEnvironment extends BrowletEnvironment {
  constructor(realm: BrowletRealm, exec: BrowletExecution, userAgent?: UserAgent) {
    super(realm, null, exec);
    if (userAgent !== undefined) this.userAgent = userAgent;
  }

  get apiBaseURL(): URLRecord {
    throw new InternalError('Sandbox has no API base URL');
  }

  get moduleMap(): ModuleMap {
    throw new InternalError('Sandbox has no module map');
  }

  get origin(): Origin {
    throw new InternalError('Sandbox has no origin');
  }

  get hasCrossSiteAncestor(): boolean {
    throw new InternalError('Sandbox has no browsing ancestry');
  }

  get policyContainer(): PolicyContainer {
    throw new InternalError('Sandbox has no policy container');
  }

  get crossOriginIsolatedCapability(): boolean {
    return this.realm.crossOriginIsolated;
  }

  get timeOrigin(): Moment {
    throw new InternalError('Sandbox has no time origin');
  }

  override getReferrerSource(): null {
    return null;
  }

  getReportingSource(): null {
    return null;
  }

  getWindowOrWorkerGlobalScopeMixin(): WindowOrWorkerGlobalScopeMixin {
    throw new InternalError('Sandbox has no Window or Worker global scope');
  }
}

/** HTML settings whose document-dependent values follow the associated Window. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#set-up-a-window-environment-settings-object
export class WindowEnvironment extends BrowletEnvironment {
  declare realm: WindowRealm;

  constructor(realm: WindowRealm, record: BrowletEnvironmentRecord, exec: BrowletExecution) {
    super(realm, record, exec);
  }

  /** Window implementation whose current Document supplies browser state. */
  get window(): WindowImpl {
    return this.realm.windowImplementation;
  }

  override get isWindow(): boolean {
    return true;
  }

  override get isTopLevelWindow(): boolean {
    return this.window.getAssociatedDocument().getNodeNavigable()?.parent === null;
  }

  override consumePreloadedResource(
    _url: URLRecord, _destination: Destination, _mode: FetchMode, _credentialsMode: RequestCredentials,
    _integrityMetadata: string, _onResponseAvailable: (response: FetchResponse) => void,
  ): boolean {
    // PROVISIONAL(HTML preload): no Document preload map is populated yet.
    // Match its keys and integrity metadata, then arrange response notification when implemented.
    return false;
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

  /** Cookie-site ancestry exposed to Fetch through its environment contract. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#concept-settings-object-has-cross-site-ancestor
  get hasCrossSiteAncestor(): boolean {
    return this.window.getAssociatedDocument().hasCrossSiteAncestor;
  }

  get policyContainer(): PolicyContainer {
    return this.window.getAssociatedDocument().policyContainer;
  }

  /** A trustworthy Window ancestor also prohibits mixed content, regardless of this origin. */
  override prohibitsMixedSecurityContexts(): boolean {
    if (super.prohibitsMixedSecurityContexts()) return true;
    const navigable = this.window.getAssociatedDocument().getNodeNavigable();
    for (let ancestor = navigable?.parent ?? null; ancestor !== null; ancestor = ancestor.parent) {
      const document = ancestor.activeDocument;
      if (document !== null && this.userAgent.isOriginPotentiallyTrustworthy(document.origin)) return true;
    }
    return false;
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
      document = container.nodeDocument;
    }
    return document.url;
  }

  // https://w3c.github.io/webappsec-subresource-integrity/#report-violations
  override getReportingSource(): URLRecord {
    return this.window.getAssociatedDocument().url;
  }

  // https://fetch.spec.whatwg.org/#populate-request-from-client
  override getTraversableForUserPrompts(): Traversable | null {
    return this.window.getAssociatedDocument().getNodeNavigable()?.traversable ?? null;
  }
}

/** State supplied when reserving an environment or transferring it into full settings. */
export interface BrowletEnvironmentRecordInit {
  /** Omitted for a fresh reservation; retained when constructing full settings. */
  id?: string;
  userAgent: UserAgent;
  creationURL: URLRecord;
  topLevelCreationURL: URLRecord | null;
  topLevelOrigin: Origin | null;
  targetBrowsingContext: BrowsingContext | null;
  activeServiceWorker?: object | null;
  isSecureContext: boolean;
}

/** Inputs selected by browsing algorithms before Window composition creates its realm. */
export type WindowEnvironmentInit = {
  /** Agent whose event loop executes the new Window's work. */
  agent: WindowAgent;
  /** Browser owner supplying shared state and integration facilities. */
  userAgent: UserAgent;
  /** URL used to initialize the Window's environment. */
  creationURL: URLRecord;
  /** Origin selected for the new Document. */
  origin: Origin;
  /** Parent Window used for ancestry and secure-context determination. */
  parent: WindowImpl | null;
  /** Top-level URL captured for the environment's initial settings. */
  topLevelCreationURL: URLRecord;
  /** Top-level origin captured for partitioning and security decisions. */
  topLevelOrigin: Origin;
  /** Early environment record whose identity survives navigation setup. */
  reservedEnv?: BrowletEnvironmentRecord | null;
  /** Previous realm whose WindowProxy identity is reused for navigation. */
  previousRealm?: WindowRealm;
};
