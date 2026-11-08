import { InternalError, type InternalPromise } from '../../infra/index';
import {
  arg, atArg, defineIncludes, defineInterface, DOMExceptionImpl, idlType, impl, invokeWith,
  op, reference, roAttr, union, type VoidFunction,
} from '../../web-idl/core/index';
import type { URLRecord } from '../../url/index';
import type { HTTPStatus } from '../../http/index';
import { isLocalURL, FetchResponse, type FetchRequestInfo, type FetchRequestInit, type ResponseImpl } from '../../fetch/index';

import { EventTargetImpl } from '../dom/events/index';
import {
  SharedWorkerAgent, EventHandlerMap, eventHandlerMapAttr, ImportMap, ModuleMap, mergeExistingAndNewImportMaps,
  type ClassicScript, type ModuleScript, type BrowletGlobalObject, type PerformScriptFetch, type SpecifierResolutionRecord, type TimerAction,
} from '../scripting/index';
import { EmbedderPolicy, PolicyContainer } from '../browsing/policy/index';
import type { TrustedScriptURLImpl, TrustedTypePolicyFactoryImpl } from '../browsing/policy/trusted-types/index';
import type { DocumentImpl } from '../dom/nodes/index';
import type { PerformanceImpl } from '../performance/index';
import { WorkerNavigatorImpl } from '../navigator/index';
import { MessagePortImpl } from '../communication/index';
import { WindowOrWorkerGlobalScopeMixin, type BrowletEnvironment, type BrowletEnvironmentBase, type TimerHandler } from '../environment/index';
import type { StructuredSerializeOptions } from '../scripting/structured-data/index';

import type { WorkerScriptResponse } from './environment';
import { WorkerLocationImpl } from './worker-location';
import { WorkerOwnerSet } from './owner-set';
import type { RemoteWorkerOwner, WorkerOwnerState } from './remote-owner';

/** Common worker scripting and policy state. */
// https://html.spec.whatwg.org/multipage/workers.html#workerglobalscope
export abstract class WorkerGlobalImpl extends EventTargetImpl implements BrowletGlobalObject {
  /** Handler definitions shared by dedicated, shared, and service worker globals. */
  protected static handlerDefinitions = new Map([
    ['onerror', 'error'], ['onlanguagechange', 'languagechange'], ['onoffline', 'offline'],
    ['ononline', 'online'], ['onrejectionhandled', 'rejectionhandled'], ['onunhandledrejection', 'unhandledrejection'],
  ]);

  declare env: BrowletEnvironment;
  /** Script kind selected during creation; service worker creation also supplies its kind. */
  type: WorkerType;
  /** Creation name, exposed only by the dedicated/shared worker subclasses. */
  name: string;
  /** Final script response URL; startup assigns it before executing author code. */
  url: URLRecord | null = null;
  /** Root response status retained for CSP violation metadata, zero before response initialization. */
  httpStatus: HTTPStatus = 0;
  /** Documents and worker globals retaining this worker, including ownerless-period timing. */
  ownerSet: WorkerOwnerSet;
  /** Presence/activity of an owner retained in another isolate; never a cloned Document or worker global. */
  // Dedicated startup supplies its original Document; the shared manager
  // publishes the combined state of its browser-owned Documents.
  remoteOwner: RemoteWorkerOwner | null = null;
  /** Policies owned by this global, replaced by the startup response or inherited owner policies. */
  policyContainer = new PolicyContainer();
  /** Script-fetch results shared with this global's worker settings. */
  moduleMap = new ModuleMap();
  /** Startup derives this capability from the agent and response policies. */
  crossOriginIsolatedCapability = false;
  /** Execution owner notified before closing is set, so pending native suspension cannot strand cleanup. */
  onClosing: (() => void) | null = null;
  /** Stable URL view, observed only after startup assigns this global's URL. */
  location: WorkerLocationImpl;
  /** Stable worker navigator identity; its capability mixins remain a later dependency. */
  navigator: WorkerNavigatorImpl;
  /** Worker handler attributes use the existing HTML handler and callback machinery. */
  override eventHandlers: EventHandlerMap = new EventHandlerMap(this, WorkerGlobalImpl.handlerDefinitions);
  /** Recursion guard for reporting exceptions in this global. */
  inErrorReportingMode = false;
  /** Rejected promises already reported but not yet handled. */
  outstandingRejectedPromises = new WeakSet<Promise<unknown>>();
  /** Rejected promises awaiting the next notification checkpoint. */
  aboutToBeNotifiedRejectedPromises: Promise<unknown>[] = [];
  /** Common HTML global state; author import-map registration currently belongs to Windows. */
  importMap = new ImportMap();
  /** Resolutions retained when applying an import map. */
  resolvedModuleSet = new Set<SpecifierResolutionRecord>();
  /** Startup installs the response's embedder policy before its inheritance check. */
  // https://html.spec.whatwg.org/multipage/workers.html#concept-workerglobalscope-embedder-policy
  embedderPolicy = new EmbedderPolicy();
  /** Timers, shared global APIs, and cleanup collections owned by this worker global. */
  #globalScopeMixin: WindowOrWorkerGlobalScopeMixin;
  /** Once set, the worker event loop discards newly queued tasks (HTML §10.2.2). */
  #closing = false;

