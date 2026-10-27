import {
  arg, atArg, ctor, defineDictionary, defineInterface, dictMember, idlType, impl, reference, roAttr,
} from '../../../web-idl/core/index';

import type { DOMHighResTimeStamp } from '../../timing/index';
import type { DOMEnvironment } from '../environment';

import { EventImpl, type EventInit } from './event';

/** Retains the original rejected promise and its reason without Promise conversion. */
// https://html.spec.whatwg.org/multipage/webappapis.html#the-promiserejectionevent-interface
export class PromiseRejectionEventImpl extends EventImpl {
  promise: object;
  reason: unknown;

  constructor(type: string, eventInitDict: PromiseRejectionEventInit, timeStamp?: DOMHighResTimeStamp) {
    super(type, eventInitDict, timeStamp);
    this.promise = eventInitDict.promise;
    this.reason = eventInitDict.reason;
  }

  /** Initialize trusted-event attributes before dispatch. */
  initialize(init: PromiseRejectionEventInit): void {
    this.setFlags(init);
    this.promise = init.promise;
    this.reason = init.reason;
  }
}

/*
 * [Exposed=*]
 * interface PromiseRejectionEvent : Event {
 *   constructor(DOMString type, PromiseRejectionEventInit eventInitDict);
 *   readonly attribute object promise;
 *   readonly attribute any reason;
 * };
 */
export const promiseRejectionEventIDL = defineInterface<DOMEnvironment>({
  name: 'PromiseRejectionEvent',
  inherits: 'Event',
  exposed: '*',
  implementation: impl(PromiseRejectionEventImpl, {
    constructWith: [atArg(2, (env) => env.realm.eventTimeStamp())],
  }),
  members: [
    ctor([
      arg('type', idlType.DOMString),
      arg('eventInitDict', reference('PromiseRejectionEventInit')),
    ]),
    roAttr('promise', idlType.object),
    roAttr('reason', idlType.any),
  ],
});

/*
 * dictionary PromiseRejectionEventInit : EventInit {
 *   required object promise;
 *   any reason;
 * };
 */
export const promiseRejectionEventInitIDL = defineDictionary({
  name: 'PromiseRejectionEventInit',
  inherits: 'EventInit',
  members: [
    dictMember('promise', idlType.object, { required: true }),
    dictMember('reason', idlType.any),
  ],
});

/** Event flags, original promise object, and an optional rejection reason. */
export interface PromiseRejectionEventInit extends EventInit {
  promise: object;
  reason?: unknown;
}
