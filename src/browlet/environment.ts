import { InternalError, type JSONValue, type InfraValue } from '../infra/index';
import { getPromiseResult, isPromiseHandled, randomUUID, type JSEnvironment, type RealmExecution } from '../js-engine/index';
import type { WebIDLExecution } from '../web-idl/core/index';
import { matchesExposure } from '../web-idl/index';
import type { SelectletEnvironment } from '../selectlet/index';
import { utf8Decode, utf8Encode, type Encoding } from '../encoding/index';
import {
  obtainSite, obtainURLOrigin, serializeURL, urlsEqual, URLImpl,
  type Origin, type URLRecord,
} from '../url/index';
import {
  FetchGroup,
  type FetchEnvironment, type FetchEnvironmentBase, type FetchExecution,
  type CacheUsage, type Destination, type FetchMode, type FetchResponse, type FetchTimingInfo,
  type NetworkPartitionKey, type RequestCredentials, type ResponseBodyInfo,
} from '../fetch/index';
import { cssStyleSheetIDL, type StyleletEnvironment, type StyleletExecution } from '../stylelet/index';

import type { QuotaExceededError } from './platform';
import { Moment, UnsafeMoment, monotonicClock, EnvironmentTiming } from './timing/index';
import type { CORSSettingsState } from './dom/nodes/html/attributes/index';
import {
  fetchClassicScript, fetchClassicWorkerScript, fetchClassicWorkerImportedScript,
  fetchExternalModuleScriptGraph, fetchModulepreloadModuleScriptGraph, fetchInlineModuleScriptGraph,
  fetchModuleWorkerScriptGraph, fetchWorkletScriptGraph,
  fetchSingleModuleScript, fetchSingleImportedModuleScript, resolveModuleSpecifier,
  ClassicScript, DedicatedWorkerAgent, SandboxAgent, domManipulationTaskSource, type Script,
  type ScriptFetchOptions, type ModuleMap, type ModuleType,
  type JSModuleRequest, type ModuleFetchCallback, type PerformScriptFetch,
  type EventLoop, type BrowletRealm, type WindowRealm, type WindowAgent, type JSExecutionContext, type BrowletGlobalObject,
} from './scripting/index';
import { ErrorEventImpl, EventTargetImpl, PromiseRejectionEventImpl } from './dom/events/index';
import type { ReportImpl } from './reporting/index';
import { InsecureRequestsPolicy, type PolicyContainer } from './browsing/policy/index';
import type { AbortSignalImpl } from './dom/abort/index';
import { NodeImpl, type DocumentImpl } from './dom/nodes/index';
import { HTMLAnchorElementImpl } from './dom/nodes/html/text/index';
import { HTMLAreaElementImpl } from './dom/nodes/html/embedded/index';
import type { DOMEnvironment, DOMExecution } from './dom/index';
import { generateReport } from './reporting/generate';
import { WindowImpl } from './browsing/window/index';
import { MessageEventImpl } from './communication/index';
import { OriginImpl } from './browsing/index';
import type { WindowOrWorkerGlobalScopeMixin } from './global-scope';
import type { BrowsingContext, Traversable } from './browsing/navigation/index';
import type { UserAgent } from './user-agent';
import type { ModuleResponsesMap } from './worklets/index';

/** Browser state shared by reserved clients and full environments. */
// https://html.spec.whatwg.org/multipage/webappapis.html#environment
export class BrowletEnvironmentBase implements FetchEnvironmentBase {
  /** Identity transferred to the full environment when a reservation is consumed. */
  id: string;
  /** Top-level creation URL, or null when the environment has none. */
  topLevelCreationURL: URLRecord | null;
  /** Top-level origin, or null until it can be determined. */
  // TODO: Worker/worklet setup must inherit this where specified; shared/service
  // worker setup must choose its implementation-defined top-level origin policy.
  topLevelOrigin: Origin | null;
  /** Navigation's target browsing context, when present. */
  targetBrowsingContext: BrowsingContext | null;
  /** Service worker controlling this environment, when present. */
  // PROVISIONAL: Replace object with the service worker record when its control lifecycle exists.
  activeServiceWorker: object | null;
  /** Whether the environment discarding steps have run for this client. */
  discarded = false;
  /** Browser owner; null only for an internal sandbox constructed without one. */
  #userAgent: UserAgent | null;
  /** Creation URL; null only for internal sandboxes. */
  #creationURL: URLRecord | null;
  #isSecureContext: boolean;
  #executionReady = false;

