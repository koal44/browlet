import {
  arg, atArg, ctor, defineDictionary, defineInterface, dictMember, emptyDictionary,
  idlType, impl, integer, reference, roAttr,
} from '../../../web-idl/core/index';

import type { DOMHighResTimeStamp } from '../../timing/index';
import type { DOMEnvironment } from '../environment';

import { EventImpl, type EventInit } from './event';

/** Error details delivered to a global or propagated to a worker's owner. */
// https://html.spec.whatwg.org/multipage/webappapis.html#the-errorevent-interface
export class ErrorEventImpl extends EventImpl {
  message = '';
  filename = '';
  lineno = 0;
  colno = 0;
  error: unknown = undefined;

  constructor(type: string, eventInitDict: ErrorEventInit = {}, timeStamp?: DOMHighResTimeStamp) {
    super(type, eventInitDict, timeStamp);
    this.initialize(eventInitDict);
  }

  /** Extract the available diagnostic information while retaining the thrown value. */
  // https://html.spec.whatwg.org/multipage/webappapis.html#extract-error
  // SPEC_MISMATCH: (exception) -> ordered map keyed by IDL attributes
  // Use a typed attribute record for ErrorEvent initialization.
  static extractErrorInformation(exception: unknown): ErrorInformation {
    // Implementation-defined: use string conversion, with a fallback if it throws.
    let message: string;
    try { message = String(exception); }
    catch { message = 'Unknown error'; }
    // TODO(HTML §8.1.4.6): Obtain source URL, line, and column from runtime exception
    // metadata. Node stack strings can include host frames and are not that contract.
    return { message, filename: '', lineno: 0, colno: 0, error: exception };
  }

  /** Initialize constructor data or trusted-event attributes before dispatch. */
  initialize(init: ErrorEventInit): void {
    this.setFlags(init);
    this.message = init.message ?? '';
    this.filename = init.filename ?? '';
    this.lineno = init.lineno ?? 0;
    this.colno = init.colno ?? 0;
    this.error = init.error;
  }
}

/*
 * [Exposed=*]
 * interface ErrorEvent : Event {
 *   constructor(DOMString type, optional ErrorEventInit eventInitDict = {});
 *
 *   readonly attribute DOMString message;
 *   readonly attribute USVString filename;
 *   readonly attribute unsigned long lineno;
 *   readonly attribute unsigned long colno;
 *   readonly attribute any error;
 * };
 */
export const errorEventIDL = defineInterface<DOMEnvironment>({
  name: 'ErrorEvent',
  inherits: 'Event',
  exposed: '*',
  implementation: impl(ErrorEventImpl, {
    constructWith: [atArg(2, (env) => env.realm.eventTimeStamp())],
  }),
  members: [
    ctor([
      arg('type', idlType.DOMString),
      arg('eventInitDict', reference('ErrorEventInit'), { default: emptyDictionary, optional: true }),
    ]),
    roAttr('message', idlType.DOMString),
    roAttr('filename', idlType.USVString),
    roAttr('lineno', idlType.unsignedLong),
    roAttr('colno', idlType.unsignedLong),
    roAttr('error', idlType.any),
  ],
});

/*
 * dictionary ErrorEventInit : EventInit {
 *   DOMString message = "";
 *   USVString filename = "";
 *   unsigned long lineno = 0;
 *   unsigned long colno = 0;
 *   any error;
 * };
 */
export const errorEventInitIDL = defineDictionary({
  name: 'ErrorEventInit',
  inherits: 'EventInit',
  members: [
    dictMember('message', idlType.DOMString, { default: '' }),
    dictMember('filename', idlType.USVString, { default: '' }),
    dictMember('lineno', idlType.unsignedLong, { default: integer(0) }),
    dictMember('colno', idlType.unsignedLong, { default: integer(0) }),
    dictMember('error', idlType.any),
  ],
});

/** Diagnostic attributes extracted before error muting or cross-realm propagation. */
export interface ErrorInformation {
  message: string;
  filename: string;
  lineno: number;
  colno: number;
  error: unknown;
}

/** Event flags and optional error attributes accepted by event creation. */
export interface ErrorEventInit extends EventInit, Partial<ErrorInformation> {}
