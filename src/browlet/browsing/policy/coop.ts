/** Create the default cross-origin opener policy with no reporting endpoints. */
// https://html.spec.whatwg.org/multipage/browsers.html#cross-origin-opener-policy
export function createOpenerPolicy(): OpenerPolicy {
  return {
    value: 'unsafe-none',
    reportingEndpoint: null,
    reportOnlyValue: 'unsafe-none',
    reportOnlyReportingEndpoint: null,
  };
}

export type OpenerPolicy = {
  /** Enforced browsing-context isolation policy. */
  value: OpenerPolicyValue;
  /** Named endpoint for enforced-policy reports, when configured. */
  reportingEndpoint: string | null;
  /** Policy evaluated without enforcing a group switch. */
  reportOnlyValue: OpenerPolicyValue;
  /** Named endpoint for report-only violations, when configured. */
  reportOnlyReportingEndpoint: string | null;
};

export type OpenerPolicyValue =
  | 'unsafe-none'
  | 'same-origin-allow-popups'
  | 'same-origin'
  | 'same-origin-plus-COEP'
  | 'noopener-allow-popups';
