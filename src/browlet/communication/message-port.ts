import { atArg, defineInterface, impl } from '../../web-idl/core/index';

import { EventTargetImpl } from '../dom/events/index';
import type { DOMEnvironment } from '../dom/environment';

/** MessagePort identity required by MessageEvent's source and ports. */
// https://html.spec.whatwg.org/multipage/web-messaging.html#messageport
// TODO(HTML §9.4): Entanglement, messaging, transfer, start/close, and MessageEventTarget.
export class MessagePortImpl extends EventTargetImpl {}

// [Exposed=(Window,Worker,AudioWorklet), Transferable] interface MessagePort : EventTarget { ... };
export const messagePortIDL = defineInterface<DOMEnvironment>({
  name: 'MessagePort',
  inherits: 'EventTarget',
  exposed: ['Window', 'Worker', 'AudioWorklet'],
  implementation: impl(MessagePortImpl, { constructWith: [atArg(0, (env) => env)] }),
  // Transferable is deliberately pending its transfer/receiving steps in §9.4.
  members: [],
});
