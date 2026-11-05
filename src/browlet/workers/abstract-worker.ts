import { defineInterfaceMixin } from '../../web-idl/core/index';

import { eventHandlerAttr, type EventHandlerCallback, type EventHandlerMap } from '../scripting/index';

/** Error-handler attribute shared by outside Worker, SharedWorker, and ServiceWorker objects. */
// https://html.spec.whatwg.org/multipage/workers.html#the-abstractworker-mixin
export class AbstractWorkerMixin {
  /** Handler names supplied when an includer constructs its handler map. */
  static handlerDefinitions = new Map([['onerror', 'error']]);

  /** The including object's handler map; its other handlers share the same map. */
  #handlers: EventHandlerMap;

  constructor(handlers: EventHandlerMap) {
    this.#handlers = handlers;
  }

  get onerror(): EventHandlerCallback | null { return this.#handlers.get('onerror'); }
  set onerror(callback: EventHandlerCallback | null) { this.#handlers.set('onerror', callback); }
}

/*
 * interface mixin AbstractWorker {
 *   attribute EventHandler onerror;
 * };
 */
export const abstractWorkerIDL = defineInterfaceMixin({
  name: 'AbstractWorker',
  members: [eventHandlerAttr('onerror')],
});
