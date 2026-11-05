import {
  arg, atArg, ctor, defineDictionary, defineInterface, dictMember, emptyDictionary, idlType, impl, reference, roAttr,
} from '../../../../web-idl/core/index';

import type { DOMHighResTimeStamp } from '../../../timing/index';
import { EventImpl, type EventInit } from '../../../dom/events/index';
import type { DOMEnvironment } from '../../../dom/environment';

/** Carries restored History state, or the constructor's unchanged author value. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-popstateevent-interface
// Existing-Document history application supplies restored state; cached-rendering UI and new-Document paths remain unfinished.
export class PopStateEventImpl extends EventImpl {
  /** State supplied by the producer; event construction does not clone it. */
  state: unknown;
  /** Whether the user agent performed a visual transition before dispatch. */
  hasUAVisualTransition: boolean;

  constructor(type: string, eventInitDict: PopStateEventInit = {}, timeStamp?: DOMHighResTimeStamp) {
    super(type, eventInitDict, timeStamp);
    this.state = eventInitDict.state ?? null;
    this.hasUAVisualTransition = eventInitDict.hasUAVisualTransition ?? false;
  }
}

/** Converted constructor data, also permitting internal event allocation before initialization. */
export interface PopStateEventInit extends EventInit {
  state?: unknown;
  hasUAVisualTransition?: boolean;
}

/*
 * [Exposed=Window]
 * interface PopStateEvent : Event {
 *   constructor(DOMString type, optional PopStateEventInit eventInitDict = {});
 *
 *   readonly attribute any state;
 *   readonly attribute boolean hasUAVisualTransition;
 * };
 */
export const popStateEventIDL = defineInterface<DOMEnvironment>({
  name: 'PopStateEvent',
  inherits: 'Event',
  exposed: 'Window',
  implementation: impl(PopStateEventImpl, {
    constructWith: [atArg(2, (env) => env.realm.eventTimeStamp())],
  }),
  members: [
    ctor([
      arg('type', idlType.DOMString),
      arg('eventInitDict', reference('PopStateEventInit'), { default: emptyDictionary, optional: true }),
    ]),
    roAttr('state', idlType.any),
    roAttr('hasUAVisualTransition', idlType.boolean),
  ],
});

/*
 * dictionary PopStateEventInit : EventInit {
 *   any state = null;
 *   boolean hasUAVisualTransition = false;
 * };
 */
export const popStateEventInitIDL = defineDictionary({
  name: 'PopStateEventInit',
  inherits: 'EventInit',
  members: [
    dictMember('state', idlType.any, { default: null }),
    dictMember('hasUAVisualTransition', idlType.boolean, { default: false }),
  ],
});