  /** Null leaves browser-specific state unavailable for an internal sandbox. */
  constructor(initialization: BrowletEnvironmentBaseInit | null) {
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
  // TODO(HTML §8.1.3.5): Worker setup must use the first owner's relevant settings;
  // worklet setup must supply true. Neither global/settings lifecycle exists yet.
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

  /** Run the discarding steps for an environment that will never become execution ready. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#environment-discarding-steps
  // https://w3c.github.io/ServiceWorker/#service-worker-client-concept
  discard(): void {
    // TODO: Call from failed/aborted navigation, redirect reservation replacement,
    // and failed worker startup when those processing paths are implemented.
    this.discarded = true;
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
export interface BrowletExecution extends
  RealmExecution, FetchExecution, WebIDLExecution, DOMExecution, StyleletExecution {
  /** Allocate a Document with this environment's binding ownership. */
  createDocument(): DocumentImpl;
  /** Allocate a node implementation with this environment's binding ownership. */
  constructNode<T extends object>(
    implementation: abstract new (...argumentsList: never[]) => T,
    argumentsList: unknown[],
  ): T;
  /** Allocate an AbortSignal with this environment's binding ownership before first projection. */
  createAbortSignal(): AbortSignalImpl;
  /** Allocate a projected QuotaExceededError in this execution's realm. */
  createQuotaExceededError(): QuotaExceededError;
}

/** Composed browser settings and execution for one realm and global. */
// HTML's environment settings object, owning its composed execution as env.exec.
export abstract class BrowletEnvironment extends BrowletEnvironmentBase implements
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

  constructor(realm: BrowletRealm, baseEnv: BrowletEnvironmentBase | null, exec: BrowletExecution) {
    super(baseEnv);
    this.exec = exec;
    this.timing = new EnvironmentTiming(this);
    this.realm = realm;
    // Internal sandboxes participate in Binding without becoming HTML settings objects.
    if (baseEnv !== null) realm.env = this;
  }

  /** The platform global installed in this environment's realm. */
  get global(): RealmExecution['global'] {
    return this.realm.globalObject;
  }

  /** The retained context shared by scripts using these settings. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#realm-execution-context
  get realmExecutionContext(): JSExecutionContext {
    return this.realm.executionContext;
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

  abstract get apiBaseURL(): URLRecord;
  /** Internal HTML global state; separate from the platform global exposed to scripts. */
  abstract get globalImplementation(): BrowletGlobalObject;
  abstract get moduleMap(): ModuleMap;
  abstract get origin(): Origin;
  abstract get hasCrossSiteAncestor(): boolean;
  abstract get policyContainer(): PolicyContainer;
  abstract get crossOriginIsolatedCapability(): boolean;
  abstract get timeOrigin(): Moment;

  get responsibleEventLoop(): EventLoop {
    return this.realm.agent.eventLoop;
  }

  /** The owning global's Document, when this is a Window environment. */
  getAssociatedDocument(): DocumentImpl | null {
    return this.realm.getAssociatedDocument();
  }

  /** Extract an origin using this environment for the caller's access check. */
  // https://html.spec.whatwg.org/multipage/browsers.html#extract-an-origin
  extractOrigin(value: unknown): Origin | null {
    if (OriginImpl.is(value)) return value.extractOrigin();
    if (URLImpl.is(value)) return value.getOrigin();
    if (WindowImpl.is(value)) return value.extractOrigin(this);
    if (HTMLAnchorElementImpl.is(value) || HTMLAreaElementImpl.is(value) || MessageEventImpl.is(value)) {
      return value.extractOrigin();
    }
    return null;
  }

