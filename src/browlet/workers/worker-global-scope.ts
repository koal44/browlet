import { InternalError } from '../../infra/index';
import { arg, defineInterface, idlType, impl, op, reference, roAttr, union } from '../../web-idl/core/index';
import type { URLRecord } from '../../url/index';
import { isLocalURL, type FetchResponse } from '../../fetch/index';

import { EventTargetImpl } from '../dom/events/index';
import {
  EventHandlerMap, eventHandlerMapAttr, ImportMap, ModuleMap, mergeExistingAndNewImportMaps,
  type BrowletGlobalObject, type SpecifierResolutionRecord,
} from '../scripting/index';
import { EmbedderPolicy, PolicyContainer } from '../browsing/policy/index';
import type { TrustedScriptURLImpl } from '../browsing/policy/trusted-types/index';
import type { DocumentImpl } from '../dom/nodes/index';
import { WorkerNavigatorImpl } from '../navigator/index';
import { MessagePortImpl } from '../communication/index';
import type { BrowletEnvironment, BrowletEnvironmentBase } from '../environment/index';

import { WorkerLocationImpl } from './worker-location';
import { WorkerOwnerSet } from './owner-set';

/** Common worker scripting and policy state. */
// https://html.spec.whatwg.org/multipage/workers.html#workerglobalscope
// TODO(HTML §§10.2.4, 10.2.6): Startup must invoke worker environment composition on the execution backend.
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
  /** Documents and worker globals retaining this worker, including ownerless-period timing. */
  ownerSet: WorkerOwnerSet;
  /** Policies owned by this global, replaced by the startup response or inherited owner policies. */
  policyContainer = new PolicyContainer();
  /** Script-fetch results shared with this global's worker settings. */
  moduleMap = new ModuleMap();
  /** Startup derives this capability from the agent and response policies. */
  crossOriginIsolatedCapability = false;
  /** Once set, the worker event loop discards newly queued tasks (HTML §10.2.2). */
  closing = false;
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

  constructor(type: WorkerType, name: string, env: BrowletEnvironment) {
    super(env);
    this.type = type;
    this.name = name;
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

  /** Snapshot of ports connected beyond this global, including peers in transit and the dedicated inside port. */
  // https://html.spec.whatwg.org/multipage/workers.html#the-worker's-ports
  get ports(): MessagePortImpl[] {
    const ports: MessagePortImpl[] = [];
    for (const port of this.env.getWindowOrWorkerGlobalScopeMixin().messagePorts) {
      if (port.isEntangledOutsideGlobal()) ports.push(port);
    }
    return ports;
  }

  /** Return this worker global's own identity. */
  // https://html.spec.whatwg.org/multipage/workers.html#dom-WorkerGlobalScope-self
  get self(): this {
    return this;
  }

  override isWorkerGlobal(): this is WorkerGlobalImpl {
    return true;
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
      if (global.isInExtendedLifetime()) return true;
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
    const resources = this.env.getWindowOrWorkerGlobalScopeMixin();
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
    return this.ownerSet.size > 0 || this.isInExtendedLifetime();
  }

  /** A permissible worker without active need may be suspended by the processing model. */
  // https://html.spec.whatwg.org/multipage/workers.html#suspendable-worker
  isSuspendable(): boolean {
    return !this.isActivelyNeeded() && this.isPermissible();
  }

  /** Worker-only synchronous script loading, supplied by the later loading integration. */
  // https://html.spec.whatwg.org/multipage/workers.html#importing-scripts-and-libraries
  importScripts(..._urls: (TrustedScriptURLImpl | string)[]): void {
    // TODO(HTML §10.3.1): Trusted Types checks, synchronous worker-imported script fetching,
    // and ordered classic-script execution require worker settings and the pause backend.
    throw new InternalError('Worker importScripts() is not implemented');
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
    this.env.getWindowOrWorkerGlobalScopeMixin().timers.clear();
    for (const port of this.ports) port.disentangle();
    this.ownerSet.clear();
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
  checkEmbedderPolicy(_ownerEnv: BrowletEnvironment, _response: FetchResponse): boolean {
    return true;
  }

  /** Shared global contract; HTML currently registers author import maps only in Windows. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#merge-existing-and-new-import-maps
  mergeImportMap(newImportMap: ImportMap): void {
    mergeExistingAndNewImportMaps(this, newImportMap);
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
    ),
    eventHandlerMapAttr('onerror', 'OnErrorEventHandler'),
    eventHandlerMapAttr('onlanguagechange'),
    eventHandlerMapAttr('onoffline'),
    eventHandlerMapAttr('ononline'),
    eventHandlerMapAttr('onrejectionhandled'),
    eventHandlerMapAttr('onunhandledrejection'),
  ],
});
