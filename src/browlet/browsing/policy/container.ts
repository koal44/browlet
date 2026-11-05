import { InternalError } from '../../../infra/index';
import type { URLRecord } from '../../../url/index';
import {
  isLocalURL, type FetchEmbedderPolicy, type FetchIntegrityPolicy, type FetchPolicyContainer,
  type FetchResponse, type ReferrerPolicy,
} from '../../../fetch/index';

import { CSPList, type CSPListSnapshot } from './csp/index';

import { EmbedderPolicy } from './cross-origin/index';
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

  /** Restore independent policy implementations from trusted host data, without consulting live owners. */
  static fromSnapshot(snapshot: PolicyContainerSnapshot): PolicyContainer {
    const container = new PolicyContainer();
    container.cspList = snapshot.cspList === undefined ? undefined : CSPList.fromSnapshot(snapshot.cspList);
    Object.assign(container.embedderPolicy, snapshot.embedderPolicy);
    container.referrerPolicy = snapshot.referrerPolicy;
    for (const name of ['integrityPolicy', 'reportOnlyIntegrityPolicy'] as const) {
      const policy = snapshot[name];
      container[name].sources = [...policy.sources];
      container[name].blockedDestinations = [...policy.blockedDestinations];
      container[name].endpoints = [...policy.endpoints];
    }
    return container;
  }

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

  /** Capture cloneable values for another isolate; reporting endpoints remain names, not service connections. */
  // Internal transport data, not author-facing structured serialization or a new policy parsing step.
  toSnapshot(): PolicyContainerSnapshot {
    return {
      cspList: this.cspList?.toSnapshot(),
      embedderPolicy: { ...this.embedderPolicy },
      referrerPolicy: this.referrerPolicy,
      integrityPolicy: { ...this.integrityPolicy.clone() },
      reportOnlyIntegrityPolicy: { ...this.reportOnlyIntegrityPolicy.clone() },
    };
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

/** Plain host-transport representation, using the existing data-only policy contracts. */
export interface PolicyContainerSnapshot {
  cspList: CSPListSnapshot | undefined;
  embedderPolicy: FetchEmbedderPolicy;
  referrerPolicy: ReferrerPolicy;
  integrityPolicy: FetchIntegrityPolicy;
  reportOnlyIntegrityPolicy: FetchIntegrityPolicy;
}