  /** Report an exception at this environment's global, unless its error event is canceled. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#report-an-exception
  // ClassicScript.run reports before popping our realm context, but that context
  // has no script. Parse failures also have no script record, so the runner passes
  // its script explicitly. Other callers use the modeled running script below.
  reportException(
    exception: unknown, omitError = false,
    script: Script | null = this.responsibleEventLoop.runningScript,
  ): void {
    // Internal sandbox execution has no HTML global or error-event target.
    if (this.realm.agent instanceof SandboxAgent) {
      console.error(exception);
      return;
    }

    const global = this.globalImplementation;
    let notHandled = true;
    const errorInfo = ErrorEventImpl.extractErrorInformation(exception);
    if (script instanceof ClassicScript && script.mutedErrors) {
      errorInfo.error = null;
      errorInfo.message = 'Script error.';
      errorInfo.filename = '';
      errorInfo.lineno = 0;
      errorInfo.colno = 0;
    }
    if (omitError) errorInfo.error = null;

    if (!global.inErrorReportingMode) {
      global.inErrorReportingMode = true;
      try {
        if (EventTargetImpl.is(global)) {
          notHandled = global.fireEvent('error', ErrorEventImpl, (event) => {
            (event as ErrorEventImpl).initialize({ ...errorInfo, cancelable: true });
          });
          // TODO(HTML §8.1.8.1): onerror needs its special five-argument callback
          // and return-true cancellation. addEventListener uses DOM cancellation.
        }
      } finally {
        global.inErrorReportingMode = false;
      }
    }

    if (!notHandled) return;
    errorInfo.error = null;
    if (this.realm.agent instanceof DedicatedWorkerAgent) {
      // TODO(HTML §8.1.4.6): Queue a DOM-manipulation task for the associated
      // Worker's relevant global, fire the sanitized ErrorEvent there, and report
      // an unhandled exception on the owner global with omitError=true. Worker
      // objects, owner links, and implicit-port disentanglement are not implemented.
      // Propagation must survive terminated parents while suppressing their handlers.
      throw new InternalError('Dedicated-worker error propagation is not implemented');
    }
    // HTML permits reporting an unhandled exception to a developer console.
    console.error(exception);
  }

  /** Track rejection changes using this current environment and the modeled running script. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#the-hostpromiserejectiontracker-implementation
  // TODO: Call from the engine's HostPromiseRejectionTracker notification. Existing
  // job hooks and Node's later process-wide events do not supply that boundary.
  trackPromiseRejection(promise: Promise<unknown>, operation: 'reject' | 'handle'): void {
    const script = this.responsibleEventLoop.runningScript;
    if (script instanceof ClassicScript && script.mutedErrors) return;
    const env = script?.env ?? this;
    const global = env.globalImplementation;
    if (operation === 'reject') {
      global.aboutToBeNotifiedRejectedPromises.push(promise);
      return;
    }

    const pending = global.aboutToBeNotifiedRejectedPromises;
    const index = pending.indexOf(promise);
    if (index !== -1) {
      void pending.splice(index, 1);
      return;
    }
    if (!global.outstandingRejectedPromises.delete(promise)) return;
    env.realm.queueGlobalTask(domManipulationTaskSource, () => {
      if (!EventTargetImpl.is(global)) {
        throw new InternalError('Promise rejection events require an EventTarget global');
      }
      global.fireEvent('rejectionhandled', PromiseRejectionEventImpl, (event) => {
        (event as PromiseRejectionEventImpl).initialize({ promise, reason: getPromiseResult(promise) });
      });
    });
  }

  /** Queue notification of this global's currently pending promise rejections. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#notify-about-rejected-promises
  notifyAboutRejectedPromises(): void {
    const global = this.globalImplementation;
    const list = [...global.aboutToBeNotifiedRejectedPromises];
    if (list.length === 0) return;
    global.aboutToBeNotifiedRejectedPromises.length = 0;
    this.realm.queueGlobalTask(domManipulationTaskSource, () => {
      for (const promise of list) {
        if (isPromiseHandled(promise)) continue;
        if (!EventTargetImpl.is(global)) {
          throw new InternalError('Promise rejection events require an EventTarget global');
        }
        const reason = getPromiseResult(promise);
        const notCanceled = global.fireEvent('unhandledrejection', PromiseRejectionEventImpl, (event) => {
          (event as PromiseRejectionEventImpl).initialize({ promise, reason, cancelable: true });
        });
        if (notCanceled) console.error(reason);
        // A listener can attach a handler while the event is being dispatched.
        if (!isPromiseHandled(promise)) global.outstandingRejectedPromises.add(promise);
      }
    });
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

  /** Decode UTF-8 with replacement and initial BOM removal, then parse in this environment's realm. */
  // https://infra.spec.whatwg.org/#parse-json-bytes-to-a-javascript-value
  parseJSONBytes(bytes: Uint8Array): JSONValue {
    return this.exec.parseJSON(utf8Decode(bytes));
  }

  /** Decode UTF-8 JSON and return its realm-independent representation. */
  // https://infra.spec.whatwg.org/#parse-json-bytes-to-an-infra-value
  parseJSONBytesToInfra(bytes: Uint8Array): InfraValue {
    return this.exec.parseJSONStringToInfra(utf8Decode(bytes));
  }

  /** Serialize JavaScript in this environment's realm, then encode UTF-8 without a BOM. */
  // https://infra.spec.whatwg.org/#serialize-a-javascript-value-to-json-bytes
  serializeJavaScriptValueToJSONBytes(value: unknown): Uint8Array<ArrayBuffer> {
    return utf8Encode(this.exec.serializeJavaScriptValueToJSONString(value));
  }

