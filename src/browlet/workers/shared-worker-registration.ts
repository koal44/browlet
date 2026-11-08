import { InternalError, WeakOrderedSet, type TaskHandle } from '../../infra/index';
import type { JSMessagePort } from '../../js-engine/index';
import { copyOrigin, copyURL, urlsEqual, type URLRecord } from '../../url/index';
import { StorageKey } from '../../storage/index';

import { DocumentImpl } from '../dom/nodes/index';
import type { MessagePortImpl, MessagePortTransportMessage } from '../communication/index';
import type { UserAgent } from '../user-agent';

import type { SharedWorkerImpl, SharedWorkerOptions } from './shared-worker';
import type { WorkerScriptInit } from './protocol';
import type { WorkerThread } from './thread';
import { WorkerGlobalImpl, type WorkerOwner } from './worker-global-scope';
import { WorkerOwnerSet } from './owner-set';
import type { WorkerOwnerState } from './remote-owner';

/** One shared execution's browser-side identity, clients, and lifetime. Never transported to the worker isolate. */
export class SharedWorkerRegistration {
  /** Live browser-side owners; Documents delete themselves during destruction. */
  ownerSet: WorkerOwnerSet;
  /** Native execution whose closing state, suspension, and lifetime publication this registration controls. */
  #thread: WorkerThread;
  /** Captured constructor options; later clients are checked against this execution's original choices. */
  #options: SharedWorkerOptions;
  /** Original constructor URL, including its fragment, rather than the final response URL. */
  #url: URLRecord;
  /** Creator's partition; a data-URL worker's opaque inside origin is not its discovery key. */
  #storageKey: StorageKey;
  /** The first creator determines the worker's secure-context classification. */
  #isSecureContext: boolean;
  /** Browser-local clocks, timeout policy, and loading-navigable query. */
  #userAgent: UserAgent;
  /** Backlinks to remove on native exit, including surviving references to destroyed Documents. */
  #documents = new WeakOrderedSet<DocumentImpl>();
  /** Activity subscriptions exist only while their Documents remain owners. */
  #activityObservers: Map<DocumentImpl, () => void> = new Map();
  /** Disconnect membership notifications before releasing this registration. */
  #stopObservingOwners: () => void;
  /** One browser-side wake-up; worker suspension must not stop lifetime time. */
  #timer: TaskHandle | null = null;
  /** Outside associations are weak: retaining a port need not retain its SharedWorker object. */
  #connections = new WeakOrderedSet<SharedWorkerImpl>();
  /** Keep loading clients alive through initial execution or asynchronous load-error delivery. */
  #pendingConnections = new Set<SharedWorkerImpl>();
  /** Later connections no longer wait for a root-script load outcome. */
  #scriptStarted = false;

