import {
  createEmbedderPolicy, type EmbedderPolicy,
} from './coep';
import type { FetchPolicyContainer, ReferrerPolicy } from '../../../fetch/index';
import { InternalError } from '../../../infra/internal-error';

/** Policies associated with a document, worker, or worklet. */
// https://html.spec.whatwg.org/multipage/browsers.html#policy-container
export class PolicyContainer implements FetchPolicyContainer {
  // PROVISIONAL: CSP and Integrity Policy still need concrete value models.
  /** Content Security Policies applied to this owner. */
  cspList: object[] = [];
  /** Enforced and report-only cross-origin embedder policy. */
  embedderPolicy: EmbedderPolicy = createEmbedderPolicy();
  /** Default referrer disclosure policy for requests initiated by this owner. */
  referrerPolicy: ReferrerPolicy = 'strict-origin-when-cross-origin';
  /** Enforced integrity requirements for outgoing requests. */
  integrityPolicy: IntegrityPolicy = {};
  /** Integrity requirements checked for reporting without blocking requests. */
  reportOnlyIntegrityPolicy: IntegrityPolicy = {};

  /** Copy the implemented policy state independently of its current owner. */
  // https://html.spec.whatwg.org/multipage/browsers.html#clone-a-policy-container
  clone(): PolicyContainer {
    // PROVISIONAL: CSP's policy model must supply copying before populated lists can be cloned.
    if (this.cspList.length !== 0) throw new InternalError('Content Security Policy copying is not implemented');
    const clone = new PolicyContainer();
    clone.embedderPolicy = { ...this.embedderPolicy };
    clone.referrerPolicy = this.referrerPolicy;
    clone.integrityPolicy = { ...this.integrityPolicy };
    // HTML currently leaves report-only integrity at its default; revisit with Integrity Policy's value model.
    return clone;
  }
}

/** Create an independent policy container with HTML's defaults. */
export function createPolicyContainer(): PolicyContainer {
  return new PolicyContainer();
}

export type IntegrityPolicy = Record<never, never>;
