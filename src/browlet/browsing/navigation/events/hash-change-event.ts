import {
  arg, atArg, ctor, defineDictionary, defineInterface, dictMember, emptyDictionary, idlType, impl, reference, roAttr,
} from '../../../../web-idl/core/index';
import type { DOMHighResTimeStamp } from '../../../../timing/index';

import { EventImpl, type EventInit } from '../../../dom/events/index';
import type { DOMEnvironment } from '../../../dom/environment';

/** Carries the previous and current entry URLs without parsing constructor-supplied strings. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-hashchangeevent-interface
// Existing-Document history application queues trusted delivery; persisted-state restoration still has an explicit owner boundary.
export class HashChangeEventImpl extends EventImpl {
  /** Producer-supplied previous URL, after Web IDL string conversion for author construction. */
  oldURL: string;
  /** Producer-supplied current URL, after Web IDL string conversion for author construction. */
  newURL: string;

  constructor(type: string, eventInitDict: HashChangeEventInit = {}, timeStamp?: DOMHighResTimeStamp) {
    super(type, eventInitDict, timeStamp);
    this.oldURL = eventInitDict.oldURL ?? '';
    this.newURL = eventInitDict.newURL ?? '';
  }
}

/** Converted constructor data, also used by DOM's legacy event factory. */
export interface HashChangeEventInit extends EventInit {
  oldURL?: string;
  newURL?: string;
}

// SPEC_CLASH(hashchange-url-scalar-strings): Follow HTML/WebKit's USVString; Chromium/Firefox retain lone surrogates via DOMString.
/*
 * [Exposed=Window]
 * interface HashChangeEvent : Event {
 *   constructor(DOMString type, optional HashChangeEventInit eventInitDict = {});
 *
 *   readonly attribute USVString oldURL;
 *   readonly attribute USVString newURL;
 * };
 */
export const hashChangeEventIDL = defineInterface<DOMEnvironment>({
  name: 'HashChangeEvent',
  inherits: 'Event',
  exposed: 'Window',
  implementation: impl(HashChangeEventImpl, {
    constructWith: [atArg(2, (env) => env.realm.eventTimeStamp())],
  }),
  members: [
    ctor([
      arg('type', idlType.DOMString),
      arg('eventInitDict', reference('HashChangeEventInit'), { default: emptyDictionary, optional: true }),
    ]),
    roAttr('oldURL', idlType.USVString),
    roAttr('newURL', idlType.USVString),
  ],
});

/*
 * dictionary HashChangeEventInit : EventInit {
 *   USVString oldURL = "";
 *   USVString newURL = "";
 * };
 */
export const hashChangeEventInitIDL = defineDictionary({
  name: 'HashChangeEventInit',
  inherits: 'EventInit',
  members: [
    dictMember('oldURL', idlType.USVString, { default: '' }),
    dictMember('newURL', idlType.USVString, { default: '' }),
  ],
});
