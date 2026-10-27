import { atArg, defineInterface, idlType, impl, roAttr } from '../../web-idl/core/index';
import { serializeOrigin, type Origin } from '../../url/index';

import type { DOMHighResTimeStamp } from '../timing/index';
import { EventImpl, type EventInit } from '../dom/events/index';
import type { DOMEnvironment } from '../dom/environment';

/** Message event origin state; initialization and transport producers remain unfinished. */
// https://html.spec.whatwg.org/multipage/comms.html#the-messageevent-interface
export class MessageEventImpl extends EventImpl {
  #origin: Origin | string | null;

  /** Internal allocation; the author constructor awaits MessageEventInit and its source/port types. */
  constructor(
    type: string,
    eventInitDict: EventInit = {},
    timeStamp?: DOMHighResTimeStamp,
    origin: Origin | string | null = null,
  ) {
    super(type, eventInitDict, timeStamp);
    this.#origin = origin;
  }

  static override is(value: unknown): value is MessageEventImpl {
    return typeof value === 'object' && value !== null && #origin in value;
  }

  get origin(): string {
    return typeof this.#origin === 'string' ? this.#origin
      : this.#origin === null ? '' : serializeOrigin(this.#origin);
  }

  // https://html.spec.whatwg.org/multipage/comms.html#the-messageevent-interface
  extractOrigin(): Origin | null {
    return typeof this.#origin === 'string' ? null : this.#origin;
  }
}

/*
 * [Exposed=(Window,Worker,AudioWorklet)]
 * interface MessageEvent : Event {
 *   constructor(DOMString type, optional MessageEventInit eventInitDict = {});
 *   readonly attribute any data;
 *   readonly attribute USVString origin;
 *   readonly attribute DOMString lastEventId;
 *   readonly attribute MessageEventSource? source;
 *   readonly attribute FrozenArray<MessagePort> ports;
 *   undefined initMessageEvent(DOMString type, optional boolean bubbles = false,
 *     optional boolean cancelable = false, optional any data = null,
 *     optional USVString origin = "", optional DOMString lastEventId = "",
 *     optional MessageEventSource? source = null, optional sequence<MessagePort> ports = []);
 * };
 */
// TODO(HTML §9.1): MessageEventInit, constructor/initMessageEvent, data, lastEventId,
// source (WindowProxy/MessagePort/ServiceWorker), and ports. Delivery must supply the internal origin.
export const messageEventIDL = defineInterface<DOMEnvironment>({
  name: 'MessageEvent',
  inherits: 'Event',
  exposed: ['Window', 'Worker', 'AudioWorklet'],
  implementation: impl(MessageEventImpl, {
    constructWith: [atArg(2, (env) => env.realm.eventTimeStamp())],
  }),
  members: [roAttr('origin', idlType.USVString)],
});
