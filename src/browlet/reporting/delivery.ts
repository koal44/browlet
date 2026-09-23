import type { Environment } from '../scripting/environment';
import type { UserAgent } from '../user-agent';
import type { ReportingEndpoint } from './endpoint';
import type { ReportImpl } from './report';
import { areSameOrigin, type Origin } from '../../url/index';

/** Hand reports to browser-owned delivery without retaining their generating environment. */
// https://w3c.github.io/reporting/#send-reports
export function sendReports(reports: ReportImpl[], environment: Environment): void {
  const { userAgent } = environment;
  if (!userAgent.reportDeliveryEnabled) return;
  const configuration = environment.getWindowOrWorkerGlobalScopeMixin().reportingEndpoints;
  const cutoff = Date.now() - userAgent.maxReportAge;
  const endpointMap = new Map<ReportingEndpoint, ReportImpl[]>();
  for (const report of reports) {
    if (report.timestamp < cutoff) continue;
    const endpoint = configuration.find((candidate) => candidate.name === report.destination);
    if (endpoint === undefined || endpoint.failures > userAgent.maxReportingEndpointFailures) continue;
    const group = endpointMap.get(endpoint);
    const copy = report.cloneForDelivery();
    if (group === undefined) endpointMap.set(endpoint, [copy]);
    else group.push(copy);
  }

  for (const [endpoint, group] of endpointMap) {
    const originGroups: [ReportImpl, ...ReportImpl[]][] = [];
    for (const report of group) {
      const originGroup = originGroups.find((candidate) => areSameOrigin(candidate[0].origin, report.origin));
      if (originGroup === undefined) originGroups.push([report]);
      else originGroup.push(report);
    }
    for (const originGroup of originGroups) {
      queueDelivery(endpoint, originGroup[0].origin, originGroup, configuration, userAgent);
    }
  }
}

/** Outcome of one delivery attempt; the caller applies endpoint bookkeeping. */
export type ReportDeliveryResult = 'success' | 'remove-endpoint' | 'failure';

// The task owns only copied reports and the original endpoint configuration.
// In particular, this closure is created outside the environment's scope.
function queueDelivery(
  endpoint: ReportingEndpoint, origin: Origin, reports: ReportImpl[],
  configuration: ReportingEndpoint[], userAgent: UserAgent,
): void {
  userAgent.queueReportingTask(() => {
    if (!userAgent.reportDeliveryEnabled) return;
    if (endpoint.failures > userAgent.maxReportingEndpointFailures) {
      const index = configuration.indexOf(endpoint);
      if (index !== -1) configuration.splice(index, 1);
    }
    if (!configuration.includes(endpoint)) return;
    const cutoff = Date.now() - userAgent.maxReportAge;
    const currentReports = reports.filter((report) => report.timestamp >= cutoff);
    if (currentReports.length === 0) return;
    userAgent.attemptReportDelivery(endpoint, origin, currentReports).observe((result) => {
      if (result === 'success') {
        endpoint.failures = 0;
      } else if (result === 'remove-endpoint') {
        const index = configuration.indexOf(endpoint);
        if (index !== -1) configuration.splice(index, 1);
      } else {
        endpoint.failures++;
      }
      // The draft leaves retries unresolved. Finishing this callback releases
      // the attempt; later reports may still use a surviving endpoint.
    }, (error) => { throw error; });
  });
}
