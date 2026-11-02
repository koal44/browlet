import {
  arg, atArg, ctor, defineDictionary, defineInterface, dictMember, idlType, impl, nullable, reference, roAttr,
} from '../../../../web-idl/core/index';

import type { DOMHighResTimeStamp } from '../../../timing/index';
import { EventImpl, type EventInit } from '../../../dom/events/index';
import type { DOMEnvironment } from '../../../dom/environment';
import type { NavigationType, NavigationHistoryEntryImpl } from '../api/index';

/** Reports the previous current entry, including state changes that keep the same entry. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigationcurrententrychangeevent
export class NavigationCurrentEntryChangeEventImpl extends EventImpl {
  /** Cause of the entry change, or null for updateCurrentEntry(). */
  navigationType: NavigationType | null;
  /** Entry that was current before the change. */
  from: NavigationHistoryEntryImpl;

  constructor(type: string, eventInitDict: NavigationCurrentEntryChangeEventInit, timeStamp?: DOMHighResTimeStamp) {
    // SPEC_CLASH(currententrychange-constructor-event-flags): HTML/Chromium/Firefox preserve EventInit flags and construct untrusted events; WebKit ignores the flags and constructs trusted events.
    super(type, eventInitDict, timeStamp);
    // Internal event creation initially supplies {}, then initializes attributes before dispatch.
    this.navigationType = eventInitDict.navigationType ?? null;
    this.from = eventInitDict.from;
  }
}

/** Constructor flags and the required implementation-side previous entry. */
export interface NavigationCurrentEntryChangeEventInit extends EventInit {
  navigationType?: NavigationType | null;
  from: NavigationHistoryEntryImpl;
}

/*
 * [Exposed=Window]
 * interface NavigationCurrentEntryChangeEvent : Event {
 *   constructor(DOMString type, NavigationCurrentEntryChangeEventInit eventInitDict);
 *
 *   readonly attribute NavigationType? navigationType;
 *   readonly attribute NavigationHistoryEntry from;
 * };
 */
export const navigationCurrentEntryChangeEventIDL = defineInterface<DOMEnvironment>({
  name: 'NavigationCurrentEntryChangeEvent',
  inherits: 'Event',
  exposed: 'Window',
  implementation: impl(NavigationCurrentEntryChangeEventImpl, {
    constructWith: [atArg(2, (env) => env.realm.eventTimeStamp())],
  }),
  members: [
    ctor([
      arg('type', idlType.DOMString),
      arg('eventInitDict', reference('NavigationCurrentEntryChangeEventInit')),
    ]),
    roAttr('navigationType', nullable(reference('NavigationType'))),
    roAttr('from', reference('NavigationHistoryEntry')),
  ],
});

/*
 * dictionary NavigationCurrentEntryChangeEventInit : EventInit {
 *   NavigationType? navigationType = null;
 *   required NavigationHistoryEntry from;
 * };
 */
export const navigationCurrentEntryChangeEventInitIDL = defineDictionary({
  name: 'NavigationCurrentEntryChangeEventInit',
  inherits: 'EventInit',
  members: [
    dictMember('navigationType', nullable(reference('NavigationType')), { default: null }),
    dictMember('from', reference('NavigationHistoryEntry'), { required: true }),
  ],
});
