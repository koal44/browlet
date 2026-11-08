import { InternalError, ParallelQueue } from '../../infra/index';
import { JSMessageChannel, JSThread } from '../../js-engine/index';
import type { URLRecord } from '../../url/index';
import { StorageKey } from '../../storage/index';

import type { MessagePortImpl, MessagePortTransportMessage } from '../communication/index';
import type { UserAgent } from '../user-agent';

import type { SharedWorkerImpl, SharedWorkerOptions } from './shared-worker';
import type { WorkerScriptInit } from './protocol';
import { WorkerThread } from './thread';
import { SharedWorkerRegistration } from './shared-worker-registration';

/** One browser's ordered shared-worker discovery and owners, retaining executions instead of remote globals. */
// https://html.spec.whatwg.org/multipage/workers.html#shared-worker-manager
export class SharedWorkerManager {
  /** Serialize discovery and creation so concurrent clients select one execution. */
  #queue: ParallelQueue;
  /** Each live execution has one registration owning its identity, clients, and lifetime. */
  #registrations = new Map<WorkerThread, SharedWorkerRegistration>();
  /** Browser owner supplying scheduling and each registration's lifetime policy. */
  #userAgent: UserAgent;

  /** Reuse the browser's background scheduler; this does not create another native thread. */
  constructor(userAgent: UserAgent) {
    this.#queue = new ParallelQueue((steps) => userAgent.runInParallel(steps));
    this.#userAgent = userAgent;
  }

  /** Capture the caller's lookup inputs and serialize selection, native creation, and port attachment. */
  // Binding supplies converted arguments; SharedWorkerImpl applies Trusted Types
  // and URL parsing. This helper owns the queued steps and execution association.
  start(worker: SharedWorkerImpl, url: URLRecord, options: SharedWorkerOptions): void {
    if (!JSThread.supportsSuspension) throw new InternalError('Worker script suspension requires the Node compatibility addon');
    const storageKey = StorageKey.obtainForNonStoragePurposes(worker.env);
    const isSecureContext = worker.env.isSecureContext;
    // The public port can be used before queued discovery runs. Prepare the
    // native pipe now; its receiving endpoint waits for the selected isolate.
    const channel = new JSMessageChannel<MessagePortTransportMessage>();
    worker.port.entangleRemote(channel.port1);
    this.#queue.enqueue(() => {
      let thread: WorkerThread | undefined;
      let created = false;
      try {
        for (;;) {
          const found = this.find(url, options, storageKey, isSecureContext);
          if (found === 'incompatible') {
            worker.port.disentangle();
            channel.port2.close();
            worker.queueError();
            return;
          }
          created = found === null;
          thread = found ?? new WorkerThread({
            kind: 'shared', creatorEnv: worker.env, script: { url, ...options }, data: undefined,
          }, () => { throw new InternalError('Production shared worker emitted a private command'); });
          if (created) {
            thread.closed.observe((exit) => {
              // eslint-disable-next-line @typescript-eslint/only-throw-error -- Preserve uncaught native host failures.
              if (exit.error !== undefined) throw exit.error;
            }, (error) => { throw error; });
          }
          // The other isolate can close after lookup. Keep this same pipe and
          // its queued messages while selecting a replacement execution.
          const registration = this.#registrations.get(thread)!;
          if (!registration.attach(worker, channel.port2, created)) continue;
          return;
        }
      } catch (error) {
        worker.port.disentangle();
        channel.port2.close();
        if (created) void thread?.terminate();
        throw error;
      }
    });
  }

  /** Publish a native execution before another queued constructor can try to start the same worker. */
  register(thread: WorkerThread, script: WorkerScriptInit): void {
    const registration = new SharedWorkerRegistration(thread, script, this.#userAgent);
    this.#registrations.set(thread, registration);
    registration.addOwner(thread.owner);
  }

  /** Remove discovery's strong reference as soon as native execution exits, including failed startup. */
  unregister(thread: WorkerThread): void {
    const registration = this.#registrations.get(thread);
    if (registration === undefined) return;
    this.#registrations.delete(thread);
    registration.dispose();
  }

  /** Attach a selected client's port, then retain its original Document as an owner. */
  // https://html.spec.whatwg.org/multipage/workers.html#dom-sharedworker
  // The constructor must select this thread through find() before calling here.
  // A port closing or moving elsewhere does not remove its Document from HTML's
  // owner set. Document destruction does that through its existing ownedWorkers.
  connect(thread: WorkerThread, outsidePort: MessagePortImpl): void {
    const registration = this.#registrations.get(thread);
    if (registration === undefined || outsidePort.env.userAgent !== thread.creatorEnv.userAgent) {
      throw new InternalError('Shared worker connection requires the owning browser manager');
    }
    registration.connectPort(outsidePort);
  }

  /** Release loading-only retention once the initial script has been entered. */
  didStartScript(thread: WorkerThread): void {
    const registration = this.#registrations.get(thread);
    if (registration === undefined) throw new InternalError('Shared worker startup requires its registration');
    registration.didStartScript();
  }

  /** Notify every client waiting on the failed load before teardown releases its associations. */
  reportScriptFetchFailure(thread: WorkerThread): void {
    this.#registrations.get(thread)?.reportScriptFetchFailure();
  }

  /** Recompute the Window owners' lifetime contribution and arm only the next deadline. */
  updateLifetime(thread: WorkerThread): void {
    this.#registrations.get(thread)?.updateLifetime();
  }

  /** Recheck ownerless workers when loading finishes or a navigable's active Document changes. */
  updateOwnerlessLifetimes(): void {
    for (const registration of this.#registrations.values()) {
      if (registration.ownerSet.size === 0) registration.updateLifetime();
    }
  }

  /** Reevaluate active deadlines when the browser changes its shared-worker extension policy. */
  updateLifetimes(): void {
    for (const registration of this.#registrations.values()) registration.updateLifetime();
  }

  /** Select a live execution, an incompatible existing match, or no match, within one queued constructor. */
  // https://html.spec.whatwg.org/multipage/workers.html#dom-sharedworker
  // Extract the constructor's lookup and compatibility checks. The caller captures
  // its key/security status before enqueueing. It must perform lookup and creation
  // in the same manager steps, not await between them and race another constructor.
  find(
    url: URLRecord, options: SharedWorkerOptions, storageKey: StorageKey, isSecureContext: boolean,
  ): WorkerThread | 'incompatible' | null {
    for (const [thread, registration] of this.#registrations) {
      if (!registration.matches(url, options.name, storageKey)) continue;
      // Browlet has no per-traversable communication-isolation preference. The
      // UserAgent and storage-key boundaries already select this discovery set.
      return registration.isCompatible(options, isSecureContext) ? thread : 'incompatible';
    }
    return null;
  }
}