  /** Serialize an Infra value in this environment's realm, then encode UTF-8 without a BOM. */
  // https://infra.spec.whatwg.org/#serialize-an-infra-value-to-json-bytes
  serializeInfraValueToJSONBytes(value: InfraValue): Uint8Array<ArrayBuffer> {
    return utf8Encode(this.exec.serializeInfraValueToJSONString(value));
  }

  /** Parse with this browser's Blob URL store; the caller selects any base URL. */
  parseURL(input: string, base: URLRecord | null = null, encoding = 'UTF-8'): URLRecord | null {
    return this.userAgent.parseURL(input, base, encoding);
  }

  /** Parse against this environment's API base URL using UTF-8; return null on failure. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#parse-a-url
  parseHTMLURL(input: string): URLRecord | null {
    return this.parseURL(input, this.apiBaseURL);
  }

  /** Parse against the API base using the current Window Document's encoding, or UTF-8 otherwise. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#encoding-parsing-a-url
  encodingParseURL(input: string): URLRecord | null {
    const encoding = this.realm.getAssociatedDocument()?.encoding ?? 'UTF-8';
    return this.parseURL(input, this.apiBaseURL, encoding);
  }

  /** Encoding-parse and serialize a URL, preserving parse failure as null. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#encoding-parsing-and-serializing-a-url
  encodingParseAndSerializeURL(input: string): string | null {
    const url = this.encodingParseURL(input);
    return url === null ? null : serializeURL(url);
  }

  /** Resolve using the referring script, with this environment as the current execution owner. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#resolve-a-module-specifier
  resolveModuleSpecifier(referringScript: Script | null, specifier: string): URLRecord {
    return resolveModuleSpecifier(referringScript, specifier, this);
  }

  /** Find integrity metadata in this environment's global import map. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#resolving-a-module-integrity-metadata
  resolveModuleIntegrityMetadata(url: URLRecord): string {
    // URL-record keys compare by URL value, independently of object identity.
    for (const [key, integrity] of this.globalImplementation.importMap.integrity) {
      if (urlsEqual(key, url)) return integrity;
    }
    return '';
  }

  /** Fetch a classic script using these settings. */
  fetchClassicScript(
    url: URLRecord, options: ScriptFetchOptions, corsSetting: CORSSettingsState, encoding: Encoding,
    onComplete: (script: ClassicScript | null) => void,
  ): void {
    fetchClassicScript(url, this, options, corsSetting, encoding, onComplete);
  }

  /** Fetch a worker's initial classic script for these settings using its outside client. */
  fetchClassicWorkerScript(
    url: URLRecord, fetchClient: BrowletEnvironment, destination: Destination,
    onComplete: (script: ClassicScript | null) => void, performFetch?: PerformScriptFetch,
  ): void {
    fetchClassicWorkerScript(url, fetchClient, destination, this, onComplete, performFetch);
  }

  /** Synchronously fetch an importScripts() dependency; the required pause is unfinished. */
  fetchClassicWorkerImportedScript(url: URLRecord, performFetch?: PerformScriptFetch): ClassicScript {
    return fetchClassicWorkerImportedScript(url, this, performFetch);
  }

  /** Fetch an external module graph for these settings. */
  fetchExternalModuleScriptGraph(url: URLRecord, options: ScriptFetchOptions, onComplete: ModuleFetchCallback): void {
    fetchExternalModuleScriptGraph(url, this, options, onComplete);
  }

  /** Preload a module root and its descendants for these Window settings. */
  fetchModulepreloadModuleScriptGraph(
    url: URLRecord, destination: Destination, options: ScriptFetchOptions, onComplete: ModuleFetchCallback,
  ): void {
    fetchModulepreloadModuleScriptGraph(url, destination, this, options, onComplete);
  }

  /** Create an inline module graph for these settings. */
  fetchInlineModuleScriptGraph(
    sourceText: string, baseURL: URLRecord, options: ScriptFetchOptions, onComplete: ModuleFetchCallback,
  ): void {
    fetchInlineModuleScriptGraph(sourceText, baseURL, this, options, onComplete);
  }

  /** Fetch a worker module graph for these settings using the outside fetch client. */
  fetchModuleWorkerScriptGraph(
    url: URLRecord, fetchClient: BrowletEnvironment, destination: Destination, credentialsMode: RequestCredentials,
    onComplete: ModuleFetchCallback,
  ): void {
    fetchModuleWorkerScriptGraph(url, fetchClient, destination, credentialsMode, this, onComplete);
  }

