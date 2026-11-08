import { describe, expect, it } from 'vitest';

import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/top-level-traversable';
import { PermissionsPolicy } from '../../../../src/browlet/browsing/policy/permissions-policy/policy';
import { FetchRequest, FetchResponse } from '../../../../src/fetch/index';
import { createOpaqueOrigin, obtainURLOrigin, parseURL } from '../../../../src/url/index';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { getRelevantRealm } from '../../../support/browlet-binding';

const feature = PermissionsPolicy.getSupportedFeature('cross-origin-isolated')!;

describe('Permissions Policy §9.15: request feature use', () => {
  it('denies a clientless request even when its owner and reserved client are Windows', () => {
    const { env, scope } = createWindow();
    const request = new FetchRequest(parseURL('https://document.test/resource').url!, env);
    request.reservedClient = env;
    expect(request.isAllowedToUseFeature(feature.name)).toBe(false);
    expect(scope.reportBuffer).toEqual([]);
  });

  it('denies a non-Window client before reading its unavailable origin or Document', () => {
    const { env, scope } = createWindow();
    const request = new FetchRequest(parseURL('https://document.test/resource').url!, env);
    request.client = env.userAgent.sandbox;
    expect(request.client.isWindow).toBe(false);
    expect(request.isAllowedToUseFeature(feature.name)).toBe(false);
    expect(scope.reportBuffer).toEqual([]);
  });

  it('requires Fetch to populate a Window request origin before checking policy', () => {
    const { env, scope } = createWindow();
    const request = new FetchRequest(parseURL('https://other.test/resource').url!, env);
    request.client = env;
    expect(() => request.isAllowedToUseFeature(feature.name)).toThrow('Fetch request origin has not been resolved');
    expect(scope.reportBuffer).toEqual([]);
    request.populateFromClient();
    expect(request.origin).toBe(env.origin);
    expect(request.isAllowedToUseFeature(feature.name)).toBe(true);
  });

  it('uses request.origin rather than either the original or redirected destination URL', () => {
    const { request, scope } = createWindow();
    request.urlList.push(parseURL('https://redirected.test/resource').url!);
    expect(request.isAllowedToUseFeature(feature.name)).toBe(true);
    expect(scope.reportBuffer).toEqual([]);
  });

  it('does not substitute the client origin for an explicit request origin', () => {
    const { request, document, scope } = createWindow();
    request.origin = obtainURLOrigin(parseURL('https://other.test/').url!);
    request.urlList = [document.url];
    expect(request.isAllowedToUseFeature(feature.name)).toBe(false);
    expect(scope.reports).toHaveLength(1);
    expect(scope.reports[0]!.data).toMatchObject({ disposition: 'enforce' });
  });

  it('accepts an explicit foreign request origin allowed by the client policy', () => {
    const { request, scope } = createWindow('cross-origin-isolated=("https://allowed.test")');
    request.origin = obtainURLOrigin(parseURL('https://allowed.test/').url!);
    expect(request.isAllowedToUseFeature(feature.name)).toBe(true);
    // The default report-only policy still restricts this foreign origin to self.
    expect(scope.reports).toHaveLength(1);
    expect(scope.reports[0]!.data).toMatchObject({ disposition: 'report' });
  });

  it.each([
    { enforced: '*', observed: '*', enabled: true, disposition: null },
    { enforced: '*', observed: '()', enabled: true, disposition: 'report' },
    { enforced: '()', observed: '*', enabled: false, disposition: 'enforce' },
    { enforced: '()', observed: '()', enabled: false, disposition: 'enforce' },
  ])('checks enforced=$enforced and report-only=$observed', ({ enforced, observed, enabled, disposition }) => {
    const { request, window, scope } = createWindow(
      `cross-origin-isolated=${enforced};report-to=blocked`,
      `cross-origin-isolated=${observed};report-to=observed`,
    );
    const observer = new window.ReportingObserver(() => {});
    observer.observe();
    expect(request.isAllowedToUseFeature(feature.name)).toBe(enabled);
    const reports = observer.takeRecords();
    if (disposition === null) {
      expect(reports).toEqual([]);
      expect(scope.reports).toEqual([]);
      return;
    }
    expect(reports).toHaveLength(1);
    expect(scope.reports).toHaveLength(1);
    expect(reports[0]!.type).toBe('permissions-policy-violation');
    expect(reports[0]!.body!.toJSON()).toMatchObject({ featureId: feature.name, disposition });
    expect(scope.reports[0]!.destination).toBe(disposition === 'enforce' ? 'blocked' : 'observed');
  });

  it('cannot override inherited denial with a permissive response declaration', () => {
    const { request, document, scope } = createWindow('cross-origin-isolated=*');
    document.permissionsPolicyState.inheritedPolicy.set(feature, 'Disabled');
    expect(request.isAllowedToUseFeature(feature.name)).toBe(false);
    expect(scope.reports).toHaveLength(1);
  });

  it('selects and reports to the client rather than the owner or reserved environment', () => {
    const owner = createWindow('cross-origin-isolated=*');
    const client = createWindow('cross-origin-isolated=();report-to=client');
    owner.request.client = client.env;
    owner.request.reservedClient = owner.env;
    expect(owner.request.isAllowedToUseFeature(feature.name)).toBe(false);
    expect(owner.scope.reportBuffer).toEqual([]);
    expect(client.scope.reports).toHaveLength(1);
    expect(client.scope.reports[0]!.destination).toBe('client');
    expect(owner.request.env).toBe(owner.env);
  });

  it('retains the initiating Document policy after navigation without adding an activity gate', () => {
    const { request, env, document, traversable, scope } = createWindow('cross-origin-isolated=*');
    navigate(traversable, 'https://replacement.test/', 'cross-origin-isolated=()');
    expect(document.isFullyActive()).toBe(false);
    expect(env.getAssociatedDocument()).toBe(document);
    expect(document.isAllowedToUse(feature.name)).toBe(false);
    expect(request.isAllowedToUseFeature(feature.name)).toBe(true);
    expect(scope.reportBuffer).toEqual([]);
  });

  it.each([
    { policy: 'cross-origin-isolated=*', allowed: true },
    { policy: 'cross-origin-isolated=(self)', allowed: false },
  ])('checks an opaque request origin against $policy', ({ policy, allowed }) => {
    const { request } = createWindow(policy, 'cross-origin-isolated=*');
    request.origin = createOpaqueOrigin();
    expect(request.isAllowedToUseFeature(feature.name)).toBe(allowed);
  });

  it('rejects an unsupported internal feature name instead of inventing a policy definition', () => {
    const { request, scope } = createWindow();
    expect(() => request.isAllowedToUseFeature('unsupported-feature')).toThrow('Unsupported policy-controlled feature');
    expect(scope.reportBuffer).toEqual([]);
  });
});

function createWindow(enforced?: string, reportOnly?: string) {
  const traversable = TopLevelTraversable.create(createManualUserAgent(), null, '');
  const document = navigate(traversable, 'https://document.test/page', enforced, reportOnly);
  const realm = getRelevantRealm(traversable.activeWindow!);
  const env = realm.env;
  const request = new FetchRequest(parseURL('https://destination.test/resource').url!, env);
  request.client = env;
  request.populateFromClient();
  return { document, env, traversable, request, window: realm.globalObject, scope: env.getWindowOrWorkerGlobalScopeMixin() };
}

function navigate(traversable: TopLevelTraversable, url: string, enforced?: string, reportOnly?: string) {
  const response = new FetchResponse();
  response.urlList.push(parseURL(url).url!);
  if (enforced !== undefined) response.headerList.append('Permissions-Policy', enforced);
  if (reportOnly !== undefined) response.headerList.append('Permissions-Policy-Report-Only', reportOnly);
  const params = traversable.createNavigationParams(response);
  const document = traversable.createAndInitializeDocument('html', 'text/html', params);
  traversable.finalizeCrossDocumentNavigation('push', 'browser UI', traversable.createHistoryEntry(document, params));
  return document;
}
