import type { FetchHeaders, FetchIntegrityPolicy, IntegrityViolationReportBody } from '../../../fetch/index';
import { defineInterface, idlType, impl, op, roAttr, xattr } from '../../../web-idl/index';
import { ReportBodyImpl } from '../../reporting/report';

/** Integrity metadata requirements and reporting endpoints for subresource loads. */
// https://w3c.github.io/webappsec-subresource-integrity/#integrity-policy-section
export class IntegrityPolicy implements FetchIntegrityPolicy {
  /** Locations from which integrity metadata may be supplied. */
  sources: 'inline'[] = [];
  /** Request destinations that require integrity metadata. */
  blockedDestinations: ('script' | 'style')[] = [];
  /** Reporting endpoint names, resolved by the owner's Reporting state. */
  endpoints: string[] = [];

  /** Parse one combined header, returning an empty policy when absent or malformed. */
  // https://w3c.github.io/webappsec-subresource-integrity/#processing-an-integrity-policy
  static parse(headers: FetchHeaders, headerName: string): IntegrityPolicy {
    const policy = new IntegrityPolicy();
    const dictionary = headers.getStructuredFieldValue(headerName, 'dictionary');
    if (dictionary === null) return policy;

    // Require the declared inner-list-of-tokens grammar before applying defaults.
    // The draft omits error handling; malformed fields invalidate the whole policy.
    const fields = new Map<string, string[]>();
    for (const [name, member] of dictionary.members) {
      if (member.type !== 'inner-list') return policy;
      const tokens: string[] = [];
      for (const { bareItem } of member.items) {
        if (bareItem.type !== 'token') return policy;
        tokens.push(bareItem.value);
      }
      fields.set(name, tokens);
    }

    const sources = fields.get('sources');
    if (sources === undefined || sources.includes('inline')) policy.sources.push('inline');
    const destinations = fields.get('blocked-destinations');
    if (destinations?.includes('script')) policy.blockedDestinations.push('script');
    if (destinations?.includes('style')) policy.blockedDestinations.push('style');
    policy.endpoints = fields.get('endpoints') ?? policy.endpoints;
    return policy;
  }

  /** Copy the policy so changes to either owner's lists remain independent. */
  clone(): IntegrityPolicy {
    const copy = new IntegrityPolicy();
    copy.sources = [...this.sources];
    copy.blockedDestinations = [...this.blockedDestinations];
    copy.endpoints = [...this.endpoints];
    return copy;
  }
}

/** Observer-facing snapshot of an Integrity Policy violation. */
// https://w3c.github.io/webappsec-subresource-integrity/#report-violations
export class IntegrityViolationReportBodyImpl extends ReportBodyImpl implements IntegrityViolationReportBody {
  /** Sanitized URL of the document or worker that initiated the request. */
  #documentURL: string;
  /** Sanitized original request URL, before redirects. */
  #blockedURL: string;
  /** Intended use of the blocked resource. */
  #destination: string;
  /** Whether the violated policy only reports instead of blocking. */
  #reportOnly: boolean;

  constructor(body: IntegrityViolationReportBody) {
    super();
    this.#documentURL = body.documentURL;
    this.#blockedURL = body.blockedURL;
    this.#destination = body.destination;
    this.#reportOnly = body.reportOnly;
  }

  get documentURL(): string {
    return this.#documentURL;
  }

  get blockedURL(): string {
    return this.#blockedURL;
  }

  get destination(): string {
    return this.#destination;
  }

  get reportOnly(): boolean {
    return this.#reportOnly;
  }
}

// -- Web IDL ------------------------------------------------------------

// Use the browser interface model shared with Reporting's ReportBody.
/*
 * [Exposed=Window]
 * interface IntegrityViolationReportBody : ReportBody {
 *   readonly attribute USVString documentURL;
 *   readonly attribute USVString blockedURL;
 *   readonly attribute USVString destination;
 *   readonly attribute boolean reportOnly;
 *   [Default] object toJSON();
 * };
 */
export const integrityViolationReportBodyIDL = defineInterface({
  name: 'IntegrityViolationReportBody',
  inherits: 'ReportBody',
  exposed: ['Window'],
  implementation: impl(IntegrityViolationReportBodyImpl),
  members: [
    roAttr('documentURL', idlType.USVString),
    roAttr('blockedURL', idlType.USVString),
    roAttr('destination', idlType.USVString),
    roAttr('reportOnly', idlType.boolean),
    op('toJSON', idlType.object, [], xattr('Default')),
  ],
});
