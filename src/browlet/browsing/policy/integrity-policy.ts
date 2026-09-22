import type { FetchHeaders, FetchIntegrityPolicy } from '../../../fetch/index';
import { defineDictionary, dictMember, idlType } from '../../../web-idl/index';

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

// https://w3c.github.io/webappsec-subresource-integrity/#report-violations
/*
 * dictionary IntegrityViolationReportBody : ReportBody {
 *   USVString documentURL;
 *   USVString blockedURL;
 *   USVString destination;
 *   boolean reportOnly;
 * };
 */
export const integrityViolationReportBodyIDL = defineDictionary({
  name: 'IntegrityViolationReportBody',
  inherits: 'ReportBody',
  members: [
    dictMember('documentURL', idlType.USVString),
    dictMember('blockedURL', idlType.USVString),
    dictMember('destination', idlType.USVString),
    dictMember('reportOnly', idlType.boolean),
  ],
});