  /** Fetch a worklet module graph using responses shared across its globals. */
  fetchWorkletScriptGraph(
    url: URLRecord, fetchClient: BrowletEnvironment, destination: Destination, credentialsMode: RequestCredentials,
    moduleResponsesMap: ModuleResponsesMap, onComplete: ModuleFetchCallback,
  ): void {
    fetchWorkletScriptGraph(url, fetchClient, destination, credentialsMode, this, moduleResponsesMap, onComplete);
  }

  /** Fetch one module for these settings, sharing in-flight work and retained results. */
  fetchSingleModuleScript(
    url: URLRecord, fetchClient: BrowletEnvironment, destination: Destination, options: ScriptFetchOptions,
    referrer: URLRecord | 'client' | 'no-referrer', moduleRequest: JSModuleRequest | undefined,
    isTopLevel: boolean, onComplete: ModuleFetchCallback, performFetch?: PerformScriptFetch,
  ): void {
    fetchSingleModuleScript(
      url, fetchClient, destination, options, this, referrer, moduleRequest, isTopLevel, onComplete, performFetch,
    );
  }

  /** Validate an imported module's attributes and fetch it as a descendant. */
  fetchSingleImportedModuleScript(
    url: URLRecord, fetchClient: BrowletEnvironment, destination: Destination, options: ScriptFetchOptions,
    referrer: URLRecord | 'client' | 'no-referrer', moduleRequest: JSModuleRequest,
    onComplete: ModuleFetchCallback, performFetch?: PerformScriptFetch,
  ): void {
    fetchSingleImportedModuleScript(url, fetchClient, destination, options, this, referrer, moduleRequest, onComplete, performFetch);
  }

  /** Whether this realm permits the requested module type, including CSS interface exposure. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#module-type-allowed
  isModuleTypeAllowed(moduleType: ModuleType): boolean {
    return moduleType !== 'css' || matchesExposure(cssStyleSheetIDL, this.realm);
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

  /** Whether an implementation owned by these settings permits scripting. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#concept-n-script
  // Use the object's original environment, even after a Node changes documents.
  isScriptingEnabledFor(object: object): boolean {
    if (!this.isScriptingEnabled()) return false;
    if (NodeImpl.is(object)) return object.nodeDocument.browsingContext !== null;
    if (this.realm.isWindow() && object === this.globalImplementation) {
      return this.realm.getAssociatedDocument().browsingContext !== null;
    }
    return true;
  }

  /** Check document activity and scripting policy before an HTML script runs. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#check-if-we-can-run-script
  canRunScript(): boolean {
    const document = this.realm.getAssociatedDocument();
    // isFullyActive provisionally allows active children until the Section 7
    // audit supplies their container-document and ancestor activity checks.
    if (document !== null && !document.isFullyActive()) return false;
    return this.isScriptingEnabled();
  }

  /** Document or worker URL for reports, or null for other kinds of global. */
  // https://w3c.github.io/webappsec-subresource-integrity/#report-violations
  abstract getReportingSource(): URLRecord | null;

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

  get globalImplementation(): BrowletGlobalObject {
    throw new InternalError('Sandbox has no HTML global implementation');
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

  constructor(realm: WindowRealm, baseEnv: BrowletEnvironmentBase, exec: BrowletExecution) {
    super(realm, baseEnv, exec);
  }

  /** Window implementation whose current Document supplies browser state. */
  get window(): WindowImpl {
    return this.realm.windowImplementation;
  }

  get globalImplementation(): WindowImpl {
    return this.window;
  }

  override get isWindow(): boolean {
    return true;
  }

  override get isTopLevelWindow(): boolean {
    return this.window.getAssociatedDocument().getNodeNavigable()?.parent === null;
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

  override consumePreloadedResource(
    _url: URLRecord, _destination: Destination, _mode: FetchMode, _credentialsMode: RequestCredentials,
    _integrityMetadata: string, _onResponseAvailable: (response: FetchResponse) => void,
  ): boolean {
    // PROVISIONAL(HTML preload): no Document preload map is populated yet.
    // Match its keys and integrity metadata, then arrange response notification when implemented.
    return false;
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
export interface BrowletEnvironmentBaseInit {
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
  /** Reserved environment whose identity survives navigation setup. */
  reservedEnv?: BrowletEnvironmentBase | null;
  /** Previous realm whose WindowProxy identity is reused for navigation. */
  previousRealm?: WindowRealm;
};
