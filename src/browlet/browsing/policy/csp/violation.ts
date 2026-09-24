import { utf8Encode } from '../../../../encoding/index';
import { InternalError } from '../../../../infra/internal-error';
import { FetchRequest, fetch } from '../../../../fetch/index';
import { copyURL, stripURLForReporting, type URLRecord } from '../../../../url/index';
import { defineInterface, idlType, impl, nullable, op, reference, roAttr, xattr } from '../../../../web-idl/index';
import type { ElementImpl } from '../../../dom/nodes/element';
import type { DocumentImpl } from '../../../dom/nodes/document';
import { fireEvent } from '../../../dom/events/event-target';
import { ReportBodyImpl } from '../../../reporting/report';
import type { Environment } from '../../../scripting/environment';
import { domManipulationTaskSource } from '../../../scripting/tasks';
import type { ContentSecurityPolicy, CSPDisposition } from './policy';
import { SecurityPolicyViolationEventImpl } from './violation-event';

/** A policy violation captured before its asynchronous event and report delivery. */
// https://w3c.github.io/webappsec-csp/#framework-violation
export class CSPViolation {
  /** Environment whose policy was violated. Worker construction awaits its global implementation. */
  env: Environment;
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
  constructor(policy: ContentSecurityPolicy, effectiveDirective: string, resource: CSPViolationResource, env: Environment) {
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
    env.realm.queueGlobalTask(domManipulationTaskSource, () => {
      const document = this.#document;
      if (target !== null && target.getShadowIncludingRoot() !== document) target = null;
      const body = new CSPViolationReportBodyImpl(this);
      fireEvent('securitypolicyviolation', target ?? document, SecurityPolicyViolationEventImpl, (event) => {
        (event as SecurityPolicyViolationEventImpl).initialize({
          documentURI: body.documentURL, referrer: body.referrer ?? '', blockedURI: body.blockedURL ?? '',
          effectiveDirective: body.effectiveDirective, violatedDirective: body.effectiveDirective,
          originalPolicy: body.originalPolicy, sourceFile: body.sourceFile ?? '', sample: body.sample ?? '',
          disposition: body.disposition, statusCode: body.statusCode,
          lineNumber: body.lineNumber ?? 0, columnNumber: body.columnNumber ?? 0,
          bubbles: true, composed: true,
        });
      });
      const endpoints = this.policy.directives.get('report-to');
      if (endpoints !== undefined) {
        for (const endpoint of endpoints) env.queueReport('csp-violation', endpoint, body);
      } else {
        this.sendLegacyReports();
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

  private sendLegacyReports(): void {
    const { env } = this;
    if (!env.userAgent.reportDeliveryEnabled) return;
    for (const token of this.policy.directives.get('report-uri') ?? []) {
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
      fetch(request);
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

// -- Web IDL ------------------------------------------------------------

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
