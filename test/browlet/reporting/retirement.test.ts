import { describe, expect, it, vi } from 'vitest';
import { getRelevantRealm } from '../../../src/browlet/bindings';
import { createNewTopLevelTraversable } from '../../../src/browlet/browsing/navigable';
import { ReportingEndpoint } from '../../../src/browlet/reporting/endpoint';
import { UserAgent } from '../../../src/browlet/user-agent';
import { parseURL } from '../../../src/url/url';

describe('Reporting retirement', () => {
  it('retires expired outbound reports, replay buffers, and pending observer records together', () => {
    const { window, scope, userAgent } = createWindow();
    const observer = new window.ReportingObserver(() => {});
    observer.observe();
    scope.queueReport('coep', 'reports', corpBody);
    const expired = scope.reports[0]!;
    expired.timestamp = Date.now() - userAgent.maxReportAge - 1;
    scope.queueReport('coep', 'reports', { ...corpBody, disposition: 'reporting' });
    scope.retireReports();

    expect(scope.reports).toHaveLength(1);
    expect(scope.reportBuffer).toEqual(scope.reports);
    expect(observer.takeRecords()).toHaveLength(1);
    const buffered = new window.ReportingObserver(() => {}, { buffered: true });
    buffered.observe();
    expect(buffered.takeRecords()).toHaveLength(1);
  });

  it('retires disconnected observers lazily without retaining them in the registration set', () => {
    const { window, scope, userAgent } = createWindow();
    const observer = new window.ReportingObserver(() => {});
    observer.observe();
    scope.queueReport('coep', 'reports', corpBody);
    observer.disconnect();
    scope.reports[0]!.timestamp = Date.now() - userAgent.maxReportAge - 1;
    scope.retireReports();
    expect(scope.reportingObservers.size).toBe(0);
    expect(observer.takeRecords()).toEqual([]);
  });

  it('keeps reports exactly at the age limit and endpoints exactly at the failure limit', () => {
    const { scope, userAgent } = createWindow();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000_000);
    try {
      scope.queueReport('coep', 'reports', corpBody);
      scope.reports[0]!.timestamp = Date.now() - userAgent.maxReportAge;
      const allowed = new ReportingEndpoint('reports', parseURL('https://collector.test/').url!);
      const retired = new ReportingEndpoint('other', allowed.url);
      allowed.failures = userAgent.maxReportingEndpointFailures;
      retired.failures = allowed.failures + 1;
      scope.reportingEndpoints.push(allowed, retired);
      scope.retireReports();
      expect(scope.reports).toHaveLength(1);
      expect(scope.reportingEndpoints).toEqual([allowed]);
    } finally {
      clock.mockRestore();
    }
  });

  it('expires local observations even when outbound reporting is disabled', () => {
    const { window, scope, userAgent } = createWindow();
    userAgent.reportDeliveryEnabled = false;
    scope.queueReport('coep', 'reports', corpBody);
    scope.reportBuffer[0]!.timestamp = Date.now() - userAgent.maxReportAge - 1;
    const observer = new window.ReportingObserver(() => {}, { buffered: true });
    observer.observe();
    expect(scope.reports).toEqual([]);
    expect(scope.reportBuffer).toEqual([]);
    expect(observer.takeRecords()).toEqual([]);
  });
});

function createWindow() {
  const userAgent = new UserAgent();
  const traversable = createNewTopLevelTraversable(userAgent, null, '');
  const realm = getRelevantRealm(traversable.activeWindow!);
  return {
    userAgent, window: realm.global as Window & typeof globalThis,
    scope: realm.environment.getWindowOrWorkerGlobalScopeMixin(),
  };
}

const corpBody = {
  type: 'corp', blockedURL: 'https://resource.test/', destination: 'script', disposition: 'enforce',
};
