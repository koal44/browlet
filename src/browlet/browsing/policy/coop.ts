/** Browsing-context isolation requirements and their reporting endpoints. */
// https://html.spec.whatwg.org/multipage/browsers.html#cross-origin-opener-policy
export class OpenerPolicy {
  /** Enforced browsing-context isolation policy. */
  value: OpenerPolicyValue = 'unsafe-none';
  /** Named endpoint for enforced-policy reports, when configured. */
  reportingEndpoint: string | null = null;
  /** Policy evaluated without enforcing a group switch. */
  reportOnlyValue: OpenerPolicyValue = 'unsafe-none';
  /** Named endpoint for report-only violations, when configured. */
  reportOnlyReportingEndpoint: string | null = null;
}

export type OpenerPolicyValue =
  | 'unsafe-none'
  | 'same-origin-allow-popups'
  | 'same-origin'
  | 'same-origin-plus-COEP'
  | 'noopener-allow-popups';
