import { defineInterfaceMixin } from '../../web-idl/core/index';

import type { EventTargetImpl } from '../dom/events/index';

import { eventHandlerAttr, EventHandlerMap, type EventHandlerCallback } from './event-handlers';

/** Window-owned handler state, shared with its eventual body/frameset aliases. */
// https://html.spec.whatwg.org/multipage/webappapis.html#windoweventhandlers
// PROVISIONAL: onstorage only; other handlers, element forwarding, and content attributes remain §8.1.8 work.
export class WindowEventHandlersMixin {
  /** Handler values and listener registrations for this Window. */
  #handlers: EventHandlerMap;

  constructor(target: EventTargetImpl) {
    this.#handlers = new EventHandlerMap(target, [{ name: 'onstorage', type: 'storage' }]);
  }

  get onstorage(): EventHandlerCallback | null { return this.#handlers.get('onstorage'); }
  set onstorage(callback: EventHandlerCallback | null) { this.#handlers.set('onstorage', callback); }
}

export const windowEventHandlersIDL = defineInterfaceMixin({
  name: 'WindowEventHandlers',
  members: [eventHandlerAttr('onstorage')],
});
