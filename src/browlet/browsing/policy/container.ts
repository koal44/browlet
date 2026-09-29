import { EmbedderPolicy } from './coep';
import { IntegrityPolicy } from './integrity-policy';
import type { CSPList } from './csp/list';
import type { FetchPolicyContainer, FetchResponse, ReferrerPolicy } from '../../../fetch/index';

/** Policies associated with a document, worker, or worklet. */
// https://html.spec.whatwg.org/multipage/browsers.html#policy-container
export class PolicyContainer implements FetchPolicyContainer {
  /** Content Security Policies; absent until the resource's origin is established. */
  cspList: CSPList | undefined = undefined;
  /** Enforced and report-only cross-origin embedder policy. */
  embedderPolicy = new EmbedderPolicy();
  /** Default referrer disclosure policy for requests initiated by this owner. */
  referrerPolicy: ReferrerPolicy = 'strict-origin-when-cross-origin';
  /** Enforced integrity requirements for outgoing requests. */
  integrityPolicy: IntegrityPolicy = new IntegrityPolicy();
  /** Integrity requirements checked for reporting without blocking requests. */
  reportOnlyIntegrityPolicy: IntegrityPolicy = new IntegrityPolicy();

  /** Replace policies supplied by the response, preserving those whose headers are absent. */
  // https://w3c.github.io/webappsec-subresource-integrity/#parse-integrity-policy-headers-section
  parseIntegrityPolicyHeaders(response: FetchResponse): void {
    const headers = response.headerList;
    if (headers.has('Integrity-Policy')) this.integrityPolicy = IntegrityPolicy.parse(headers, 'Integrity-Policy');
    if (headers.has('Integrity-Policy-Report-Only')) {
      this.reportOnlyIntegrityPolicy = IntegrityPolicy.parse(headers, 'Integrity-Policy-Report-Only');
    }
  }

  /** Copy the implemented policy state independently of its current owner. */
  // https://html.spec.whatwg.org/multipage/browsers.html#clone-a-policy-container
  clone(): PolicyContainer {
    const clone = new PolicyContainer();
    clone.cspList = this.cspList?.clone();
    clone.embedderPolicy = this.embedderPolicy.clone();
    clone.referrerPolicy = this.referrerPolicy;
    clone.integrityPolicy = this.integrityPolicy.clone();
    // Preserve both policies, as Gecko does; HTML's clone steps omit report-only integrity.
    clone.reportOnlyIntegrityPolicy = this.reportOnlyIntegrityPolicy.clone();
    return clone;
  }
}
