import { InternalError } from '../../infra/internal-error';
import { stripURLForReporting } from '../../url/index';
import { parseIntegrityMetadata, type IntegrityViolationReportBody } from '../integrity';
import type { FetchRequest } from '../request';
import { isLocalScheme } from '../url';

/** Whether the request's integrity policies block it, reporting violations of either policy. */
// https://w3c.github.io/webappsec-subresource-integrity/#should-request-be-blocked-by-integrity-policy-section
export function isBlockedByIntegrityPolicy(request: FetchRequest): boolean {
  if (request.policyContainer === undefined) throw new InternalError('Fetch request policy container has not been resolved');
  const metadata = parseIntegrityMetadata(request.integrityMetadata);
  if (metadata.length !== 0 && (request.mode === 'cors' || request.mode === 'same-origin')) return false;
  if (isLocalScheme(request.url.scheme)) return false;
  const { destination, client } = request;
  if (destination !== 'script' && destination !== 'style') return false;
  const policy = request.policyContainer.integrityPolicy;
  const reportPolicy = request.policyContainer.reportOnlyIntegrityPolicy;
  const block = policy.sources.includes('inline') && policy.blockedDestinations.includes(destination);
  const reportBlock = reportPolicy.sources.includes('inline') && reportPolicy.blockedDestinations.includes(destination);
  if (!block && !reportBlock) return false;
  if (client === null) return false;
  const source = client.getReportingSource();
  if (source === null) return false;

  // https://w3c.github.io/webappsec-subresource-integrity/#report-violations
  const body: IntegrityViolationReportBody = {
    documentURL: stripURLForReporting(source), blockedURL: stripURLForReporting(request.url),
    destination, reportOnly: false,
  };
  if (block) {
    for (const endpoint of policy.endpoints) client.queueReport('integrity-violation', endpoint, { ...body });
  }
  if (reportBlock) {
    for (const endpoint of reportPolicy.endpoints) {
      client.queueReport('integrity-violation', endpoint, { ...body, reportOnly: true });
    }
  }
  return block;
}
