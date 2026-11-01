import { describe, expect, it, vi } from 'vitest';

import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/navigable';
import { PermissionsPolicy } from '../../../../src/browlet/browsing/policy/permissions';
import type { Report } from '../../../../src/browlet/platform';
import { FetchResponse } from '../../../../src/fetch/index';
import { obtainURLOrigin, parseURL } from '../../../../src/url/index';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { getRelevantRealm } from '../../../support/browlet-binding';

const feature = PermissionsPolicy.getSupportedFeature('cross-origin-isolated')!;
const type = 'permissions-policy-violation';

describe('Permissions Policy §§9.10–9.11 and 9.13: feature use and actual violation reports', () => {
  it.each([
    { enforced: '*', observed: '*', enabled: true, disposition: null },
    { enforced: '*', observed: '()', enabled: true, disposition: 'report' },
    { enforced: '()', observed: '*', enabled: false, disposition: 'enforce' },
    { enforced: '()', observed: '()', enabled: false, disposition: 'enforce' },
  ])('checks enforced=$enforced, report-only=$observed', ({ enforced, observed, enabled, disposition }) => {
    const { document, window, scope } = createWindow(
      `cross-origin-isolated=${enforced};report-to=blocked`,
      `cross-origin-isolated=${observed};report-to=observed`,
    );
    const observer = new window.ReportingObserver(() => {});
    observer.observe();

    expect(document.isAllowedToUse(feature.name)).toBe(enabled);
    const reports = observer.takeRecords();
    if (disposition === null) {
      expect(reports).toEqual([]);
      expect(scope.reports).toEqual([]);
      return;
    }
    // Enforced denial takes precedence: even when both deny, produce only one report.
    expect(reports).toHaveLength(1);
    expect(scope.reports).toHaveLength(1);
    expect(reports[0]!.type).toBe(type);
    expect(reports[0]!.url).toBe('https://document.test/page');
    expect(reports[0]!.body).toBeInstanceOf(window.PermissionsPolicyViolationReportBody);
    expect(reports[0]!.body!.toJSON()).toEqual({
      featureId: feature.name, sourceFile: null, lineNumber: null, columnNumber: null,
      disposition, allowAttribute: null, srcAttribute: null,
    });
    expect(scope.reports[0]!.destination).toBe(disposition === 'enforce' ? 'blocked' : 'observed');
    expect(scope.reports[0]!.data).not.toHaveProperty('allowAttribute');
    expect(scope.reports[0]!.data).not.toHaveProperty('srcAttribute');
  });

  it.each(['*', '()'])('suppresses reports for explicit inspection with enforced=%s', (enforced) => {
    const { document, window, scope } = createWindow(`cross-origin-isolated=${enforced}`, 'cross-origin-isolated=()');
    const observer = new window.ReportingObserver(() => {});
    observer.observe();
    expect(document.isPolicyFeatureEnabled(feature, document.origin, false)).toBe(enforced === '*' ? 'Enabled' : 'Disabled');
    expect(window.document.permissionsPolicy.allowsFeature(feature.name)).toBe(enforced === '*');
    expect(observer.takeRecords()).toEqual([]);
    expect(scope.reports).toEqual([]);
    expect(scope.reportBuffer).toEqual([]);
  });

  it('checks the supplied origin against the Document origin and the feature default', () => {
    const { document, scope } = createWindow();
    const other = obtainURLOrigin(parseURL('https://other.test/').url!);
    expect(document.isPolicyFeatureEnabled(feature, document.origin)).toBe('Enabled');
    expect(document.isPolicyFeatureEnabled(feature, other)).toBe('Disabled');
    expect(scope.reports).toHaveLength(1);
    expect(scope.reports[0]!.data).toMatchObject({ featureId: feature.name, disposition: 'enforce' });
    expect(document.permissionsPolicyState.getReportingEndpoint(feature)).toBeNull();
  });

  it('reports inherited denial even when the local declaration allows the feature', () => {
    const { document, scope } = createWindow('cross-origin-isolated=*;report-to=inherited', 'cross-origin-isolated=*');
    document.permissionsPolicyState.inheritedPolicy.set(feature, 'Disabled');
    expect(document.isAllowedToUse(feature.name)).toBe(false);
    expect(scope.reports).toHaveLength(1);
    expect(scope.reports[0]!.destination).toBe('inherited');
    expect(scope.reports[0]!.data).toMatchObject({ disposition: 'enforce' });
  });

  it('reports inherited report-only denial without blocking feature use', () => {
    const { document, scope } = createWindow('cross-origin-isolated=*', 'cross-origin-isolated=*;report-to=observed');
    document.reportOnlyPermissionsPolicyState.inheritedPolicy.set(feature, 'Disabled');
    expect(document.isAllowedToUse(feature.name)).toBe(true);
    expect(scope.reports).toHaveLength(1);
    expect(scope.reports[0]!.destination).toBe('observed');
    expect(scope.reports[0]!.data).toMatchObject({ disposition: 'report' });
  });

  it('keeps endpointless reports observable without falling back to the default network endpoint', () => {
    const { document, window, env, scope, runTask } = createWindow('cross-origin-isolated=()');
    const batches: Report[][] = [];
    new window.ReportingObserver((reports) => { batches.push(reports); }).observe();
    const scheduleDelivery = vi.spyOn(env.userAgent, 'queueReportingTask');
    expect(scope.reportingEndpoints.map((endpoint) => endpoint.name)).toEqual(['default']);
    expect(document.isAllowedToUse(feature.name)).toBe(false);
    expect(batches).toEqual([]);
    runTask();
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(1);
    expect(batches[0]![0]!.body!.toJSON()).toMatchObject({ disposition: 'enforce' });
    env.userAgent.sendReports(scope.reports, scope.reportingEndpoints);
    expect(scheduleDelivery).not.toHaveBeenCalled();
  });

  it('keeps reports locally observable when the host disables outbound delivery', () => {
    const { document, window, env, scope } = createWindow('cross-origin-isolated=();report-to=default');
    env.userAgent.reportDeliveryEnabled = false;
    const observer = new window.ReportingObserver(() => {});
    observer.observe();
    expect(document.isAllowedToUse(feature.name)).toBe(false);
    expect(observer.takeRecords()).toHaveLength(1);
    expect(scope.reportBuffer).toHaveLength(1);
    expect(scope.reports).toEqual([]);
  });

  it('applies the real policy when reading a concretely isolated Window capability', () => {
    const { document, window, env, scope } = createWindow('cross-origin-isolated=()');
    env.realm.agent.agentCluster!.crossOriginIsolationMode = 'concrete';
    const observer = new window.ReportingObserver(() => {});
    observer.observe();
    expect(window.crossOriginIsolated).toBe(false);
    expect(observer.takeRecords()).toHaveLength(1);
    expect(scope.reports[0]!.data).toMatchObject({ featureId: feature.name, disposition: 'enforce' });
    expect(document.permissionsPolicyState.getReportingEndpoint(feature)).toBeNull();
  });

  it('returns false without reporting when the Document has no browsing context', () => {
    const { document, scope } = createWindow('cross-origin-isolated=()');
    document.browsingContext = null;
    expect(document.isAllowedToUse(feature.name)).toBe(false);
    expect(scope.reportBuffer).toEqual([]);
  });

  it('returns false without reporting when the Document is no longer fully active', () => {
    const { document, scope, traversable } = createWindow('cross-origin-isolated=()');
    const response = new FetchResponse();
    response.urlList.push(parseURL('https://replacement.test/').url!);
    const params = traversable.createNavigationParams(response);
    const next = traversable.createAndInitializeDocument('html', 'text/html', params);
    traversable.finalizeCrossDocumentNavigation('push', 'browser UI', traversable.createHistoryEntry(next, params));
    expect(document.browsingContext).not.toBeNull();
    expect(document.isFullyActive()).toBe(false);
    expect(document.isAllowedToUse(feature.name)).toBe(false);
    expect(scope.reportBuffer).toEqual([]);
  });
});

// Real response-installed policies and Window bindings, with observer tasks advanced explicitly.
function createWindow(enforced?: string, reportOnly?: string) {
  const traversable = TopLevelTraversable.create(createManualUserAgent(), null, '');
  const response = new FetchResponse();
  response.urlList.push(parseURL('https://document.test/page#fragment').url!);
  if (enforced !== undefined) response.headerList.append('Permissions-Policy', enforced);
  if (reportOnly !== undefined) response.headerList.append('Permissions-Policy-Report-Only', reportOnly);
  response.headerList.append('Reporting-Endpoints', 'default="https://reports.test/upload"');
  const params = traversable.createNavigationParams(response);
  const document = traversable.createAndInitializeDocument('html', 'text/html', params);
  traversable.finalizeCrossDocumentNavigation('push', 'browser UI', traversable.createHistoryEntry(document, params));
  const realm = getRelevantRealm(traversable.activeWindow!);
  const env = realm.env;
  return {
    document, env, traversable, window: realm.globalObject,
    scope: env.getWindowOrWorkerGlobalScopeMixin(),
    runTask: () => env.realm.agent.eventLoop.runTaskTurn(),
  };
}
