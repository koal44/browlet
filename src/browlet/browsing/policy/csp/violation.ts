import { utf8Encode } from '../../../../encoding/index';
import { InternalError } from '../../../../infra/internal-error';
import { FetchRequest, fetch } from '../../../../fetch/index';
import { copyURL, stripURLForReporting, type URLRecord } from '../../../../url/index';
import {
  arg, atArg, ctor, defineDictionary, defineEnumeration, defineInterface, dictMember,
  emptyDictionary, idlType, impl, integer, nullable, op, reference, roAttr, xattr,
} from '../../../../web-idl/index';
import { EventImpl, type EventInitRecord } from '../../../dom/events/event';
import type { DOMEnvironment } from '../../../dom/environment';
import type { DOMHighResTimeStamp } from '../../../performance/high-resolution-time';
import type { ElementImpl } from '../../../dom/nodes/element';
import type { DocumentImpl } from '../../../dom/nodes/document';
import { ReportBodyImpl } from '../../../reporting/report';
import type { BrowletEnvironment } from '../../../scripting/environment';
import type { ContentSecurityPolicy, CSPDisposition } from './policy';

/** A policy violation captured before its asynchronous event and report delivery. */
// https://w3c.github.io/webappsec-csp/#framework-violation
export class CSPViolation {
  /** Environment whose policy was violated. Worker construction awaits its global implementation. */
  env: BrowletEnvironment;
  /** Protected Document retained for queued event targeting. */
  #document: DocumentImpl;
  /** Protected resource URL captured when the violation occurs. */
  url: URLRecord;
  /** HTTP status of the protected resource, not the rejected subresource. */
  status: number;
  /** Original blocked URL or the kind of non-URL violation. */
  resource: CSPViolationResource;
  /** Referrer of the protected resource, or null when omitted. */
  referrer: URLRecord | null;
  /** Policy responsible for the violation. */
  policy: ContentSecurityPolicy;
  /** Operation's effective directive, before falling back to another source list. */
  effectiveDirective: string;
  /** Requested script source URL when its provenance is available. */
  sourceFile: URLRecord | null = null;
  /** Source line, or zero when unavailable. */
  lineNumber = 0;
  /** Source column, or zero when unavailable. */
  columnNumber = 0;
  /** Element which caused the violation, or null for a global operation. */
  element: ElementImpl | null = null;
  /** Authorized excerpt of violating inline code, otherwise empty. */
  sample = '';

  // https://w3c.github.io/webappsec-csp/#create-violation-for-global
  // Require the resource at construction instead of exposing a partially populated violation.
  constructor(
    policy: ContentSecurityPolicy, effectiveDirective: string, resource: CSPViolationResource, env: BrowletEnvironment,
  ) {
    const document = env.realm.getAssociatedDocument();
    if (document === null) throw new InternalError('CSP worker violation integration is not implemented');
    this.env = env;
    this.#document = document;
    this.url = copyURL(document.url);
    this.status = document.httpStatus;
    this.resource = typeof resource === 'string' ? resource : copyURL(resource);
    this.referrer = document.referrer === '' ? null : env.parseURL(document.referrer).url;
    this.policy = policy;
    this.effectiveDirective = effectiveDirective;
    // CSP permits omitting script locations when the engine cannot supply them.
    // Do not infer author locations from a host Node stack or disclose a redirect target.
  }

  /** Sanitized blocked resource, shared by DOM events and both report formats. */
  // https://w3c.github.io/webappsec-csp/#obtain-violation-blocked-uri
  get blockedURI(): string {
    return typeof this.resource === 'string' ? this.resource : stripURLForReporting(this.resource);
  }

  /** Deliver a trusted event, then submit the policy's selected report format. */
  // https://w3c.github.io/webappsec-csp/#report-violation
  report(): void {
    const { env } = this;
    let target = this.element;
    // SPEC_CLASH(csp-violation-task-source): CSP leaves the source unnamed;
    // WebKit uses DOM manipulation, Blink networking. Follow WebKit here.
    env.exec.queueTask('dom-manipulation', () => {
      const document = this.#document;
      if (target !== null && target.getShadowIncludingRoot() !== document) target = null;
      const body = new CSPViolationReportBodyImpl(this);
      (target ?? document).fireEvent('securitypolicyviolation', SecurityPolicyViolationEventImpl, (event) => {
        (event as SecurityPolicyViolationEventImpl).initialize({
          documentURI: body.documentURL, referrer: body.referrer ?? '', blockedURI: body.blockedURL ?? '',
          effectiveDirective: body.effectiveDirective, violatedDirective: body.effectiveDirective,
          originalPolicy: body.originalPolicy, sourceFile: body.sourceFile ?? '', sample: body.sample ?? '',
          disposition: body.disposition, statusCode: body.statusCode,
          lineNumber: body.lineNumber ?? 0, columnNumber: body.columnNumber ?? 0,
          bubbles: true, composed: true,
        });
      });
      const endpoints = this.policy.directives.get('report-to')?.tokens;
      if (endpoints !== undefined) {
        for (const endpoint of endpoints) env.queueReport('csp-violation', endpoint, body);
      } else {
        this.#sendLegacyReports();
      }
    });
  }

