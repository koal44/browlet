import { InternalError } from '../../../infra/index';
import type { URLRecord } from '../../../url/index';
import { isLocalURL, type FetchPolicyContainer, type FetchResponse, type ReferrerPolicy } from '../../../fetch/index';

import type { CSPList } from './csp/index';

import { EmbedderPolicy } from './coep';
import { IntegrityPolicy } from './integrity-policy';

/** Policies associated with a document, worker, or worklet. */
// https://html.spec.whatwg.org/multipage/browsers.html#policy-container
export class PolicyContainer implements FetchPolicyContainer {
  /** Content Security Policies; absent until the resource's origin is established. */
  // TODO(CSP): Represent the initially empty list independently of its later self origin.
  cspList: CSPList | undefined = undefined;
  /** Enforced and report-only cross-origin embedder policy. */
  embedderPolicy = new EmbedderPolicy();
  /** Default referrer disclosure policy for requests initiated by this owner. */
  referrerPolicy: ReferrerPolicy = 'strict-origin-when-cross-origin';
  /** Enforced integrity requirements for outgoing requests. */
  integrityPolicy: IntegrityPolicy = new IntegrityPolicy();
  /** Integrity requirements checked for reporting without blocking requests. */
  reportOnlyIntegrityPolicy: IntegrityPolicy = new IntegrityPolicy();

  // https://html.spec.whatwg.org/multipage/browsers.html#requires-storing-the-policy-container-in-history
  static requiresStorageInHistory(url: URLRecord): boolean {
    return url.scheme !== 'blob' && isLocalURL(url);
  }

  /** Select the destination's policies in history, srcdoc, initiator, then response order. */
  // https://html.spec.whatwg.org/multipage/browsers.html#determining-navigation-params-policy-container
  static determineForNavigation(
    responseURL: URLRecord, historyPolicyContainer: PolicyContainer | null,
    initiatorPolicyContainer: PolicyContainer | null, parentPolicyContainer: PolicyContainer | null,
    responsePolicyContainer: PolicyContainer | null,
  ): PolicyContainer {
    if (historyPolicyContainer !== null) {
      if (!this.requiresStorageInHistory(responseURL)) throw new InternalError('This URL cannot restore policies from history');
      return historyPolicyContainer.clone();
    }
    if (
      responseURL.scheme === 'about' && responseURL.path === 'srcdoc' && responseURL.query === null &&
      responseURL.username === '' && responseURL.password === '' && responseURL.host === null
    ) {
      if (parentPolicyContainer === null) throw new InternalError('Srcdoc policy inheritance requires a parent policy container');
      return parentPolicyContainer.clone();
    }
    if (isLocalURL(responseURL) && initiatorPolicyContainer !== null) return initiatorPolicyContainer.clone();
    return responsePolicyContainer ?? new PolicyContainer();
  }

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
    // SPEC_CLASH(policy-container-report-only-integrity): Preserve both policies, as Gecko does; HTML's clone steps omit report-only integrity.
    clone.reportOnlyIntegrityPolicy = this.reportOnlyIntegrityPolicy.clone();
    return clone;
  }
}
