import { InternalError } from '../../infra/index';
import {
  arg, atArg, ctor, defineDictionary, defineIncludes, defineInterface, dictMember, DOMExceptionImpl,
  emptyDictionary, idlType, impl, reference, roAttr, union,
} from '../../web-idl/core/index';

import { EventTargetImpl } from '../dom/events/index';
import { EventHandlerMap, type EventHandlerCallback } from '../scripting/index';
import type { TrustedScriptURLImpl } from '../browsing/policy/trusted-types/index';
import { MessagePortImpl } from '../communication/index';
import type { BrowletEnvironment } from '../environment/index';

import { AbstractWorkerMixin } from './abstract-worker';
import type { WorkerOptions } from './worker';

/** Outside shared-worker connection; author messages belong to its exposed port. */
// https://html.spec.whatwg.org/multipage/workers.html#shared-workers-and-the-sharedworker-interface
export class SharedWorkerImpl extends EventTargetImpl {
  declare env: BrowletEnvironment;
  /** Stable connection endpoint, initially disconnected with its message queue disabled. */
  port: MessagePortImpl;
  /** Only error events target the outside object; message events target its port. */
  override eventHandlers: EventHandlerMap = new EventHandlerMap(this, AbstractWorkerMixin.handlerDefinitions);
  /** Shared outside-object handler behavior, distinct from the global's five-argument onerror. */
  abstractWorkerMixin = new AbstractWorkerMixin(this.eventHandlers);

  /** Allocate an outside object and its endpoint without starting or discovering a worker. */
  constructor(env: BrowletEnvironment) {
    super(env);
    // Allocate with the implementation, as for Worker. The manager will connect
    // this endpoint; constructing or reading it does not enable message delivery.
    this.port = new MessagePortImpl(env);
  }

  get onerror(): EventHandlerCallback | null { return this.abstractWorkerMixin.onerror; }
  set onerror(callback: EventHandlerCallback | null) { this.abstractWorkerMixin.onerror = callback; }

  /** Apply the synchronous constructor checks after Web IDL has converted both arguments. */
  // https://html.spec.whatwg.org/multipage/workers.html#dom-sharedworker
  initialize(scriptURL: TrustedScriptURLImpl | string, _options: string | SharedWorkerOptions): void {
    const compliantScriptURL = this.env.getWindowOrWorkerGlobalScopeMixin().trustedTypes.getCompliantString(
      'TrustedScriptURL', scriptURL, 'SharedWorker constructor', 'script',
    );
    const workerURL = this.env.encodingParseURL(compliantScriptURL);
    if (workerURL === null) throw new DOMExceptionImpl('Invalid SharedWorker URL', 'SyntaxError');
    // TODO(HTML §§10.2.4, 10.2.6.4): The UserAgent's shared-worker manager must
    // normalize a string name to option defaults, capture the creator's non-storage
    // storage key and secure-context state, then serialize discovery/connection.
    // Match constructor URL/name/key, reject incompatible options asynchronously,
    // and reuse this port for an existing global or a new independent execution.
    // Startup and shared-service transport remain explicit dependencies; do not
    // return an apparently connected SharedWorker or invent a local-only registry.
    throw new InternalError('Shared worker discovery and startup are not implemented');
  }
}

/** Converted shared-worker options, including the opt-in ownerless lifetime extension. */
export interface SharedWorkerOptions extends WorkerOptions {
  extendedLifetime: boolean;
}

/*
 * [Exposed=Window]
 * interface SharedWorker : EventTarget {
 *   constructor((TrustedScriptURL or USVString) scriptURL, optional (DOMString or SharedWorkerOptions) options = {});
 *   readonly attribute MessagePort port;
 * };
 */
export const sharedWorkerIDL = defineInterface<BrowletEnvironment>({
  name: 'SharedWorker',
  inherits: 'EventTarget',
  exposed: 'Window',
  implementation: impl(SharedWorkerImpl, { constructWith: [atArg(0, (env) => env)] }),
  members: [
    ctor(
      [
        arg('scriptURL', union(reference('TrustedScriptURL'), idlType.USVString)),
        arg('options', union(idlType.DOMString, reference('SharedWorkerOptions')), { optional: true, default: emptyDictionary }),
      ],
      {
        initialize(_env, scriptURL, options) {
          const worker = this as SharedWorkerImpl;
          worker.initialize(scriptURL as TrustedScriptURLImpl | string, options as string | SharedWorkerOptions);
        },
      },
    ),
    roAttr('port', reference('MessagePort')),
  ],
});

/*
 * dictionary SharedWorkerOptions : WorkerOptions {
 *   boolean extendedLifetime = false;
 * };
 */
export const sharedWorkerOptionsIDL = defineDictionary({
  name: 'SharedWorkerOptions',
  inherits: 'WorkerOptions',
  members: [dictMember('extendedLifetime', idlType.boolean, { default: false })],
});

/*
 * SharedWorker includes AbstractWorker;
 */
export const sharedWorkerIncludesAbstractWorkerIDL = defineIncludes({ interface: 'SharedWorker', mixin: 'AbstractWorker' });
