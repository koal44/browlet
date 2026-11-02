import { attr, defineInterfaceMixin, reference } from '../../web-idl/core/index';

import type { EventTargetImpl } from '../dom/events/index';

import { EventHandlerMap, type EventHandlerCallback } from './event-handlers';

/** Handler state shared by the GlobalEventHandlers includers. */
// https://html.spec.whatwg.org/multipage/webappapis.html#globaleventhandlers
// TODO(HTML §8.1.8.2): Add the other handlers and compose this mixin into elements and Document.
export class GlobalEventHandlersMixin {
  /** Handler values and listener registrations for this includer. */
  #handlers: EventHandlerMap;

  constructor(target: EventTargetImpl) {
    this.#handlers = new EventHandlerMap(target, [{ name: 'onerror', type: 'error' }]);
  }

  get onerror(): EventHandlerCallback | null { return this.#handlers.get('onerror'); }
  set onerror(callback: EventHandlerCallback | null) { this.#handlers.set('onerror', callback); }
}

export const globalEventHandlersIDL = defineInterfaceMixin({
  name: 'GlobalEventHandlers',
  members: [attr('onerror', reference('OnErrorEventHandler'))],
});
