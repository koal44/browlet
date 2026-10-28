import { defineInterfaceMixin } from '../../web-idl/core/index';

import { eventHandlerAttr, EventHandlerMap, type EventHandlerCallback } from '../scripting/index';
import type { EventTargetImpl } from '../dom/events/index';

/** Event-handler attributes shared by ports and worker messaging targets. */
// https://html.spec.whatwg.org/multipage/web-messaging.html#messageeventtarget
export class MessageEventTargetMixin {
  #handlers: EventHandlerMap;

  constructor(target: EventTargetImpl) {
    this.#handlers = new EventHandlerMap(target, [
      { name: 'onmessage', type: 'message' },
      { name: 'onmessageerror', type: 'messageerror' },
    ]);
  }

  get onmessage(): EventHandlerCallback | null { return this.#handlers.get('onmessage'); }
  set onmessage(callback: EventHandlerCallback | null) { this.#handlers.set('onmessage', callback); }

  get onmessageerror(): EventHandlerCallback | null { return this.#handlers.get('onmessageerror'); }
  set onmessageerror(callback: EventHandlerCallback | null) { this.#handlers.set('onmessageerror', callback); }
}

export const messageEventTargetIDL = defineInterfaceMixin({
  name: 'MessageEventTarget',
  members: [eventHandlerAttr('onmessage'), eventHandlerAttr('onmessageerror')],
});
