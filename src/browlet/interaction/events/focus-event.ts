import {
  arg, atArg, ctor, defineDictionary, defineInterface, dictMember, emptyDictionary,
  idlType, impl, nullable, reference, roAttr,
} from '../../../web-idl/core/index';

import type { DOMHighResTimeStamp } from '../../timing/index';
import type { EventTargetImpl } from '../../dom/events/index';
import type { DOMEnvironment } from '../../dom/environment';

import { UIEventImpl, type UIEventInit } from './ui-event';

/** Focus event data; DOM dispatch retargets the inherited related target for each listener. */
// https://w3c.github.io/uievents/#interface-focusevent
export class FocusEventImpl extends UIEventImpl {
  constructor(type: string, eventInitDict: FocusEventInit = {}, timeStamp?: DOMHighResTimeStamp) {
    super(type, eventInitDict, timeStamp);
    this.relatedTarget = eventInitDict.relatedTarget ?? null;
  }
}

/** Converted constructor data, independent of HTML's focus-transition producer. */
export interface FocusEventInit extends UIEventInit {
  relatedTarget?: EventTargetImpl | null;
}

/*
 * [Exposed=Window]
 * interface FocusEvent : UIEvent {
 *   constructor(DOMString type, optional FocusEventInit eventInitDict = {});
 *   readonly attribute EventTarget? relatedTarget;
 * };
 */
export const focusEventIDL = defineInterface<DOMEnvironment>({
  name: 'FocusEvent',
  inherits: 'UIEvent',
  exposed: 'Window',
  implementation: impl(FocusEventImpl, {
    constructWith: [atArg(2, (env) => env.realm.eventTimeStamp())],
  }),
  members: [
    ctor([
      arg('type', idlType.DOMString),
      arg('eventInitDict', reference('FocusEventInit'), { default: emptyDictionary, optional: true }),
    ]),
    roAttr('relatedTarget', nullable(reference('EventTarget'))),
  ],
});

/*
 * dictionary FocusEventInit : UIEventInit {
 *   EventTarget? relatedTarget = null;
 * };
 */
export const focusEventInitIDL = defineDictionary({
  name: 'FocusEventInit',
  inherits: 'UIEventInit',
  members: [dictMember('relatedTarget', nullable(reference('EventTarget')), { default: null })],
});
