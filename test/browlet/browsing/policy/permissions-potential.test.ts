import { describe, expect, it } from 'vitest';

import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { DocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import { Navigable, TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/navigable';
import { PermissionsPolicy } from '../../../../src/browlet/browsing/policy/permissions';
import type { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/iframe';
import type { Report } from '../../../../src/browlet/platform';
import { FetchResponse } from '../../../../src/fetch/index';
import { parseURL } from '../../../../src/url/index';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { getRelevantRealm, unwrap } from '../../../support/browlet-binding';

const feature = PermissionsPolicy.getSupportedFeature('cross-origin-isolated')!;
const type = 'potential-permissions-policy-violation';

describe('Permissions Policy §§9.12 and 9.14: potential iframe violations', () => {
  it.each([
    { enforced: '*', observed: '*', disposition: null },
    { enforced: '*', observed: '()', disposition: 'report' },
    { enforced: '()', observed: '*', disposition: 'enforce' },
    { enforced: '()', observed: '()', disposition: 'enforce' },
  ])('checks parent enforced=$enforced, report-only=$observed', ({ enforced, observed, disposition }) => {
    const { iframe, window, scope } = createWindow(
      `cross-origin-isolated=${enforced};report-to=blocked`,
      `cross-origin-isolated=${observed};report-to=observed`,
    );
    iframe.setAttributeValue('src', 'https://child.test/page');
    iframe.setAttributeValue('allow', 'cross-origin-isolated *');
    const observer = new window.ReportingObserver(() => {}, { types: [type] });
    observer.observe();
    check(iframe);
    const reports = observer.takeRecords();
    if (disposition === null) {
      expect(reports).toEqual([]);
      expect(scope.reports).toEqual([]);
      return;
    }
    // Enforced denial wins when both policies would prevent inheritance.
    expect(reports).toHaveLength(1);
    expect(scope.reports).toHaveLength(1);
    expect(reports[0]!.type).toBe(type);
    expect(reports[0]!.url).toBe('https://parent.test/page');
    expect(reports[0]!.body).toBeInstanceOf(window.PermissionsPolicyViolationReportBody);
    expect(reports[0]!.body!.toJSON()).toEqual({
      featureId: feature.name, sourceFile: null, lineNumber: null, columnNumber: null,
      disposition, allowAttribute: 'cross-origin-isolated *', srcAttribute: 'https://child.test/page',
    });
    expect(scope.reports[0]!.destination).toBe(disposition === 'enforce' ? 'blocked' : 'observed');
    expect(scope.reports[0]!.data).toEqual(reports[0]!.body!.toJSON());
  });

  it.each([null, '', 'unrecognized-feature *'])('reports a default restriction without a recognized allow directive: %j', (allow) => {
    const { iframe, scope } = createWindow();
    iframe.setAttributeValue('src', 'https://child.test/page');
    if (allow !== null) iframe.setAttributeValue('allow', allow);
    check(iframe);
    // §9.12 checks every supported feature, even absent from allow (unlike Chromium).
    expect(scope.reports).toHaveLength(1);
    expect(scope.reports[0]!.data).toMatchObject({ featureId: feature.name, disposition: 'enforce', allowAttribute: allow });
    expect(scope.reports[0]!.destination).toBe('');
  });

  it('requires the parent to permit its own origin as well as the child origin', () => {
    const { iframe, scope } = createWindow('cross-origin-isolated=("https://child.test");report-to=blocked');
    iframe.setAttributeValue('src', 'https://child.test/page');
    iframe.setAttributeValue('allow', 'cross-origin-isolated *');
    check(iframe);
    expect(scope.reports).toHaveLength(1);
    expect(scope.reports[0]!.data).toMatchObject({ disposition: 'enforce' });
    expect(scope.reports[0]!.destination).toBe('blocked');
  });

  it('reports inherited report-only restrictions from the parent', () => {
    const { document, iframe, scope } = createWindow('cross-origin-isolated=*', 'cross-origin-isolated=*;report-to=observed');
    document.reportOnlyPermissionsPolicyState.inheritedPolicy.set(feature, 'Disabled');
    iframe.setAttributeValue('allow', 'cross-origin-isolated *');
    check(iframe);
    expect(scope.reports).toHaveLength(1);
    expect(scope.reports[0]!.data).toMatchObject({ disposition: 'report', srcAttribute: null });
    expect(scope.reports[0]!.destination).toBe('observed');
  });

  it('checks current src and srcdoc origins without a loaded child', () => {
    const { iframe, scope } = createWindow();
    iframe.setAttributeValue('src', '/child');
    check(iframe);
    expect(scope.reports).toEqual([]);
    iframe.setAttributeValue('src', 'https://child.test/');
    check(iframe);
    expect(scope.reports).toHaveLength(1);
    iframe.setAttributeValue('srcdoc', '');
    check(iframe);
    expect(scope.reports).toHaveLength(1);
    expect(iframe.contentNavigable).toBeNull();
  });

  it('does not expose a supplied child Document\'s private policy', () => {
    const { document, iframe, scope } = createWindow();
    const parent = document.getNodeNavigable()!;
    const group = parent.activeBrowsingContext!.group!;
    const [context, childDocument] = BrowsingContext.create(null, null, group);
    group.append(context);
    iframe.contentNavigable = new Navigable(DocumentState.create(childDocument), parent);
    childDocument.permissionsPolicyState.inheritedPolicy.set(feature, 'Disabled');
    childDocument.reportOnlyPermissionsPolicyState.inheritedPolicy.set(feature, 'Disabled');
    iframe.setAttributeValue('src', 'https://child.test/');
    iframe.setAttributeValue('allow', 'cross-origin-isolated *');
    // This supplies child state, without claiming to implement iframe loading.
    check(iframe);
    expect(scope.reports).toEqual([]);
  });

  it('uses a changed allow attribute and wildcard delegation for an opaque sandbox origin', () => {
    const { iframe, scope } = createWindow();
    iframe.setAttributeValue('sandbox', 'allow-scripts');
    iframe.setAttributeValue('allow', 'cross-origin-isolated *');
    expect(iframe.declaredOrigin.kind).toBe('opaque');
    check(iframe);
    expect(scope.reports).toEqual([]);
    iframe.setAttributeValue('allow', "cross-origin-isolated 'none'");
    check(iframe);
    expect(scope.reports).toHaveLength(1);
    expect(scope.reports[0]!.data).toMatchObject({ disposition: 'enforce' });
  });

  it.each([
    { allow: null, src: null },
    { allow: '', src: '' },
    { allow: "  cross-origin-isolated 'none'  ", src: '../child?mode=test#fragment' },
  ])('preserves the supplied raw attribute snapshot %j', ({ allow, src }) => {
    const { iframe, scope } = createWindow('cross-origin-isolated=()');
    iframe.setAttributeValue('allow', 'cross-origin-isolated *');
    iframe.checkPotentialPermissionsPolicyViolation(allow, src);
    // The supplied text is diagnostic data; policy checks use the actual current attributes.
    const data = scope.reports[0]!.cloneForDelivery().data;
    expect(data).toMatchObject({ allowAttribute: allow, srcAttribute: src });
    expect(Object.hasOwn(data as object, 'allowAttribute')).toBe(true);
    expect(Object.hasOwn(data as object, 'srcAttribute')).toBe(true);
  });

  it('delivers endpointless reports on the embedding event loop, with attributes captured before delivery', () => {
    const { iframe, window, env, scope } = createWindow();
    env.userAgent.reportDeliveryEnabled = false;
    const batches: Report[][] = [];
    new window.ReportingObserver((reports) => { batches.push(reports); }, { types: [type] }).observe();
    const actual = new window.ReportingObserver(() => {}, { types: ['permissions-policy-violation'] });
    actual.observe();
    iframe.setAttributeValue('allow', "cross-origin-isolated 'none'");
    check(iframe);
    iframe.setAttributeValue('allow', 'cross-origin-isolated *');
    expect(batches).toEqual([]);
    env.realm.agent.eventLoop.runTaskTurn();
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(1);
    expect(batches[0]![0]!.body!.toJSON()).toMatchObject({ allowAttribute: "cross-origin-isolated 'none'", srcAttribute: null });
    expect(actual.takeRecords()).toEqual([]);
    expect(scope.reports).toEqual([]);
    expect(scope.reportBuffer).toHaveLength(1);
  });

  it('uses the current node Document for both policy and reporting after adoption', () => {
    const first = createWindow();
    const second = createWindow('cross-origin-isolated=();report-to=adopted', undefined, 'https://new-parent.test/');
    const originalObserver = new first.window.ReportingObserver(() => {});
    const newObserver = new second.window.ReportingObserver(() => {});
    originalObserver.observe();
    newObserver.observe();
    first.iframe.setAttributeValue('allow', 'cross-origin-isolated *');
    second.document.adoptNode(first.iframe);
    expect(first.iframe.nodeDocument).toBe(second.document);
    expect(first.iframe.env).toBe(first.env);
    check(first.iframe);
    expect(originalObserver.takeRecords()).toEqual([]);
    expect(first.scope.reports).toEqual([]);
    const reports = newObserver.takeRecords();
    expect(reports).toHaveLength(1);
    expect(reports[0]!.url).toBe('https://new-parent.test/');
    expect(second.scope.reports[0]!.destination).toBe('adopted');
  });

  it('does not run the load-time check merely because attributes or insertion change', () => {
    const { document, iframe, scope } = createWindow('cross-origin-isolated=()');
    iframe.setAttributeValue('allow', "cross-origin-isolated 'none'");
    iframe.setAttributeValue('src', 'https://child.test/');
    document.appendChild(iframe);
    expect(scope.reportBuffer).toEqual([]);
    // The unfinished iframe load event steps must call this check after dispatching load.
    check(iframe);
    expect(scope.reportBuffer).toHaveLength(1);
  });
});

function check(iframe: HTMLIFrameElementImpl): void {
  iframe.checkPotentialPermissionsPolicyViolation(iframe.getAttributeNS(null, 'allow'), iframe.getAttributeNS(null, 'src'));
}

// Supply a response-installed parent policy; child loading is a separate integration dependency.
function createWindow(enforced?: string, reportOnly?: string, url = 'https://parent.test/page#fragment') {
  const traversable = TopLevelTraversable.create(createManualUserAgent(), null, '');
  const response = new FetchResponse();
  response.urlList.push(parseURL(url).url!);
  if (enforced !== undefined) response.headerList.append('Permissions-Policy', enforced);
  if (reportOnly !== undefined) response.headerList.append('Permissions-Policy-Report-Only', reportOnly);
  const params = traversable.createNavigationParams(response);
  const document = traversable.createAndInitializeDocument('html', 'text/html', params);
  traversable.finalizeCrossDocumentNavigation('push', 'browser UI', traversable.createHistoryEntry(document, params));
  const realm = getRelevantRealm(traversable.activeWindow!);
  const env = realm.env;
  const window = realm.globalObject;
  const iframe = unwrap<HTMLIFrameElementImpl>(window.document.createElement('iframe'));
  return { document, iframe, window, env, scope: env.getWindowOrWorkerGlobalScopeMixin() };
}
