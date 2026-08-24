export function createOpenerPolicy(): OpenerPolicy {
  return {
    value: 'unsafe-none',
    reportingEndpoint: null,
    reportOnlyValue: 'unsafe-none',
    reportOnlyReportingEndpoint: null,
  };
}

export type OpenerPolicy = {
  value: OpenerPolicyValue;
  reportingEndpoint: string | null;
  reportOnlyValue: OpenerPolicyValue;
  reportOnlyReportingEndpoint: string | null;
};

export type OpenerPolicyValue =
  | 'unsafe-none'
  | 'same-origin-allow-popups'
  | 'same-origin'
  | 'same-origin-plus-COEP'
  | 'noopener-allow-popups';
