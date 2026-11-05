import {
  arg, atArg, ctor, defineDictionary, defineInterface, dictMember, emptyDictionary, idlType, impl, reference, roAttr,
} from '../../../../web-idl/core/index';
import type { DOMHighResTimeStamp } from '../../../../timing/index';

import { EventImpl, type EventInit } from '../../../dom/events/index';
import type { DOMEnvironment } from '../../../dom/environment';

/** Carries the restoration or possible retention state for pageshow/pagehide. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-pagetransitionevent-interface
export class PageTransitionEventImpl extends EventImpl {
  /** Snapshot supplied by the lifecycle producer, not a live salvageability check. */
  persisted: boolean;

  constructor(type: string, eventInitDict: PageTransitionEventInit = {}, timeStamp?: DOMHighResTimeStamp) {
    super(type, eventInitDict, timeStamp);
    this.persisted = eventInitDict.persisted ?? false;
  }
}

/** Converted event data, also permitting internal allocation before producer initialization. */
export interface PageTransitionEventInit extends EventInit {
  persisted?: boolean;
}

/*
 * [Exposed=Window]
 * interface PageTransitionEvent : Event {
 *   constructor(DOMString type, optional PageTransitionEventInit eventInitDict = {});
 *
 *   readonly attribute boolean persisted;
 * };
 */
export const pageTransitionEventIDL = defineInterface<DOMEnvironment>({
  name: 'PageTransitionEvent', inherits: 'Event', exposed: 'Window',
  implementation: impl(PageTransitionEventImpl, {
    constructWith: [atArg(2, (env) => env.realm.eventTimeStamp())],
  }),
  members: [
    ctor([
      arg('type', idlType.DOMString),
      arg('eventInitDict', reference('PageTransitionEventInit'), { default: emptyDictionary, optional: true }),
    ]),
    roAttr('persisted', idlType.boolean),
  ],
});

// SPEC_CLASH(pagetransition-init-frame-swap): follow HTML/Chromium/WebKit; do not read Gecko's nonstandard inFrameSwap member.
/*
 * dictionary PageTransitionEventInit : EventInit {
 *   boolean persisted = false;
 * };
 */
export const pageTransitionEventInitIDL = defineDictionary({
  name: 'PageTransitionEventInit', inherits: 'EventInit',
  members: [dictMember('persisted', idlType.boolean, { default: false })],
});
