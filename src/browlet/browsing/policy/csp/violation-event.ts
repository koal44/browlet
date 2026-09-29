import {
  arg, atArg, ctor, defineDictionary, defineEnumeration, defineInterface, dictMember,
  emptyDictionary, idlType, impl, integer, reference, roAttr,
} from '../../../../web-idl/index';
import { EventImpl } from '../../../dom/events/event';
import type { DOMEnvironment } from '../../../dom/environment';
import type { CSPDisposition } from './policy';

/** Author-visible details of a Content Security Policy violation. */
// https://w3c.github.io/webappsec-csp/#violation-events
export class SecurityPolicyViolationEventImpl extends EventImpl {
  /** Protected document's URL, sanitized for disclosure. */
  documentURI = '';
  /** Referrer of the protected resource. */
  referrer = '';
  /** Original blocked URL, or the kind of non-URL violation. */
  blockedURI = '';
  /** Directive selected for the operation, before source-list fallback. */
  effectiveDirective = '';
  /** Historical name for the effective directive in generated events. */
  violatedDirective = '';
  /** Serialized policy which produced the violation. */
  originalPolicy = '';
  /** Script source URL when source-location information is available. */
  sourceFile = '';
  /** Authorized excerpt of violating inline content, otherwise empty. */
  sample = '';
  /** Whether the violated policy enforces or only monitors. */
  disposition: CSPDisposition = 'enforce';
  /** HTTP status of the protected document or worker resource. */
  statusCode = 0;
  /** Source line, or zero when unavailable. */
  lineNumber = 0;
  /** Source column, or zero when unavailable. */
  columnNumber = 0;

  constructor(type: string, init: SecurityPolicyViolationEventInitRecord = {}, timeStamp?: DOMHighResTimeStamp) {
    super(type, init, timeStamp);
    this.initialize(init);
  }

  /** Initialize attributes on an internally created event before dispatch. */
  initialize(init: SecurityPolicyViolationEventInitRecord): void {
    this.documentURI = init.documentURI ?? '';
    this.referrer = init.referrer ?? '';
    this.blockedURI = init.blockedURI ?? '';
    this.effectiveDirective = init.effectiveDirective ?? '';
    this.violatedDirective = init.violatedDirective ?? '';
    this.originalPolicy = init.originalPolicy ?? '';
    this.sourceFile = init.sourceFile ?? '';
    this.sample = init.sample ?? '';
    this.disposition = init.disposition ?? 'enforce';
    this.statusCode = init.statusCode ?? 0;
    this.lineNumber = init.lineNumber ?? 0;
    this.columnNumber = init.columnNumber ?? 0;
    this.setFlags(init);
  }
}

/** Event dictionaries also enter through DOM's internal event-creation path. */
export interface SecurityPolicyViolationEventInitRecord extends EventInit {
  documentURI?: string;
  referrer?: string;
  blockedURI?: string;
  effectiveDirective?: string;
  violatedDirective?: string;
  originalPolicy?: string;
  sourceFile?: string;
  sample?: string;
  disposition?: CSPDisposition;
  statusCode?: number;
  lineNumber?: number;
  columnNumber?: number;
}

/*
 * enum SecurityPolicyViolationEventDisposition { "enforce", "report" };
 *
 * [Exposed=(Window,Worker)]
 * interface SecurityPolicyViolationEvent : Event {
 *   constructor(DOMString type, optional SecurityPolicyViolationEventInit eventInitDict = {});
 *   readonly attribute USVString documentURI;
 *   readonly attribute USVString referrer;
 *   readonly attribute USVString blockedURI;
 *   readonly attribute DOMString effectiveDirective;
 *   readonly attribute DOMString violatedDirective;
 *   readonly attribute DOMString originalPolicy;
 *   readonly attribute USVString sourceFile;
 *   readonly attribute DOMString sample;
 *   readonly attribute SecurityPolicyViolationEventDisposition disposition;
 *   readonly attribute unsigned short statusCode;
 *   readonly attribute unsigned long lineNumber;
 *   readonly attribute unsigned long columnNumber;
 * };
 *
 * dictionary SecurityPolicyViolationEventInit : EventInit {
 *   USVString documentURI = "";
 *   USVString referrer = "";
 *   USVString blockedURI = "";
 *   DOMString violatedDirective = "";
 *   DOMString effectiveDirective = "";
 *   DOMString originalPolicy = "";
 *   USVString sourceFile = "";
 *   DOMString sample = "";
 *   SecurityPolicyViolationEventDisposition disposition = "enforce";
 *   unsigned short statusCode = 0;
 *   unsigned long lineNumber = 0;
 *   unsigned long columnNumber = 0;
 * };
 */
export const securityPolicyViolationEventDispositionIDL = defineEnumeration({
  name: 'SecurityPolicyViolationEventDisposition',
  values: ['enforce', 'report'] satisfies CSPDisposition[],
});

export const securityPolicyViolationEventIDL = defineInterface<DOMEnvironment>({
  name: 'SecurityPolicyViolationEvent',
  inherits: 'Event',
  exposed: ['Window', 'Worker'],
  implementation: impl(SecurityPolicyViolationEventImpl, {
    constructWith: [atArg(2, (ctx) => ctx.realm.eventTimeStamp())],
  }),
  members: [
    ctor([
      arg('type', idlType.DOMString),
      arg('eventInitDict', reference('SecurityPolicyViolationEventInit'), { optional: true, default: emptyDictionary }),
    ]),
    roAttr('documentURI', idlType.USVString),
    roAttr('referrer', idlType.USVString),
    roAttr('blockedURI', idlType.USVString),
    roAttr('effectiveDirective', idlType.DOMString),
    roAttr('violatedDirective', idlType.DOMString),
    roAttr('originalPolicy', idlType.DOMString),
    roAttr('sourceFile', idlType.USVString),
    roAttr('sample', idlType.DOMString),
    roAttr('disposition', reference('SecurityPolicyViolationEventDisposition')),
    roAttr('statusCode', idlType.unsignedShort),
    roAttr('lineNumber', idlType.unsignedLong),
    roAttr('columnNumber', idlType.unsignedLong),
  ],
});

export const securityPolicyViolationEventInitIDL = defineDictionary({
  name: 'SecurityPolicyViolationEventInit',
  inherits: 'EventInit',
  members: [
    dictMember('documentURI', idlType.USVString, { default: '' }),
    dictMember('referrer', idlType.USVString, { default: '' }),
    dictMember('blockedURI', idlType.USVString, { default: '' }),
    dictMember('effectiveDirective', idlType.DOMString, { default: '' }),
    dictMember('violatedDirective', idlType.DOMString, { default: '' }),
    dictMember('originalPolicy', idlType.DOMString, { default: '' }),
    dictMember('sourceFile', idlType.USVString, { default: '' }),
    dictMember('sample', idlType.DOMString, { default: '' }),
    dictMember('disposition', reference('SecurityPolicyViolationEventDisposition'), { default: 'enforce' }),
    dictMember('statusCode', idlType.unsignedShort, { default: integer(0) }),
    dictMember('lineNumber', idlType.unsignedLong, { default: integer(0) }),
    dictMember('columnNumber', idlType.unsignedLong, { default: integer(0) }),
  ],
});
