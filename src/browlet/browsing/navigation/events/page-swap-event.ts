import {
  arg, atArg, ctor, defineDictionary, defineInterface, dictMember, emptyDictionary, idlType, impl, nullable, reference, roAttr,
} from '../../../../web-idl/core/index';

import type { DOMHighResTimeStamp } from '../../../timing/index';
import { EventImpl, type EventInit } from '../../../dom/events/index';
import type { DOMEnvironment } from '../../../dom/environment';
import type { NavigationActivationImpl } from '../api/index';
import type { ViewTransitionImpl } from '../../../rendering/index';

/** The outgoing Document's destination activation and optional outbound view transition. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-pageswapevent-interface
// Window.firePageSwapEvent() owns trusted production; deactivation and CSS transition capture remain §7.4.6.1 dependencies.
export class PageSwapEventImpl extends EventImpl {
  /** Destination activation supplied by the producer, or null when it cannot be exposed. */
  activation: NavigationActivationImpl | null;
  /** Outbound transition supplied by CSS View Transitions, or null without one. */
  viewTransition: ViewTransitionImpl | null;

  constructor(type: string, eventInitDict: PageSwapEventInit = {}, timeStamp?: DOMHighResTimeStamp) {
    super(type, eventInitDict, timeStamp);
    this.activation = eventInitDict.activation ?? null;
    this.viewTransition = eventInitDict.viewTransition ?? null;
  }
}

/** Converted event data, also permitting internal allocation before producer initialization. */
export interface PageSwapEventInit extends EventInit {
  activation?: NavigationActivationImpl | null;
  viewTransition?: ViewTransitionImpl | null;
}

/*
 * [Exposed=Window]
 * interface PageSwapEvent : Event {
 *   constructor(DOMString type, optional PageSwapEventInit eventInitDict = {});
 *   readonly attribute NavigationActivation? activation;
 *   readonly attribute ViewTransition? viewTransition;
 * };
 */
export const pageSwapEventIDL = defineInterface<DOMEnvironment>({
  name: 'PageSwapEvent', inherits: 'Event', exposed: 'Window',
  implementation: impl(PageSwapEventImpl, {
    constructWith: [atArg(2, (env) => env.realm.eventTimeStamp())],
  }),
  members: [
    ctor([
      arg('type', idlType.DOMString),
      arg('eventInitDict', reference('PageSwapEventInit'), { default: emptyDictionary, optional: true }),
    ]),
    roAttr('activation', nullable(reference('NavigationActivation'))),
    roAttr('viewTransition', nullable(reference('ViewTransition'))),
  ],
});

/*
 * dictionary PageSwapEventInit : EventInit {
 *   NavigationActivation? activation = null;
 *   ViewTransition? viewTransition = null;
 * };
 */
export const pageSwapEventInitIDL = defineDictionary({
  name: 'PageSwapEventInit', inherits: 'EventInit',
  members: [
    dictMember('activation', nullable(reference('NavigationActivation')), { default: null }),
    dictMember('viewTransition', nullable(reference('ViewTransition')), { default: null }),
  ],
});