  constructor(type: WorkerType, name: string, env: BrowletEnvironment) {
    super(env);
    this.type = type;
    this.name = name;
    this.#globalScopeMixin = new WindowOrWorkerGlobalScopeMixin(env);
    // Local workers have no native suspension. Separate-isolate startup replaces
    // this clock before author code or timeout algorithms can create waits.
    this.#globalScopeMixin.timers.setWorkerClock(() => env.currentHighResolutionTime().milliseconds);
    this.ownerSet = new WorkerOwnerSet(env);
    this.location = new WorkerLocationImpl(this);
    this.navigator = new WorkerNavigatorImpl(env);
  }

  /** Select the creating Window's associated Document, or the creating worker global itself. */
  // https://html.spec.whatwg.org/multipage/workers.html#relevant-owner-to-add
  static getRelevantOwner(env: BrowletEnvironment): WorkerOwner {
    if (env.realm.isWindow()) return env.realm.getAssociatedDocument();
    const global = env.globalImplementation;
    if (global instanceof WorkerGlobalImpl) return global;
    throw new InternalError('A worker owner requires Window or WorkerGlobalScope settings');
  }

  /** Current remote ownership, visible without waiting for the worker's host message queue. */
  get remoteOwnerState(): WorkerOwnerState { return this.remoteOwner?.state ?? null; }

