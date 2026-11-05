import { atArg, defineIncludes, defineInterface, impl, xattr } from '../../web-idl/core/index';

import { EventTargetImpl } from '../dom/events/index';
import { EventHandlerMap, type EventHandlerCallback } from '../scripting/index';
import type { DOMEnvironment } from '../dom/environment';

import { AbstractWorkerMixin } from './abstract-worker';

/** ServiceWorker identity required by MessageEventSource, distinct from its global scope. */
// https://w3c.github.io/ServiceWorker/#serviceworker-interface
// TODO(Service Workers): Registration-owned objects, scriptURL/state, messaging, and error-event delivery.
export class ServiceWorkerImpl extends EventTargetImpl {
  /** One map for AbstractWorker and future service-worker-specific handlers. */
  override eventHandlers: EventHandlerMap = new EventHandlerMap(this, AbstractWorkerMixin.handlerDefinitions);
  /** Outside-object error handlers receive an Event, unlike WorkerGlobalScope.onerror. */
  abstractWorkerMixin = new AbstractWorkerMixin(this.eventHandlers);

  get onerror(): EventHandlerCallback | null { return this.abstractWorkerMixin.onerror; }
  set onerror(callback: EventHandlerCallback | null) { this.abstractWorkerMixin.onerror = callback; }
}

/*
 * [SecureContext, Exposed=(Window,Worker)]
 * interface ServiceWorker : EventTarget { ... };
 */
export const serviceWorkerIDL = defineInterface<DOMEnvironment>({
  name: 'ServiceWorker',
  inherits: 'EventTarget',
  exposed: ['Window', 'Worker'],
  ...xattr('SecureContext'),
  implementation: impl(ServiceWorkerImpl, { constructWith: [atArg(0, (env) => env)] }),
  members: [],
});

/*
 * ServiceWorker includes AbstractWorker;
 */
export const serviceWorkerIncludesAbstractWorkerIDL = defineIncludes({
  interface: 'ServiceWorker', mixin: 'AbstractWorker',
});
