import {
  arg, atArg, ctor, defineDictionary, defineInterface, dictMember, emptyDictionary, idlType, impl, nullable, reference, roAttr,
} from '../../../../web-idl/core/index';

import type { DOMHighResTimeStamp } from '../../../timing/index';
import { EventImpl, type EventInit } from '../../../dom/events/index';
import type { DOMEnvironment } from '../../../dom/environment';
import type { ViewTransitionImpl } from '../../../rendering/index';

/** The incoming Document's optional cross-document view transition. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-pagerevealevent-interface
// Document.reveal() supplies trusted delivery; CSS transition resolution/activation and the rendering caller remain unfinished.
export class PageRevealEventImpl extends EventImpl {
  /** Inbound transition supplied by CSS View Transitions, or null without one. */
  viewTransition: ViewTransitionImpl | null;

  constructor(type: string, eventInitDict: PageRevealEventInit = {}, timeStamp?: DOMHighResTimeStamp) {
    super(type, eventInitDict, timeStamp);
    this.viewTransition = eventInitDict.viewTransition ?? null;
  }
}

/** Converted event data, also permitting internal allocation before producer initialization. */
export interface PageRevealEventInit extends EventInit {
  viewTransition?: ViewTransitionImpl | null;
}

/*
 * [Exposed=Window]
 * interface PageRevealEvent : Event {
 *   constructor(DOMString type, optional PageRevealEventInit eventInitDict = {});
 *   readonly attribute ViewTransition? viewTransition;
 * };
 */
export const pageRevealEventIDL = defineInterface<DOMEnvironment>({
  name: 'PageRevealEvent', inherits: 'Event', exposed: 'Window',
  implementation: impl(PageRevealEventImpl, {
    constructWith: [atArg(2, (env) => env.realm.eventTimeStamp())],
  }),
  members: [
    ctor([
      arg('type', idlType.DOMString),
      arg('eventInitDict', reference('PageRevealEventInit'), { default: emptyDictionary, optional: true }),
    ]),
    roAttr('viewTransition', nullable(reference('ViewTransition'))),
  ],
});

/*
 * dictionary PageRevealEventInit : EventInit {
 *   ViewTransition? viewTransition = null;
 * };
 */
export const pageRevealEventInitIDL = defineDictionary({
  name: 'PageRevealEventInit', inherits: 'EventInit',
  members: [
    dictMember('viewTransition', nullable(reference('ViewTransition')), { default: null }),
  ],
});