  /** Closing workers finish their current turn and cannot subsequently be suspended. */
  get closing(): boolean { return this.#closing; }
  set closing(closing: boolean) {
    // Disable native suspension before publishing the flag. Otherwise a V8
    // interrupt between these steps could strand a worker that is already closing.
    if (closing && !this.#closing) this.onClosing?.();
    this.#closing = closing;
  }

  /** Snapshot of ports connected beyond this global, including peers in transit and the dedicated inside port. */
  // https://html.spec.whatwg.org/multipage/workers.html#the-worker's-ports
  get ports(): MessagePortImpl[] {
    const ports: MessagePortImpl[] = [];
    for (const port of this.getWindowOrWorkerGlobalScopeMixin().messagePorts) {
      if (port.isEntangledOutsideGlobal()) ports.push(port);
    }
    return ports;
  }

  /** Return this worker global's own identity. */
  // https://html.spec.whatwg.org/multipage/workers.html#dom-WorkerGlobalScope-self
  get self(): this {
    return this;
  }

  /** Serialized origin of this worker's environment, separate from its script URL. */
  get origin(): string {
    return this.getWindowOrWorkerGlobalScopeMixin().origin;
  }

  /** Security classification inherited during worker environment creation. */
  get isSecureContext(): boolean {
    return this.getWindowOrWorkerGlobalScopeMixin().isSecureContext;
  }

  /** Isolation capability derived from this worker's agent and response policies. */
  get crossOriginIsolated(): boolean {
    return this.getWindowOrWorkerGlobalScopeMixin().crossOriginIsolated;
  }

  /** Stable performance timeline owned by this worker's environment. */
  get performance(): PerformanceImpl {
    return this.getWindowOrWorkerGlobalScopeMixin().performance;
  }

  /** Policy factory owned by this worker, independent of its creator's factory. */
  get trustedTypes(): TrustedTypePolicyFactoryImpl {
    return this.getWindowOrWorkerGlobalScopeMixin().trustedTypes;
  }

  /** Encode a converted binary string through the common global implementation. */
  btoa(data: string): string {
    return this.getWindowOrWorkerGlobalScopeMixin().btoa(data);
  }

  /** Decode a converted Base64 string through the common global implementation. */
  atob(data: string): string {
    return this.getWindowOrWorkerGlobalScopeMixin().atob(data);
  }

  /** Report a value through this worker's normal runtime-error handling. */
  reportError(exception: unknown): void {
    this.env.reportException(exception);
  }

  /** Queue a converted callback on this worker's realm and event loop. */
  queueMicrotask(callback: VoidFunction): void {
    this.getWindowOrWorkerGlobalScopeMixin().queueMicrotask(callback);
  }

  /** Clone into this worker's realm, applying the converted transfer list. */
  structuredClone<T>(value: T, options?: StructuredSerializeOptions): T {
    return this.getWindowOrWorkerGlobalScopeMixin().structuredClone(value, options) as T;
  }

  /** Fetch with this worker's environment and its connected browser services. */
  fetch(input: FetchRequestInfo, init: FetchRequestInit): InternalPromise<ResponseImpl> {
    return this.getWindowOrWorkerGlobalScopeMixin().fetch(input, init);
  }

  /** Allocate a one-shot timer with converted arguments in this worker's timer owner. */
  setTimeout(handler: TimerHandler, timeout: number, ...argumentsList: unknown[]): number {
    // TODO(HTML worker timers): Startup must advance timers only while the worker is not suspended.
    return this.getWindowOrWorkerGlobalScopeMixin().setTimeout(this.#createTimerAction(handler), timeout, argumentsList);
  }

  /** Allocate a repeating timer in the same timer-ID map as timeouts. */
  setInterval(handler: TimerHandler, timeout: number, ...argumentsList: unknown[]): number {
    return this.getWindowOrWorkerGlobalScopeMixin().setInterval(this.#createTimerAction(handler), timeout, argumentsList);
  }

  /** Cancel an outstanding timeout or interval belonging to this worker. */
  clearTimeout(id: number): void {
    this.getWindowOrWorkerGlobalScopeMixin().clearTimer(id);
  }

  /** Cancel an outstanding interval or timeout belonging to this worker. */
  clearInterval(id: number): void {
    this.getWindowOrWorkerGlobalScopeMixin().clearTimer(id);
  }

  override isWorkerGlobal(): this is WorkerGlobalImpl {
    return true;
  }

  /** Return this global's shared APIs and resource-lifetime state. */
  getWindowOrWorkerGlobalScopeMixin(): WindowOrWorkerGlobalScopeMixin {
    return this.#globalScopeMixin;
  }

  /** Run a successfully loaded initial script from its completion task, then activate its entangled startup ports. */
  // https://html.spec.whatwg.org/multipage/workers.html#run-a-worker
  // The caller connects lifetime monitoring first. The outside queue may live in
  // another isolate, so its execution owner supplies the activation steps.
  runScript(script: ClassicScript | ModuleScript, insidePort: MessagePortImpl, startOutsidePort: () => void): void {
    const env = this.env;
    env.markExecutionReady();
    // ModuleScript.run() owns rejection reporting. HTML does not wait for its
    // evaluation Promise (including top-level await) before enabling the ports.
    void script.run();
    startOutsidePort();
    if (!(env.realm.agent instanceof SharedWorkerAgent)) {
      insidePort.start();
    } else {
      env.realm.agent.globalScope!.queueConnectEvent(insidePort);
    }
    // TODO(Service Workers): Enable this client's ServiceWorkerContainer message
    // queue. No container/client-message-queue implementation exists yet.
  }

  /** Install resolved root policies on this worker before parsing; rejected responses remain script-fetch failures. */
  // Transport supplies resolved policies and the creator-side COEP result.
  // No live creator or Blob registration is consulted here.
  // CSP initialization belongs here: warnings and upgrade-insecure-requests
  // must affect this worker, never its creator's environment.
  initializeScriptResponse(result: WorkerScriptResponse): FetchResponse {
    const env = this.env;
    const { response, policyContainer } = result;
    // Network errors have no URL or policies to install.
    if (response.type === 'error') return response;
    const url = response.url;
    if (url === null) throw new InternalError('Worker script response requires a URL');
    if (policyContainer === null) throw new InternalError('Worker script response requires resolved policies');
    this.url = url;
    this.httpStatus = response.status;
    env.creationURL = url;
    this.policyContainer = policyContainer;
    this.embedderPolicy = this.policyContainer.embedderPolicy;
    let blocked = this.policyContainer.cspList?.initializeWorker(this) ?? false;
    const agent = env.realm.agent;
    const cluster = agent.agentCluster;
    if (cluster === null) throw new InternalError('Worker response initialization requires its agent cluster');
    if (agent instanceof SharedWorkerAgent && EmbedderPolicy.isCompatibleWithCrossOriginIsolation(this.embedderPolicy.value)) {
      // Use the same logical-isolation policy as Window startup. Physical
      // isolation and shared-memory exposure still require their own integration.
      cluster.crossOriginIsolationMode = 'logical';
    }
    // SPEC_CLASH(worker-rejected-response-url): HTML replaces response with a
    // network error, then still uses its URL for reports and the data: check.
    // Retain the original response for those steps; return the rejection below.
    if (!result.embedderPolicyAllowed) blocked = true;
    this.crossOriginIsolatedCapability = cluster.crossOriginIsolationMode === 'concrete';
    if (!(agent instanceof SharedWorkerAgent) && (!result.outsideCrossOriginIsolatedCapability || url.scheme === 'data')) {
      this.crossOriginIsolatedCapability = false;
    }
    return blocked ? FetchResponse.networkError() : response;
  }

  /** Entangle a new inside connection with its outside peer before script execution. */
  // https://html.spec.whatwg.org/multipage/workers.html#run-a-worker
  connectPort(outsidePort: MessagePortImpl): MessagePortImpl {
    const insidePort = new MessagePortImpl(this.env);
    outsidePort.entangle(insidePort);
    return insidePort;
  }

  /** Only shared workers can opt into an extended lifetime. */
  // https://html.spec.whatwg.org/multipage/workers.html#in-extended-lifetime-worker
  isInExtendedLifetime(): boolean {
    return false;
  }

  /** Whether this worker or an owning worker is extended, or has a fully active Document owner. */
  // https://html.spec.whatwg.org/multipage/workers.html#active-needed-worker
  isActivelyNeeded(): boolean {
    const pending: WorkerGlobalImpl[] = [this];
    const visited = new Set<WorkerGlobalImpl>();
    // Shared workers can form owner cycles. Visit each global once rather than
    // recurse indefinitely through a cycle with no active or extended owner.
    while (pending.length > 0) {
      const global = pending.pop()!;
      if (visited.has(global)) continue;
      visited.add(global);
      if (global.remoteOwner?.activelyNeeded || global.isInExtendedLifetime()) return true;
      for (const owner of global.ownerSet) {
        if (owner instanceof WorkerGlobalImpl) pending.push(owner);
        else if (owner.isFullyActive()) return true;
      }
    }
    return false;
  }

  /** Whether active need is backed by an extension, external port, or outstanding asynchronous work. */
  // https://html.spec.whatwg.org/multipage/workers.html#protected-worker
  isProtected(): boolean {
    if (!this.isActivelyNeeded()) return false;
    if (this.isInExtendedLifetime()) return true;
    if (this.ports.length > 0) return true;
    const resources = this.getWindowOrWorkerGlobalScopeMixin();
    // SPEC_GAP(worker-outstanding-activity): HTML leaves "outstanding" work informal.
    // Count uncanceled timers through callback delivery, unfinished Fetch requests,
    // and EventSources through reconnection. Idle pooled sockets do not count.
    // TODO(IndexedDB, WebSockets, WebTransport): Include worker-owned transactions
    // and live connections when those subsystems expose their activity lifetimes.
    return resources.timers.hasOutstandingTimers() || this.env.fetchGroup.hasPendingFetches() ||
      resources.eventSources.size > 0;
  }

  /** Whether an owner or an extended lifetime still permits this worker to exist. */
  // https://html.spec.whatwg.org/multipage/workers.html#permissible-worker
  isPermissible(): boolean {
    return this.ownerSet.size > 0 || this.remoteOwnerState !== null || this.isInExtendedLifetime();
  }

  /** A permissible worker without active need may be suspended by the processing model. */
  // https://html.spec.whatwg.org/multipage/workers.html#suspendable-worker
  isSuspendable(): boolean {
    return !this.isActivelyNeeded() && this.isPermissible();
  }

  /** Apply Trusted Types before importing scripts using the invoked method's current environment. */
  // https://html.spec.whatwg.org/multipage/workers.html#importing-scripts-and-libraries
  // The injected environment precedes the variadic IDL arguments, which must remain last.
  importScripts(env: BrowletEnvironment, ...urls: (TrustedScriptURLImpl | string)[]): void {
    const trustedTypes = this.getWindowOrWorkerGlobalScopeMixin().trustedTypes;
    const urlStrings = urls.map((url) => trustedTypes.getCompliantString(
      'TrustedScriptURL', url, 'WorkerGlobalScope importScripts', 'script',
    ));
    this.importScriptsIntoWorker(urlStrings, undefined, env);
  }

  /** Validate all URLs, then fetch and execute each script; Service Workers may supply their fetch hook. */
  // https://html.spec.whatwg.org/multipage/workers.html#import-scripts-into-worker-global-scope
  importScriptsIntoWorker(urls: string[], performFetch?: PerformScriptFetch, env = this.env): void {
    if (this.type === 'module') throw new env.realm.TypeError('Module workers cannot use importScripts()');
    const urlRecords = urls.map((url) => {
      const record = env.encodingParseURL(url);
      if (record === null) throw new DOMExceptionImpl('Invalid worker import URL', 'SyntaxError');
      return record;
    });
    for (const url of urlRecords) {
      const script = env.fetchClassicWorkerImportedScript(url, performFetch);
      const completion = script.run(true);
      if (completion.type === 'throw') throw completion.value;
    }
  }

  /** Discard queued tasks and prevent further tasks; the running script can finish. */
  // https://html.spec.whatwg.org/multipage/workers.html#close-a-worker
  close(): void {
    const loop = this.env.responsibleEventLoop;
    for (const queue of loop.getTaskQueues()) queue.clear();
    this.closing = true;
    loop.notifyTaskRunnabilityChanged();
  }

  /** Release the worker's resources after its event loop has been destroyed. */
  // https://html.spec.whatwg.org/multipage/workers.html#run-a-worker
  // Extracted final onComplete steps, after the event-loop processing step.
  finishRunning(): void {
    // TODO(HTML §10.2.4): Connect Fetch cancellation to shared-service owners;
    // local cleanup cannot release requests retained in another isolate.
    const resources = this.getWindowOrWorkerGlobalScopeMixin();
    resources.timers.clear();
    for (const port of this.ports) port.disentangle();
    // SPEC_GAP(worker-eventsource-shutdown): HTML's worker tail omits EventSource disposal.
    // Blink closes EventSources on context destruction. Reuse the same local
    // close path here to abort requests, cancel retries, and release retention.
    for (const source of resources.eventSources) source.close();
    // SPEC_GAP(worker-file-reader-shutdown): HTML's worker tail omits FileReader disposal.
    // Blink, Gecko, and WebKit cancel pending reads on context destruction,
    // without the author events fired by FileReader.abort().
    for (const reader of resources.fileReaders) reader.stop();
    this.ownerSet.clear();
    this.remoteOwner = null;
  }

  /** Local non-Blob workers inherit their owner's policies; other workers use the response. */
  // https://html.spec.whatwg.org/multipage/browsers.html#initialize-worker-policy-container
  initializePolicyContainer(response: FetchResponse, env: BrowletEnvironmentBase): void {
    if (this.url === null) throw new InternalError('Worker policy initialization requires its script URL');
    if (isLocalURL(this.url) && this.url.scheme !== 'blob') {
      if (this.ownerSet.size !== 1) throw new InternalError('Local worker policy inheritance requires exactly one owner');
      const [owner] = this.ownerSet;
      this.policyContainer = owner!.policyContainer.clone();
    } else {
      this.policyContainer = env.userAgent.createPolicyContainerFromResponse(response, env);
    }
  }

  /** Non-dedicated workers do not participate in the owner's COEP inheritance check. */
  // https://html.spec.whatwg.org/multipage/browsers.html#check-a-global-object's-embedder-policy
  checkEmbedderPolicy(_response: FetchResponse, _ownerEnv: BrowletEnvironment): boolean {
    return true;
  }

  /** Shared global contract; HTML currently registers author import maps only in Windows. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#merge-existing-and-new-import-maps
  mergeImportMap(newImportMap: ImportMap): void {
    mergeExistingAndNewImportMaps(this, newImportMap);
  }

  /** Supply the worker global as the callback receiver when a timer is delivered. */
  #createTimerAction(handler: TimerHandler): TimerAction {
    if (typeof handler === 'string') {
      // TODO(HTML timers): Share string-handler preparation with Window when Trusted Types/CSP are connected.
      return () => { throw new InternalError('String timer handlers await Trusted Types, CSP, and classic scripts'); };
    }
    return (argumentsList) => { Reflect.apply(handler, this.env.global, argumentsList); };
  }
}

/** A Document or worker global responsible for a worker's lifetime. */
export type WorkerOwner = DocumentImpl | WorkerGlobalImpl;

/** Script kinds shared with HTML's WorkerOptions dictionary (§10.2.6.3). */
export type WorkerType = 'classic' | 'module';

/*
 * [Exposed=Worker]
 * interface WorkerGlobalScope : EventTarget {
 *   readonly attribute WorkerGlobalScope self;
 *   readonly attribute WorkerLocation location;
 *   readonly attribute WorkerNavigator navigator;
 *   undefined importScripts((TrustedScriptURL or USVString)... urls);
 *   attribute OnErrorEventHandler onerror;
 *   attribute EventHandler onlanguagechange;
 *   attribute EventHandler onoffline;
 *   attribute EventHandler ononline;
 *   attribute EventHandler onrejectionhandled;
 *   attribute EventHandler onunhandledrejection;
 * };
 */
export const workerGlobalScopeIDL = defineInterface<BrowletEnvironment>({
  name: 'WorkerGlobalScope',
  inherits: 'EventTarget',
  exposed: 'Worker',
  implementation: impl(WorkerGlobalImpl),
  members: [
    roAttr('self', reference('WorkerGlobalScope')),
    roAttr('location', reference('WorkerLocation')),
    roAttr('navigator', reference('WorkerNavigator')),
    op('importScripts', idlType.undefined,
      [arg('urls', union(reference('TrustedScriptURL'), idlType.USVString), { variadic: true })],
      invokeWith(atArg(0, (_env, methodEnv) => methodEnv)),
    ),
    eventHandlerMapAttr('onerror', 'OnErrorEventHandler'),
    eventHandlerMapAttr('onlanguagechange'),
    eventHandlerMapAttr('onoffline'),
    eventHandlerMapAttr('ononline'),
    eventHandlerMapAttr('onrejectionhandled'),
    eventHandlerMapAttr('onunhandledrejection'),
  ],
});

/*
 * WorkerGlobalScope includes WindowOrWorkerGlobalScope;
 */
export const workerIncludesWindowOrWorkerGlobalScopeIDL = defineIncludes({
  interface: 'WorkerGlobalScope', mixin: 'WindowOrWorkerGlobalScope',
});
