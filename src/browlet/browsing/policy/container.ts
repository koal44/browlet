import {
  createEmbedderPolicy, type EmbedderPolicy,
} from './coep';
import { IntegrityPolicy } from './integrity-policy';
import type { FetchPolicyContainer, FetchResponse, ReferrerPolicy } from '../../../fetch/index';
import { InternalError } from '../../../infra/internal-error';

/** Policies associated with a document, worker, or worklet. */
// https://html.spec.whatwg.org/multipage/browsers.html#policy-container
export class PolicyContainer implements FetchPolicyContainer {
  // PROVISIONAL: CSP still needs its concrete value model.
  /** Content Security Policies applied to this owner. */
  cspList: object[] = [];
  /** Enforced and report-only cross-origin embedder policy. */
  embedderPolicy: EmbedderPolicy = createEmbedderPolicy();
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
    // PROVISIONAL: CSP's policy model must supply copying before populated lists can be cloned.
    if (this.cspList.length !== 0) throw new InternalError('Content Security Policy copying is not implemented');
    const clone = new PolicyContainer();
    clone.embedderPolicy = { ...this.embedderPolicy };
    clone.referrerPolicy = this.referrerPolicy;
    clone.integrityPolicy = this.integrityPolicy.clone();
    // Preserve both policies, as Gecko does; HTML's clone steps omit report-only integrity.
    clone.reportOnlyIntegrityPolicy = this.reportOnlyIntegrityPolicy.clone();
    return clone;
  }
}

/** Create an independent policy container with HTML's defaults. */
export function createPolicyContainer(): PolicyContainer {
  return new PolicyContainer();
}
