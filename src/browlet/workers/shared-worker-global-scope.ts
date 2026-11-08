import { defineInterface, idlType, impl, op, roAttr, xattr } from '../../web-idl/core/index';
import type { URLRecord } from '../../url/index';
import type { StorageKey } from '../../storage/index';
import type { RequestCredentials } from '../../fetch/index';

import { EventHandlerMap, eventHandlerMapAttr } from '../scripting/index';
import { MessageEventImpl, type MessagePortImpl } from '../communication/index';
import type { BrowletEnvironment } from '../environment/index';

import { WorkerGlobalImpl, type WorkerType } from './worker-global-scope';

/** Inside global of a shared worker, receiving a separate message port for each connection. */
// https://html.spec.whatwg.org/multipage/workers.html#sharedworkerglobalscope
export class SharedWorkerGlobalImpl extends WorkerGlobalImpl {
  /** Common worker handlers plus the shared worker's connection handler. */
  static #handlerDefinitions = new Map([...WorkerGlobalImpl.handlerDefinitions, ['onconnect', 'connect']]);

  /** Creating environment's storage partition, used when matching subsequent connections. */
  constructorStorageKey: StorageKey;
  /** Requested script URL used for matching, distinct from the final response URL in `url`. */
  constructorURL: URLRecord;
  /** Credentials option used to check compatibility with subsequent connections. */
  credentials: RequestCredentials;
  /** Creation option consumed by the worker lifetime algorithms; it does not itself keep a worker alive. */
  extendedLifetime: boolean;
  /** One handler map for inherited worker events and shared-worker connections. */
  override eventHandlers: EventHandlerMap = new EventHandlerMap(this, SharedWorkerGlobalImpl.#handlerDefinitions);

  constructor(
    type: WorkerType, name: string, constructorStorageKey: StorageKey, constructorURL: URLRecord,
    credentials: RequestCredentials, extendedLifetime: boolean, env: BrowletEnvironment,
  ) {
    super(type, name, env);
    this.constructorStorageKey = constructorStorageKey;
    this.constructorURL = constructorURL;
    this.credentials = credentials;
    this.extendedLifetime = extendedLifetime;
  }

  /** Queue a connection on this global without enabling either MessagePort's message queue. */
  // https://html.spec.whatwg.org/multipage/workers.html#dom-sharedworker
  // The isolate can receive ports while its initial script is still loading.
  // HTML enters the worker event loop after initial execution, so hold these
  // events until then. A failed/closing startup must still release their ports.
  queueConnectEvent(insidePort: MessagePortImpl): void {
    if (this.closing || this.env.discarded) { insidePort.close(); return; }
    this.env.queueTask('dom-manipulation', {
      run: () => {
        if (!this.env.executionReady) { insidePort.close(); return; }
        this.fireEvent('connect', MessageEventImpl, (event) => {
          event.data = '';
          event.ports = [insidePort];
          event.source = insidePort;
        });
      },
      isRunnable: () => this.env.executionReady || this.env.discarded || this.closing,
      discard: () => insidePort.close(),
    });
  }

  /** Keep opted-in shared workers extended during a recent ownerless or inactive-Document period. */
  // https://html.spec.whatwg.org/multipage/workers.html#in-extended-lifetime-worker
  // SPEC_CLASH(shared-worker-extension-restart): HTML measures the current uninterrupted
  // empty/inactive period; Chromium can keep the first destruction/freezing deadline
  // across reconnect/reactivation. Follow HTML here; evidence is in ROADMAP.md.
  override isInExtendedLifetime(): boolean {
    const pending: SharedWorkerGlobalImpl[] = [this];
    const visited = new Set<SharedWorkerGlobalImpl>();
    // Follow the specification's recursive owner test without revisiting cycles.
    while (pending.length > 0) {
      const global = pending.pop()!;
      if (visited.has(global)) continue;
      visited.add(global);
      if (!global.extendedLifetime) continue;
      // Separate-isolate shared startup keeps all Window owners at the browser.
      // Its local ownerSet is empty; that is not an ownerless worker.
      if (global.remoteOwner !== null) {
        if (global.remoteOwner.inExtendedLifetime) return true;
        continue;
      }
      const now = global.env.userAgent.unsafeSharedCurrentTime();
      const timeout = global.env.userAgent.extendedLifetimeSharedWorkerTimeout;
      const emptySince = global.ownerSet.emptySince;
      if (emptySince !== null && now - emptySince < timeout) return true;

      // Any fully active Document wins over other owners' extension eligibility.
      let hasActiveDocument = false;
      for (const owner of global.ownerSet) {
        if (!(owner instanceof WorkerGlobalImpl) && owner.isFullyActive()) {
          hasActiveDocument = true;
          break;
        }
      }
      if (hasActiveDocument) continue;

      for (const owner of global.ownerSet) {
        if (owner instanceof WorkerGlobalImpl) {
          if (owner instanceof SharedWorkerGlobalImpl) pending.push(owner);
        } else {
          const inactiveSince = owner.nonFullyActiveSince;
          if (inactiveSince !== null && now - inactiveSince < timeout) return true;
        }
      }
    }
    return false;
  }

  /** Every actively needed shared worker is protected, even without ports or pending work. */
  // https://html.spec.whatwg.org/multipage/workers.html#protected-worker
  override isProtected(): boolean {
    return this.isActivelyNeeded();
  }

  /** Allow a short ownerless interval while any navigable in this browser is still loading. */
  // https://html.spec.whatwg.org/multipage/workers.html#permissible-worker
  override isPermissible(): boolean {
    if (this.remoteOwner !== null) return this.remoteOwner.permissible;
    if (super.isPermissible()) return true;
    const { userAgent } = this.env;
    const emptySince = this.ownerSet.emptySince!;
    // Unlike the extended-lifetime test, HTML includes the exact timeout boundary.
    return userAgent.unsafeSharedCurrentTime() - emptySince <= userAgent.betweenLoadsSharedWorkerTimeout &&
      userAgent.hasLoadingNavigable();
  }

  /** Keep the remote activity/permissibility decision coherent during concurrent owner changes. */
  override isSuspendable(): boolean {
    return this.remoteOwner?.suspendable ?? super.isSuspendable();
  }
}

/*
 * [Global=(Worker,SharedWorker),Exposed=SharedWorker]
 * interface SharedWorkerGlobalScope : WorkerGlobalScope {
 *   [Replaceable] readonly attribute DOMString name;
 *   undefined close();
 *   attribute EventHandler onconnect;
 * };
 */
export const sharedWorkerGlobalScopeIDL = defineInterface<BrowletEnvironment>({
  name: 'SharedWorkerGlobalScope',
  inherits: 'WorkerGlobalScope',
  exposed: 'SharedWorker',
  ...xattr(['Global', ['Worker', 'SharedWorker']]),
  implementation: impl(SharedWorkerGlobalImpl),
  members: [
    roAttr('name', idlType.DOMString, xattr('Replaceable')),
    op('close', idlType.undefined),
    eventHandlerMapAttr('onconnect'),
  ],
});
