import { defineInterface, idlType, impl, op, roAttr, xattr } from '../../web-idl/core/index';
import type { URLRecord } from '../../url/index';
import type { StorageKey } from '../../storage/index';
import type { RequestCredentials } from '../../fetch/index';

import { EventHandlerMap, eventHandlerMapAttr } from '../scripting/index';
import type { BrowletEnvironment } from '../environment/index';

import { WorkerGlobalImpl, type WorkerType } from './worker-global-scope';

/** Inside global of a shared worker, receiving a separate message port for each connection. */
// https://html.spec.whatwg.org/multipage/workers.html#sharedworkerglobalscope
// TODO(HTML §§10.2.4, 10.2.6.4): Startup must invoke environment composition; the
// shared-worker manager owns matching, additional owners, and queued connect events.
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
    if (super.isPermissible()) return true;
    const { userAgent } = this.env;
    const emptySince = this.ownerSet.emptySince!;
    // Unlike the extended-lifetime test, HTML includes the exact timeout boundary.
    return userAgent.unsafeSharedCurrentTime() - emptySince <= userAgent.betweenLoadsSharedWorkerTimeout &&
      userAgent.hasLoadingNavigable();
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