  /** Encode the deprecated report-uri payload as JSON bytes. */
  // https://w3c.github.io/webappsec-csp/#deprecated-serialize-violation
  serialize(): Uint8Array<ArrayBuffer> {
    const body = {
      'document-uri': stripURLForReporting(this.url),
      referrer: this.referrer === null ? '' : stripURLForReporting(this.referrer),
      'blocked-uri': this.blockedURI,
      'effective-directive': this.effectiveDirective,
      'violated-directive': this.effectiveDirective,
      'original-policy': this.policy.serialized,
      disposition: this.policy.disposition,
      'status-code': this.status,
      'script-sample': this.sample,
      ...(this.sourceFile === null ? {} : {
        'source-file': stripURLForReporting(this.sourceFile),
        'line-number': this.lineNumber,
        'column-number': this.columnNumber,
      }),
    };
    return utf8Encode(JSON.stringify({ 'csp-report': body }));
  }

  #sendLegacyReports(): void {
    const { env } = this;
    if (!env.userAgent.reportDeliveryEnabled) return;
    for (const token of this.policy.directives.get('report-uri')?.tokens ?? []) {
      const endpoint = env.parseURL(token, this.url).url;
      if (endpoint === null) continue;
      const request = new FetchRequest(endpoint, env, env.userAgent);
      request.method = 'POST';
      request.origin = env.origin;
      request.traversableForUserPrompts = null;
      request.destination = 'report';
      request.credentialsMode = 'same-origin';
      request.keepalive = true;
      request.headerList.append('Content-Type', 'application/csp-report');
      request.body = this.serialize();
      request.redirectMode = 'error';
      fetch(request, {}, env);
    }
  }
}

/** Resources identified by CSP independently of a network URL. */
export type CSPViolationResource = URLRecord | 'inline' | 'eval' | 'wasm-eval' | 'trusted-types-policy' | 'trusted-types-sink';

/** JSON-serializable violation data, also projected as the observer's ReportBody. */
export class CSPViolationReportBodyImpl extends ReportBodyImpl {
  /** Sanitized protected document URL. */
  documentURL: string;
  /** Sanitized protected resource referrer, or null when absent. */
  referrer: string | null;
  /** Sanitized original blocked URL or non-URL violation kind. */
  blockedURL: string | null;
  /** Effective directive before fallback. */
  effectiveDirective: string;
  /** Original policy text. */
  originalPolicy: string;
  /** Sanitized script source URL, or null when unavailable. */
  sourceFile: string | null;
  /** Authorized inline excerpt, otherwise empty. */
  sample: string | null;
  /** Enforced or monitored policy. */
  disposition: CSPDisposition;
  /** HTTP status of the protected resource. */
  statusCode: number;
  /** Source line, or null when the source file is unavailable. */
  lineNumber: number | null;
  /** Source column, or null when the source file is unavailable. */
  columnNumber: number | null;

  constructor(violation: CSPViolation) {
    super();
    this.documentURL = stripURLForReporting(violation.url);
    this.referrer = violation.referrer === null ? null : stripURLForReporting(violation.referrer);
    this.blockedURL = violation.blockedURI;
    this.effectiveDirective = violation.effectiveDirective;
    this.originalPolicy = violation.policy.serialized;
    this.sourceFile = violation.sourceFile === null ? null : stripURLForReporting(violation.sourceFile);
    this.sample = violation.sample;
    this.disposition = violation.policy.disposition;
    this.statusCode = violation.status;
    this.lineNumber = violation.sourceFile === null ? null : violation.lineNumber;
    this.columnNumber = violation.sourceFile === null ? null : violation.columnNumber;
  }
}

// SPEC_CLASH(csp-report-body-interface): The draft declares a dictionary inheriting
// the ReportBody interface. Use the browser interface model already adopted for Reporting.
/*
 * [Exposed=(Window,Worker)]
 * interface CSPViolationReportBody : ReportBody {
 *   readonly attribute USVString documentURL;
 *   readonly attribute USVString? referrer;
 *   readonly attribute USVString? blockedURL;
 *   readonly attribute DOMString effectiveDirective;
 *   readonly attribute DOMString originalPolicy;
 *   readonly attribute USVString? sourceFile;
 *   readonly attribute DOMString? sample;
 *   readonly attribute SecurityPolicyViolationEventDisposition disposition;
 *   readonly attribute unsigned short statusCode;
 *   readonly attribute unsigned long? lineNumber;
 *   readonly attribute unsigned long? columnNumber;
 *   [Default] object toJSON();
 * };
 */
export const cspViolationReportBodyIDL = defineInterface({
  name: 'CSPViolationReportBody',
  inherits: 'ReportBody',
  exposed: ['Window', 'Worker'],
  implementation: impl(CSPViolationReportBodyImpl),
  members: [
    roAttr('documentURL', idlType.USVString),
    roAttr('referrer', nullable(idlType.USVString)),
    roAttr('blockedURL', nullable(idlType.USVString)),
    roAttr('effectiveDirective', idlType.DOMString),
    roAttr('originalPolicy', idlType.DOMString),
    roAttr('sourceFile', nullable(idlType.USVString)),
    roAttr('sample', nullable(idlType.DOMString)),
    roAttr('disposition', reference('SecurityPolicyViolationEventDisposition')),
    roAttr('statusCode', idlType.unsignedShort),
    roAttr('lineNumber', nullable(idlType.unsignedLong)),
    roAttr('columnNumber', nullable(idlType.unsignedLong)),
    op('toJSON', idlType.object, [], xattr('Default')),
  ],
});

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
  effectiveDirective: string = '';
  /** Historical name for the effective directive in generated events. */
  violatedDirective: string = '';
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
export interface SecurityPolicyViolationEventInitRecord extends EventInitRecord {
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
 */
export const securityPolicyViolationEventDispositionIDL = defineEnumeration({
  name: 'SecurityPolicyViolationEventDisposition',
  values: ['enforce', 'report'] satisfies CSPDisposition[],
});

/*
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
 */
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

/*
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
