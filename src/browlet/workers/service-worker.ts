import { atArg, defineInterface, impl, xattr } from '../../web-idl/core/index';

import { EventTargetImpl } from '../dom/events/index';
import type { DOMEnvironment } from '../dom/environment';

/** ServiceWorker identity required by MessageEventSource, distinct from its global scope. */
// https://w3c.github.io/ServiceWorker/#serviceworker-interface
// TODO(Service Workers): Registration-owned objects, scriptURL/state, messaging, and AbstractWorker.
export class ServiceWorkerImpl extends EventTargetImpl {}

// [SecureContext, Exposed=(Window,Worker)] interface ServiceWorker : EventTarget { ... };
export const serviceWorkerIDL = defineInterface<DOMEnvironment>({
  name: 'ServiceWorker',
  inherits: 'EventTarget',
  exposed: ['Window', 'Worker'],
  ...xattr('SecureContext'),
  implementation: impl(ServiceWorkerImpl, { constructWith: [atArg(0, (env) => env)] }),
  members: [],
});
