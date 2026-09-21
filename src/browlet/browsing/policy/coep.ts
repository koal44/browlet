import type { FetchEmbedderPolicyValue } from '../../../fetch/index';

/** https://html.spec.whatwg.org/multipage/browsers.html#embedder-policy */
export function createEmbedderPolicy(): EmbedderPolicy {
  return {
    value: 'unsafe-none',
    reportingEndpoint: '',
    reportOnlyValue: 'unsafe-none',
    reportOnlyReportingEndpoint: '',
  };
}

export type EmbedderPolicy = {
  value: EmbedderPolicyValue;
  reportingEndpoint: string;
  reportOnlyValue: EmbedderPolicyValue;
  reportOnlyReportingEndpoint: string;
};

export type EmbedderPolicyValue = FetchEmbedderPolicyValue;
