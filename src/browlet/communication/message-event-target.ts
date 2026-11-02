import { defineInterfaceMixin } from '../../web-idl/core/index';

import { eventHandlerAttr, type EventHandlerMap, type EventHandlerCallback } from '../scripting/index';

/** Event-handler attributes shared by ports and worker messaging targets. */
// https://html.spec.whatwg.org/multipage/web-messaging.html#messageeventtarget
export class MessageEventTargetMixin {
  /** Messaging names supplied when an includer constructs its handler map. */
  static handlerDefinitions = new Map([
    ['onmessage', 'message'], ['onmessageerror', 'messageerror'],
  ]);

  /** This messaging target's shared handler map. */
  #handlers: EventHandlerMap;

  constructor(handlers: EventHandlerMap) {
    this.#handlers = handlers;
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
