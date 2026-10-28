import {
  arg, atArg, ctor, defineDictionary, defineInterface, defineTypedef, dictMember,
  emptyDictionary, emptySequence, frozenArray, idlType, impl, nullable, op, reference, roAttr, sequence, union,
} from '../../web-idl/core/index';
import { serializeOrigin, type Origin } from '../../url/index';

import type { DOMHighResTimeStamp } from '../timing/index';
import { EventImpl, type EventInit } from '../dom/events/index';
import type { DOMEnvironment } from '../dom/environment';
import type { WindowProxyHandle } from '../browsing/window/index';
import type { ServiceWorkerImpl } from '../workers/index';

import type { MessagePortImpl } from './message-port';

/** Message data and sender identity, independent of the transport delivering the event. */
// https://html.spec.whatwg.org/multipage/comms.html#the-messageevent-interface
export class MessageEventImpl extends EventImpl {
  data: unknown;
  lastEventId: string;
  source: MessageEventSource | null;
  /** Snapshot of implementation ports; Binding owns the exposed frozen array. */
  ports: readonly MessagePortImpl[];
  #origin: Origin | string | null;

  constructor(
    type: string,
    eventInitDict: MessageEventInit = {},
    timeStamp?: DOMHighResTimeStamp,
    origin: Origin | string | null = eventInitDict.origin ?? null,
  ) {
    super(type, eventInitDict, timeStamp);
    this.data = eventInitDict.data ?? null;
    this.lastEventId = eventInitDict.lastEventId ?? '';
    this.source = eventInitDict.source ?? null;
    this.ports = eventInitDict.ports?.slice() ?? [];
    this.#origin = origin;
  }

  static override is(value: unknown): value is MessageEventImpl {
    return typeof value === 'object' && value !== null && #origin in value;
  }

  get origin(): string {
    return typeof this.#origin === 'string' ? this.#origin
      : this.#origin === null ? '' : serializeOrigin(this.#origin);
  }

  /** Initialize the sender's origin record when a delivery algorithm creates the event. */
  setOrigin(origin: Origin): void {
    this.#origin = origin;
  }

  /** @deprecated Reinitialize an idle event, retaining its timestamp and composed flag. */
  // https://html.spec.whatwg.org/multipage/comms.html#dom-messageevent-initmessageevent
  initMessageEvent(
    type: string, bubbles = false, cancelable = false, data: unknown = null,
    origin = '', lastEventId = '', source: MessageEventSource | null = null,
    ports: MessagePortImpl[] = [],
  ): void {
    if (this.dispatching) return;
    this.initEvent(type, bubbles, cancelable);
    this.data = data;
    this.#origin = origin;
    this.lastEventId = lastEventId;
    this.source = source;
    this.ports = ports.slice();
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
export const messageEventIDL = defineInterface<DOMEnvironment>({
  name: 'MessageEvent',
  inherits: 'Event',
  exposed: ['Window', 'Worker', 'AudioWorklet'],
  implementation: impl(MessageEventImpl, {
    constructWith: [atArg(2, (env) => env.realm.eventTimeStamp())],
  }),
  members: [
    ctor([
      arg('type', idlType.DOMString),
      arg('eventInitDict', reference('MessageEventInit'), { default: emptyDictionary, optional: true }),
    ]),
    roAttr('data', idlType.any),
    roAttr('origin', idlType.USVString),
    roAttr('lastEventId', idlType.DOMString),
    roAttr('source', nullable(reference('MessageEventSource'))),
    roAttr('ports', frozenArray(reference('MessagePort'))),
    op('initMessageEvent', idlType.undefined, [
      arg('type', idlType.DOMString),
      arg('bubbles', idlType.boolean, { default: false, optional: true }),
      arg('cancelable', idlType.boolean, { default: false, optional: true }),
      arg('data', idlType.any, { default: null, optional: true }),
      arg('origin', idlType.USVString, { default: '', optional: true }),
      arg('lastEventId', idlType.DOMString, { default: '', optional: true }),
      arg('source', nullable(reference('MessageEventSource')), { default: null, optional: true }),
      arg('ports', sequence(reference('MessagePort')), { default: emptySequence, optional: true }),
    ]),
  ],
});

/** Converted MessageEvent constructor dictionary. */
export interface MessageEventInit extends EventInit {
  data?: unknown;
  origin?: string;
  lastEventId?: string;
  source?: MessageEventSource | null;
  ports?: MessagePortImpl[];
}

/*
 * dictionary MessageEventInit : EventInit {
 *   any data = null;
 *   USVString origin = "";
 *   DOMString lastEventId = "";
 *   MessageEventSource? source = null;
 *   sequence<MessagePort> ports = [];
 * };
 */
export const messageEventInitIDL = defineDictionary({
  name: 'MessageEventInit',
  inherits: 'EventInit',
  members: [
    dictMember('data', idlType.any, { default: null }),
    dictMember('origin', idlType.USVString, { default: '' }),
    dictMember('lastEventId', idlType.DOMString, { default: '' }),
    dictMember('source', nullable(reference('MessageEventSource')), { default: null }),
    dictMember('ports', sequence(reference('MessagePort')), { default: emptySequence }),
  ],
});

export type MessageEventSource = WindowProxyHandle | MessagePortImpl | ServiceWorkerImpl;

// typedef (WindowProxy or MessagePort or ServiceWorker) MessageEventSource;
export const messageEventSourceIDL = defineTypedef({
  name: 'MessageEventSource',
  type: union(reference('WindowProxy'), reference('MessagePort'), reference('ServiceWorker')),
});
