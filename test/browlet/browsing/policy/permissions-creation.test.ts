import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { createDocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import { Navigable } from '../../../../src/browlet/browsing/navigation/navigable';
import { PermissionsPolicy } from '../../../../src/browlet/browsing/policy/permissions';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/iframe';
import type { Window } from '../../../../src/browlet/platform';
import { FetchResponse } from '../../../../src/fetch/response';
import { HTML_NAMESPACE } from '../../../../src/infra/index';
import { createOpaqueOrigin, obtainURLOrigin, parseURL, type Origin } from '../../../../src/url/index';
import { unwrap } from '../../../support/browlet-binding';
import { createTestDocument } from '../../../support/dom';

declare const window: Window;

const feature = PermissionsPolicy.getSupportedFeature('cross-origin-isolated')!;

describe('Permissions Policy §9.5: create a policy for a navigable', () => {
  it('enables top-level inheritance even at an opaque origin', () => {
    const policy = PermissionsPolicy.create(null, createOpaqueOrigin());
    expect(policy.inheritedPolicy.get(feature)).toBe('Enabled');
    expect(policy.declaredPolicy.declarations.size).toBe(0);
    expect(policy.declaredPolicy.reportingConfiguration.size).toBe(0);
  });

  it.each([
    ['https://parent.test/', '', 'Enabled'],
    ['https://child.test/', '', 'Disabled'],
    ['https://child.test/', 'cross-origin-isolated *', 'Enabled'],
    ['https://parent.test/', "cross-origin-isolated 'none'", 'Disabled'],
  ])('creates %s with allow=%j as %s', (url, allow, expected) => {
    const { iframe } = createContainer();
    iframe.setAttributeValue('allow', allow);
    expect(PermissionsPolicy.create(iframe, origin(url)).inheritedPolicy.get(feature)).toBe(expected);
  });

  it('uses the supplied destination origin when it differs from the declared src origin', () => {
    const { iframe } = createContainer();
    iframe.setAttributeValue('src', 'https://child.test/page');
    iframe.setAttributeValue('allow', feature.name);

    expect(PermissionsPolicy.create(iframe, origin('https://child.test/')).inheritedPolicy.get(feature)).toBe('Enabled');
    expect(PermissionsPolicy.create(iframe, origin('https://redirect.test/')).inheritedPolicy.get(feature)).toBe('Disabled');
    iframe.setAttributeValue('allow', 'cross-origin-isolated *');
    expect(PermissionsPolicy.create(iframe, origin('https://redirect.test/')).inheritedPolicy.get(feature)).toBe('Enabled');
  });

  it.each([
    ["'self'", 'Disabled'],
    ['https://child.test', 'Disabled'],
    ["'self' https://child.test", 'Enabled'],
  ])('requires the parent declaration %j to permit both origins', (allow, expected) => {
    const { document, iframe } = createContainer();
    document.permissionsPolicyState.declaredPolicy.declarations = PermissionsPolicy.parseDirective(
      `${feature.name} ${allow}`, document.origin,
    );
    document.permissionsPolicyState.declaredPolicy.reportingConfiguration.set(feature, 'parent-reports');
    iframe.setAttributeValue('allow', 'cross-origin-isolated *');

    const policy = PermissionsPolicy.create(iframe, origin('https://child.test/'));
    expect(policy.inheritedPolicy.get(feature)).toBe(expected);
    // Inherit availability, not the parent's response declarations or reporting endpoints.
    expect(policy.declaredPolicy.declarations.size).toBe(0);
    expect(policy.declaredPolicy.reportingConfiguration.size).toBe(0);
    expect(document.permissionsPolicyState.declaredPolicy.reportingConfiguration.get(feature)).toBe('parent-reports');
  });

  it('captures creation-time restrictions without sharing mutable parent or sibling state', () => {
    const { document, iframe } = createContainer();
    const childOrigin = origin('https://child.test/');
    iframe.setAttributeValue('allow', 'cross-origin-isolated *');
    const first = PermissionsPolicy.create(iframe, childOrigin);

    iframe.setAttributeValue('allow', "cross-origin-isolated 'none'");
    const second = PermissionsPolicy.create(iframe, childOrigin);
    expect(second.inheritedPolicy.get(feature)).toBe('Disabled');
    expect(first.inheritedPolicy.get(feature)).toBe('Enabled');

    iframe.setAttributeValue('allow', 'cross-origin-isolated *');
    document.permissionsPolicyState.inheritedPolicy.set(feature, 'Disabled');
    const third = PermissionsPolicy.create(iframe, childOrigin);
    expect(third.inheritedPolicy.get(feature)).toBe('Disabled');
    expect(first.inheritedPolicy.get(feature)).toBe('Enabled');
    third.inheritedPolicy.set(feature, 'Enabled');
    expect(document.permissionsPolicyState.inheritedPolicy.get(feature)).toBe('Disabled');
    expect(second.inheritedPolicy.get(feature)).toBe('Disabled');
  });

  it('carries inherited denial into a further descendant even with wildcard delegation', () => {
    const parent = createContainer();
    parent.iframe.setAttributeValue('allow', "cross-origin-isolated 'none'");
    const child = createContainer('https://child.test/');
    // Supply policy state directly: automatic child Document creation is still unfinished.
    child.document.permissionsPolicyState = PermissionsPolicy.create(parent.iframe, child.document.origin);
    child.iframe.setAttributeValue('allow', 'cross-origin-isolated *');

    const grandchild = PermissionsPolicy.create(child.iframe, origin('https://grandchild.test/'));
    expect(grandchild.inheritedPolicy.get(feature)).toBe('Disabled');
  });
});

describe('Permissions Policy §9.6: create a policy from a response', () => {
  it('combines inherited availability with the response allowlist and endpoint', () => {
    const { iframe } = createContainer();
    const childOrigin = origin('https://child.test/');
    iframe.setAttributeValue('allow', 'cross-origin-isolated *');
    const response = makeResponse('cross-origin-isolated=();report-to=blocked');
    const policy = PermissionsPolicy.fromResponse(iframe, childOrigin, response);

    expect(policy.inheritedPolicy.get(feature)).toBe('Enabled');
    expect(policy.declaredPolicy.declarations.has(feature)).toBe(true);
    expect(policy.check(feature, childOrigin, childOrigin)).toBe('Disabled');
    expect(policy.declaredPolicy.reportingConfiguration.get(feature)).toBe('blocked');
  });

  it.each(['container', 'parent'] as const)('cannot override a %s denial but retains the response endpoint', (source) => {
    const { document, iframe } = createContainer();
    const childOrigin = origin('https://child.test/');
    iframe.setAttributeValue('allow', source === 'container' ? "cross-origin-isolated 'none'" : 'cross-origin-isolated *');
    if (source === 'parent') document.permissionsPolicyState.inheritedPolicy.set(feature, 'Disabled');
    const response = makeResponse('cross-origin-isolated=*;report-to=child');
    const policy = PermissionsPolicy.fromResponse(iframe, childOrigin, response);

    expect(policy.inheritedPolicy.get(feature)).toBe('Disabled');
    expect(policy.declaredPolicy.declarations.has(feature)).toBe(false);
    expect(policy.check(feature, childOrigin, childOrigin)).toBe('Disabled');
    expect(policy.declaredPolicy.reportingConfiguration.get(feature)).toBe('child');
  });

  it.each([null, '', 'cross-origin-isolated=('])('preserves inherited restrictions with an absent or invalid field: %j', (header) => {
    const { document, iframe } = createContainer();
    document.permissionsPolicyState.inheritedPolicy.set(feature, 'Disabled');
    const policy = PermissionsPolicy.fromResponse(iframe, document.origin, makeResponse(header));
    expect(policy.inheritedPolicy.get(feature)).toBe('Disabled');
    expect(policy.declaredPolicy.declarations.size).toBe(0);
    expect(policy.declaredPolicy.reportingConfiguration.size).toBe(0);
  });

  it('uses the supplied origin for self, including an opaque sandbox origin', () => {
    const opaque = createOpaqueOrigin();
    const policy = PermissionsPolicy.fromResponse(null, opaque, makeResponse('cross-origin-isolated=self'));
    expect(policy.check(feature, opaque, opaque)).toBe('Enabled');
    expect(policy.check(feature, origin('https://child.test/'), opaque)).toBe('Disabled');
    expect(policy.check(feature, createOpaqueOrigin(), opaque)).toBe('Disabled');
  });

  it('selects independent enforced and report-only response records', () => {
    const childOrigin = origin('https://child.test/');
    const response = makeResponse('cross-origin-isolated=();report-to=enforced', 'cross-origin-isolated=*;report-to=observed');
    const enforced = PermissionsPolicy.fromResponse(null, childOrigin, response);
    const observed = PermissionsPolicy.fromResponse(null, childOrigin, response, true);
    expect(enforced.check(feature, childOrigin, childOrigin)).toBe('Disabled');
    expect(observed.check(feature, childOrigin, childOrigin)).toBe('Enabled');
    expect(enforced.declaredPolicy.reportingConfiguration.get(feature)).toBe('enforced');
    expect(observed.declaredPolicy.reportingConfiguration.get(feature)).toBe('observed');

    observed.declaredPolicy.reportingConfiguration.clear();
    const recreated = PermissionsPolicy.fromResponse(null, childOrigin, response, true);
    expect(recreated.declaredPolicy.reportingConfiguration.get(feature)).toBe('observed');
    expect(enforced.declaredPolicy.reportingConfiguration.get(feature)).toBe('enforced');
  });

  it('uses enforced parent inheritance even when selecting the report-only response header', () => {
    const { document, iframe } = createContainer();
    document.permissionsPolicyState.inheritedPolicy.set(feature, 'Disabled');
    iframe.setAttributeValue('allow', 'cross-origin-isolated *');
    const policy = PermissionsPolicy.fromResponse(
      iframe, origin('https://child.test/'), makeResponse(null, 'cross-origin-isolated=*;report-to=observed'), true,
    );
    // §9.6 selects the header; its §9.5 inheritance call has no report-only argument.
    expect(document.reportOnlyPermissionsPolicyState.inheritedPolicy.get(feature)).toBe('Enabled');
    expect(policy.inheritedPolicy.get(feature)).toBe('Disabled');
    expect(policy.declaredPolicy.declarations.size).toBe(0);
    expect(policy.declaredPolicy.reportingConfiguration.get(feature)).toBe('observed');
  });
});

describe('Permissions Policy response Document initialization', () => {
  it('uses the actual container when initializing a supplied child destination', () => {
    const browser = new Browlet({ route: () => '' });
    const parent = unwrap<DocumentImpl>(browser.document).getNodeNavigable()!;
    // Supply the unfinished child lifecycle; exercise the real response-initialization path.
    const group = parent.activeBrowsingContext!.group!;
    const [context, initial] = BrowsingContext.create(null, null, group);
    group.append(context);
    const child = new Navigable(createDocumentState(initial), parent);
    const iframe = unwrap<HTMLIFrameElementImpl>(browser.document.createElement('iframe'));
    iframe.setAttributeValue('allow', "cross-origin-isolated 'none'");
    iframe.contentNavigable = child;
    const response = makeResponse('cross-origin-isolated=*;report-to=child');

    const document = child.createAndInitializeDocument('html', 'text/html', child.createNavigationParams(response));
    expect(document.permissionsPolicyState.inheritedPolicy.get(feature)).toBe('Disabled');
    expect(document.permissionsPolicyState.declaredPolicy.declarations.size).toBe(0);
    expect(document.permissionsPolicyState.declaredPolicy.reportingConfiguration.get(feature)).toBe('child');
    expect(document.reportOnlyPermissionsPolicyState.inheritedPolicy.get(feature)).toBe('Disabled');
  });

  it('installs both response policies and replaces them on later navigation', async () => {
    const browser = new Browlet({ route: () => '' });
    const initial = unwrap<DocumentImpl>(browser.document);
    const document = navigate(browser, makeResponse(
      'cross-origin-isolated=();report-to=enforced', 'cross-origin-isolated=*;report-to=observed',
    ));

    expect(await browser.evaluate(() => window.document.permissionsPolicy.allowsFeature('cross-origin-isolated'))).toBe(false);
    expect(document.reportOnlyPermissionsPolicyState.check(feature, document.origin, document.origin)).toBe('Enabled');
    expect(document.permissionsPolicyState.declaredPolicy.reportingConfiguration.get(feature)).toBe('enforced');
    expect(document.reportOnlyPermissionsPolicyState.declaredPolicy.reportingConfiguration.get(feature)).toBe('observed');
    expect(initial.permissionsPolicyState.declaredPolicy.declarations.size).toBe(0);

    const replacement = navigate(browser, makeResponse(null));
    expect(await browser.evaluate(() => window.document.permissionsPolicy.allowsFeature('cross-origin-isolated'))).toBe(true);
    expect(replacement.permissionsPolicyState.declaredPolicy.declarations.size).toBe(0);
    expect(replacement.reportOnlyPermissionsPolicyState.declaredPolicy.reportingConfiguration.size).toBe(0);
    expect(document.permissionsPolicyState.check(feature, document.origin, document.origin)).toBe('Disabled');
    expect(document.reportOnlyPermissionsPolicyState.declaredPolicy.reportingConfiguration.get(feature)).toBe('observed');
  });

  it('keeps a report-only restriction out of enforced policy inspection', async () => {
    const browser = new Browlet({ route: () => '' });
    const document = navigate(browser, makeResponse(null, 'cross-origin-isolated=()'));
    expect(await browser.evaluate(() => window.document.permissionsPolicy.allowsFeature('cross-origin-isolated'))).toBe(true);
    expect(document.reportOnlyPermissionsPolicyState.check(feature, document.origin, document.origin)).toBe('Disabled');
  });
});

function origin(url: string): Origin {
  return obtainURLOrigin(parseURL(url).url!);
}

function createContainer(url = 'https://parent.test/') {
  const document = createTestDocument();
  document.url = parseURL(url).url!;
  document.origin = obtainURLOrigin(document.url);
  const iframe = document.createElementNode('iframe', HTML_NAMESPACE);
  if (!HTMLIFrameElementImpl.is(iframe)) throw new Error('Expected an iframe implementation');
  return { document, iframe };
}

function makeResponse(enforced: string | null, reportOnly: string | null = null): FetchResponse {
  const response = new FetchResponse();
  response.urlList.push(parseURL('https://child.test/').url!);
  if (enforced !== null) response.headerList.append('Permissions-Policy', enforced);
  if (reportOnly !== null) response.headerList.append('Permissions-Policy-Report-Only', reportOnly);
  return response;
}

function navigate(browser: Browlet, response: FetchResponse): DocumentImpl {
  const navigable = unwrap<DocumentImpl>(browser.document).getNodeNavigable()!;
  const params = navigable.createNavigationParams(response);
  const document = navigable.createAndInitializeDocument('html', 'text/html', params);
  const entry = navigable.createHistoryEntry(document, params);
  navigable.finalizeCrossDocumentNavigation('push', 'browser UI', entry);
  return document;
}
