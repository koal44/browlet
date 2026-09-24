import { InternalError } from '../../infra/internal-error';
import { areSameOrigin, areSchemelesslySameSite, obtainURLOrigin, type Origin } from '../../url/index';
import type { FetchEmbedderPolicyValue, FetchEnvironment } from '../infrastructure';
import type { FetchRequest } from '../request';
import type { FetchResponse } from '../response';

/** Whether COEP permits credentials for this request's origin, mode, and redirect history. */
// https://fetch.spec.whatwg.org/#cross-origin-embedder-policy-allows-credentials
export function crossOriginEmbedderPolicyAllowsCredentials(request: FetchRequest): boolean {
  if (request.origin === undefined) throw new InternalError('Fetch request origin has not been resolved');
  if (request.mode !== 'no-cors' || request.client === null) return true;
  if (request.client.policyContainer.embedderPolicy.value !== 'credentialless') return true;
  return areSameOrigin(request.origin, obtainURLOrigin(request.currentURL)) &&
    request.redirectTaint === 'same-origin';
}

/** Whether CORP blocks the response, reporting violations of the client's embedder policies. */
// https://fetch.spec.whatwg.org/#cross-origin-resource-policy-check
export function isBlockedByCORP(
  response: FetchResponse, origin: Origin, env: FetchEnvironment, destination: string, forNavigation: boolean,
): boolean {
  const policy = env.policyContainer.embedderPolicy;
  if (isBlockedByCORPInternal(response, origin, 'unsafe-none', forNavigation)) {
    return true;
  }
  if (isBlockedByCORPInternal(response, origin, policy.reportOnlyValue, forNavigation)) {
    queueCORPViolationReport(response, env, destination, true);
  }
  if (!isBlockedByCORPInternal(response, origin, policy.value, forNavigation)) {
    return false;
  }
  queueCORPViolationReport(response, env, destination, false);
  return true;
}

/** Check one embedder policy against the response's CORP header without reporting. */
// https://fetch.spec.whatwg.org/#cross-origin-resource-policy-internal-check
export function isBlockedByCORPInternal(
  response: FetchResponse, origin: Origin, embedderPolicyValue: FetchEmbedderPolicyValue, forNavigation: boolean,
): boolean {
  if (forNavigation && embedderPolicyValue === 'unsafe-none') return false;
  let policy = response.headerList.get('Cross-Origin-Resource-Policy');
  if (policy !== 'same-origin' && policy !== 'same-site' && policy !== 'cross-origin') policy = null;
  if (policy === null && (embedderPolicyValue === 'require-corp' ||
    (embedderPolicyValue === 'credentialless' && (response.requestIncludesCredentials || forNavigation)))) {
    policy = 'same-origin';
  }
  if (policy === null || policy === 'cross-origin') return false;
  const url = response.url;
  if (url === null) throw new InternalError('CORP origin comparison requires a response URL');
  const responseOrigin = obtainURLOrigin(url);
  if (policy === 'same-origin') return !areSameOrigin(origin, responseOrigin);
  return origin.kind !== 'tuple' || !areSchemelesslySameSite(origin, responseOrigin) ||
    (origin.scheme !== 'https' && url.scheme === 'https');
}

/** Queue a COEP violation with its endpoint and sanitized original response URL. */
// https://fetch.spec.whatwg.org/#queue-a-cross-origin-embedder-policy-corp-violation-report
export function queueCORPViolationReport(
  response: FetchResponse, env: FetchEnvironment, destination: string, reportOnly: boolean,
): void {
  const policy = env.policyContainer.embedderPolicy;
  const endpoint = reportOnly ? policy.reportOnlyReportingEndpoint : policy.reportingEndpoint;
  env.queueReport('coep', endpoint, {
    type: 'corp', blockedURL: response.serializeURLForReporting(), destination,
    disposition: reportOnly ? 'reporting' : 'enforce',
  });
}