  /** Capture constructor identity and begin observing ownership before the manager adds the creating Document. */
  constructor(thread: WorkerThread, script: WorkerScriptInit, userAgent: UserAgent) {
    this.#thread = thread;
    this.#userAgent = userAgent;
    this.#options = {
      name: script.name,
      type: script.type,
      credentials: script.credentials,
      extendedLifetime: script.extendedLifetime ?? false,
    };
    this.#url = copyURL(script.url);
    // Discovery compares the original URL, never the cached Blob registration.
    // The initial Fetch already retains any registration it needs.
    this.#url.blobURLEntry = null;
    const storageKey = StorageKey.obtainForNonStoragePurposes(thread.creatorEnv);
    this.#storageKey = new StorageKey(copyOrigin(storageKey.origin));
    this.#isSecureContext = thread.creatorEnvSnapshot.isSecureContext;
    this.ownerSet = new WorkerOwnerSet(thread.creatorEnv);
    this.#stopObservingOwners = this.ownerSet.observe(() => { this.updateLifetime(); });
  }

  /** Match discovery identity only while the execution remains open to new connections. */
  matches(url: URLRecord, name: string, storageKey: StorageKey): boolean {
    return !this.#thread.closing && this.#storageKey.equals(storageKey) &&
      urlsEqual(this.#url, url) && this.#options.name === name;
  }

  /** Check the options and security status that must agree once discovery identity matches. */
  isCompatible(options: SharedWorkerOptions, isSecureContext: boolean): boolean {
    return this.#options.type === options.type && this.#options.credentials === options.credentials &&
      this.#options.extendedLifetime === options.extendedLifetime && this.#isSecureContext === isSecureContext;
  }

  /** Attach a prepared public connection, or leave its channel untouched if closing requires discovery to retry. */
  attach(worker: SharedWorkerImpl, channel: JSMessagePort<MessagePortTransportMessage>, initial: boolean): boolean {
    if (!this.#thread.attachSharedPort(channel, initial)) return false;
    this.addOwner(WorkerGlobalImpl.getRelevantOwner(worker.env));
    worker.thread = this.#thread;
    this.#connections.add(new WeakRef(worker));
    if (!this.#scriptStarted) this.#pendingConnections.add(worker);
    return true;
  }

  /** Connect an additional port, adding its Document only after native handoff succeeds. */
  connectPort(outsidePort: MessagePortImpl): void {
    const owner = WorkerGlobalImpl.getRelevantOwner(outsidePort.env);
    this.#thread.connectSharedPort(outsidePort);
    this.addOwner(owner);
  }

  /** Deduplicate Documents independently of how many outside SharedWorker objects they create. */
  addOwner(owner: WorkerOwner): void {
    if (this.ownerSet.has(owner)) return;
    this.ownerSet.add(owner);
    if (owner instanceof DocumentImpl) {
      // Do not remove this backlink synchronously when Document.destroy() calls
      // ownerSet.delete(): that algorithm is still iterating ownedWorkers.
      if (!owner.ownedWorkers.includes(this)) {
        owner.ownedWorkers.push(this);
        this.#documents.add(new WeakRef(owner));
      }
    }
  }

  /** Release loading-only retention once the initial script has been entered. */
  // SPEC_CLASH(shared-worker-port-activation): HTML enables the initiating outside
  // port in run-a-worker. All three browsers require start() or onmessage instead.
  didStartScript(): void {
    this.#scriptStarted = true;
    this.#pendingConnections.clear();
  }

  /** Notify every client waiting on the failed load before teardown releases its associations. */
  // SPEC_CLASH(shared-worker-load-error-clients): HTML names only run-a-worker's
  // initial outside object. All three browsers also notify clients attached during loading.
  reportScriptFetchFailure(): void {
    for (const worker of this.#pendingConnections) worker.queueError();
    this.#pendingConnections.clear();
  }

  /** Recompute the Window owners' lifetime contribution and arm only the next deadline. */
  // https://html.spec.whatwg.org/multipage/workers.html#the-worker's-lifetime
  // SharedWorker is Window-only, so these remote owners are Documents; local
  // worker-owner graphs keep their existing recursive predicates on WorkerGlobalImpl.
  updateLifetime(): void {
    this.#timer?.remove();
    this.#timer = null;
    for (const [document, unsubscribe] of this.#activityObservers) {
      if (!this.ownerSet.has(document)) {
        unsubscribe();
        this.#activityObservers.delete(document);
      }
    }
    if (this.#thread.closing) return;

    let state: WorkerOwnerState = this.ownerSet.size === 0 ? null : 'inactive';
    let inactiveSince: number | null = null;
    for (const owner of this.ownerSet) {
      if (!(owner instanceof DocumentImpl)) throw new InternalError('Shared worker monitoring requires Window owners');
      if (!this.#activityObservers.has(owner)) {
        this.#activityObservers.set(owner, owner.observeFullyActiveState(() => { this.updateLifetime(); }));
      }
      if (owner.isFullyActive()) {
        state = 'active';
      } else if (owner.nonFullyActiveSince !== null) {
        inactiveSince = Math.max(inactiveSince ?? -Infinity, owner.nonFullyActiveSince);
      }
    }
    const now = this.#userAgent.unsafeSharedCurrentTime();
    const extensionStart = state === null ? this.ownerSet.emptySince : inactiveSince;
    const extensionDeadline = this.#options.extendedLifetime && state !== 'active' && extensionStart !== null
      ? extensionStart + this.#userAgent.extendedLifetimeSharedWorkerTimeout : null;
    const extended = extensionDeadline !== null && now < extensionDeadline;
    const betweenLoadsDeadline = this.ownerSet.emptySince === null ? null
      : this.ownerSet.emptySince + this.#userAgent.betweenLoadsSharedWorkerTimeout;
    const betweenLoads = betweenLoadsDeadline !== null && now <= betweenLoadsDeadline && this.#userAgent.hasLoadingNavigable();
    const permissible = state !== null || extended || betweenLoads;
    this.#thread.updateSharedLifetime(state, extended, permissible);
    if (!permissible) return;

    let deadline = extended ? extensionDeadline : null;
    if (betweenLoads) deadline = Math.min(deadline ?? Infinity, betweenLoadsDeadline);
    if (deadline !== null) {
      // At the inclusive between-loads boundary, another positive clock advance
      // is required. Native timer granularity can also wake just before a deadline.
      this.#timer = this.#userAgent.timerHost.scheduleTimeout(Math.max(1, deadline - now), () => {
        this.#timer = null;
        this.updateLifetime();
      });
    }
  }

  /** Release every browser-side subscription, client association, and Document backlink after native exit. */
  dispose(): void {
    this.#timer?.remove();
    this.#timer = null;
    this.#stopObservingOwners();
    for (const unsubscribe of this.#activityObservers.values()) unsubscribe();
    this.#activityObservers.clear();
    for (const worker of this.#connections.values()) worker.thread = null;
    this.#connections.clear();
    this.#pendingConnections.clear();
    // A destroyed Document has already left ownerSet. Its backlink can still
    // exist, so visit the weak cleanup list without retaining those Documents.
    for (const document of this.#documents.values()) {
      const index = document.ownedWorkers.indexOf(this);
      if (index !== -1) document.ownedWorkers.splice(index, 1);
    }
    this.#documents.clear();
    this.ownerSet.clear();
  }
}
